import { bondstoreAbi } from '@puppet/contracts/abi'
import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { IAccountLib__Mandate, ICoreGate__OperateIntent, ICoreGate__Outcome, IHubGate__Loss } from '@puppet/contracts/types'
import { type Address, getAddress, type Hex, isAddressEqual, type PublicClient } from 'viem'
import { readContract } from 'viem/actions'
import { composeCohort, type ICohortCandidate, type ISettleValuation, listsToken, owedFor } from '../backing/index.js'
import { CompactContractError, CompactError, formatThrownError } from '../compact/error.js'
import { type ChainId, deploymentAddress } from '../const/index.js'
import type { IDigestClient } from '../datastore/index.js'
import { type IGetRate, type IRate, VALUE_KEY } from '../evaluate/index.js'
import { bookIdOf, settlementIdOf } from '../fold/fold.js'
import {
  backerTable,
  backingTable,
  bookTable,
  flowTable,
  type IBackerRow,
  type IBookRow,
  type IMandateRow,
  type IMarkRow,
  type ISettlementRow,
  mandateTable,
  markTable,
  settlementTable,
  settleRowTable
} from '../schema/index.js'
import { fetchTokenBalance } from '../state/route.js'
import { bondTokenOf, type ITokenRegistryMap, symbolOf, symbolOfKey, tokenInfoFor } from '../state/tokenRegistry.js'

export const COHORT_MIN_STAKE = 1_000_000n

const HUB = HUB_CHAIN_ID as ChainId
const VALUE_SYMBOL = symbolOfKey(VALUE_KEY)

export interface ITermsDeps {
  chronicle: IDigestClient
  clients: Readonly<Record<number, PublicClient>>
  getRate: IGetRate
  getTokenRegistry: () => Promise<ITokenRegistryMap>
}

export const fromChronicle = <T>(what: string, read: Promise<T>): Promise<T> =>
  read.catch(err => {
    throw new CompactError('CHRONICLE_UNAVAILABLE', `${what} could not be read from the chronicle: ${formatThrownError(err)}`, 'server')
  })

const fromChain = <T>(what: string, chainId: number, read: Promise<T>): Promise<T> =>
  read.catch(err => {
    throw new CompactError('CHAIN_UNREACHABLE', `${what} read failed on chain ${chainId}; nothing can be signed against it: ${formatThrownError(err)}`, 'server')
  })

function clientOf(deps: ITermsDeps, chainId: ChainId): PublicClient {
  const client = deps.clients[chainId]
  if (client === undefined) throw new CompactError('CHAIN_UNAVAILABLE', `no client for chain ${chainId}`, 'server')
  return client
}

export const mandateOf = (row: IMandateRow): IAccountLib__Mandate => ({
  master: getAddress(row.master),
  skin: row.skin,
  allocationRate: row.allocationRate,
  cooldownPeriod: row.cooldownPeriod,
  expiry: row.expiry,
  tokenIdList: [...row.tokenIdList]
})

export interface IBookState {
  book: IBookRow | undefined
  backers: IBackerRow[]
  mark: IMarkRow | undefined
}

export async function readBookState(chronicle: IDigestClient, chainId: ChainId, master: Address): Promise<IBookState> {
  const id = bookIdOf(chainId, master)
  const book = await fromChronicle(`book ${id}`, chronicle.find(bookTable, { id }))
  if (!book) return { book: undefined, backers: [], mark: undefined }
  const [backers, mark] = await fromChronicle(
    `book ${id}`,
    Promise.all([chronicle.select(backerTable, { where: { chainId: BigInt(chainId), master } }), chronicle.find(markTable, { id: book.lastMark })])
  )
  return { book, backers, mark }
}

export const readSettlement = (
  chronicle: IDigestClient,
  master: Address,
  spokeChainId: ChainId,
  cycle: bigint,
  kind: 'settle' | 'draw'
): Promise<ISettlementRow | undefined> =>
  fromChronicle(
    `${kind} of ${master} cycle ${cycle} on chain ${spokeChainId}`,
    chronicle.find(settlementTable, { id: settlementIdOf(master, spokeChainId, cycle, kind) })
  )

export async function openCycleOf(chronicle: IDigestClient, chainId: ChainId, book: IBookRow | undefined): Promise<IBookRow | null> {
  if (book === undefined) return null
  return (await readSettlement(chronicle, getAddress(book.master), chainId, book.cycle, 'settle')) === undefined ? book : null
}

export function carriedValue(mark: IMarkRow | undefined): bigint {
  if (mark === undefined) throw new CompactError('MARK_MISSING', 'the book has no mark to carry; open a cycle first', 'hard')
  if (mark.pending || mark.closeValue === undefined) {
    throw new CompactError('MARK_PENDING', `mark ${mark.id} is not evaluated yet; the chronicle values it lazily`, 'soft')
  }
  return mark.closeValue
}

export async function assertCycleSettled(
  chronicle: IDigestClient,
  spokeChainId: ChainId,
  book: IBookRow,
  backers: readonly IBackerRow[],
  mark: IMarkRow | undefined
): Promise<void> {
  if (book.backed === 0n) return
  const master = getAddress(book.master)
  const [settled, drawn] = await Promise.all([
    readSettlement(chronicle, master, spokeChainId, book.cycle, 'settle'),
    readSettlement(chronicle, master, spokeChainId, book.cycle, 'draw')
  ])
  if (settled === undefined || settled.value === undefined) {
    throw new CompactError('CYCLE_UNSETTLED', `${master} must settle cycle ${book.cycle} on chain ${spokeChainId} before opening the next one`, 'hard')
  }
  if (drawn !== undefined) return
  const ledger = { totalShares: book.totalShares, totalPending: book.totalPending, backing: book.backed, masterShares: book.masterShares, masterPending: book.masterPending }
  if (owedFor(ledger, carriedValue(mark), settled.value, backers).some(o => o.owed < 0n)) {
    throw new CompactError('CYCLE_UNDRAWN', `${master} must draw the losses of cycle ${book.cycle} on the hub before opening the next one`, 'hard')
  }
}

export async function readMandates(chronicle: IDigestClient, master: Address): Promise<Map<Address, IMandateRow>> {
  const rows = await fromChronicle(`mandates naming ${master}`, chronicle.select(mandateTable, { where: { master } }))
  return new Map(rows.map(r => [getAddress(r.puppet), r]))
}

export async function readOpenBacking(chronicle: IDigestClient, puppets: readonly Address[]): Promise<Map<Address, Map<Address, bigint>>> {
  const open = new Map(puppets.map(puppet => [getAddress(puppet), new Map<Address, bigint>()] as const))
  if (puppets.length === 0) return open
  const [stakes, settled] = await fromChronicle(
    `backing of ${puppets.length} puppets`,
    Promise.all([
      chronicle.select(backingTable, { where: { puppet: { in: [...puppets] } } }),
      chronicle.select(settleRowTable, { where: { puppet: { in: [...puppets] } } })
    ])
  )
  const closed = new Set(settled.map(r => `${getAddress(r.puppet)}-${getAddress(r.master)}-${r.spokeChainId}-${r.cycle}`))
  for (const row of stakes) {
    const puppet = getAddress(row.puppet)
    const master = getAddress(row.master)
    if (closed.has(`${puppet}-${master}-${row.chainId}-${row.cycle}`)) continue
    const byMaster = open.get(puppet)
    if (byMaster === undefined) {
      throw new CompactError('CHRONICLE_UNAVAILABLE', `the chronicle returned a backing row of ${puppet}, who was not in the queried set`, 'server')
    }
    byMaster.set(master, (byMaster.get(master) ?? 0n) + row.stake)
  }
  return open
}

export async function readBonds(client: PublicClient, puppets: readonly Address[]): Promise<Map<Address, bigint>> {
  if (puppets.length === 0) return new Map()
  const bondToken = bondTokenOf(HUB)
  let bondStore: Address
  try {
    bondStore = deploymentAddress('BondStore', HUB)
  } catch (err) {
    throw new CompactError(
      'BOND_STORE_UNDEPLOYED',
      `the BondStore has no deployment on the hub chain ${HUB}, so no puppet's bond can be read and no backing can be composed: ${formatThrownError(err)}`,
      'server'
    )
  }
  return new Map(
    await fromChain(
      `bonds of ${puppets.length} puppets in ${bondToken}`,
      HUB,
      Promise.all(
        puppets.map(
          async puppet =>
            [getAddress(puppet), await readContract(client, { address: bondStore, abi: bondstoreAbi, functionName: 'bondMap', args: [puppet, bondToken] })] as const
        )
      )
    )
  )
}

export async function readBondStanding(deps: ITermsDeps, puppets: readonly Address[]): Promise<Map<Address, { bond: bigint; matchable: bigint }>> {
  const [bonds, open] = await Promise.all([readBonds(clientOf(deps, HUB), puppets), readOpenBacking(deps.chronicle, puppets)])
  return new Map(
    puppets.map(candidate => {
      const puppet = getAddress(candidate)
      const bond = bonds.get(puppet)
      const byMaster = open.get(puppet)
      if (bond === undefined || byMaster === undefined) throw new CompactError('BALANCE_UNREAD', `${puppet}'s bond standing was not read`, 'soft')
      const backed = [...byMaster.values()].reduce((total, stake) => total + stake, 0n)
      if (backed > bond) {
        throw new CompactError('BOND_OVERDRAWN', `${puppet} backs ${backed} of open cycles against a bond of ${bond}; the chronicle and the bond store disagree`, 'server')
      }
      return [puppet, { bond, matchable: bond - backed }] as const
    })
  )
}

export async function readCollateral(chronicle: IDigestClient, chainId: ChainId, master: Address): Promise<bigint> {
  const rows = await fromChronicle(
    `deposits of ${master} on chain ${chainId}`,
    chronicle.select(flowTable, { where: { chainId: BigInt(chainId), account: master, settlement: false } })
  )
  let total = 0n
  for (const r of rows) {
    if (r.pending || r.value === undefined) throw new CompactError('FLOW_PENDING', `flow ${r.id} is not valued yet; the chronicle values it lazily`, 'soft')
    total += r.value
  }
  return total
}

const valuationFrom = (chainId: ChainId, rates: ReadonlyMap<Address, Pick<IRate, 'token0' | 'token1'>>): ISettleValuation => {
  const rateOf = (token: Address) => {
    const rate = rates.get(getAddress(token))
    if (rate === undefined) throw new Error(`${token} on chain ${chainId} was not priced for this valuation`)
    return rate
  }
  return {
    toValue: (token, amount) => {
      const rate = rateOf(token)
      return (amount * rate.token0) / rate.token1
    },
    toAmount: (token, value) => {
      const rate = rateOf(token)
      return (value * rate.token1) / rate.token0
    }
  }
}

export async function valuationOf(getRate: IGetRate, chainId: ChainId, tokens: readonly Address[]): Promise<ISettleValuation> {
  const rates = new Map(
    await Promise.all(
      tokens.map(async token => {
        const symbol = symbolOf(chainId, token)
        return [getAddress(token), symbol === VALUE_SYMBOL ? { token0: 1n, token1: 1n } : await getRate(symbol, VALUE_SYMBOL)] as const
      })
    )
  )
  return valuationFrom(chainId, rates)
}

export function sealedValuationOf(chainId: ChainId, mark: IMarkRow | undefined, token: Address): ISettleValuation {
  if (mark === undefined) throw new CompactError('MARK_MISSING', 'the book has no mark to carry; open a cycle first', 'hard')
  if (mark.pending || mark.closeRate0 === undefined || mark.closeRate1 === undefined) {
    throw new CompactError('MARK_PENDING', `mark ${mark.id} is not evaluated yet; the chronicle values it lazily`, 'soft')
  }
  return valuationFrom(chainId, new Map([[getAddress(token), { token0: mark.closeRate0, token1: mark.closeRate1 }]]))
}

export interface IOperateTermsContext {
  chainId: ChainId
  master: Address
  book: IBookRow | undefined
  backers: readonly IBackerRow[]
  mark: IMarkRow | undefined
  cycle: bigint
  mandates: ReadonlyMap<Address, IMandateRow>
  matchable: ReadonlyMap<Address, bigint>
  collateral: bigint
  nowSec: number
}

export type IOperateTerms = Pick<ICoreGate__OperateIntent, 'cycle' | 'value' | 'collateral' | 'backed' | 'backingList'>

export async function readOperateContext(deps: ITermsDeps, chainId: ChainId, master: Address, nowSec: number): Promise<IOperateTermsContext> {
  const { book, backers, mark } = await readBookState(deps.chronicle, chainId, master)
  const open = await openCycleOf(deps.chronicle, chainId, book)
  if (open === null && book !== undefined) await assertCycleSettled(deps.chronicle, chainId, book, backers, mark)
  const cycle = open === null ? (book === undefined ? 0n : book.cycle) + 1n : open.cycle
  const mandates = await readMandates(deps.chronicle, master)
  const [standing, collateral] = await Promise.all([readBondStanding(deps, [...mandates.keys()]), readCollateral(deps.chronicle, chainId, master)])
  return {
    chainId,
    master,
    book,
    backers,
    mark,
    cycle,
    mandates,
    matchable: new Map([...standing].map(([puppet, bond]) => [puppet, bond.matchable] as const)),
    collateral,
    nowSec
  }
}

export function operateTermsOf(ctx: IOperateTermsContext, tokenId: Hex, skin: bigint): IOperateTerms {
  const bookCycle = ctx.book === undefined ? 0n : ctx.book.cycle
  const opening = ctx.cycle > bookCycle
  const backed = opening || ctx.book === undefined ? 0n : ctx.book.backed
  const value = opening ? ctx.collateral : carriedValue(ctx.mark)
  const committedAt = new Map(ctx.backers.map(b => [getAddress(b.puppet), b.committedAt]))
  const candidates: ICohortCandidate[] = [...ctx.mandates].map(([puppet, row]) => {
    const matchable = ctx.matchable.get(puppet)
    if (matchable === undefined) throw new CompactError('BALANCE_UNREAD', `${puppet}'s matchable bond was not read`, 'soft')
    const committed = committedAt.get(puppet)
    return { puppet, mandate: mandateOf(row), matchable, committedAt: committed === undefined ? 0 : committed }
  })
  const rows = composeCohort({ master: ctx.master, tokenId, collateral: ctx.collateral, skin, backed, nowSec: ctx.nowSec, minStake: COHORT_MIN_STAKE, candidates })
  return {
    cycle: ctx.cycle,
    value,
    collateral: ctx.collateral,
    backed,
    backingList: rows.map(row => ({ puppet: row.puppet, matchable: row.matchable, stake: row.stake, mandate: row.mandate }))
  }
}

export interface ISettleTermsContext {
  spokeChainId: ChainId
  book: IBookRow
  backers: readonly IBackerRow[]
  mark: IMarkRow | undefined
  settled: ISettlementRow | undefined
  closingValue: bigint
  mandates: ReadonlyMap<Address, IMandateRow>
  token: Address
  tokenId: Hex
  spokeValuation: ISettleValuation | null
  hubValuation: ISettleValuation
  bondToken: Address
  masterHolding: bigint
}

export interface ISettleTerms {
  cycle: bigint
  value: bigint
  gainList: ICoreGate__Outcome[]
  lossList: IHubGate__Loss[]
}

export async function readSettleContext(deps: ITermsDeps, spokeChainId: ChainId, master: Address, requested: Address | null): Promise<ISettleTermsContext> {
  const { book, backers, mark } = await readBookState(deps.chronicle, spokeChainId, master)
  if (book === undefined || book.cycle === 0n) throw new CompactError('BAD_REQUEST', `${master} has no book on chain ${spokeChainId}`, 'hard')
  const settled = await readSettlement(deps.chronicle, master, spokeChainId, book.cycle, 'settle')
  const token = settled !== undefined && settled.token !== undefined ? getAddress(settled.token) : requested
  if (token === null) {
    throw new CompactError('UNSETTLED', `cycle ${book.cycle} of ${master} has no settlement on chain ${spokeChainId} yet; settle the gains first`, 'soft')
  }
  if (!isAddressEqual(token, book.token)) {
    throw new CompactError('BAD_REQUEST', `gains settle in the book's token ${book.token}, not ${token}`, 'hard')
  }
  const client = clientOf(deps, spokeChainId)
  const bondToken = bondTokenOf(HUB)
  const [tokenRegistry, mandates, masterHolding, hubValuation] = await Promise.all([
    deps.getTokenRegistry(),
    readMandates(deps.chronicle, master),
    fromChain(`balance of ${master} in ${token}`, spokeChainId, fetchTokenBalance(client, token, master)),
    valuationOf(deps.getRate, HUB, [bondToken])
  ])
  return {
    spokeChainId,
    book,
    backers,
    mark,
    settled,
    closingValue: settled !== undefined && settled.value !== undefined ? settled.value : carriedValue(mark),
    mandates,
    token,
    tokenId: tokenInfoFor(tokenRegistry, spokeChainId, token).tokenId,
    spokeValuation: settled === undefined ? sealedValuationOf(spokeChainId, mark, token) : null,
    hubValuation,
    bondToken,
    masterHolding
  }
}

export function settleTermsOf(ctx: ISettleTermsContext): ISettleTerms {
  const ledger = {
    totalShares: ctx.book.totalShares,
    totalPending: ctx.book.totalPending,
    backing: ctx.book.backed,
    masterShares: ctx.book.masterShares,
    masterPending: ctx.book.masterPending
  }
  const owed = owedFor(ledger, carriedValue(ctx.mark), ctx.closingValue, ctx.backers)
  const gainList: ICoreGate__Outcome[] = []
  const lossList: IHubGate__Loss[] = []
  for (const row of owed) {
    if (row.owed === 0n) continue
    const puppet = getAddress(row.puppet)
    const known = ctx.mandates.get(puppet)
    if (known === undefined) throw new CompactError('MANDATE_UNKNOWN', `${puppet} has no mandate naming ${ctx.book.master}`, 'hard')
    if (row.owed < 0n) {
      lossList.push({ puppet, amount: ctx.hubValuation.toAmount(ctx.bondToken, -row.owed) })
      continue
    }
    if (ctx.spokeValuation === null) continue
    const mandate = mandateOf(known)
    if (!listsToken(mandate, ctx.tokenId)) throw new CompactContractError('Mandate__TokenNotListed', [puppet, ctx.token])
    const amount = ctx.spokeValuation.toAmount(ctx.token, row.owed)
    if (amount > 0n) gainList.push({ puppet, amount, mandate })
  }
  const byPuppet = <T extends { puppet: Address }>(rows: T[]): T[] => rows.sort((a, b) => (BigInt(a.puppet) < BigInt(b.puppet) ? -1 : 1))
  return { cycle: ctx.book.cycle, value: ctx.closingValue, gainList: byPuppet(gainList), lossList: byPuppet(lossList) }
}
