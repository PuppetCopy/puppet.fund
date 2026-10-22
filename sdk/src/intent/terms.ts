import { accountmoduleAbi, escrowstoreAbi, fundaccountAbi, fundstoreAbi, hubgateAbi, mandatestoreAbi, sharetokenAbi, useraccountAbi } from '@puppet/contracts/abi'
import { HUB_CANONICAL_TOKEN, HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import type {
  IFund__Allocation,
  IFund__Asset,
  IFund__Position,
  IFund__Price,
  IFund__Valuation,
  IFundStore__Credit,
  IFundStore__Holding,
  IFundStore__Redemption,
  IMandateLib__Mandate
} from '@puppet/contracts/types'
import {
  type Address,
  decodeFunctionData,
  erc20Abi,
  getAddress,
  type Hex,
  isAddressEqual,
  keccak256,
  type PublicClient,
  parseAbi,
  parseAbiItem,
  type SignedAuthorization,
  toHex
} from 'viem'
import { accountModuleAddress, predictUserAccount } from '../account/createAccount.js'
import { composeAllocation, cooledDown } from '../allocation/index.js'
import { CompactError, formatThrownError } from '../compact/error.js'
import { PRECISION } from '../const/common.js'
import { CHAIN_ID_LIST, type ChainId, deploymentAddress, TOKEN_META } from '../const/index.js'
import type { IDigestClient } from '../datastore/index.js'
import { evaluateFundAt, type IGetRate, type IRate } from '../evaluate/index.js'
import { exitingOf, sharesFor, valueFor } from '../pool/index.js'
import {
  accountTable,
  allowanceTable,
  balanceTable,
  creditTable,
  fulfilTable,
  fundTable,
  holdingTable,
  type IAccountRow,
  type ICreditRow,
  type IFulfilRow,
  type IFundRow,
  type IHoldingRow,
  type IMandateRow,
  type IRedemptionRow,
  type ITransitRow,
  mandateTable,
  ownerCreditTable,
  redemptionTable,
  transitTable,
  venueTable
} from '../schema/index.js'
import { feeConverter, RELAY_RATE_MAX_STALE_MS, relayFeeOf } from '../state/fee.js'
import { chainTokenOfKey, listedTokensOf, symbolOf, tokenKeyOf } from '../state/tokenRegistry.js'
import { VENUES } from '../venue/venues.js'
import { acrossSpokePoolOf } from './route/acrossDeposit.js'
import { mandateDigest, mandateOfRow } from './shared.js'
import { assetKey, positionKey } from './valuation.js'

const HUB = HUB_CHAIN_ID as ChainId
const ACROSS_VENUE = keccak256(toHex('across'))
export const ACROSS_FILLED = 2n
const REFUND_LOG_WINDOW = 5_000n
export const SPOKE_POOL_ABI = parseAbi([
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

const mandateOf = (row: IMandateRow): IMandateLib__Mandate => ({ ...mandateOfRow(row), master: getAddress(row.master) })

export interface IFundBook {
  master: Address
  mandates: IMandateRow[]
  epochs: ReadonlyMap<Address, bigint>
  holdings: IHoldingRow[]
  redemption: IRedemptionRow | undefined
}

export async function readFundBook(deps: Pick<ITermsDeps, 'chronicle'>, master: Address): Promise<IFundBook> {
  const [mandates, holdings, [redemption]] = await Promise.all([
    fromChronicle(`mandates naming ${master}`, deps.chronicle.select(mandateTable, { where: { master } })),
    fromChronicle(`the holders of ${master}`, deps.chronicle.select(holdingTable, { where: { master }, orderBy: { col: 'shares', dir: 'desc' } })),
    fromChronicle(`the redemption of ${master}`, deps.chronicle.select(redemptionTable, { where: { master } }))
  ])
  const puppets = [...new Set(mandates.map(row => getAddress(row.puppet)))]
  const accounts = puppets.length === 0 ? [] : await fromChronicle(`the accounts mandating ${master}`, deps.chronicle.select(accountTable, { where: { account: { in: puppets } } }))
  const epochs = new Map(accounts.filter(row => Number(row.chainId) === HUB).map(row => [getAddress(row.account), row.epoch] as const))
  return { master: getAddress(master), mandates, epochs, holdings, redemption }
}

export const exitingSharesOf = (book: { holdings: readonly Pick<IHoldingRow, 'holder' | 'queued'>[] }, holder: Address): bigint => {
  const holding = book.holdings.find(row => isAddressEqual(row.holder, holder))
  return holding === undefined ? 0n : holding.queued
}

export type IMandateStanding = { kind: 'open' } | { kind: 'revoked' } | { kind: 'expired'; at: bigint } | { kind: 'cooldown'; until: bigint }

export function mandateStandingOf(
  row: Pick<IMandated, 'mandate'> & Pick<IMandateRow, 'epoch'>,
  epoch: bigint,
  holding: Pick<IHoldingRow, 'allocatedAt'> | undefined,
  at: bigint
): IMandateStanding {
  if (row.epoch !== epoch) return { kind: 'revoked' }
  if (row.mandate.expiry <= at) return { kind: 'expired', at: row.mandate.expiry }
  if (holding === undefined) return { kind: 'open' }
  if (!cooledDown(holding.allocatedAt, row.mandate.cooldownPeriod, at)) return { kind: 'cooldown', until: holding.allocatedAt + row.mandate.cooldownPeriod }
  return { kind: 'open' }
}

export async function readMandateWindow(
  deps: ITermsDeps,
  { master, mandates, epochs, holdings, redemption }: Pick<IFundBook, 'master' | 'mandates' | 'epochs' | 'holdings' | 'redemption'>,
  tokens: readonly Address[],
  block: { number: bigint; timestamp: bigint }
): Promise<IMandated[][]> {
  const holdingOf = new Map(holdings.map(row => [getAddress(row.holder), row]))
  const open = mandates
    .filter(row => {
      const puppet = getAddress(row.puppet)
      const epoch = epochs.get(puppet)
      if (epoch === undefined) {
        throw new CompactError('ACCOUNT_UNRECORDED', `the chronicle holds a mandate from ${puppet} to ${master} but not ${puppet}'s hub account`, 'soft')
      }
      return mandateStandingOf({ mandate: mandateOf(row), epoch: row.epoch }, epoch, holdingOf.get(puppet), block.timestamp).kind === 'open'
    })
    .map(row => ({ puppet: getAddress(row.puppet), mandate: mandateOf(row) }))
  if (open.length <= Number(PROTOCOL.maxCohortSize)) return tokens.map(() => open)
  const masterHolding = holdingOf.get(getAddress(master))
  const masterShares = masterHolding === undefined ? 0n : masterHolding.shares
  const exiting = exitingOf(redemption === undefined ? 0n : redemption.queued, holdings.reduce((total, row) => total + row.shares, 0n))
  return Promise.all(
    tokens.map(async token => {
      const balances = await fromChain(
        `the ${token} balances of the puppets mandating ${master} at block ${block.number}`,
        HUB,
        clientOf(deps, HUB).multicall({
          allowFailure: false,
          blockNumber: block.number,
          contracts: open.map(row => ({ address: token, abi: erc20Abi, functionName: 'balanceOf' as const, args: [row.puppet] as const }))
        })
      )
      return open
        .map((row, i) => {
          const holding = holdingOf.get(row.puppet)
          const capped =
            row.mandate.exitCap <= exiting || (row.mandate.skin > 0n && masterShares * row.mandate.skin <= (holding === undefined ? 0n : holding.shares) * PRECISION.basisPoints)
          return { row, capped, room: balances[i]! * row.mandate.allocationRate }
        })
        .sort((a, b) =>
          a.capped !== b.capped
            ? a.capped
              ? 1
              : -1
            : a.room > b.room
              ? -1
              : a.room < b.room
                ? 1
                : BigInt(a.row.puppet) < BigInt(b.row.puppet)
                  ? -1
                  : 1
        )
        .slice(0, Number(PROTOCOL.maxCohortSize))
        .map(ranked => ranked.row)
    })
  )
}

export interface IFundState {
  shareToken: Address
  performanceFee: bigint
  owner: Address
  supply: bigint
  masterShares: bigint
  redemption: IFundStore__Redemption
}

export async function readFundState(
  deps: Pick<ITermsDeps, 'clients'>,
  fund: Pick<IFundRow, 'master' | 'shareToken' | 'performanceFee'>,
  blockNumber: bigint
): Promise<IFundState> {
  const master = getAddress(fund.master)
  const shareToken = getAddress(fund.shareToken)
  const [supply, masterShares, redemption, owner] = await fromChain(
    `the fund of ${master} at block ${blockNumber}`,
    HUB,
    clientOf(deps, HUB).multicall({
      allowFailure: false,
      blockNumber,
      contracts: [
        { address: shareToken, abi: sharetokenAbi, functionName: 'totalSupply' },
        { address: shareToken, abi: sharetokenAbi, functionName: 'balanceOf', args: [master] },
        { address: deploymentAddress('FundStore', HUB), abi: fundstoreAbi, functionName: 'getRedemption', args: [master] },
        { address: master, abi: fundaccountAbi, functionName: 'parent' }
      ]
    })
  )
  return { shareToken, performanceFee: fund.performanceFee, owner: getAddress(owner), supply, masterShares, redemption }
}

export interface IHolderState {
  balance: bigint
  holding: IFundStore__Holding
}

export async function readHolderStates(
  deps: Pick<ITermsDeps, 'clients'>,
  master: Address,
  shareToken: Address,
  holders: readonly Address[],
  blockNumber: bigint
): Promise<Map<Address, IHolderState>> {
  const client = clientOf(deps, HUB)
  const [balances, holdings] = await fromChain(
    `the holders of ${master} at block ${blockNumber}`,
    HUB,
    Promise.all([
      client.multicall({
        allowFailure: false,
        blockNumber,
        contracts: holders.map(holder => ({ address: shareToken, abi: sharetokenAbi, functionName: 'balanceOf' as const, args: [holder] as const }))
      }),
      client.multicall({
        allowFailure: false,
        blockNumber,
        contracts: holders.map(holder => ({
          address: deploymentAddress('FundStore', HUB),
          abi: fundstoreAbi,
          functionName: 'getHolding' as const,
          args: [master, holder] as const
        }))
      })
    ])
  )
  return new Map(holders.map((holder, i) => [getAddress(holder), { balance: balances[i]!, holding: holdings[i]! }] as const))
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

export async function readOpening(
  deps: Pick<ITermsDeps, 'clients'>,
  master: Address,
  opening: Hex
): Promise<{ user: Address; key: Hex; approval: Hex; authorizationList: readonly SignedAuthorization[] }> {
  const tx = await fromChain(`the opening of ${master}`, HUB, clientOf(deps, HUB).getTransaction({ hash: opening }))
  const { functionName, args } = decodeFunctionData({ abi: hubgateAbi, data: tx.input })
  if (functionName !== 'createFund') throw new CompactError('FUND_UNRECORDED', `${master} opened in ${opening}, which is not a createFund`, 'server')
  return { user: getAddress(args[4].header.user), key: args[2], approval: args[3], authorizationList: tx.authorizationList ?? [] }
}

export async function requireFolded(deps: Pick<ITermsDeps, 'clients' | 'chronicle'>, chainId: ChainId, account: Address): Promise<void> {
  await requireFoldedOn(deps, account, await fromChronicle(`the account of ${account}`, deps.chronicle.select(accountTable, { where: { account } })), [chainId])
}

export async function requireFoldedOn(
  deps: Pick<ITermsDeps, 'clients'>,
  account: Address,
  rows: readonly Pick<IAccountRow, 'chainId' | 'lastBlock'>[],
  chainIds: readonly ChainId[]
): Promise<void> {
  await Promise.all(
    chainIds.map(async chainId => {
      const [tip] = await fromChain(
        `the last call block of ${account}`,
        chainId,
        clientOf(deps, chainId).readContract({ address: deploymentAddress('AccountModule', chainId), abi: accountmoduleAbi, functionName: 'accountTipMap', args: [account] })
      )
      const folded = rows.find(row => Number(row.chainId) === chainId)
      if ((folded === undefined ? 0n : BigInt(folded.lastBlock)) < tip) {
        throw new CompactError(
          'CHRONICLE_BEHIND',
          `the chronicle folded ${account} on chain ${chainId} up to block ${folded?.lastBlock ?? 0} while the AccountModule records a call at block ${tip}; retry once it catches up`,
          'soft'
        )
      }
    })
  )
}

export interface IEscrowCredit {
  escrowed: bigint
  released: bigint
  returned: bigint
  returnAt: bigint
  ownerCredited: bigint
}

export const openEscrowOf = (credit: Pick<IEscrowCredit, 'escrowed' | 'released' | 'returned'>): bigint => credit.escrowed - credit.released - credit.returned

export const creditableOf = (credit: Pick<IEscrowCredit, 'escrowed' | 'released' | 'returned' | 'ownerCredited'>): bigint => {
  const held = credit.escrowed - credit.returned
  const committed = credit.ownerCredited > credit.released ? credit.ownerCredited : credit.released
  return held > committed ? held - committed : 0n
}

export const uncreditedOf = (
  fulfils: readonly Pick<IFulfilRow, 'owner' | 'master' | 'chainId' | 'token' | 'fulfilled' | 'feeBilled'>[],
  credits: readonly Pick<ICreditRow, 'creditChainId' | 'token' | 'credited' | 'feeOwed'>[]
): { chainId: ChainId; token: Address; amount: bigint }[] =>
  fulfils.flatMap(fulfil => {
    if (Number(fulfil.chainId) === HUB || isAddressEqual(fulfil.owner, fulfil.master)) return []
    const credit = credits.find(row => row.creditChainId === fulfil.chainId && isAddressEqual(row.token, fulfil.token))
    const amount = fulfil.fulfilled - fulfil.feeBilled - (credit === undefined ? 0n : credit.credited - credit.feeOwed)
    return amount > 0n ? [{ chainId: Number(fulfil.chainId) as ChainId, token: getAddress(fulfil.token), amount }] : []
  })

export async function readEscrowCredit(
  deps: Pick<ITermsDeps, 'clients' | 'chronicle'>,
  owner: Address,
  chainId: ChainId,
  token: Address
): Promise<IEscrowCredit> {
  const store = deploymentAddress('EscrowStore', chainId)
  await requireFolded(deps, HUB, owner)
  const [[escrowed, released, returned, returnAt], credits] = await Promise.all([
    fromChain(
      `the ${token} escrow of ${owner}`,
      chainId,
      clientOf(deps, chainId).multicall({
        allowFailure: false,
        contracts: [
          { address: store, abi: escrowstoreAbi, functionName: 'escrowedMap', args: [owner, token] },
          { address: store, abi: escrowstoreAbi, functionName: 'releasedMap', args: [owner, token] },
          { address: store, abi: escrowstoreAbi, functionName: 'returnedMap', args: [owner, token] },
          { address: store, abi: escrowstoreAbi, functionName: 'returnAtMap', args: [owner, token] }
        ]
      })
    ),
    fromChronicle(`the credits ${owner} signed`, deps.chronicle.select(ownerCreditTable, { where: { owner: getAddress(owner) } }))
  ])
  const signed = credits.find(row => Number(row.chainId) === chainId && isAddressEqual(row.token, token))
  return { escrowed, released, returned, returnAt, ownerCredited: signed === undefined ? 0n : signed.credited }
}

export function readCreditBook(deps: Pick<ITermsDeps, 'clients'>, owner: Address, master: Address, chainId: ChainId, token: Address): Promise<IFundStore__Credit> {
  if (chainId !== HUB) {
    return fromChain(
      `the ${token} credit of ${master} on chain ${chainId}`,
      HUB,
      clientOf(deps, HUB).readContract({ address: deploymentAddress('FundStore', HUB), abi: fundstoreAbi, functionName: 'getCredit', args: [master, BigInt(chainId), token] })
    )
  }
  return readReleased(deps, owner, master, HUB, token)
}

export function readReleased(deps: Pick<ITermsDeps, 'clients'>, owner: Address, master: Address, chainId: ChainId, token: Address): Promise<IFundStore__Credit> {
  const store = deploymentAddress('EscrowStore', chainId)
  return fromChain(
    `the ${token} ${owner} released to ${master} on chain ${chainId}`,
    chainId,
    clientOf(deps, chainId).multicall({
      allowFailure: false,
      contracts: [
        { address: store, abi: escrowstoreAbi, functionName: 'fulfilledMap', args: [owner, master, token] },
        { address: store, abi: escrowstoreAbi, functionName: 'feePaidMap', args: [owner, master, token] }
      ]
    })
  ).then(([total, feeTotal]) => ({ total, feeTotal }))
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

export async function readTransits(
  deps: Pick<ITermsDeps, 'clients' | 'chronicle'>,
  master: Address,
  blocks: IPinnedBlocks
): Promise<{ reached: ReadonlySet<ChainId>; transits: ITransit[] }> {
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
            functionName: 'accountTipMap',
            args: [account],
            blockNumber: block.number
          })
        ).then(([head]) => [chainId, head] as const)
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
  const reached = new Set<ChainId>([...heads.filter(([, head]) => head > 0n).map(([chainId]) => chainId), ...rows.map(row => Number(row.destinationChainId) as ChainId)])
  const latest = new Map<bigint, ITransitRow>()
  for (const row of rows) {
    if (BigInt(row.block) > pinnedOf(blocks, row.chainId).number) continue
    const held = latest.get(row.chainId)
    if (held === undefined || row.block > held.block || (row.block === held.block && row.logIndex > held.logIndex)) latest.set(row.chainId, row)
  }
  const transits = await Promise.all(
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
  return { reached, transits }
}

export async function assertNoOpenTransit(deps: Pick<ITermsDeps, 'clients' | 'chronicle'>, account: Address): Promise<void> {
  const { transits } = await readTransits(deps, account, await pinBlocks(deps))
  const open = transits.filter(transit => transit.kind === 'fillable' || (transit.kind === 'expired' && transit.owed > 0n))
  if (open.length > 0) {
    throw new CompactError(
      'TRANSIT_OPEN',
      `a bridge from fund ${account} is still settling (${open.map(transit => transit.kind).join(', ')}); a new bridge waits until it fills or is refunded`,
      'soft'
    )
  }
}

interface IValuationRates {
  toValue(chainId: ChainId, token: Address, amount: bigint): bigint
  rates: readonly { chainId: ChainId; token: Address; rate: IRate }[]
}

export async function valuationRatesOf(getRate: IGetRate, tokens: readonly { chainId: ChainId; token: Address }[], freshness: number): Promise<IValuationRates> {
  const rates = await Promise.all(
    tokens.map(async ({ chainId, token }) => {
      const symbol = symbolOf(chainId, token)
      const rate: IRate =
        symbol === TOKEN_META.WETH.symbol ? { token0: 1n, token1: 1n, time: Math.floor(Date.now() / 1000) } : await getRate(symbol, TOKEN_META.WETH.symbol, freshness)
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

export async function markPrice(getRate: IGetRate, chainId: ChainId, token: Address, amount: bigint, freshness: number): Promise<IFund__Price> {
  const priced = await valuationRatesOf(getRate, [{ chainId, token }], freshness)
  return { amount, value: priced.toValue(chainId, token, amount) }
}

export async function composeValuation(deps: ITermsDeps, master: Address, freshness: number): Promise<IFund__Valuation> {
  const rates = new Map<string, Promise<IRate>>()
  const getRate: IGetRate = (asset0, asset1, freshness) => {
    const key = `${asset0}/${asset1}/${freshness}`
    const held = rates.get(key) ?? deps.getRate(asset0, asset1, freshness)
    rates.set(key, held)
    return held
  }
  const assetList: IFund__Asset[] = []
  const positionList: IFund__Position[] = []
  const blocks = await pinBlocks(deps)
  const account = getAddress(master)
  const [{ reached, transits }, recorded, funds, venues, allowances, credits, fulfils] = await Promise.all([
    readTransits(deps, master, blocks),
    fromChronicle(`the recorded holdings of ${master}`, deps.chronicle.select(balanceTable, { where: { account } })),
    fromChronicle(`the fund of ${master}`, deps.chronicle.select(fundTable, { where: { master: account } })),
    fromChronicle(`the venues of ${master}`, deps.chronicle.select(venueTable, { where: { account } })),
    fromChronicle(`the standing allowances of ${master}`, deps.chronicle.select(allowanceTable, { where: { account } })),
    fromChronicle(`the foreign credits of ${account}`, deps.chronicle.select(creditTable, { where: { master: account } })),
    fromChronicle(`the releases to ${account}`, deps.chronicle.select(fulfilTable, { where: { master: account } }))
  ])
  const valued = await Promise.all(
    CHAIN_ID_LIST.filter(chainId => chainId === HUB || reached.has(chainId)).map(async chainId => {
      const listedTokenList = listedTokensOf(chainId)
      const unlistedTokenList = recorded
        .filter(
          row =>
            Number(row.chainId) === chainId &&
            !listedTokenList.some(token => isAddressEqual(token, row.token)) &&
            !funds.some(fund => isAddressEqual(fund.shareToken, row.token))
        )
        .map(row => getAddress(row.token))
      const block = pinnedOf(blocks, chainId)
      const standing = allowances.filter(row => Number(row.chainId) === chainId && row.implied > 0n)
      const live = await fromChain(
        `the standing allowances of ${master}`,
        chainId,
        Promise.all(
          standing.map(row =>
            clientOf(deps, chainId).readContract({ address: row.token, abi: erc20Abi, functionName: 'allowance', args: [master, row.spender], blockNumber: block.number })
          )
        )
      )
      const pulled = standing.filter((row, i) => live[i]! < row.implied).map(row => row.venue)
      const result = await fromChain(
        `the fund of ${master}`,
        chainId,
        evaluateFundAt({
          clients: deps.clients,
          chainId,
          account: master,
          listedTokenList,
          unlistedTokenList,
          blockNumber: block.number,
          blockTimestamp: Number(block.timestamp),
          venueIdList: [
            ...new Set([
              ...venues.filter(row => Number(row.chainId) === chainId).map(row => row.venue),
              ...pulled,
              ...VENUES.filter(venue => venues.some(row => row.venue === venue.venueId)).flatMap(venue => venue.exitsInto ?? [])
            ])
          ],
          getRate,
          freshness
        })
      )
      return { chainId, result }
    })
  )
  const isCash = (asset: IFund__Asset): boolean =>
    Number(asset.chainId) === HUB &&
    (isAddressEqual(asset.token, PROTOCOL.nativeToken) || Object.values(HUB_CANONICAL_TOKEN).some(canonical => isAddressEqual(asset.token, canonical)))
  const held: IFund__Asset[] = []
  for (const { chainId, result } of valued) {
    if (!result.ok) throw new CompactError('POOL_UNVALUABLE', result.reasons.map(r => r.detail).join('; '), 'soft')
    for (const h of result.holdings) held.push({ chainId: BigInt(chainId), token: getAddress(h.token), id: 0n, amount: h.balance, value: h.mark.value })
    for (const p of result.positions) {
      if (p.value < 0n) throw new CompactError('POOL_UNVALUABLE', `${p.venue} position ${p.id} is worth ${p.value}`, 'soft')
      positionList.push({ chainId: BigInt(chainId), venue: keccak256(toHex(p.venue)), id: p.id, value: p.value })
    }
  }
  const exitCosts = new Map(
    await Promise.all(
      [...new Set(held.filter(asset => !isCash(asset)).map(asset => Number(asset.chainId) as ChainId))].map(async chainId => {
        const convert = await feeConverter(getRate, chainId, chainTokenOfKey(chainId, tokenKeyOf(HUB, HUB_CANONICAL_TOKEN.WETH)), RELAY_RATE_MAX_STALE_MS)
        return [chainId, relayFeeOf(convert, chainId, 'fundSwap', false, 0n, 0n, 0n)] as const
      })
    )
  )
  const recoverable = (asset: IFund__Asset): boolean => {
    if (isCash(asset)) return true
    const exitCost = exitCosts.get(Number(asset.chainId) as ChainId)
    if (exitCost === undefined) throw new Error(`the exit cost of chain ${asset.chainId} was not read`)
    return asset.value * PROTOCOL.maxRelayFeeBps >= exitCost * PRECISION.basisPoints
  }
  for (const release of uncreditedOf(fulfils, credits)) {
    const at = held.findIndex(asset => Number(asset.chainId) === release.chainId && isAddressEqual(asset.token, release.token))
    const line = held[at]
    if (line === undefined || line.amount < release.amount) {
      throw new CompactError(
        'CREDIT_NOT_HELD',
        `${master} holds ${line === undefined ? 0n : line.amount} of ${release.token} on chain ${release.chainId}, less than the ${release.amount} its owner released into it and the hub has not credited yet; that release stays the owner's until a round credits it`,
        'soft'
      )
    }
    held[at] = { ...line, amount: line.amount - release.amount, value: line.value - (line.value * release.amount) / line.amount }
  }
  assetList.push(...held.filter(asset => asset.amount > 0n).filter(recoverable))
  const priced = await valuationRatesOf(
    getRate,
    transits.flatMap(transit => {
      const sent = { chainId: Number(transit.row.chainId) as ChainId, token: transit.row.inputToken }
      if (transit.kind === 'fillable') return [sent, { chainId: Number(transit.row.destinationChainId) as ChainId, token: transit.row.outputToken }]
      return transit.kind === 'expired' && transit.owed > 0n ? [sent] : []
    }),
    freshness
  )
  for (const transit of transits) {
    const originChainId = Number(transit.row.chainId) as ChainId
    if (transit.kind === 'fillable') {
      const delivered = priced.toValue(Number(transit.row.destinationChainId) as ChainId, transit.row.outputToken, transit.row.outputAmount)
      const sent = priced.toValue(originChainId, transit.row.inputToken, transit.row.inputAmount)
      positionList.push({ chainId: transit.row.destinationChainId, venue: ACROSS_VENUE, id: transit.row.relayHash, value: delivered < sent ? delivered : sent })
    } else if (transit.kind === 'expired' && transit.owed > 0n) {
      positionList.push({
        chainId: transit.row.chainId,
        venue: ACROSS_VENUE,
        id: transit.row.relayHash,
        value: priced.toValue(originChainId, transit.row.inputToken, transit.owed)
      })
    }
  }
  const merged = new Map<string, IFund__Asset>()
  for (const asset of assetList) {
    const key = assetKey(asset)
    const held = merged.get(key)
    merged.set(key, held === undefined ? asset : { ...held, amount: held.amount + asset.amount, value: held.value + asset.value })
  }
  return {
    assetList: [...merged]
      .filter(([, asset]) => asset.amount > 0n && asset.value > 0n)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([, asset]) => asset),
    positionList: positionList.filter(position => position.value > 0n).sort((a, b) => (positionKey(a) < positionKey(b) ? -1 : 1))
  }
}

export interface IMandated {
  puppet: Address
  mandate: IMandateLib__Mandate
}

export interface IAllocationCandidate extends IMandated {
  user: Address | null
  epoch: bigint | null
  registered: Hex
  available: bigint
  held: bigint
  cost: bigint
  allocatedAt: bigint
}

interface IAllocationTermsContext extends IFundState {
  kind: 'allocate' | 'createFund'
  master: Address
  now: bigint
  deadline: bigint
  value: bigint
  price: IFund__Price
  feeReserve: bigint
  feeCeiling: bigint
  candidates: readonly IAllocationCandidate[]
}

export async function readAllocationCandidates(
  deps: ITermsDeps,
  master: Address,
  shareToken: Address | null,
  tokens: readonly Address[],
  blockNumber: bigint,
  rows: readonly (readonly IMandated[])[]
): Promise<IAllocationCandidate[][]> {
  const byPuppet = new Map<Address, IMandated>()
  for (const list of rows) for (const row of list) byPuppet.set(getAddress(row.puppet), row)
  const puppets = [...byPuppet.keys()]
  if (puppets.length === 0) return tokens.map(() => [])
  const client = clientOf(deps, HUB)
  const [digests, holdings, balances, users, epochs, shares] = await fromChain(
    `the mandated puppets of ${master} at block ${blockNumber}`,
    HUB,
    Promise.all([
      client.multicall({
        allowFailure: false,
        blockNumber,
        contracts: puppets.map(puppet => ({
          address: deploymentAddress('MandateStore', HUB),
          abi: mandatestoreAbi,
          functionName: 'mandateMap' as const,
          args: [puppet, master] as const
        }))
      }),
      client.multicall({
        allowFailure: false,
        blockNumber,
        contracts: puppets.map(puppet => ({
          address: deploymentAddress('FundStore', HUB),
          abi: fundstoreAbi,
          functionName: 'getHolding' as const,
          args: [master, puppet] as const
        }))
      }),
      Promise.all(
        tokens.map(token =>
          client.multicall({
            allowFailure: false,
            blockNumber,
            contracts: puppets.map(puppet => ({ address: token, abi: erc20Abi, functionName: 'balanceOf' as const, args: [puppet] as const }))
          })
        )
      ),
      client.multicall({
        allowFailure: true,
        blockNumber,
        contracts: puppets.map(puppet => ({ address: puppet, abi: useraccountAbi, functionName: 'user' as const }))
      }),
      client.multicall({
        allowFailure: true,
        blockNumber,
        contracts: puppets.map(puppet => ({ address: puppet, abi: useraccountAbi, functionName: 'epoch' as const }))
      }),
      shareToken === null
        ? puppets.map(() => 0n)
        : client.multicall({
            allowFailure: false,
            blockNumber,
            contracts: puppets.map(puppet => ({ address: shareToken, abi: sharetokenAbi, functionName: 'balanceOf' as const, args: [puppet] as const }))
          })
    ])
  )
  const indexOf = new Map(puppets.map((puppet, i) => [puppet, i]))
  return rows.map((list, t) =>
    list.map(row => {
      const puppet = getAddress(row.puppet)
      const i = indexOf.get(puppet)!
      const user = users[i]!
      const epoch = epochs[i]!
      return {
        puppet,
        mandate: row.mandate,
        user: user.status === 'success' ? getAddress(user.result) : null,
        epoch: epoch.status === 'success' ? epoch.result : null,
        registered: digests[i]!,
        available: balances[t]![i]!,
        held: shares[i]!,
        cost: holdings[i]!.cost,
        allocatedAt: BigInt(holdings[i]!.allocatedAt)
      }
    })
  )
}

export function allocationTermsOf(ctx: IAllocationTermsContext, contribution: bigint): IFund__Allocation[] {
  const { value, price, supply } = ctx
  const contributionValue = valueFor(contribution, price)
  const contributed = contributionValue > ctx.feeCeiling ? sharesFor(contributionValue - ctx.feeCeiling, supply, value) : 0n
  const masterLeg = contribution > 0n ? 1 : 0
  return composeAllocation({
    kind: ctx.kind,
    master: ctx.master,
    now: ctx.now,
    deadline: ctx.deadline,
    supply,
    value,
    owner: ctx.owner,
    masterShares: ctx.masterShares + contributed,
    exiting: exitingOf(ctx.redemption.queued, supply),
    sliceAt: rows => ctx.feeCeiling / BigInt(rows + masterLeg),
    candidates: ctx.candidates
      .filter(
        c => c.user !== null && isAddressEqual(predictUserAccount(c.user), c.puppet) && c.epoch !== null && c.registered === mandateDigest(c.mandate, c.epoch)
      )
      .map(c => ({
        puppet: c.puppet,
        mandate: c.mandate,
        available: valueFor(c.available > ctx.feeReserve ? c.available - ctx.feeReserve : 0n, price),
        held: c.held,
        allocatedAt: c.allocatedAt
      }))
  })
    .map(row => ({ puppet: row.puppet, mandate: row.mandate, amount: (row.stake * price.amount) / price.value }))
    .filter(row => row.amount > 0n)
}
