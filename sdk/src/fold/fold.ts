import { HUB_CANONICAL_TOKEN, HUB_CHAIN_ID, PRICE_PRECISION, PROTOCOL, VIRTUAL_SHARES } from '@puppet/contracts/const'
import { accountCallEvent } from '@puppet/contracts/events'
import type { IAccountCall__Deposit_depositAcross, IAccountCall__Deposit_fundSwap, IAccountCall__Deposit_withdraw, IAccountCall__Fund_allocateMaster, IAccountCall__Fund_allocateOwner, IAccountCall__Fund_allocatePuppet, IAccountCall__HubGate_createFund, IAccountCall__HubGate_mandate, IAccountCall__LiquidityGate_deposit, IAccountCall__LiquidityGate_depositEscrow, IAccountCall__LiquidityGate_retireEscrow, IAccountCall__LiquidityGate_returnEscrow, IAccountCall__Redeem_redeem, IAccountCall__Redeem_redeemCohortHolder, IAccountCall__Redeem_redeemCohortMaster, IAccountCall__Redeem_redeemCohortOwner, IAccountCall__Redeem_sell, IAccountCall__SpokeGate_fulfil, IAccountCall__UserAccount_revokeSessions, IAccountCall__UserAccount_withdraw, IAccountCallEntry, IBalanceLib__Balance, IFundStore__Redemption, IIAccount__Call } from '@puppet/contracts/types'
import { decodeEventLog, encodeAbiParameters, encodeFunctionData, erc20Abi, getAddress, type Hex, isAddressEqual, keccak256, parseAbiItem, slice, toEventSelector } from 'viem'
import { ACCOUNT_CALL_MAP, ACCOUNT_CALL_TOPIC, decodeAccountCall, type IReceiptLog, type IStoredAccountCall, swapDeliveryAmount } from '../account/index.js'
import { IntervalTime, PLATFORM_STAT_INTERVAL, PRECISION } from '../const/common.js'
import { type ChainId, deploymentAddress, TOKEN_META } from '../const/index.js'
import { decode, encode } from '../compact/index.js'
import type { IColumns, InferRow, ITable } from '../datastore/index.js'
import type { IOracleSnapshot } from '../evaluate/oracleRate.js'
import { acrossSpokePoolOf } from '../intent/route/acrossDeposit.js'
import { cashFor, claimOf, type IRedeemPlan, performanceIndexOf, planCohort, planRedeem, planSell, POOL_SHARE, POOL_SOURCE } from '../pool/index.js'
import { ACCOUNT_VENUE, accountTable, allowanceTable, balanceTable, creditTable, escrowTable, flowTable, fulfilTable, fundListTable, fundTable, holdingTable, type IAccountRow, type IFundMetricRow, mandateTable, fundMetricTable, observationTable, ownerCreditTable, positionSyncTable, positionTable, redemptionTable, transitTable, venueTable } from '../schema/index.js'
import { windowPnlSeries, windowVenueSeries } from '../state/metricMath.js'
import { providerToken, symbolOf, tokenMetaOf, wrappedNativeAddressOf } from '../state/tokenRegistry.js'
import { HYPERLIQUID_CHAIN_ID } from '../venue/hyperliquid/contracts.js'
import { hyperliquidCollateralUsd, hyperliquidRows, hyperliquidSpotExit, type IHyperliquidObservation } from '../venue/hyperliquid/evaluate.js'
import { hyperliquidVenue } from '../venue/hyperliquid/screen.js'
import { NO_VENUE_FACTS } from '../venue/screen.js'
import type { IVenuePosition } from '../venue/types.js'
import { standingMovesOf, VENUES } from '../venue/venues.js'

export interface IStore {
  set<Cols extends IColumns>(table: ITable<Cols>, row: InferRow<Cols>): void
  get<Cols extends IColumns>(table: ITable<Cols>, key: string | Partial<InferRow<Cols>>): Promise<InferRow<Cols> | undefined>
  getOrCreate<Cols extends IColumns>(table: ITable<Cols>, row: InferRow<Cols>): Promise<InferRow<Cols>>
}

export interface IAccountEntry {
  chainId: number
  account: Hex
  source: Hex
  digest: Hex
  executionData: Hex
  callList: IIAccount__Call[]
  resultList: Hex[]
  balanceList: IBalanceLib__Balance[]
  siblingLogs: IReceiptLog[]
  block: { number: number; timestamp: number }
  logIndex: number
  transactionHash: Hex
}

const entryIdOf = (entry: Pick<IAccountEntry, 'chainId' | 'transactionHash' | 'logIndex'>): string =>
  `${entry.chainId}-${entry.transactionHash}-${entry.logIndex}`
const holdingIdOf = (master: Hex, holder: Hex): string => `${getAddress(master)}-${getAddress(holder)}`
const ceilDiv = (a: bigint, b: bigint): bigint => (a === 0n ? 0n : (a - 1n) / b + 1n)
const valueFor = (amount: bigint, price: { amount: bigint; value: bigint }): bigint => (amount * price.value) / price.amount

export const FUNDS_DEPOSITED = parseAbiItem(
  'event FundsDeposited(bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 indexed destinationChainId, uint256 indexed depositId, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes32 indexed depositor, bytes32 recipient, bytes32 exclusiveRelayer, bytes message)'
)
export const FUNDS_DEPOSITED_TOPIC = toEventSelector(FUNDS_DEPOSITED)

const where = (entry: Pick<IAccountEntry, 'account' | 'block' | 'logIndex'>): string => `${entry.account}@${entry.block.number}:${entry.logIndex}`

interface ISiblingRecord {
  account: Hex
  digest: Hex
  logIndex: number
  record: IAccountCallEntry
}

const decodedReceipts = new WeakMap<readonly IReceiptLog[], readonly ISiblingRecord[]>()

export function siblingRecords(entry: Pick<IAccountEntry, 'siblingLogs' | 'logIndex'>): ISiblingRecord[] {
  const held = decodedReceipts.get(entry.siblingLogs)
  const rows =
    held ??
    entry.siblingLogs
      .filter(log => log.topics[0] === ACCOUNT_CALL_TOPIC)
      .map(log => {
        const { args } = decodeEventLog({ abi: [accountCallEvent], data: log.data, topics: log.topics as [Hex, ...Hex[]] })
        return {
          account: getAddress(args.account),
          digest: args.digest,
          logIndex: log.logIndex,
          record: decodeAccountCall({ source: args.source, executionData: args.executionData })
        }
      })
      .sort((a, b) => a.logIndex - b.logIndex)
  decodedReceipts.set(entry.siblingLogs, rows)
  return rows.filter(row => row.logIndex !== entry.logIndex)
}

export function allocationRowsOf(entry: Pick<IAccountEntry, 'siblingLogs' | 'logIndex'>, master: Hex): ISiblingRecord[] {
  const rows: ISiblingRecord[] = []
  for (const row of siblingRecords(entry).filter(r => r.logIndex < entry.logIndex).reverse()) {
    if (!isAllocationRecord(row.record) || !isAddressEqual(row.record.master, master)) break
    rows.unshift(row)
  }
  return rows
}

const matches = (r: IAccountCallEntry, spec: { selector: Hex; size: number | null }): boolean =>
  r.selector === spec.selector &&
  (spec.size === null
    ? !Object.values(ACCOUNT_CALL_MAP).some(methods =>
        (Object.values(methods) as { selector: string; size: number | null }[]).some(other => other.selector === spec.selector && other.size === r.size)
      )
    : r.size === spec.size)

export const isAllocationRecord = (r: IAccountCallEntry): r is IAccountCall__Fund_allocatePuppet => matches(r, ACCOUNT_CALL_MAP.Fund.allocatePuppet)
export const isAllocateOwnerRecord = (r: IAccountCallEntry): r is IAccountCall__Fund_allocateOwner => matches(r, ACCOUNT_CALL_MAP.Fund.allocateOwner)
export const isSellRecord = (r: IAccountCallEntry): r is IAccountCall__Redeem_sell => matches(r, ACCOUNT_CALL_MAP.Redeem.sell)
export const isRedeemRecord = (r: IAccountCallEntry): r is IAccountCall__Redeem_redeem => matches(r, ACCOUNT_CALL_MAP.Redeem.redeem)
export const isRedeemHolderRecord = (r: IAccountCallEntry): r is IAccountCall__Redeem_redeemCohortHolder =>
  matches(r, ACCOUNT_CALL_MAP.Redeem.redeemCohortHolder)
export const isRedeemCloseRecord = (r: IAccountCallEntry): r is IAccountCall__Redeem_redeemCohortMaster =>
  matches(r, ACCOUNT_CALL_MAP.Redeem.redeemCohortMaster)
export const isRedeemOwnerRecord = (r: IAccountCallEntry): r is IAccountCall__Redeem_redeemCohortOwner =>
  matches(r, ACCOUNT_CALL_MAP.Redeem.redeemCohortOwner)

export function openPlanOf(d: Pick<IAccountCall__Redeem_redeem, 'valuation' | 'join' | 'active' | 'masterShares' | 'cash' | 'redemption' | 'rate'>): IRedeemPlan {
  const post = d.redemption
  return planRedeem({
    supply: d.active + d.masterShares + post.queued,
    masterBalance: d.masterShares,
    redemption: { id: post.id - 1n, masterPay: 0n, queued: post.queued, owedLeft: 0n },
    fraction: BigInt(post.fraction),
    join: d.join,
    valuation: d.valuation,
    token: post.token,
    price: d.rate,
    held: d.cash,
    native: 0n,
    fee: post.fee
  })
}

export interface IFundValuation {
  master: Hex
  value: bigint
  totalShares: bigint
  after: bigint
  sharesAfter: bigint
  block: number
  blockTimestamp: number
  logIndex: number
}

export function fundValuationsOf(
  master: Hex,
  calls: readonly Pick<IStoredAccountCall, 'source' | 'executionData' | 'balanceList' | 'blockNumber' | 'blockTimestamp' | 'logIndex'>[]
): IFundValuation[] {
  const valuations: IFundValuation[] = []
  for (const call of calls) {
    const d = decodeAccountCall(call)
    const at = { master: getAddress(master), block: Number(call.blockNumber), blockTimestamp: call.blockTimestamp, logIndex: call.logIndex }
    if (matches(d, ACCOUNT_CALL_MAP.Fund.allocateMaster)) {
      const r = d as IAccountCall__Fund_allocateMaster
      const priced = r.supply - VIRTUAL_SHARES
      valuations.push({ ...at, value: r.valuation, totalShares: priced, after: cashFor(priced + r.minted, priced, r.valuation), sharesAfter: priced + r.minted })
      continue
    }
    if (!isRedeemRecord(d)) continue
    const plan = openPlanOf(d)
    valuations.push({
      ...at,
      value: d.valuation,
      totalShares: plan.supply,
      after: plan.full ? 0n : d.valuation - valueFor(plan.redemption.potLeft + plan.redemption.masterPay, plan.rate),
      sharesAfter: plan.supply - plan.masterPart - plan.redemption.owedLeft / PRECISION.basisPoints
    })
  }
  return valuations
}

function verifyPuppetOrder(entry: IAccountEntry, rows: readonly { puppet: Hex }[]): void {
  for (let i = 1; i < rows.length; i++) {
    if (BigInt(rows[i]!.puppet) <= BigInt(rows[i - 1]!.puppet)) {
      throw new Error(`entry ${where(entry)}: row ${i} (${rows[i]!.puppet}) is out of order`)
    }
  }
}

async function selfOf(store: IStore, entry: IAccountEntry): Promise<IAccountRow> {
  const self = await store.get(accountTable, `${entry.chainId}-${getAddress(entry.account)}`)
  if (!self) throw new Error(`account ${entry.account} acts before its genesis was folded`)
  return self
}

function foldVenueCalls(store: IStore, entry: IAccountEntry): void {
  const account = getAddress(entry.account)
  const venues = VENUES.filter(venue => venue.chains.some(chainId => chainId === entry.chainId))
  const moveOf = (venue: (typeof venues)[number], call: IIAccount__Call) => (venue.transit === undefined ? null : venue.transit(entry.chainId as ChainId, account, call))
  for (const venue of venues) {
    if (!entry.callList.some(call => moveOf(venue, call) === null && venue.outflows(account, call).length > 0)) continue
    store.set(venueTable, { account, venue: venue.venueId, chainId: BigInt(entry.chainId), lastDepositTimestamp: entry.block.timestamp })
  }
  const moves = venues.flatMap(venue =>
    entry.callList.flatMap(call => {
      const move = moveOf(venue, call)
      return move === null ? [] : [move]
    })
  )
  if (moves.length === 0) return
  if (moves.length > 1) throw new Error(`entry ${where(entry)} bridges ${moves.length} times in one operate`)
  const move = moves[0]!
  const a = acrossDepositOf(entry)
  if (a === null) throw new Error(`entry ${where(entry)}: an operate bridging to chain ${move.destinationChainId} emitted no Across deposit`)
  if (
    a.destinationChainId !== move.destinationChainId ||
    !isAddressEqual(slice(a.inputToken, 12), move.inputToken) ||
    a.inputAmount !== move.inputAmount ||
    !isAddressEqual(slice(a.outputToken, 12), move.outputToken) ||
    a.outputAmount < move.outputAmount
  ) {
    throw new Error(
      `entry ${where(entry)}: its Across deposit bridges ${a.inputAmount} of ${slice(a.inputToken, 12)} for ${a.outputAmount} of ${slice(a.outputToken, 12)} to chain ${a.destinationChainId}, against the signed call's ${move.inputAmount} of ${move.inputToken} for ${move.outputAmount} of ${move.outputToken} to chain ${move.destinationChainId}`
    )
  }
  store.set(transitTable, {
    id: `${account}-${entry.chainId}-${move.destinationChainId}`,
    chainId: BigInt(entry.chainId),
    account,
    destinationChainId: move.destinationChainId,
    relayHash: a.relayHash,
    fillDeadline: a.fillDeadline,
    inputToken: getAddress(slice(a.inputToken, 12)),
    inputAmount: a.inputAmount,
    outputToken: getAddress(slice(a.outputToken, 12)),
    outputAmount: a.outputAmount,
    block: entry.block.number,
    blockTimestamp: entry.block.timestamp,
    logIndex: entry.logIndex
  })
}

function foldFlows(store: IStore, entry: IAccountEntry, account: Hex, deltas: ReadonlyMap<Hex, bigint>): void {
  for (const [token, amount] of deltas) {
    if (amount === 0n) continue
    store.set(flowTable, {
      id: `${entryIdOf(entry)}-${getAddress(account)}-${getAddress(token)}`,
      chainId: BigInt(entry.chainId),
      account: getAddress(account),
      token: getAddress(token),
      amount,
      block: entry.block.number,
      blockTimestamp: entry.block.timestamp,
      logIndex: entry.logIndex,
      pending: true,
      value: undefined
    })
  }
}

function foldBalances(store: IStore, entry: IAccountEntry): void {
  for (const b of entry.balanceList) {
    store.set(balanceTable, {
      chainId: BigInt(entry.chainId),
      account: getAddress(entry.account),
      token: getAddress(b.token),
      amount: b.amount,
      lastBlock: entry.block.number
    })
  }
}

async function foldCreateFund(store: IStore, entry: IAccountEntry, d: IAccountCall__HubGate_createFund): Promise<void> {
  const master = getAddress(entry.account)
  const prior = await store.get(fundTable, master)
  store.set(fundTable, {
    master,
    shareToken: getAddress(d.clone),
    symbol: d.symbol,
    pixels: d.pixels,
    performanceFee: d.performanceFee,
    totalShares: prior === undefined ? 0n : prior.totalShares,
    value: prior === undefined ? 0n : prior.value,
    averageCost: prior === undefined ? POOL_SHARE : prior.averageCost,
    transactionHash: entry.transactionHash,
    lastBlock: entry.block.number
  })
  if (prior === undefined) {
    const listed = await store.get(fundListTable, FUND_LIST_ID)
    store.set(fundListTable, { id: FUND_LIST_ID, masterList: [...(listed === undefined ? [] : listed.masterList), master] })
  }
  await syncFundMetrics(store, master, entry.block.timestamp)
}

const FUND_LIST_ID = 'all'

const escrowIdOf = (owner: Hex, chainId: bigint, token: Hex): string => `${getAddress(owner)}-${chainId}-${getAddress(token)}`

async function foldDeposit(store: IStore, entry: IAccountEntry, d: IAccountCall__LiquidityGate_deposit): Promise<void> {
  await selfOf(store, entry)
  if (d.amount === 0n) throw new Error(`entry ${where(entry)} deposits nothing`)
  if (d.msgValue > d.amount) throw new Error(`entry ${where(entry)} attaches ${d.msgValue} to a deposit of ${d.amount}`)
  const token = getAddress(d.token)
  const native = getAddress(PROTOCOL.nativeToken)
  const deltas = new Map<Hex, bigint>()
  if (isAddressEqual(token, native)) {
    deltas.set(native, d.msgValue)
    deltas.set(wrappedNativeAddressOf(entry.chainId as ChainId), d.amount - d.msgValue)
  } else {
    deltas.set(token, d.amount)
  }
  foldFlows(store, entry, entry.account, deltas)
}

async function foldDepositEscrow(store: IStore, entry: IAccountEntry, d: IAccountCall__LiquidityGate_depositEscrow): Promise<void> {
  await selfOf(store, entry)
  const owner = getAddress(entry.account)
  const token = getAddress(d.token)
  if (d.amount === 0n) throw new Error(`entry ${where(entry)} escrows nothing`)
  const chainId = BigInt(entry.chainId)
  const prior = await store.get(escrowTable, escrowIdOf(owner, chainId, token))
  const escrowed = prior === undefined ? 0n : prior.escrowed
  if (d.escrowed !== escrowed + d.amount) throw new Error(`entry ${where(entry)} escrows ${d.amount} to a total of ${d.escrowed} where the fold holds ${escrowed}`)
  store.set(escrowTable, {
    owner,
    chainId,
    token,
    escrowed: d.escrowed,
    released: prior === undefined ? 0n : prior.released,
    returned: prior === undefined ? 0n : prior.returned
  })
  foldFlows(store, entry, deploymentAddress('EscrowStore', entry.chainId), new Map([[token, d.amount]]))
}

async function foldFulfil(store: IStore, entry: IAccountEntry, d: IAccountCall__SpokeGate_fulfil): Promise<void> {
  const master = getAddress(entry.account)
  const self = await selfOf(store, entry)
  const owner = getAddress(self.owner)
  const chainId = BigInt(entry.chainId)
  const token = getAddress(d.token)
  const escrow = await store.get(escrowTable, escrowIdOf(owner, chainId, token))
  if (escrow === undefined) throw new Error(`entry ${where(entry)} releases ${owner}'s escrow the fold never recorded`)
  const prior = await store.get(fulfilTable, `${owner}-${master}-${chainId}-${token}`)
  const fulfilled = prior === undefined ? 0n : prior.fulfilled
  const feeBilled = prior === undefined ? 0n : prior.feeBilled
  if (d.total <= fulfilled || d.feeTotal < feeBilled) {
    throw new Error(`entry ${where(entry)} fulfils a total of ${d.total} with fees of ${d.feeTotal} where the fold holds ${fulfilled} and ${feeBilled}`)
  }
  const amount = d.total - fulfilled
  const fee = d.feeTotal - feeBilled
  if (amount > escrow.escrowed - escrow.released - escrow.returned) {
    throw new Error(`entry ${where(entry)} releases ${amount} of an escrow open for ${escrow.escrowed - escrow.released - escrow.returned}`)
  }
  if (fee > amount) throw new Error(`entry ${where(entry)} bills a fee of ${fee} against a release of ${amount}`)
  store.set(fulfilTable, {
    owner,
    master,
    chainId,
    token,
    fulfilled: d.total,
    feeBilled: d.feeTotal,
    lastBlock: entry.block.number,
    lastLogIndex: entry.logIndex
  })
  store.set(escrowTable, { ...escrow, released: escrow.released + amount })
  foldFlows(store, entry, deploymentAddress('EscrowStore', entry.chainId), new Map([[token, -amount]]))
  foldFlows(store, entry, master, new Map([[token, amount - fee]]))
}

async function foldRetireEscrow(store: IStore, entry: IAccountEntry, d: IAccountCall__LiquidityGate_retireEscrow): Promise<void> {
  await selfOf(store, entry)
  const owner = getAddress(entry.account)
  const token = getAddress(d.token)
  if (d.amount === 0n) throw new Error(`entry ${where(entry)} escrows nothing`)
  const chainId = BigInt(entry.chainId)
  const prior = await store.get(escrowTable, escrowIdOf(owner, chainId, token))
  const escrowed = prior === undefined ? 0n : prior.escrowed
  if (d.escrowed !== escrowed + d.amount) throw new Error(`entry ${where(entry)} escrows ${d.amount} to a total of ${d.escrowed} where the fold holds ${escrowed}`)
  store.set(escrowTable, {
    owner,
    chainId,
    token,
    escrowed: d.escrowed,
    released: prior === undefined ? 0n : prior.released,
    returned: prior === undefined ? 0n : prior.returned
  })
  const wrap = entry.callList[0]
  const spent = wrap !== undefined && isAddressEqual(wrap.target, token) && wrap.value === d.amount ? getAddress(PROTOCOL.nativeToken) : token
  const paid = new Map([[spent, -d.amount]])
  const feeToken = getAddress(d.feeToken)
  paid.set(feeToken, (paid.get(feeToken) ?? 0n) - d.fee)
  foldFlows(store, entry, owner, paid)
  foldFlows(store, entry, deploymentAddress('EscrowStore', entry.chainId), new Map([[token, d.amount]]))
}

async function foldReturnEscrow(store: IStore, entry: IAccountEntry, d: IAccountCall__LiquidityGate_returnEscrow): Promise<void> {
  await selfOf(store, entry)
  const owner = getAddress(entry.account)
  const token = getAddress(d.token)
  const escrow = await store.get(escrowTable, escrowIdOf(owner, BigInt(entry.chainId), token))
  if (escrow === undefined) throw new Error(`entry ${where(entry)} returns escrow the fold never recorded`)
  const open = escrow.escrowed - escrow.released - escrow.returned
  if (open === 0n || d.returned !== escrow.returned + open) {
    throw new Error(`entry ${where(entry)} returns to a total of ${d.returned} where the fold holds ${escrow.returned} returned and ${open} open`)
  }
  store.set(escrowTable, { ...escrow, returned: d.returned })
  foldFlows(store, entry, deploymentAddress('EscrowStore', entry.chainId), new Map([[token, -open]]))
}

async function foldCredit(store: IStore, entry: IAccountEntry, parent: Hex, d: IAccountCall__Fund_allocateMaster): Promise<bigint> {
  const master = getAddress(entry.account)
  const row = d.credit
  if (row.total === 0n) {
    if (d.masterBilled !== 0n) throw new Error(`entry ${where(entry)} bills ${d.masterBilled} without a credit`)
    return 0n
  }
  const signed = siblingRecords(entry)
    .filter(r => r.logIndex < entry.logIndex)
    .reverse()
    .find(r => isAllocateOwnerRecord(r.record) && isAddressEqual(r.record.master, master))
  const record = signed?.record as IAccountCall__Fund_allocateOwner | undefined
  if (
    signed === undefined ||
    record === undefined ||
    !isAddressEqual(signed.account, parent) ||
    record.credit.chainId !== row.chainId ||
    !isAddressEqual(record.credit.token, row.token) ||
    record.credit.total !== row.total ||
    record.credit.feeTotal !== row.feeTotal
  ) {
    throw new Error(`entry ${where(entry)} credits a total of ${row.total} of ${row.token} from chain ${row.chainId} without its owner ${parent} recording the same total`)
  }
  const owner = getAddress(parent)
  const token = getAddress(row.token)
  const chainId = BigInt(entry.chainId)
  if (row.chainId !== chainId) {
    const prior = await store.get(creditTable, `${master}-${row.chainId}-${token}`)
    const credited = prior === undefined ? 0n : prior.credited
    const feeOwed = prior === undefined ? 0n : prior.feeOwed
    if (row.total <= credited || row.total - credited <= d.masterBilled) {
      throw new Error(`entry ${where(entry)} credits a total of ${row.total} billing ${d.masterBilled} where the fold holds ${credited}`)
    }
    if (row.feeTotal !== feeOwed + d.masterBilled) {
      throw new Error(`entry ${where(entry)} totals fees of ${row.feeTotal} where the fold holds ${feeOwed} and the round bills ${d.masterBilled}`)
    }
    store.set(creditTable, { master, creditChainId: row.chainId, token, credited: row.total, feeOwed: row.feeTotal })
    return row.total - credited
  }
  if (!isAddressEqual(token, d.token)) throw new Error(`entry ${where(entry)} credits ${row.token} into a ${d.token} round`)
  const prior = await store.get(fulfilTable, `${owner}-${master}-${chainId}-${token}`)
  const fulfilled = prior === undefined ? 0n : prior.fulfilled
  const feeBilled = prior === undefined ? 0n : prior.feeBilled
  if (row.total <= fulfilled || row.total - fulfilled <= d.masterBilled || row.feeTotal !== feeBilled + d.masterBilled) {
    throw new Error(`entry ${where(entry)} releases a total of ${row.total} with fees of ${row.feeTotal} billing ${d.masterBilled} where the fold holds ${fulfilled} and ${feeBilled}`)
  }
  const amount = row.total - fulfilled
  const escrow = await store.get(escrowTable, escrowIdOf(owner, chainId, token))
  if (escrow === undefined) throw new Error(`entry ${where(entry)} releases ${owner}'s escrow the fold never recorded`)
  if (amount > escrow.escrowed - escrow.released - escrow.returned) {
    throw new Error(`entry ${where(entry)} releases ${amount} of an escrow open for ${escrow.escrowed - escrow.released - escrow.returned}`)
  }
  store.set(fulfilTable, {
    owner,
    master,
    chainId,
    token,
    fulfilled: row.total,
    feeBilled: row.feeTotal,
    lastBlock: entry.block.number,
    lastLogIndex: entry.logIndex
  })
  store.set(escrowTable, { ...escrow, released: escrow.released + amount })
  foldFlows(store, entry, deploymentAddress('EscrowStore', entry.chainId), new Map([[token, -amount]]))
  return amount
}

async function foldAllocateOwner(store: IStore, entry: IAccountEntry, d: IAccountCall__Fund_allocateOwner): Promise<void> {
  await selfOf(store, entry)
  if (entry.callList.length > 0) throw new Error(`entry ${where(entry)}: an owner's consent to a credit moves nothing from its account`)
  if (d.credit.chainId === BigInt(entry.chainId)) return
  const owner = getAddress(entry.account)
  const master = getAddress(d.master)
  const token = getAddress(d.credit.token)
  const [book, committed] = await Promise.all([
    store.get(creditTable, `${master}-${d.credit.chainId}-${token}`),
    store.get(ownerCreditTable, `${owner}-${d.credit.chainId}-${token}`)
  ])
  const prior = book === undefined ? 0n : book.credited
  if (d.credit.total <= prior) throw new Error(`entry ${where(entry)} signs a total of ${d.credit.total} for ${master} where the fold holds ${prior}`)
  store.set(ownerCreditTable, {
    owner,
    chainId: d.credit.chainId,
    token,
    credited: (committed === undefined ? 0n : committed.credited) + d.credit.total - prior
  })
}

async function foldAllocate(store: IStore, entry: IAccountEntry, self: IAccountRow, d: IAccountCall__Fund_allocateMaster): Promise<void> {
  const master = getAddress(entry.account)
  const prior = await store.get(fundTable, master)
  if (prior === undefined) throw new Error(`entry ${where(entry)} allocates into a fund the fold never opened`)
  if (d.price.amount === 0n || d.price.value === 0n) throw new Error(`entry ${where(entry)} prices its round at ${d.price.amount} for ${d.price.value}`)
  if (d.supply < VIRTUAL_SHARES) throw new Error(`entry ${where(entry)} prices a supply of ${d.supply} below its virtual shares`)
  const supply = d.supply - VIRTUAL_SHARES
  const rows = allocationRowsOf(entry, master)
  verifyPuppetOrder(entry, rows.map(r => ({ puppet: r.account })))
  let staked = 0n
  let sold = 0n
  for (const [i, row] of rows.entries()) {
    const record = row.record as IAccountCall__Fund_allocatePuppet
    if (isAddressEqual(row.account, master) || isAddressEqual(row.account, self.owner)) {
      throw new Error(`entry ${where(entry)} allocates the master or its owner as a puppet`)
    }
    if (!isAddressEqual(record.master, master)) throw new Error(`entry ${where(entry)} row ${i}: ${row.account} allocated into ${record.master}`)
    if (record.amount === 0n) throw new Error(`entry ${where(entry)} row ${i}: ${row.account} logged a zero stake`)
    if (record.value !== valueFor(record.amount, d.price)) {
      throw new Error(`entry ${where(entry)} row ${i}: ${row.account} staked ${record.amount} logged at ${record.value}, off the round price`)
    }
    if (record.slice !== d.slice) throw new Error(`entry ${where(entry)} row ${i}: ${row.account} paid a slice of ${record.slice} in a round sliced at ${d.slice}`)
    staked += record.value
    sold += record.shares
  }
  const creditAmount = await foldCredit(store, entry, self.owner, d)
  const masterFee = d.credit.total > 0n ? d.slice : 0n
  const masterSlice = (masterFee * d.price.amount) / d.price.value
  const local = d.credit.chainId === BigInt(entry.chainId)
  if (d.billed !== (d.slice * BigInt(rows.length) * d.price.amount) / d.price.value) {
    throw new Error(`entry ${where(entry)}: bills ${d.billed} for ${rows.length} slices of ${d.slice} at the round price`)
  }
  if (local ? d.masterBilled !== masterSlice && d.masterBilled !== ceilDiv(masterFee * d.price.amount, d.price.value) : d.masterBilled < masterSlice) {
    throw new Error(`entry ${where(entry)}: bills the master ${d.masterBilled} for a ${masterFee} slice at the round price`)
  }
  if (sold > d.minted) throw new Error(`entry ${where(entry)}: the puppet rows mint ${sold} of ${d.minted} shares`)
  const creditValue = valueFor(creditAmount, d.price)
  const added = creditValue + staked - d.slice * BigInt(rows.length) - masterFee - (local ? 0n : valueFor(d.masterBilled - masterSlice, d.price))
  const closing = entry.balanceList.find(b => isAddressEqual(b.token, prior.shareToken))
  if (closing === undefined) throw new Error(`entry ${where(entry)} closes without the master's ${prior.shareToken} balance`)

  const next = {
    ...prior,
    master,
    totalShares: supply + d.minted,
    value: d.valuation + added,
    averageCost: (prior.averageCost * supply + (added + (supply === 0n ? d.valuation : 0n)) * POOL_SHARE) / (supply + d.minted),
    lastBlock: entry.block.number
  }
  store.set(fundTable, next)
  store.set(holdingTable, { master, holder: master, shares: closing.amount, queued: 0n, allocatedAt: 0n, redeemedAt: 0n, cost: 0n })
  const deltas = new Map<Hex, bigint>()
  if (creditAmount > 0n && d.credit.chainId === BigInt(entry.chainId)) deltas.set(getAddress(d.credit.token), creditAmount - d.masterBilled)
  foldFlows(store, entry, entry.account, deltas)
  await meterFund(store, master, entry.block.timestamp, {
    venue: null,
    valuation: d.valuation,
    index: performanceIndexOf(next.value, next),
    allocated: true
  })
  await syncFundMetrics(store, master, entry.block.timestamp)
}

async function foldAllocation(store: IStore, entry: IAccountEntry, d: IAccountCall__Fund_allocatePuppet): Promise<void> {
  const master = getAddress(d.master)
  const [leg, ...rest] = entry.callList
  if (
    leg === undefined ||
    rest.length > 0 ||
    leg.value !== 0n ||
    leg.callData !== encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [master, d.amount] })
  ) {
    throw new Error(`entry ${where(entry)}: an allocation must carry exactly one transfer of ${d.amount} to ${master}`)
  }
  const holder = getAddress(entry.account)
  const prior = await store.get(holdingTable, holdingIdOf(master, holder))
  const queued = prior === undefined ? 0n : prior.queued
  const redeemedAt = prior === undefined ? 0n : prior.redeemedAt
  const held = prior === undefined ? 0n : prior.shares
  const cost = ((prior === undefined ? 0n : prior.cost) * held + (d.value - d.slice) * PRICE_PRECISION) / (held + d.shares)
  if (
    BigInt(d.holding.allocatedAt) !== BigInt(entry.block.timestamp) ||
    d.holding.queued !== queued ||
    BigInt(d.holding.redeemedAt) !== redeemedAt ||
    d.holding.cost !== cost
  ) {
    throw new Error(
      `entry ${where(entry)}: ${holder} enters ${master} holding ${d.holding.queued} queued at cost ${d.holding.cost}, paid in redemption ${d.holding.redeemedAt}, where the fold holds ${queued} queued, a blended cost of ${cost} and redemption ${redeemedAt}`
    )
  }
  foldFlows(store, entry, entry.account, new Map([[getAddress(leg.target), -((d.slice * d.amount) / d.value)]]))
  store.set(holdingTable, { master, holder, shares: held + d.shares, queued, allocatedAt: BigInt(d.holding.allocatedAt), redeemedAt, cost })
  if (held === 0n && d.shares > 0n) {
    for (const row of await metricRowsOf(store, master, entry.block.timestamp)) store.set(fundMetricTable, { ...row, backers: row.backers + 1 })
  }
}

function verifyRedemption(entry: IAccountEntry, what: string, recorded: IFundStore__Redemption, planned: IFundStore__Redemption): void {
  const off = (Object.keys(recorded) as (keyof IFundStore__Redemption)[]).find(key => recorded[key] !== planned[key])
  if (off !== undefined) throw new Error(`entry ${where(entry)} ${what} leaves redemption ${off} at ${recorded[off]} where the fold plans ${planned[off]}`)
}

async function foldSell(store: IStore, entry: IAccountEntry, d: IAccountCall__Redeem_sell): Promise<void> {
  if (d.shares === 0n) throw new Error(`entry ${where(entry)} sells no shares`)
  const holder = getAddress(entry.account)
  const master = getAddress(d.master)
  const [prior, fund] = await Promise.all([store.get(holdingTable, holdingIdOf(master, holder)), store.get(fundTable, master)])
  if (prior === undefined || fund === undefined) throw new Error(`entry ${where(entry)} sells ${holder}'s shares in ${master}, which it never held`)
  const post = d.redemption
  const settled = BigInt(d.holding.redeemedAt) === post.id && prior.redeemedAt !== post.id
  const claim = settled ? claimOf(prior, prior.shares, post.fraction) : 0n
  const before = settled
    ? {
        ...post,
        potLeft: post.potLeft + d.payout,
        owedLeft: post.owedLeft + claim,
        queued: post.queued - d.shares + d.queued,
        masterPay: post.masterPay - d.profitFee + d.protocolCut
      }
    : { ...post, queued: post.queued - d.shares }
  const planned = planSell({
    redemption: before,
    holding: { allocatedAt: Number(prior.allocatedAt), redeemedAt: Number(prior.redeemedAt), queued: prior.queued, cost: prior.cost },
    balance: prior.shares,
    shares: d.shares,
    performanceFee: fund.performanceFee,
    protocolFeeShare: PROTOCOL.protocolFeeShare
  })
  const recorded = {
    queued: d.queued,
    burned: d.burned,
    payout: d.payout,
    profitFee: d.profitFee,
    protocolCut: d.protocolCut,
    'holding.allocatedAt': d.holding.allocatedAt,
    'holding.redeemedAt': d.holding.redeemedAt,
    'holding.queued': d.holding.queued,
    'holding.cost': d.holding.cost
  }
  const expected = {
    queued: planned.queued,
    burned: planned.burned,
    payout: planned.payout,
    profitFee: planned.profitFee,
    protocolCut: planned.protocolCut,
    'holding.allocatedAt': planned.holding.allocatedAt,
    'holding.redeemedAt': planned.holding.redeemedAt,
    'holding.queued': planned.holding.queued,
    'holding.cost': planned.holding.cost
  }
  const off = (Object.keys(expected) as (keyof typeof expected)[]).find(key => recorded[key] !== expected[key])
  if (off !== undefined) throw new Error(`entry ${where(entry)} sells ${holder}'s shares in ${master} with ${off} ${recorded[off]} where the fold plans ${expected[off]}`)
  verifyRedemption(entry, `selling ${holder}'s shares`, post, planned.redemption)
  store.set(holdingTable, {
    master,
    holder,
    shares: planned.balance,
    queued: d.holding.queued,
    allocatedAt: BigInt(d.holding.allocatedAt),
    redeemedAt: BigInt(d.holding.redeemedAt),
    cost: d.holding.cost
  })
  const row = await store.get(redemptionTable, master)
  if (row === undefined && post.id !== 0n) throw new Error(`entry ${where(entry)} sells into redemption ${post.id} of ${master}, which the fold never opened`)
  store.set(redemptionTable, { rateAmount: undefined, rateValue: undefined, ...row, master, ...post })
  const mandate = await store.get(mandateTable, `${holder}-${master}`)
  if (mandate !== undefined) store.set(mandateTable, { ...mandate, expiry: 0n })
  const paid = new Map<Hex, bigint>([[getAddress(post.token), d.payout - d.profitFee]])
  const feeToken = getAddress(d.feeToken)
  paid.set(feeToken, (paid.get(feeToken) ?? 0n) - d.fee)
  foldFlows(store, entry, entry.account, paid)
  if (prior.shares > 0n && planned.balance === 0n) {
    for (const row of await metricRowsOf(store, master, entry.block.timestamp)) {
      if (row.backers === 0) throw new Error(`entry ${where(entry)} empties ${holder}'s holding in ${master}, which counts no backers`)
      store.set(fundMetricTable, { ...row, backers: row.backers - 1 })
    }
  }
}

async function foldRedeem(store: IStore, entry: IAccountEntry, d: IAccountCall__Redeem_redeem): Promise<void> {
  const master = getAddress(entry.account)
  const fund = await store.get(fundTable, master)
  const holding = await store.get(holdingTable, holdingIdOf(master, master))
  if (fund === undefined || holding === undefined) throw new Error(`entry ${where(entry)} opens a redemption in a fund the fold never opened`)
  if (d.masterShares !== holding.shares) throw new Error(`entry ${where(entry)} opens on ${d.masterShares} master shares where the fold holds ${holding.shares}`)
  const plan = openPlanOf(d)
  verifyRedemption(entry, 'opening', d.redemption, plan.redemption)
  const closing = entry.balanceList.find(b => isAddressEqual(b.token, fund.shareToken))
  const token = getAddress(d.redemption.token)
  if (closing === undefined || closing.amount !== d.masterShares - plan.masterPart || !entry.balanceList.some(b => isAddressEqual(b.token, token))) {
    throw new Error(`entry ${where(entry)}: the master closes holding ${closing?.amount} of ${d.masterShares} shares, retiring ${plan.masterPart}`)
  }
  const leaving = valueFor(plan.redemption.potLeft + plan.redemption.masterPay, d.rate)
  const after = plan.full ? 0n : d.valuation - leaving
  if (after < 0n) throw new Error(`entry ${where(entry)} pays ${leaving} out of a fund valued at ${d.valuation}`)
  const totalShares = plan.supply - plan.masterPart - plan.redemption.owedLeft / PRECISION.basisPoints
  store.set(fundTable, { ...fund, totalShares, value: after, lastBlock: entry.block.number })
  store.set(holdingTable, { ...holding, shares: closing.amount })
  store.set(redemptionTable, { master, ...d.redemption, rateAmount: d.rate.amount, rateValue: d.rate.value })
  const wrapLeg = entry.callList.find(call => isAddressEqual(call.target, HUB_CANONICAL_TOKEN.WETH) && call.value > 0n)
  const wrap = wrapLeg === undefined ? 0n : wrapLeg.value
  foldFlows(
    store,
    entry,
    entry.account,
    new Map([
      [token, wrap - plan.redemption.potLeft - plan.redemption.masterPay],
      [getAddress(PROTOCOL.nativeToken), -wrap]
    ])
  )
  await meterFund(store, master, entry.block.timestamp, { venue: null, valuation: d.valuation, index: performanceIndexOf(d.valuation, fund), allocated: false })
  await syncFundMetrics(store, master, entry.block.timestamp)
}

async function foldRedeemHolder(store: IStore, entry: IAccountEntry, d: IAccountCall__Redeem_redeemCohortHolder): Promise<void> {
  const holder = getAddress(entry.account)
  const master = getAddress(d.master)
  const [prior, fund] = await Promise.all([store.get(holdingTable, holdingIdOf(master, holder)), store.get(fundTable, master)])
  if (prior === undefined || fund === undefined) throw new Error(`entry ${where(entry)} settles ${holder} in ${master}, which it never held`)
  const post = d.redemption
  if (prior.redeemedAt === post.id) throw new Error(`entry ${where(entry)} settles ${holder} twice in redemption ${post.id} of ${master}`)
  const claim = claimOf(prior, prior.shares, post.fraction)
  const plan = planCohort({
    master,
    redemption: {
      ...post,
      potLeft: post.potLeft + d.payout,
      owedLeft: post.owedLeft + claim,
      queued: post.queued + d.queued,
      masterPay: post.masterPay - d.profitFee + d.protocolCut
    },
    performanceFee: fund.performanceFee,
    protocolFeeShare: PROTOCOL.protocolFeeShare,
    holders: [
      {
        holder,
        balance: prior.shares,
        holding: { allocatedAt: Number(prior.allocatedAt), redeemedAt: Number(prior.redeemedAt), queued: prior.queued, cost: prior.cost },
        refused: d.refused
      }
    ]
  })
  const settled = plan.settled[0]
  if (settled === undefined) throw new Error(`entry ${where(entry)} settles ${holder} in ${master} where the fold plans no settlement`)
  const recorded = { queued: d.queued, burned: d.burned, payout: d.payout, profitFee: d.profitFee, protocolCut: d.protocolCut, refused: d.refused }
  const expected = { queued: settled.queued, burned: settled.burned, payout: settled.payout, profitFee: settled.profitFee, protocolCut: settled.protocolCut, refused: settled.refused }
  const off = (Object.keys(expected) as (keyof typeof expected)[]).find(key => recorded[key] !== expected[key])
  if (off !== undefined) throw new Error(`entry ${where(entry)} settles ${holder} in ${master} with ${off} ${recorded[off]} where the fold plans ${expected[off]}`)
  verifyRedemption(entry, `settling ${holder}`, post, settled.redemption)
  const row = await store.get(redemptionTable, master)
  if (row === undefined) throw new Error(`entry ${where(entry)} settles ${holder} in redemption ${post.id} of ${master}, which the fold never opened`)
  const shares = prior.shares - settled.queued - settled.burned
  store.set(holdingTable, {
    master,
    holder,
    shares,
    queued: settled.holding.queued,
    allocatedAt: BigInt(settled.holding.allocatedAt),
    redeemedAt: BigInt(settled.holding.redeemedAt),
    cost: settled.holding.cost
  })
  store.set(redemptionTable, { ...row, ...post })
  if (!settled.cut) foldFlows(store, entry, entry.account, new Map([[getAddress(post.token), settled.payout - settled.profitFee - settled.fee]]))
  if (prior.shares > 0n && shares === 0n) {
    for (const row of await metricRowsOf(store, master, entry.block.timestamp)) {
      if (row.backers === 0) throw new Error(`entry ${where(entry)} empties ${holder}'s holding in ${master}, which counts no backers`)
      store.set(fundMetricTable, { ...row, backers: row.backers - 1 })
    }
  }
}

async function foldRedeemOwner(store: IStore, entry: IAccountEntry, d: IAccountCall__Redeem_redeemCohortOwner): Promise<void> {
  const master = getAddress(d.master)
  const body = await store.get(accountTable, `${entry.chainId}-${master}`)
  if (body === undefined || !isAddressEqual(body.owner, entry.account)) {
    throw new Error(`entry ${where(entry)} pays ${entry.account} the close-out of ${master}, a fund it does not own`)
  }
  const close = siblingRecords(entry).find(r => r.logIndex > entry.logIndex && isAddressEqual(r.account, master) && isRedeemCloseRecord(r.record))?.record
  if (close === undefined || !isRedeemCloseRecord(close)) throw new Error(`entry ${where(entry)} pays a close-out of ${master} with no close in its transaction`)
  const owed = close.payout - (close.payout < close.redemption.fee ? close.payout : close.redemption.fee)
  if (d.paid !== owed || !isAddressEqual(d.token, close.redemption.token)) {
    throw new Error(`entry ${where(entry)} pays ${d.paid} of ${d.token} where its close-out pays ${owed} of ${close.redemption.token}`)
  }
  foldFlows(store, entry, entry.account, new Map([[getAddress(d.token), d.paid]]))
}

async function foldRedeemClose(store: IStore, entry: IAccountEntry, d: IAccountCall__Redeem_redeemCohortMaster): Promise<void> {
  const master = getAddress(entry.account)
  const post = d.redemption
  const folded = await store.get(redemptionTable, master)
  if (folded === undefined || folded.id !== post.id) throw new Error(`entry ${where(entry)} closes redemption ${post.id} of ${master}, which the fold never opened`)
  const settled = siblingRecords(entry).findLast(
    r => r.logIndex < entry.logIndex && isRedeemHolderRecord(r.record) && isAddressEqual(r.record.master, master) && r.record.redemption.id === post.id
  )?.record
  const row = settled !== undefined && isRedeemHolderRecord(settled) ? { ...folded, ...settled.redemption } : folded
  const fund = await store.get(fundTable, master)
  if (fund === undefined) throw new Error(`entry ${where(entry)} closes redemption ${post.id} in ${master}, a fund the fold never opened`)
  const closing = post.owedLeft === 0n
  if (
    (closing
      ? d.payout !== row.masterPay || d.cut < row.potLeft || post.potLeft !== 0n || post.masterPay !== 0n
      : d.payout !== 0n || d.unburned !== 0n || d.cut === 0n || post.potLeft !== row.potLeft || post.owedLeft !== row.owedLeft || post.masterPay !== row.masterPay) ||
    post.fraction !== row.fraction ||
    post.fee !== row.fee ||
    post.price !== row.price ||
    !isAddressEqual(post.token, row.token)
  ) {
    throw new Error(
      `entry ${where(entry)} ${closing ? 'closes' : 'cuts claims in'} redemption ${post.id} of ${master} paying ${d.payout} and cutting ${d.cut} into owed ${post.owedLeft}, pot ${post.potLeft} and master pay ${post.masterPay}, where the fold holds owed ${row.owedLeft}, pot ${row.potLeft} and master pay ${row.masterPay} at fee ${row.fee}`
    )
  }
  if (row.rateAmount === undefined || row.rateValue === undefined) throw new Error(`entry ${where(entry)} closes redemption ${post.id} of ${master}, whose opening rate the fold never recorded`)
  const cut = valueFor(d.cut, { amount: row.rateAmount, value: row.rateValue })
  store.set(fundTable, { ...fund, value: fund.value + cut, totalShares: fund.totalShares + d.unburned, lastBlock: entry.block.number })
  store.set(redemptionTable, { ...row, ...post })
  foldFlows(store, entry, entry.account, new Map([[getAddress(post.token), d.cut]]))
  await syncFundMetrics(store, master, entry.block.timestamp)
}

function foldMandate(store: IStore, entry: IAccountEntry, self: IAccountRow, d: IAccountCall__HubGate_mandate): void {
  const puppet = getAddress(entry.account)
  if (d.epoch !== self.epoch) throw new Error(`entry ${where(entry)} mandates under epoch ${d.epoch} where the fold holds ${self.epoch}`)
  d.mandateList.forEach((mandate, i) => {
    const master = getAddress(mandate.master)
    if (i > 0 && BigInt(master) <= BigInt(d.mandateList[i - 1]!.master)) throw new Error(`entry ${where(entry)}: mandate ${i} is out of order`)
    if (mandate.allocationRate >= PRECISION.basisPoints) throw new Error(`entry ${where(entry)}: mandate ${i} takes ${mandate.allocationRate} of the balance per round, the whole balance or more`)
    if (mandate.skin > PRECISION.basisPoints * 100n) throw new Error(`entry ${where(entry)}: mandate ${i} asks skin ${mandate.skin} above a hundred times the master`)
    if (mandate.exitCap > PRECISION.basisPoints) throw new Error(`entry ${where(entry)}: mandate ${i} caps exits at ${mandate.exitCap}, above the whole supply`)
    store.set(mandateTable, {
      puppet,
      master,
      skin: mandate.skin,
      allocationRate: mandate.allocationRate,
      exitCap: mandate.exitCap,
      cooldownPeriod: mandate.cooldownPeriod,
      expiry: mandate.expiry,
      epoch: d.epoch
    })
  })
}

export function acrossDepositOf(entry: Pick<IAccountEntry, 'chainId' | 'account' | 'siblingLogs' | 'logIndex'>) {
  const opened = entry.siblingLogs.reduce(
    (at, log) => (log.topics[0] === ACCOUNT_CALL_TOPIC && log.logIndex < entry.logIndex && log.logIndex > at ? log.logIndex : at),
    -1
  )
  const spokePool = acrossSpokePoolOf(entry.chainId)
  const deposits = entry.siblingLogs
    .filter(log => log.logIndex > opened && log.logIndex < entry.logIndex && log.topics[0] === FUNDS_DEPOSITED_TOPIC && isAddressEqual(log.address, spokePool))
    .map(log => ({ logIndex: log.logIndex, args: decodeEventLog({ abi: [FUNDS_DEPOSITED], data: log.data, topics: log.topics as [Hex, ...Hex[]] }).args }))
    .filter(deposit => isAddressEqual(slice(deposit.args.depositor, 12), entry.account))
  if (deposits.length === 0) return null
  const a = deposits.reduce((last, deposit) => (deposit.logIndex > last.logIndex ? deposit : last)).args
  const relayHash = keccak256(
    encodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            { type: 'bytes32' },
            { type: 'bytes32' },
            { type: 'bytes32' },
            { type: 'bytes32' },
            { type: 'bytes32' },
            { type: 'uint256' },
            { type: 'uint256' },
            { type: 'uint256' },
            { type: 'uint256' },
            { type: 'uint32' },
            { type: 'uint32' },
            { type: 'bytes' }
          ]
        },
        { type: 'uint256' }
      ],
      [
        [
          a.depositor,
          a.recipient,
          a.exclusiveRelayer,
          a.inputToken,
          a.outputToken,
          a.inputAmount,
          a.outputAmount,
          BigInt(entry.chainId),
          a.depositId,
          a.fillDeadline,
          a.exclusivityDeadline,
          a.message
        ],
        a.destinationChainId
      ]
    )
  )
  return { ...a, relayHash }
}

function foldTransit(store: IStore, entry: IAccountEntry, d: IAccountCall__Deposit_depositAcross | IAccountCall__Deposit_fundSwap): void {
  const a = acrossDepositOf(entry)
  if (a === null) throw new Error(`entry ${where(entry)}: a move to chain ${d.destinationChainId} emitted no Across deposit`)
  const delivered = providerToken(d.outputToken, Number(d.destinationChainId))
  if (a.destinationChainId !== d.destinationChainId || !isAddressEqual(slice(a.outputToken, 12), delivered) || a.outputAmount < d.outputAmount) {
    throw new Error(
      `entry ${where(entry)}: its last Across deposit bridges ${a.outputAmount} of ${slice(a.outputToken, 12)} to chain ${a.destinationChainId}, against the signed ${d.outputAmount} of ${delivered} to chain ${d.destinationChainId}`
    )
  }
  const bridged = getAddress(slice(a.inputToken, 12))
  const sent = tokenMetaOf(entry.chainId as ChainId, bridged)
  const arriving = tokenMetaOf(Number(a.destinationChainId) as ChainId, delivered)
  if (sent.decimals !== arriving.decimals) {
    throw new Error(`entry ${where(entry)}: Across takes ${sent.symbol} with ${sent.decimals} decimals for ${arriving.symbol} with ${arriving.decimals}, so what it delivers cannot be booked in the token it took`)
  }
  const deltas = new Map<Hex, bigint>([[getAddress(d.inputToken), -d.inputAmount]])
  deltas.set(bridged, (deltas.get(bridged) ?? 0n) + a.outputAmount)
  foldFlows(store, entry, entry.account, deltas)
  store.set(transitTable, {
    id: `${getAddress(entry.account)}-${entry.chainId}-${d.destinationChainId}`,
    chainId: BigInt(entry.chainId),
    account: getAddress(entry.account),
    destinationChainId: d.destinationChainId,
    relayHash: a.relayHash,
    fillDeadline: a.fillDeadline,
    inputToken: getAddress(slice(a.inputToken, 12)),
    inputAmount: a.inputAmount,
    outputToken: getAddress(slice(a.outputToken, 12)),
    outputAmount: a.outputAmount,
    block: entry.block.number,
    blockTimestamp: entry.block.timestamp,
    logIndex: entry.logIndex
  })
}

function foldBridge(store: IStore, entry: IAccountEntry, d: IAccountCall__Deposit_depositAcross): void {
  if (d.destinationChainId !== BigInt(entry.chainId)) {
    foldTransit(store, entry, d)
    return
  }
  const received = getAddress(d.outputToken)
  const deltas = new Map<Hex, bigint>([[getAddress(d.inputToken), -d.inputAmount]])
  deltas.set(received, (deltas.get(received) ?? 0n) + d.outputAmount)
  foldFlows(store, entry, entry.account, deltas)
}

function foldFundSwap(store: IStore, entry: IAccountEntry, d: IAccountCall__Deposit_fundSwap): void {
  if (d.destinationChainId !== BigInt(entry.chainId)) {
    foldTransit(store, entry, d)
    return
  }
  if (isAddressEqual(d.outputToken, PROTOCOL.nativeToken)) {
    foldFlows(store, entry, entry.account, new Map([[getAddress(d.feeToken), -d.fee]]))
    return
  }
  const opened = entry.siblingLogs.reduce(
    (at, log) => (log.topics[0] === ACCOUNT_CALL_TOPIC && log.logIndex < entry.logIndex && log.logIndex > at ? log.logIndex : at),
    -1
  )
  const delivered = entry.siblingLogs
    .filter(log => log.logIndex > opened && log.logIndex < entry.logIndex)
    .flatMap(log => {
      const amount = swapDeliveryAmount(entry.chainId, entry.account, d.outputToken, log)
      return amount === null ? [] : [amount]
    })
    .reduce((total, amount) => total + amount, 0n)
  if (delivered < d.outputAmount) {
    throw new Error(
      `entry ${where(entry)}: its receipt delivers ${delivered} of ${d.outputToken} to the fund, below the ${d.outputAmount} the gate checked it received, so the swap's delivery logs are missing`
    )
  }
  foldFlows(store, entry, entry.account, new Map([[getAddress(d.inputToken), -d.inputAmount], [getAddress(d.outputToken), delivered]]))
}

interface IFundMetricDelta {
  venue: string | null
  valuation: bigint | null
  index: bigint | null
  allocated: boolean
}

function metricRowsOf(store: IStore, master: Hex, time: number): Promise<IFundMetricRow[]> {
  return Promise.all(
    PLATFORM_STAT_INTERVAL.map(interval =>
      store.getOrCreate(fundMetricTable, {
        id: `${interval}:${getAddress(master)}`,
        interval,
        master: getAddress(master),
        venueList: [],
        venueTimeList: [],
        allocationTimeList: [],
        pnlList: [],
        performanceIndexList: [],
        pnlTimestampList: [],
        openingIndex: POOL_SHARE,
        pnl: 0n,
        roi: 0n,
        lastUpdatedTimestamp: time,
        backers: 0,
        totalShares: 0n,
        backerShares: 0n,
        valuation: 0n
      })
    )
  )
}

async function syncFundMetrics(store: IStore, master: Hex, time: number): Promise<void> {
  const [fund, own, rows] = await Promise.all([
    store.get(fundTable, getAddress(master)),
    store.get(holdingTable, holdingIdOf(master, master)),
    metricRowsOf(store, master, time)
  ])
  if (fund === undefined) throw new Error(`the leaderboard rows of ${master} are synced before its fund was folded`)
  const masterShares = own === undefined ? 0n : own.shares
  for (const row of rows) {
    store.set(fundMetricTable, {
      ...row,
      symbol: fund.symbol,
      pixels: fund.pixels,
      totalShares: fund.totalShares,
      backerShares: fund.totalShares - masterShares,
      valuation: fund.value
    })
  }
}

export async function meterFund(store: IStore, master: Hex, time: number, delta: IFundMetricDelta): Promise<void> {
  if (delta.valuation === null && delta.venue === null) return
  const rows = await metricRowsOf(store, master, time)
  for (const row of rows) {
    const venues = delta.venue === null ? {} : windowVenueSeries(row.venueList, row.venueTimeList, delta.venue, time, row.interval)
    if (delta.valuation === null) {
      store.set(fundMetricTable, { ...row, ...venues })
      continue
    }
    const series = windowPnlSeries(row.pnlList, row.performanceIndexList, row.pnlTimestampList, row.openingIndex, delta.valuation - row.valuation, delta.index, time, row.interval)
    const closing = series.performanceIndexList.at(-1) ?? series.openingIndex
    store.set(fundMetricTable, {
      ...row,
      ...venues,
      ...series,
      pnl: series.pnlList.reduce((acc, p) => acc + p, 0n),
      roi: series.openingIndex === 0n ? 0n : ((closing - series.openingIndex) * PRECISION.basisPoints) / series.openingIndex,
      allocationTimeList: [...row.allocationTimeList.filter(at => at >= time - row.interval), ...(delta.allocated ? [time] : [])],
      valuation: delta.valuation,
      lastUpdatedTimestamp: Math.max(row.lastUpdatedTimestamp, time)
    })
  }
}

export interface IHoldingsObservation {
  balances: { chainId: number; token: Hex; amount: bigint }[]
  owed: { chainId: number; token: Hex; amount: bigint; reason: string }[]
  moving: { relayHash: Hex; from: { chainId: number; token: Hex; amount: bigint }; to: { chainId: number; token: Hex; amount: bigint } }[]
  unlisted: { chainId: number; token: Hex; amount: bigint }[]
  venues: { venue: string; lastDepositTimestamp: number }[]
  note: string | null
}

export type IEvaluation =
  | { kind: 'positions'; account: Hex; time: number; venue: string; rows: readonly IVenuePosition[] }
  | { kind: 'holdings'; account: Hex; time: number; basis: number; holdings: IHoldingsObservation }
  | { kind: 'hyperliquid'; account: Hex; time: number; observation: IHyperliquidObservation }
  | {
      kind: 'tick'
      time: number
      snapshot: IOracleSnapshot
      marks: readonly { coin: string; mark: bigint }[]
      read: readonly Hex[]
      spot: readonly { coin: string; bids: readonly (readonly [bigint, bigint])[] }[]
      exits: readonly { chainId: number; usd: bigint }[]
    }

type IEvaluationStore = IStore & { remove<Cols extends IColumns>(table: ITable<Cols>, id: string): void }

export async function foldEvaluation(store: IEvaluationStore, evaluation: IEvaluation): Promise<string | null> {
  if (evaluation.kind === 'positions') {
    const id = `${evaluation.account}:${evaluation.venue}`
    const prior = await store.get(positionSyncTable, id)
    const kept = new Set<string>()
    for (const row of evaluation.rows) {
      const rowId = [evaluation.account, evaluation.venue, row.chainId, row.holder, row.key].join(':')
      if (kept.has(rowId)) throw new Error(`${evaluation.venue} reported the position ${rowId} twice`)
      kept.add(rowId)
      store.set(positionTable, { ...row, id: rowId, account: evaluation.account, venue: evaluation.venue })
    }
    for (const stale of prior === undefined ? [] : prior.idList) if (!kept.has(stale)) store.remove(positionTable, stale)
    store.set(positionSyncTable, { id, account: evaluation.account, venue: evaluation.venue, time: evaluation.time, idList: [...kept] })
    return null
  }
  if (evaluation.kind === 'holdings' || evaluation.kind === 'hyperliquid') {
    const id = `${evaluation.account}:${evaluation.kind}`
    const prior = await store.get(observationTable, id)
    if (prior !== undefined && prior.time > evaluation.time) return `${evaluation.account}: its ${evaluation.kind} read at ${evaluation.time} arrived after the one read at ${prior.time}`
    store.set(observationTable, { id, account: evaluation.account, source: evaluation.kind, time: evaluation.time, data: encode(evaluation) })
    return null
  }
  if (evaluation.kind === 'tick') {
    const list = await store.get(fundListTable, FUND_LIST_ID)
    if (list === undefined) return 'no fund is folded yet'
    const rates = new Map(evaluation.snapshot.rates.flatMap(rate => ('refused' in rate ? [] : [[rate.symbol, rate] as const])))
    const marks = new Map(evaluation.marks.map(mark => [mark.coin, mark.mark] as const))
    const spot = new Map(evaluation.spot.map(book => [book.coin, book.bids] as const))
    const exits = new Map(evaluation.exits.map(exit => [exit.chainId, exit.usd] as const))
    const read = new Set(evaluation.read.map(account => getAddress(account)))
    const notes: string[] = []
    let invested = 0
    for (const listed of list.masterList) {
      const master = getAddress(listed)
      const fund = await store.get(fundTable, master)
      if (fund !== undefined && fund.totalShares === 0n) continue
      invested++
      if (!read.has(master)) {
        notes.push(`${master}: not read at this tick`)
        continue
      }
      const worth = await fundWorthAt(store, master, evaluation.time, rates, marks, spot, exits)
      if ('note' in worth) {
        notes.push(worth.note)
        continue
      }
      if (worth.hyperliquid !== null) await foldEvaluation(store, { kind: 'positions', account: master, time: evaluation.time, venue: hyperliquidVenue.venueId, rows: worth.hyperliquid })
      const day = await store.get(fundMetricTable, `${IntervalTime.DAY}:${master}`)
      if (day !== undefined && day.lastUpdatedTimestamp > evaluation.time) {
        notes.push(`${master}: valued at ${evaluation.time}, before its last metered value at ${day.lastUpdatedTimestamp}`)
        continue
      }
      await meterFund(store, master, evaluation.time, { venue: null, valuation: worth.valuation, index: performanceIndexOf(worth.valuation, worth.fund), allocated: false })
    }
    return notes.length === 0 ? null : `${invested - notes.length} of ${invested} funds metered; ${notes.join('; ')}`
  }
  throw new Error(`evaluation kind ${String(Reflect.get(evaluation, 'kind'))} is not folded`)
}

export async function fundWorthAt(
  store: Pick<IStore, 'get'>,
  master: Hex,
  time: number,
  rates: ReadonlyMap<string, { token0: bigint; token1: bigint }>,
  marks: ReadonlyMap<string, bigint>,
  spot: ReadonlyMap<string, readonly (readonly [bigint, bigint])[]>,
  exits: ReadonlyMap<number, bigint>
): Promise<{ note: string } | { valuation: bigint; fund: InferRow<(typeof fundTable)['columns']>; hyperliquid: IVenuePosition[] | null }> {
  const note = (text: string) => ({ note: `${master}: ${text}` })
  const fund = await store.get(fundTable, master)
  if (fund === undefined || fund.totalShares === 0n) return note('holds no shares')
  const held = await store.get(observationTable, `${master}:holdings`)
  if (held === undefined) return note('holdings not observed yet')
  const holdings = decode(held.data) as Extract<IEvaluation, { kind: 'holdings' }>
  if (holdings.basis !== fund.lastBlock) return note('holdings read before its last fund record')
  if (holdings.holdings.note !== null) return note(holdings.holdings.note)
  const unpriced = new Set<string>()
  const usdOf = (chainId: number, token: Hex, amount: bigint): bigint => {
    const symbol = symbolOf(chainId as ChainId, token)
    const rate = rates.get(symbol)
    if (rate === undefined) {
      unpriced.add(symbol)
      return 0n
    }
    return (amount * rate.token0) / rate.token1
  }
  let usd = 0n
  for (const balance of holdings.holdings.balances) {
    const value = usdOf(balance.chainId, balance.token, balance.amount)
    const exit = exits.get(balance.chainId)
    const cash =
      balance.chainId === HUB_CHAIN_ID &&
      (isAddressEqual(balance.token, PROTOCOL.nativeToken) || Object.values(HUB_CANONICAL_TOKEN).some(canonical => isAddressEqual(balance.token, canonical)))
    if (cash || exit === undefined || value * PROTOCOL.maxRelayFeeBps >= exit * PRECISION.basisPoints) usd += value
  }
  for (const owed of holdings.holdings.owed) usd += usdOf(owed.chainId, owed.token, owed.amount)
  for (const move of holdings.holdings.moving) {
    const delivered = usdOf(move.to.chainId, move.to.token, move.to.amount)
    const sent = usdOf(move.from.chainId, move.from.token, move.from.amount)
    usd += delivered < sent ? delivered : sent
  }
  let hyperliquid: IVenuePosition[] | null = null
  for (const used of holdings.holdings.venues) {
    const venue = VENUES.find(known => known.venueId === used.venue)
    if (venue === undefined || venue.positions === undefined) return note(`${used.venue} positions are not tracked`)
    const creditSec = venue.deposit === undefined ? 0 : venue.deposit.creditSec
    let rows: readonly IVenuePosition[]
    if (venue === hyperliquidVenue) {
      const observed = await store.get(observationTable, `${master}:hyperliquid`)
      if (observed === undefined) return note(`${venue.name} not observed yet`)
      const read = decode(observed.data) as Extract<IEvaluation, { kind: 'hyperliquid' }>
      if (read.time < used.lastDepositTimestamp + creditSec) return note(`a ${venue.name} deposit landed after its last read`)
      const missing = read.observation.books.flatMap(book => book.positions).find(position => !marks.has(position.coin))
      if (missing !== undefined) return note(`no ${venue.name} mark for ${missing.coin} at this tick`)
      const pricers = new Map<string, (amount: bigint) => bigint>()
      for (const symbol of new Set([TOKEN_META.USDC.symbol, ...read.observation.books.map(book => book.collateral)])) {
        const rate = rates.get(symbol)
        if (rate === undefined) return note(`${symbol} unpriced at this tick`)
        pricers.set(symbol, hyperliquidCollateralUsd(symbol, rate))
      }
      hyperliquid = hyperliquidRows(
        HYPERLIQUID_CHAIN_ID,
        master,
        read.observation,
        coin => marks.get(coin)!,
        (coin, amount) => {
          const bids = spot.get(coin)
          return bids === undefined ? undefined : hyperliquidSpotExit(bids, amount)
        },
        (collateral, amount) => pricers.get(collateral)!(amount),
        time
      )
      rows = hyperliquid
    } else {
      const sync = await store.get(positionSyncTable, `${master}:${venue.venueId}`)
      if (sync === undefined) return note(`${venue.name} not read yet`)
      if (sync.time < used.lastDepositTimestamp + creditSec) return note(`a ${venue.name} deposit landed after its last read`)
      if (sync.time < held.time) return note(`its balances moved after its last ${venue.name} read`)
      rows = await Promise.all(
        sync.idList.map(async id => {
          const row = await store.get(positionTable, id)
          if (row === undefined) throw new Error(`the ${venue.name} sync of ${master} lists position ${id}, which is not folded`)
          return { ...row, kind: row.kind as IVenuePosition['kind'] }
        })
      )
    }
    const unvalued = rows.find(row => row.value === undefined)
    if (unvalued !== undefined) return note(`${unvalued.label} is not priced`)
    for (const row of rows) {
      const index = rates.get(row.unit)
      const backing = row.collateralUnit === undefined ? undefined : rates.get(row.collateralUnit)
      if (row.long === undefined || row.entry === undefined || row.collateral === undefined || index === undefined || backing === undefined) {
        usd += row.value!
        continue
      }
      const sized = (row.size * index.token0) / index.token1
      const worth = (row.collateral * backing.token0) / backing.token1 + (row.long ? sized - row.entry : row.entry - sized) - (row.accruedCost === undefined ? 0n : row.accruedCost)
      usd += worth > 0n ? worth : 0n
    }
  }
  if (holdings.holdings.unlisted.length > 0) {
    const sync = await store.get(positionSyncTable, `${master}:${ACCOUNT_VENUE}`)
    if (sync === undefined) return note('its unlisted holdings are not read yet')
    const rows = await Promise.all(sync.idList.map(id => store.get(positionTable, id)))
    for (const unlisted of holdings.holdings.unlisted) {
      const row = rows.find(
        held => held !== undefined && held.chainId === BigInt(unlisted.chainId) && held.contract !== undefined && isAddressEqual(held.contract, unlisted.token) && held.size === unlisted.amount
      )
      if (row === undefined || row.value === undefined) return note(`its ${unlisted.token} on chain ${unlisted.chainId} changed since its last read`)
      usd += row.value
    }
  }
  if (unpriced.size > 0) return note(`${[...unpriced].join(', ')} unpriced at this tick`)
  const eth = rates.get(symbolOf(HUB_CHAIN_ID, HUB_CANONICAL_TOKEN.WETH))
  if (eth === undefined) return note('ETH unpriced at this tick')
  return { valuation: (usd * eth.token1) / eth.token0, fund, hyperliquid }
}

export async function foldAccountEntry(store: IStore, entry: IAccountEntry): Promise<void> {
  await foldEntry(store, entry)
  foldBalances(store, entry)
  const self = await store.get(accountTable, `${entry.chainId}-${getAddress(entry.account)}`)
  if (self !== undefined) store.set(accountTable, { ...self, lastBlock: entry.block.number, lastLogIndex: entry.logIndex })
}

async function foldEntry(store: IStore, entry: IAccountEntry): Promise<void> {
  const decoded = decodeAccountCall(entry)
  if (decoded.selector === ACCOUNT_CALL_MAP.UserAccount.revokeSessions.selector) {
    const d = decoded as IAccountCall__UserAccount_revokeSessions
    const self = await selfOf(store, entry)
    if (d.epoch === self.epoch) throw new Error(`entry ${where(entry)} revokes to epoch ${d.epoch}, the one already folded`)
    store.set(accountTable, {
      ...self,
      epoch: d.epoch,
      revokedAt: entry.block.timestamp,
      lastBlock: entry.block.number,
      lastLogIndex: entry.logIndex
    })
    return
  }
  if (decoded.selector === ACCOUNT_CALL_MAP.AccountModule.createUserAccount.selector) {
    store.set(accountTable, {
      chainId: BigInt(entry.chainId),
      account: getAddress(entry.account),
      owner: getAddress(decoded.user),
      epoch: 0n,
      revokedAt: 0,
      createdAt: entry.block.timestamp,
      lastBlock: entry.block.number,
      lastLogIndex: entry.logIndex
    })
    return
  }
  if (decoded.selector === ACCOUNT_CALL_MAP.AccountModule.createAccount.selector) {
    store.set(accountTable, {
      chainId: BigInt(entry.chainId),
      account: getAddress(entry.account),
      owner: getAddress(decoded.parent),
      epoch: 0n,
      revokedAt: 0,
      createdAt: entry.block.timestamp,
      lastBlock: entry.block.number,
      lastLogIndex: entry.logIndex
    })
    return
  }
  if (decoded.selector === ACCOUNT_CALL_MAP.LiquidityGate.deposit.selector) return foldDeposit(store, entry, decoded as IAccountCall__LiquidityGate_deposit)
  if (decoded.selector === ACCOUNT_CALL_MAP.LiquidityGate.depositEscrow.selector) {
    return foldDepositEscrow(store, entry, decoded as IAccountCall__LiquidityGate_depositEscrow)
  }
  if (decoded.selector === ACCOUNT_CALL_MAP.SpokeGate.fulfil.selector) return foldFulfil(store, entry, decoded as IAccountCall__SpokeGate_fulfil)
  if (decoded.selector === ACCOUNT_CALL_MAP.LiquidityGate.retireEscrow.selector) {
    return foldRetireEscrow(store, entry, decoded as IAccountCall__LiquidityGate_retireEscrow)
  }
  if (decoded.selector === ACCOUNT_CALL_MAP.LiquidityGate.returnEscrow.selector) {
    return foldReturnEscrow(store, entry, decoded as IAccountCall__LiquidityGate_returnEscrow)
  }
  if (decoded.selector === ACCOUNT_CALL_MAP.LiquidityGate.requestReturn.selector) {
    await selfOf(store, entry)
    return
  }
  if (isAllocateOwnerRecord(decoded)) return foldAllocateOwner(store, entry, decoded)
  const self = await selfOf(store, entry)
  if (isAllocationRecord(decoded)) return foldAllocation(store, entry, decoded)
  if (isSellRecord(decoded)) return foldSell(store, entry, decoded)
  if (isRedeemHolderRecord(decoded)) return foldRedeemHolder(store, entry, decoded)
  if (isRedeemCloseRecord(decoded)) return foldRedeemClose(store, entry, decoded)
  if (isRedeemOwnerRecord(decoded)) return foldRedeemOwner(store, entry, decoded)
  if (isRedeemRecord(decoded)) return foldRedeem(store, entry, decoded)
  switch (decoded.selector) {
    case ACCOUNT_CALL_MAP.Fund.allocateMaster.selector:
      return foldAllocate(store, entry, self, decoded as IAccountCall__Fund_allocateMaster)
    case ACCOUNT_CALL_MAP.HubGate.mandate.selector:
      foldFlows(store, entry, entry.account, new Map([[decoded.feeToken, -decoded.fee]]))
      return foldMandate(store, entry, self, decoded)
    case ACCOUNT_CALL_MAP.SpokeGate.operate.selector:
      foldFlows(store, entry, entry.account, new Map([[decoded.feeToken, -decoded.fee]]))
      foldVenueCalls(store, entry)
      for (const move of standingMovesOf(entry.chainId as ChainId, getAddress(entry.account), entry.callList)) {
        const id = `${entry.chainId}-${getAddress(entry.account)}-${move.token}-${move.spender}`
        const base = move.granted ?? (await store.get(allowanceTable, id))?.implied
        if (base === undefined) continue
        const implied = base > move.pulled ? base - move.pulled : 0n
        store.set(allowanceTable, {
          chainId: BigInt(entry.chainId),
          account: getAddress(entry.account),
          venue: move.venueId,
          token: move.token,
          spender: move.spender,
          implied
        })
        if (implied > 0n) store.set(venueTable, { account: getAddress(entry.account), venue: move.venueId, chainId: BigInt(entry.chainId), lastDepositTimestamp: entry.block.timestamp })
      }
      for (const venue of VENUES) {
        if (venue.describe(entry.chainId as ChainId, getAddress(entry.account), entry.callList, entry.resultList, NO_VENUE_FACTS).size === 0) continue
        await meterFund(store, entry.account, entry.block.timestamp, { venue: venue.venueId, valuation: null, index: null, allocated: false })
      }
      return
    case ACCOUNT_CALL_MAP.Deposit.fundSwap.selector:
      return foldFundSwap(store, entry, decoded as IAccountCall__Deposit_fundSwap)
    case ACCOUNT_CALL_MAP.HubGate.createFund.selector:
      return foldCreateFund(store, entry, decoded as IAccountCall__HubGate_createFund)
    case ACCOUNT_CALL_MAP.Deposit.depositAcross.selector:
      return foldBridge(store, entry, decoded as IAccountCall__Deposit_depositAcross)
    case ACCOUNT_CALL_MAP.Deposit.withdraw.selector: {
      const d = decoded as IAccountCall__Deposit_withdraw
      foldFlows(store, entry, entry.account, new Map([[getAddress(d.inputToken), -d.inputAmount]]))
      return
    }
    case ACCOUNT_CALL_MAP.UserAccount.withdraw.selector: {
      const d = decoded as IAccountCall__UserAccount_withdraw
      foldFlows(store, entry, entry.account, new Map([[getAddress(d.token), -d.amount]]))
      return
    }
    default:
      throw new Error(`entry ${where(entry)} carries selector ${(decoded as { selector: Hex }).selector}, which the fold does not know`)
  }
}

export function dependenciesOf(entry: Pick<IAccountEntry, 'account' | 'source' | 'executionData'>): Hex[] {
  const d = decodeAccountCall(entry)
  const named =
    d.selector === ACCOUNT_CALL_MAP.AccountModule.createAccount.selector
      ? [d.parent]
      : isAllocationRecord(d) || isAllocateOwnerRecord(d) || isSellRecord(d) || isRedeemHolderRecord(d) || isRedeemOwnerRecord(d)
        ? [d.master]
        : []
  return named.map(account => getAddress(account)).filter(account => !isAddressEqual(account, entry.account))
}

export const FOLD_SOURCE: string = [
  entryIdOf,
  holdingIdOf,
  ceilDiv,
  valueFor,
  where,
  siblingRecords,
  allocationRowsOf,
  matches,
  isAllocationRecord,
  isAllocateOwnerRecord,
  isSellRecord,
  isRedeemRecord,
  isRedeemHolderRecord,
  isRedeemCloseRecord,
  openPlanOf,
  verifyPuppetOrder,
  selfOf,
  foldFlows,
  foldBalances,
  foldCreateFund,
  escrowIdOf,
  foldDeposit,
  foldDepositEscrow,
  foldFulfil,
  foldRetireEscrow,
  foldReturnEscrow,
  foldCredit,
  foldAllocateOwner,
  foldAllocate,
  foldAllocation,
  verifyRedemption,
  foldSell,
  foldRedeem,
  foldRedeemHolder,
  foldRedeemOwner,
  foldRedeemClose,
  foldMandate,
  acrossDepositOf,
  foldTransit,
  foldBridge,
  foldFundSwap,
  metricRowsOf,
  syncFundMetrics,
  meterFund,
  foldEvaluation,
  fundWorthAt,
  standingMovesOf,
  hyperliquidRows,
  hyperliquidSpotExit,
  hyperliquidCollateralUsd,
  foldVenueCalls,
  foldAccountEntry,
  foldEntry,
  windowPnlSeries,
  windowVenueSeries,
  swapDeliveryAmount,
  tokenMetaOf,
  providerToken,
  wrappedNativeAddressOf,
  ...VENUES.map(venue => venue.outflows),
  ...VENUES.flatMap(venue => (venue.transit === undefined ? [] : [venue.transit])),
  ...VENUES.map(venue => venue.describe)
]
  .map(f => f.toString())
  .join('\n')
  .concat(`\n${FUNDS_DEPOSITED_TOPIC}\n${POOL_SOURCE}`)
