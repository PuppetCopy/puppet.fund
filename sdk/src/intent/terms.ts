import { accountmoduleAbi, escrowstoreAbi, fundaccountAbi, fundstoreAbi, mandatestoreAbi, shareAbi, useraccountAbi } from '@puppet/contracts/abi'
import { HUB_CHAIN_ID, PRECISION } from '@puppet/contracts/const'
import type {
  IAccountLib__Mandate,
  IFund__Allocation,
  IFund__Asset,
  IFund__Position,
  IFund__Valuation,
  IFundStore__Holding,
  IFundStore__Position,
  IFundStore__Queue
} from '@puppet/contracts/types'
import { type Address, erc20Abi, getAddress, type Hex, isAddressEqual, keccak256, type PublicClient, parseAbi, parseAbiItem, toHex, } from 'viem'
import { accountModuleAddress } from '../account/createAccount.js'
import { composeAllocation } from '../allocation/index.js'
import { CompactError, formatThrownError } from '../compact/error.js'
import { CHAIN_ID_LIST, type ChainId, deploymentAddress } from '../const/index.js'
import type { IDigestClient } from '../datastore/index.js'
import { evaluateFundAt, type IGetRate, type IRate, VALUE_KEY } from '../evaluate/index.js'
import { cashFor, floorOf, unitsFor } from '../pool/index.js'
import { accountTable, type IMandateRow, type ITransitRow, mandateTable, transitTable } from '../schema/index.js'
import { bondTokenOf, type ITokenRegistryMap, registeredTokenAddresses, symbolOf, symbolOfKey } from '../state/tokenRegistry.js'
import { VENUES } from '../venue/venues.js'
import { acrossSpokePoolOf } from './route/acrossDeposit.js'
import { mandateDigest, mandateOfRow } from './shared.js'

const COHORT_MIN_STAKE = 1_000_000n

const HUB = HUB_CHAIN_ID as ChainId
const VALUE_SYMBOL = symbolOfKey(VALUE_KEY)
const ACROSS_VENUE = keccak256(toHex('across'))
const VENUE_BOOK_DUST = 10_000n
const ACROSS_FILLED = 2n
const REFUND_LOG_WINDOW = 5_000n
const SPOKE_POOL_ABI = parseAbi([
  'function fillStatuses(bytes32 relayHash) view returns (uint256)',
  'function getRelayerRefund(address l2TokenAddress, address refundAddress) view returns (uint256)'
])
const EXECUTED_RELAYER_REFUND_ROOT = parseAbiItem(
  'event ExecutedRelayerRefundRoot(uint256 amountToReturn, uint256 indexed chainId, uint256[] refundAmounts, uint32 indexed rootBundleId, uint32 indexed leafId, address l2TokenAddress, address[] refundAddresses, bool deferredRefunds, address caller)'
)

export interface ITermsDeps {
  chronicle: IDigestClient
  clients: Readonly<Record<number, PublicClient>>
  getRate: IGetRate
  getTokenRegistry: () => Promise<ITokenRegistryMap>
}

const fromChronicle = <T>(what: string, read: Promise<T>): Promise<T> =>
  read.catch(err => {
    throw new CompactError('CHRONICLE_UNAVAILABLE', `${what} could not be read from the chronicle: ${formatThrownError(err)}`, 'server')
  })

export const fromChain = <T>(what: string, chainId: number, read: Promise<T>): Promise<T> =>
  read.catch(err => {
    throw new CompactError('CHAIN_UNREACHABLE', `${what} read failed on chain ${chainId}; nothing can be signed against it: ${formatThrownError(err)}`, 'server')
  })

export function clientOf(deps: Pick<ITermsDeps, 'clients'>, chainId: ChainId): PublicClient {
  const client = deps.clients[chainId]
  if (client === undefined) throw new CompactError('CHAIN_UNAVAILABLE', `no client for chain ${chainId}`, 'server')
  return client
}

const mandateOf = (row: IMandateRow): IAccountLib__Mandate => ({ ...mandateOfRow(row), master: getAddress(row.master) })

async function readMandates(chronicle: IDigestClient, master: Address): Promise<Map<Address, IMandateRow>> {
  const rows = await fromChronicle(`mandates naming ${master}`, chronicle.select(mandateTable, { where: { master } }))
  return new Map(rows.map(r => [getAddress(r.puppet), r]))
}

export interface IFundState {
  skin: bigint
  queue: IFundStore__Queue
  share: Address
  supply: bigint
  queued: bigint
  masterUnits: bigint
}

export async function readFundState(deps: Pick<ITermsDeps, 'clients'>, master: Address, share: Address): Promise<IFundState> {
  const address = deploymentAddress('FundStore', HUB)
  const client = clientOf(deps, HUB)
  const [skin, queue] = await fromChain(
    `the fund of ${master}`,
    HUB,
    client.multicall({
      allowFailure: false,
      contracts: [
        { address, abi: fundstoreAbi, functionName: 'skinMap', args: [master] },
        { address, abi: fundstoreAbi, functionName: 'getQueue', args: [master] }
      ]
    })
  )
  const [supply, queued, masterUnits] = await fromChain(
    `the units of ${master}`,
    HUB,
    client.multicall({
      allowFailure: false,
      contracts: [
        { address: share, abi: shareAbi, functionName: 'totalSupply' },
        { address: share, abi: shareAbi, functionName: 'balanceOf', args: [address] },
        { address: share, abi: shareAbi, functionName: 'balanceOf', args: [master] }
      ]
    })
  )
  return { skin, queue, share, supply, queued, masterUnits }
}

export async function readBoundParent(deps: Pick<ITermsDeps, 'clients'>, chainId: ChainId, master: Address): Promise<Address | null> {
  const client = clientOf(deps, chainId)
  const code = await fromChain(`the code of ${master}`, chainId, client.getCode({ address: master }))
  if (code === undefined || code === '0x') return null
  const [module, parent] = await fromChain(
    `the binding of ${master}`,
    chainId,
    client.readContract({ address: master, abi: fundaccountAbi, functionName: 'bound' })
  )
  return isAddressEqual(module, accountModuleAddress()) ? getAddress(parent) : null
}

export interface IEscrowCredit {
  escrowed: bigint
  credited: bigint
  fulfilled: bigint
  hubShutdown: boolean
  chainShutdown: boolean
}

export const creditableOf = (credit: IEscrowCredit): bigint =>
  credit.escrowed - (credit.credited > credit.fulfilled ? credit.credited : credit.fulfilled)

export async function readEscrowCredit(
  deps: Pick<ITermsDeps, 'clients'>,
  parent: Address,
  master: Address,
  chainId: ChainId,
  token: Address
): Promise<IEscrowCredit> {
  const store = deploymentAddress('EscrowStore', chainId)
  const [[escrowed, fulfilled, chainShutdown], [credited, hubShutdown]] = await Promise.all([
    fromChain(
      `the ${token} escrow of ${master}`,
      chainId,
      clientOf(deps, chainId).multicall({
        allowFailure: false,
        contracts: [
          { address: store, abi: escrowstoreAbi, functionName: 'escrowedMap', args: [parent, master, token] },
          { address: store, abi: escrowstoreAbi, functionName: 'fulfilledMap', args: [parent, master, token] },
          { address: store, abi: escrowstoreAbi, functionName: 'shutdown' }
        ]
      })
    ),
    fromChain(
      `the credit of ${master} on chain ${chainId}`,
      HUB,
      clientOf(deps, HUB).multicall({
        allowFailure: false,
        contracts: [
          { address: deploymentAddress('FundStore', HUB), abi: fundstoreAbi, functionName: 'creditedMap', args: [master, BigInt(chainId), token] },
          { address: deploymentAddress('EscrowStore', HUB), abi: escrowstoreAbi, functionName: 'shutdown' }
        ]
      })
    )
  ])
  return { escrowed, credited, fulfilled, hubShutdown, chainShutdown }
}

export async function readPoolPosition(
  deps: Pick<ITermsDeps, 'clients'>,
  master: Address,
  holder: Address
): Promise<{ holding: IFundStore__Holding; position: IFundStore__Position; queue: IFundStore__Queue; closedAccrued: bigint }> {
  const address = deploymentAddress('FundStore', HUB)
  const client = clientOf(deps, HUB)
  const [holding, position, queue] = await fromChain(
    `the holding of ${holder} in the fund of ${master}`,
    HUB,
    client.multicall({
      allowFailure: false,
      contracts: [
        { address, abi: fundstoreAbi, functionName: 'getHolding', args: [master, holder] },
        { address, abi: fundstoreAbi, functionName: 'getPosition', args: [master, holder] },
        { address, abi: fundstoreAbi, functionName: 'getQueue', args: [master] }
      ]
    })
  )
  const closedAccrued = await fromChain(
    `closed accrual of ${master} epoch ${position.epoch}`,
    HUB,
    client.readContract({ address, abi: fundstoreAbi, functionName: 'closedAccruedMap', args: [master, position.epoch] })
  )
  return { holding, position, queue, closedAccrued }
}

type IPinnedBlocks = ReadonlyMap<ChainId, { number: bigint; timestamp: bigint }>

export async function pinBlocks(deps: Pick<ITermsDeps, 'clients'>): Promise<IPinnedBlocks> {
  const blocks = await Promise.all(CHAIN_ID_LIST.map(chainId => fromChain('latest block', chainId, clientOf(deps, chainId).getBlock())))
  return new Map(CHAIN_ID_LIST.map((chainId, i) => [chainId, { number: blocks[i]!.number, timestamp: blocks[i]!.timestamp }] as const))
}

type ITransit = { row: ITransitRow } & (
  | { kind: 'filled' }
  | { kind: 'fillable'; fillStatus: bigint }
  | { kind: 'expired'; fillStatus: bigint; refunded: bigint; deferred: bigint; owed: bigint }
)

const pinnedOf = (blocks: IPinnedBlocks, chainId: number | bigint): { number: bigint; timestamp: bigint } => {
  const block = blocks.get(Number(chainId) as ChainId)
  if (block === undefined) throw new CompactError('CHAIN_UNAVAILABLE', `no pinned block for chain ${chainId}`, 'server')
  return block
}

export async function readTransits(deps: Pick<ITermsDeps, 'clients' | 'chronicle'>, master: Address, blocks: IPinnedBlocks): Promise<ITransit[]> {
  const account = getAddress(master)
  const [heads, folded, rows] = await Promise.all([
    Promise.all(
      [...blocks].map(([chainId, block]) =>
        fromChain(
          `the last call block of ${account}`,
          chainId,
          clientOf(deps, chainId).readContract({
            address: deploymentAddress('AccountModule', chainId),
            abi: accountmoduleAbi,
            functionName: 'accountBlockMap',
            args: [account],
            blockNumber: block.number
          })
        ).then(head => [chainId, head] as const)
      )
    ),
    fromChronicle(`bodies of ${account}`, deps.chronicle.select(accountTable, { where: { account } })),
    fromChronicle(`bridge transits of ${account}`, deps.chronicle.select(transitTable, { where: { account } }))
  ])
  for (const [chainId, head] of heads) {
    const row = folded.find(r => Number(r.chainId) === chainId)
    if (row === undefined && head > 0n) {
      const code = await fromChain(
        `the code of ${account}`,
        chainId,
        clientOf(deps, chainId).getCode({ address: account, blockNumber: pinnedOf(blocks, chainId).number })
      )
      if (code === undefined || code === '0x') continue
      const body = code.toLowerCase() === `0xef0100${deploymentAddress('FundAccount', chainId).slice(2)}`.toLowerCase()
      if (body && (await readBoundParent(deps, chainId, account)) === null) continue
    }
    const lastBlock = row === undefined ? 0n : BigInt(row.lastBlock)
    if (lastBlock < head) {
      throw new CompactError(
        'CHRONICLE_BEHIND',
        `the chronicle folded ${account} on chain ${chainId} up to block ${lastBlock} while the AccountModule records a call at block ${head}; retry once it catches up`,
        'soft'
      )
    }
  }
  const latest = new Map<bigint, ITransitRow>()
  for (const row of rows) {
    if (BigInt(row.block) > pinnedOf(blocks, row.chainId).number) continue
    const held = latest.get(row.chainId)
    if (held === undefined || row.block > held.block || (row.block === held.block && row.logIndex > held.logIndex)) latest.set(row.chainId, row)
  }
  return Promise.all(
    [...latest.values()].map(async (row): Promise<ITransit> => {
      const originChainId = Number(row.chainId) as ChainId
      const destinationChainId = Number(row.destinationChainId) as ChainId
      const destination = pinnedOf(blocks, row.destinationChainId)
      const fillStatus = await fromChain(
        `the Across fill of ${row.relayHash}`,
        destinationChainId,
        clientOf(deps, destinationChainId).readContract({
          address: acrossSpokePoolOf(destinationChainId),
          abi: SPOKE_POOL_ABI,
          functionName: 'fillStatuses',
          args: [row.relayHash],
          blockNumber: destination.number
        })
      )
      if (fillStatus === ACROSS_FILLED) return { row, kind: 'filled' }
      if (destination.timestamp <= BigInt(row.fillDeadline)) return { row, kind: 'fillable', fillStatus }
      const origin = clientOf(deps, originChainId)
      const spokePool = acrossSpokePoolOf(originChainId)
      const pinned = pinnedOf(blocks, row.chainId).number
      let refunded = 0n
      for (let from = BigInt(row.block); from <= pinned && refunded < row.inputAmount; from += REFUND_LOG_WINDOW) {
        const to = from + REFUND_LOG_WINDOW - 1n < pinned ? from + REFUND_LOG_WINDOW - 1n : pinned
        const leaves = await fromChain(
          `Across refunds to ${account}`,
          originChainId,
          origin.getLogs({ address: spokePool, event: EXECUTED_RELAYER_REFUND_ROOT, args: { chainId: row.chainId }, fromBlock: from, toBlock: to, strict: true })
        )
        for (const leaf of leaves) {
          if (!isAddressEqual(leaf.args.l2TokenAddress, row.inputToken)) continue
          leaf.args.refundAddresses.forEach((refundAddress, i) => {
            if (isAddressEqual(refundAddress, account)) refunded += leaf.args.refundAmounts[i]!
          })
        }
      }
      const deferred = await fromChain(
        `deferred Across refunds to ${account}`,
        originChainId,
        origin.readContract({ address: spokePool, abi: SPOKE_POOL_ABI, functionName: 'getRelayerRefund', args: [row.inputToken, account], blockNumber: pinned })
      )
      const owed = (refunded < row.inputAmount ? row.inputAmount - refunded : 0n) + deferred
      return { row, kind: 'expired', fillStatus, refunded, deferred, owed }
    })
  )
}

interface IValuationRates {
  toValue(chainId: ChainId, token: Address, amount: bigint): bigint
  rates: readonly { chainId: ChainId; token: Address; rate: IRate }[]
}

export async function valuationRatesOf(getRate: IGetRate, tokens: readonly { chainId: ChainId; token: Address }[]): Promise<IValuationRates> {
  const rates = await Promise.all(
    tokens.map(async ({ chainId, token }) => {
      const symbol = symbolOf(chainId, token)
      const rate = symbol === VALUE_SYMBOL ? { token0: 1n, token1: 1n, time: 0 } : await getRate(symbol, VALUE_SYMBOL)
      return { chainId, token: getAddress(token), rate }
    })
  )
  return {
    rates,
    toValue: (chainId, token, amount) => {
      const found = rates.find(r => r.chainId === chainId && r.token === getAddress(token))
      if (found === undefined) throw new Error(`${token} on chain ${chainId} was not priced for this valuation`)
      return (amount * found.rate.token0) / found.rate.token1
    }
  }
}

export async function composeValuation(deps: ITermsDeps, master: Address): Promise<IFund__Valuation> {
  const registry = await deps.getTokenRegistry()
  const used: { symbol0: string; symbol1: string; rate: IRate }[] = []
  const getRate: IGetRate = async (asset0, asset1, freshness) => {
    const rate = await deps.getRate(asset0, asset1, freshness)
    used.push({ symbol0: asset0, symbol1: asset1, rate })
    return rate
  }
  const assetList: IFund__Asset[] = []
  const positionList: IFund__Position[] = []
  let value = 0n
  const blocks = await pinBlocks(deps)
  const transits = await readTransits(deps, master, blocks)
  for (const chainId of CHAIN_ID_LIST) {
    const client = clientOf(deps, chainId)
    const tokens = registeredTokenAddresses(registry, chainId)
    const block = pinnedOf(blocks, chainId)
    const result = await fromChain(
      `the fund of ${master}`,
      chainId,
      evaluateFundAt({
        client,
        chainId,
        account: master,
        holdingTokens: tokens,
        blockNumber: block.number,
        blockTimestamp: Number(block.timestamp),
        kind: 'redeem',
        signerGain: null,
        getRate
      })
    )
    if (!result.ok) throw new CompactError('POOL_UNVALUABLE', result.reasons.map(r => r.detail).join('; '), 'soft')
    value += result.navMark
    for (const leg of result.breakdown.perChain) {
      if (leg.balance > 0n) assetList.push({ chainId: BigInt(chainId), token: bondTokenOf(chainId), amount: leg.balance })
    }
    for (const h of result.breakdown.holdings) {
      assetList.push({ chainId: BigInt(chainId), token: getAddress(h.token), amount: h.balance })
    }
    const books = new Map<string, { platform: string; net: bigint }>()
    for (const p of result.breakdown.positions) {
      if (p.facets?.kind === 'unpriced') continue
      const book = p.facets?.book
      if (book === undefined) {
        if (p.netBase < 0n) throw new CompactError('POOL_UNVALUABLE', `${p.platform} position ${p.positionKey} is worth ${p.netBase}`, 'soft')
        positionList.push({ chainId: BigInt(chainId), venue: keccak256(toHex(p.platform)), id: p.positionKey, valueInUsd: p.netBase })
        continue
      }
      const key = `${p.platform}:${master}:${String(book)}`
      const sum = books.get(key)
      books.set(key, { platform: p.platform, net: (sum?.net ?? 0n) + p.netBase })
    }
    for (const [key, { platform, net }] of books) {
      if (net < 0n) throw new CompactError('POOL_UNVALUABLE', `${key} margin book is worth ${net}`, 'soft')
      if (net < VENUE_BOOK_DUST) continue
      positionList.push({ chainId: BigInt(chainId), venue: keccak256(toHex(platform)), id: keccak256(toHex(key)), valueInUsd: net })
    }
  }
  const priced = await valuationRatesOf(
    getRate,
    transits.flatMap(transit => {
      const sent = { chainId: Number(transit.row.chainId) as ChainId, token: transit.row.inputToken }
      if (transit.kind === 'fillable') return [sent, { chainId: Number(transit.row.destinationChainId) as ChainId, token: transit.row.outputToken }]
      return transit.kind === 'expired' && transit.owed > 0n ? [sent] : []
    })
  )
  for (const transit of transits) {
    const originChainId = Number(transit.row.chainId) as ChainId
    if (transit.kind === 'fillable') {
      const delivered = priced.toValue(Number(transit.row.destinationChainId) as ChainId, transit.row.outputToken, transit.row.outputAmount)
      const sent = priced.toValue(originChainId, transit.row.inputToken, transit.row.inputAmount)
      const worth = delivered < sent ? delivered : sent
      value += worth
      positionList.push({ chainId: transit.row.destinationChainId, venue: ACROSS_VENUE, id: transit.row.relayHash, valueInUsd: worth })
    } else if (transit.kind === 'expired' && transit.owed > 0n) {
      const worth = priced.toValue(originChainId, transit.row.inputToken, transit.owed)
      value += worth
      positionList.push({ chainId: transit.row.chainId, venue: ACROSS_VENUE, id: transit.row.relayHash, valueInUsd: worth })
    }
  }
  return {
    value,
    assetList,
    positionList,
  }
}

export interface IAllocationCandidate {
  puppet: Address
  delegated: boolean
  withdrawRequestedAt: bigint
  mandate: IAccountLib__Mandate
  registered: Hex
  available: bigint
  basis: bigint
  allocatedAt: bigint
}

interface IAllocationTermsContext extends IFundState {
  master: Address
  nowSec: bigint
  value: bigint
  blocked: string | null
  feeReserve: bigint
  feeCeiling: bigint
  candidates: readonly IAllocationCandidate[]
}

export async function readAllocationCandidates(deps: ITermsDeps, master: Address): Promise<IAllocationCandidate[]> {
  const rows = await readMandates(deps.chronicle, master)
  const puppets = [...rows.keys()]
  if (puppets.length === 0) return []
  const client = clientOf(deps, HUB)
  const bond = bondTokenOf(HUB)
  const [codes, digests, holdings, balances, arms] = await fromChain(
    `the mandated puppets of ${master}`,
    HUB,
    Promise.all([
      Promise.all(puppets.map(puppet => client.getCode({ address: puppet }))),
      client.multicall({
        allowFailure: false,
        contracts: puppets.map(puppet => ({
          address: deploymentAddress('MandateStore', HUB),
          abi: mandatestoreAbi,
          functionName: 'mandateMap' as const,
          args: [puppet, master] as const
        }))
      }),
      client.multicall({
        allowFailure: false,
        contracts: puppets.map(puppet => ({
          address: deploymentAddress('FundStore', HUB),
          abi: fundstoreAbi,
          functionName: 'getHolding' as const,
          args: [master, puppet] as const
        }))
      }),
      client.multicall({
        allowFailure: false,
        contracts: puppets.map(puppet => ({ address: bond, abi: erc20Abi, functionName: 'balanceOf' as const, args: [puppet] as const }))
      }),
      client.multicall({
        allowFailure: true,
        contracts: puppets.map(puppet => ({ address: puppet, abi: useraccountAbi, functionName: 'withdrawRequestedAt' as const }))
      })
    ])
  )
  return puppets.map((puppet, i) => {
    const delegated = codes[i] !== undefined && codes[i] !== '0x'
    const arm = arms[i]!
    if (delegated && arm.status !== 'success') {
      throw new CompactError('CHAIN_UNREACHABLE', `the withdrawal arm of ${puppet} could not be read; nothing can be signed against it`, 'server')
    }
    return {
      puppet,
      delegated,
      withdrawRequestedAt: arm.status === 'success' ? arm.result : 0n,
      mandate: mandateOf(rows.get(puppet)!),
      registered: digests[i]!,
      available: balances[i]!,
      basis: holdings[i]!.basis,
      allocatedAt: holdings[i]!.allocatedAt
    }
  })
}

export async function readAllocationBlock(deps: Pick<ITermsDeps, 'clients'>, master: Address): Promise<string | null> {
  const reasons = await Promise.all(
    VENUES.filter(venue => venue.blocksAllocation !== undefined).map(venue =>
      fromChain(`${venue.name} standing on ${master}`, venue.chains[0]!, venue.blocksAllocation!({ account: getAddress(master), clients: deps.clients }))
    )
  )
  return reasons.find(reason => reason !== null) ?? null
}

export function allocationTermsOf(ctx: IAllocationTermsContext, contribution: bigint): IFund__Allocation[] {
  if (ctx.blocked !== null) return []
  const { skin, supply, queued, value } = ctx
  const contributed = contribution > ctx.feeCeiling ? unitsFor(contribution - ctx.feeCeiling, supply, value) : 0n
  const masterUnits = ctx.masterUnits + contributed
  const active = supply - queued + contributed
  const roomAt = (floor: bigint): bigint | null => {
    if (floor === 0n) return null
    const bound = (masterUnits * PRECISION.basisPoints) / floor
    return bound > active ? cashFor(bound - active, supply, value) : 0n
  }
  return composeAllocation({
    master: ctx.master,
    nowSec: ctx.nowSec,
    minStake: COHORT_MIN_STAKE,
    baseFloor: floorOf(skin, supply - queued, ctx.masterUnits),
    roomAt,
    candidates: ctx.candidates
      .filter(c => c.delegated && c.withdrawRequestedAt === 0n && c.registered === mandateDigest(c.puppet, c.mandate))
      .map(c => ({ puppet: c.puppet, mandate: c.mandate, available: c.available > ctx.feeReserve ? c.available - ctx.feeReserve : 0n, basis: c.basis, allocatedAt: c.allocatedAt }))
  }).map(row => ({ puppet: row.puppet, stake: row.stake, mandate: row.mandate }))
}
