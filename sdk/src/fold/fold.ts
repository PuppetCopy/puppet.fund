import { PRECISION } from '@puppet/contracts/const'
import { accountCallEvent } from '@puppet/contracts/events'
import type {
  IAccountCall__Deposit_deposit,
  IAccountCall__Deposit_depositAcross,
  IAccountCall__Fund_allocateMaster,
  IAccountCall__Fund_allocatePuppet,
  IAccountCall__Fund_claimHolder,
  IAccountCall__Fund_claimMaster,
  IAccountCall__Fund_redeem,
  IAccountCall__Fund_sellMaster,
  IAccountCall__Fund_sellPuppet,
  IAccountCall__HubGate_createFund,
  IAccountCall__HubGate_mandate,
  IAccountCall__LiquidityGate_escrow,
  IAccountCall__SpokeGate_fulfil,
  IAccountCall__UserAccount_revokeSessions,
  IAccountCall__UserAccount_withdraw,
  IAccountCallEntry,
  IIAccount__Call
} from '@puppet/contracts/types'
import { decodeEventLog, encodeAbiParameters, getAddress, type Hex, isAddressEqual, keccak256, parseAbiItem, slice, toEventSelector } from 'viem'
import { ACCOUNT_CALL_MAP, ACCOUNT_CALL_TOPIC, decodeAccountCall, entryDeltas, type IReceiptLog } from '../account/index.js'
import { PLATFORM_STAT_INTERVAL } from '../const/common.js'
import type { ChainId } from '../const/index.js'
import type { IColumns, InferRow, ITable } from '../datastore/index.js'
import { acrossSpokePoolOf } from '../intent/route/acrossDeposit.js'
import {
  accountTable,
  allocationTable,
  closedAccruedTable,
  creditTable,
  escrowTable,
  flowTable,
  fundSwapTable,
  fundTable,
  holdingTable,
  type IAccountRow,
  mandateTable,
  masterMetricTable,
  positionTable,
  queueTable,
  transitTable,
  valuationTable
} from '../schema/index.js'
import { applyDecay, getDecayBps, windowPnlSeries } from '../state/metricMath.js'
import { bondTokenOf, chainTokenOfKey, tokenKeyOf } from '../state/tokenRegistry.js'

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
  logs: IReceiptLog[]
  value: bigint
  block: { number: number; timestamp: number }
  logIndex: number
  transactionHash: Hex
}

type IValuationRecord = IAccountCall__Fund_redeem['valuation']

const entryIdOf = (entry: Pick<IAccountEntry, 'chainId' | 'transactionHash' | 'logIndex'>): string =>
  `${entry.chainId}-${entry.transactionHash}-${entry.logIndex}`
const holdingIdOf = (master: Hex, holder: Hex): string => `${getAddress(master)}-${getAddress(holder)}`

const FUNDS_DEPOSITED = parseAbiItem(
  'event FundsDeposited(bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 indexed destinationChainId, uint256 indexed depositId, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes32 indexed depositor, bytes32 recipient, bytes32 exclusiveRelayer, bytes message)'
)
const FUNDS_DEPOSITED_TOPIC = toEventSelector(FUNDS_DEPOSITED)

const where = (entry: IAccountEntry): string => `${entry.account}@${entry.block.number}:${entry.logIndex}`

export function receiptRecords(entry: Pick<IAccountEntry, 'logs' | 'logIndex'>): { account: Hex; digest: Hex; record: IAccountCallEntry }[] {
  const rows: { account: Hex; digest: Hex; record: IAccountCallEntry }[] = []
  for (const log of entry.logs) {
    if (log.topics[0] !== ACCOUNT_CALL_TOPIC || log.logIndex === entry.logIndex) continue
    const { args } = decodeEventLog({ abi: [accountCallEvent], data: log.data, topics: log.topics as [Hex, ...Hex[]] })
    rows.push({
      account: getAddress(args.account),
      digest: args.digest,
      record: decodeAccountCall({ source: args.source, executionData: args.executionData })
    })
  }
  return rows
}

const matches = (r: IAccountCallEntry, spec: { selector: Hex; size: number | null }): boolean => r.selector === spec.selector && r.size === spec.size

export const isAllocationRecord = (r: IAccountCallEntry): r is IAccountCall__Fund_allocatePuppet => matches(r, ACCOUNT_CALL_MAP.Fund.allocatePuppet)
export const isSellRecord = (r: IAccountCallEntry): r is IAccountCall__Fund_sellPuppet => matches(r, ACCOUNT_CALL_MAP.Fund.sellPuppet)
export const isSellFeeRecord = (r: IAccountCallEntry): r is IAccountCall__Fund_sellMaster => matches(r, ACCOUNT_CALL_MAP.Fund.sellMaster)
export const isClaimRecord = (r: IAccountCallEntry): r is IAccountCall__Fund_claimHolder => matches(r, ACCOUNT_CALL_MAP.Fund.claimHolder)
export const isClaimFeeRecord = (r: IAccountCallEntry): r is IAccountCall__Fund_claimMaster => matches(r, ACCOUNT_CALL_MAP.Fund.claimMaster)

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

function foldFlows(store: IStore, entry: IAccountEntry, owner: Hex, deltas: ReadonlyMap<Hex, bigint>): void {
  for (const [token, amount] of deltas) {
    if (amount === 0n) continue
    store.set(flowTable, {
      id: `${entryIdOf(entry)}-${getAddress(token)}`,
      chainId: BigInt(entry.chainId),
      account: getAddress(entry.account),
      owner,
      token: getAddress(token),
      amount,
      block: entry.block.number,
      blockTimestamp: entry.block.timestamp,
      logIndex: entry.logIndex,
      transactionHash: entry.transactionHash,
      pending: true,
      value: undefined
    })
  }
}

function valuationRow(entry: IAccountEntry, kind: 'allocate' | 'redeem', v: IValuationRecord, totalUnits: bigint, contribution: bigint) {
  return {
    master: getAddress(entry.account),
    kind,
    value: v.value,
    totalUnits,
    contribution,
    assetChainIdList: v.assetList.map(a => a.chainId),
    assetTokenList: v.assetList.map(a => getAddress(a.token) as Hex),
    assetAmountList: v.assetList.map(a => a.amount),
    positionChainIdList: v.positionList.map(p => p.chainId),
    positionVenueList: v.positionList.map(p => p.venue),
    positionIdList: v.positionList.map(p => p.id),
    positionValueList: v.positionList.map(p => p.valueInUsd),
    block: entry.block.number,
    blockTimestamp: entry.block.timestamp,
    logIndex: entry.logIndex,
    transactionHash: entry.transactionHash
  }
}

async function foldCreateFund(store: IStore, entry: IAccountEntry, d: IAccountCall__HubGate_createFund): Promise<void> {
  const master = getAddress(entry.account)
  const prior = await store.get(fundTable, master)
  store.set(fundTable, {
    master,
    share: getAddress(d.clone),
    symbol: d.symbol,
    pixels: d.pixels,
    performanceFee: d.performanceFee,
    totalUnits: prior === undefined ? 0n : prior.totalUnits,
    skin: prior === undefined ? 0n : prior.skin,
    value: prior === undefined ? 0n : prior.value,
    lastBlock: entry.block.number,
    lastLogIndex: entry.logIndex
  })
}

const escrowIdOf = (parent: Hex, master: Hex, chainId: bigint, token: Hex): string =>
  `${getAddress(parent)}-${getAddress(master)}-${chainId}-${getAddress(token)}`

async function foldEscrow(store: IStore, entry: IAccountEntry, d: { master: Hex; token: Hex; amount: bigint }, sign: 1n | -1n): Promise<void> {
  const parent = getAddress(entry.account)
  const chainId = BigInt(entry.chainId)
  const prior = await store.get(escrowTable, escrowIdOf(parent, d.master, chainId, d.token))
  const escrowed = (prior === undefined ? 0n : prior.escrowed) + sign * d.amount
  const fulfilled = prior === undefined ? 0n : prior.fulfilled
  if (escrowed < fulfilled) throw new Error(`entry ${where(entry)} leaves ${escrowed} escrowed under the ${fulfilled} already released`)
  store.set(escrowTable, {
    parent,
    master: getAddress(d.master),
    chainId,
    token: getAddress(d.token),
    escrowed,
    fulfilled,
    feeBilled: prior === undefined ? 0n : prior.feeBilled,
    lastBlock: entry.block.number,
    lastLogIndex: entry.logIndex
  })
}

async function foldRelease(
  store: IStore,
  entry: IAccountEntry,
  parent: Hex,
  master: Hex,
  d: { token: Hex; amount: bigint; total: bigint; fee: bigint }
): Promise<void> {
  const prior = await store.get(escrowTable, escrowIdOf(parent, master, BigInt(entry.chainId), d.token))
  if (prior === undefined) throw new Error(`entry ${where(entry)} releases escrow the fold never recorded`)
  if (d.total <= prior.fulfilled || d.total > prior.escrowed) {
    throw new Error(`entry ${where(entry)} releases up to ${d.total} against ${prior.fulfilled} released of ${prior.escrowed} escrowed`)
  }
  if (d.amount !== d.total - prior.fulfilled) {
    throw new Error(`entry ${where(entry)} records a release of ${d.amount} where the totals move by ${d.total - prior.fulfilled}`)
  }
  if (d.fee > d.amount) throw new Error(`entry ${where(entry)} bills a fee of ${d.fee} against a release of ${d.amount}`)
  store.set(escrowTable, {
    ...prior,
    fulfilled: d.total,
    feeBilled: prior.feeBilled + d.fee,
    lastBlock: entry.block.number,
    lastLogIndex: entry.logIndex
  })
}

async function foldCredit(store: IStore, entry: IAccountEntry, parent: Hex, d: IAccountCall__Fund_allocateMaster): Promise<void> {
  const master = getAddress(entry.account)
  const row = d.credit
  if (row.amount === 0n && row.value === 0n) {
    if (d.masterSlice !== 0n || d.billed !== 0n || d.creditedTotal !== 0n) {
      throw new Error(`entry ${where(entry)} slices ${d.masterSlice}, bills ${d.billed} and totals ${d.creditedTotal} without a credit`)
    }
    return
  }
  if (row.amount <= d.billed || row.value <= d.masterSlice) {
    throw new Error(`entry ${where(entry)}: a credit of ${row.amount} worth ${row.value} cannot carry a slice of ${d.masterSlice} billed as ${d.billed}`)
  }
  if (row.chainId === BigInt(entry.chainId)) {
    return foldRelease(store, entry, parent, master, { token: row.token, amount: row.amount, total: d.creditedTotal, fee: d.billed })
  }
  const token = getAddress(row.token)
  const prior = await store.get(creditTable, `${master}-${row.chainId}-${token}`)
  const credited = (prior === undefined ? 0n : prior.credited) + row.amount
  if (credited !== d.creditedTotal) throw new Error(`entry ${where(entry)} totals ${d.creditedTotal} credited where the fold reaches ${credited}`)
  store.set(creditTable, {
    master,
    creditChainId: row.chainId,
    token,
    round: entry.digest,
    credited,
    feeOwed: (prior === undefined ? 0n : prior.feeOwed) + d.billed,
    lastBlock: entry.block.number,
    lastLogIndex: entry.logIndex
  })
}

async function foldFulfil(store: IStore, entry: IAccountEntry, d: IAccountCall__SpokeGate_fulfil): Promise<void> {
  if (!isAddressEqual(d.feeToken, d.token)) throw new Error(`entry ${where(entry)} bills its fee in ${d.feeToken} against a release of ${d.token}`)
  return foldRelease(store, entry, d.parent, getAddress(entry.account), { token: d.token, amount: d.amount, total: d.fulfilledTotal, fee: d.fee })
}

async function foldAllocate(store: IStore, entry: IAccountEntry, self: IAccountRow, d: IAccountCall__Fund_allocateMaster): Promise<void> {
  const master = getAddress(entry.account)
  const prior = await store.get(fundTable, master)
  if (prior === undefined) throw new Error(`entry ${where(entry)} allocates into a fund the fold never opened`)
  const priorUnits = prior.totalUnits
  const rows = receiptRecords(entry).filter(r => isAllocationRecord(r.record))
  verifyPuppetOrder(entry, rows.map(r => ({ puppet: r.account })))
  let staked = 0n
  let sold = 0n
  let sliced = 0n
  for (const [i, row] of rows.entries()) {
    const record = row.record as IAccountCall__Fund_allocatePuppet
    if (isAddressEqual(row.account, master)) throw new Error(`entry ${where(entry)} allocates the master as a puppet`)
    if (!isAddressEqual(record.master, master)) throw new Error(`entry ${where(entry)} row ${i}: ${row.account} allocated into ${record.master}`)
    if (record.stake === 0n) throw new Error(`entry ${where(entry)} row ${i}: ${row.account} logged a zero stake`)
    staked += record.stake
    sold += record.units
    sliced += record.slice
  }
  if (sliced + d.masterSlice > d.fee) throw new Error(`entry ${where(entry)}: fee slices ${sliced} + ${d.masterSlice} exceed the relay fee ${d.fee}`)
  if (sold > d.minted) throw new Error(`entry ${where(entry)}: the puppet rows mint ${sold} of ${d.minted} units`)

  store.set(fundTable, {
    ...prior,
    master,
    skin: d.skin,
    totalUnits: priorUnits + d.minted,
    value: d.valuation.value + d.credit.value + staked - d.fee,
    lastBlock: entry.block.number,
    lastLogIndex: entry.logIndex
  })
  store.set(holdingTable, {
    master,
    holder: master,
    units: d.masterUnits,
    basis: 0n,
    allocatedAt: 0n,
    lastBlock: entry.block.number,
    lastLogIndex: entry.logIndex
  })
  store.set(valuationTable, valuationRow(entry, 'allocate', d.valuation, priorUnits, d.credit.value + staked))
  store.set(allocationTable, {
    id: entryIdOf(entry),
    master,
    contribution: d.credit.value,
    staked,
    minted: d.minted,
    skin: d.skin,
    value: d.valuation.value,
    block: entry.block.number,
    blockTimestamp: entry.block.timestamp,
    logIndex: entry.logIndex,
    transactionHash: entry.transactionHash
  })
  foldFlows(store, entry, self.owner, new Map([[d.feeToken, -d.masterSlice]]))
  await foldCredit(store, entry, self.owner, d)
  await meterMaster(store, master, entry.block.timestamp, {
    pnl: d.valuation.value - prior.value,
    capital: d.credit.value + staked,
    committed: staked
  })
}

async function foldAllocation(store: IStore, entry: IAccountEntry, self: IAccountRow, d: IAccountCall__Fund_allocatePuppet): Promise<void> {
  if (entry.callList.length !== 0) throw new Error(`entry ${where(entry)}: an allocation record carries ${entry.callList.length} legs`)
  const master = getAddress(d.master)
  const holder = getAddress(entry.account)
  const prior = await store.get(holdingTable, holdingIdOf(master, holder))
  foldFlows(store, entry, self.owner, new Map([[bondTokenOf(entry.chainId as ChainId), -d.slice]]))
  store.set(holdingTable, {
    master,
    holder,
    ...d.holding,
    units: (prior === undefined ? 0n : prior.units) + d.units,
    lastBlock: entry.block.number,
    lastLogIndex: entry.logIndex
  })
}

async function foldSell(store: IStore, entry: IAccountEntry, self: IAccountRow, d: IAccountCall__Fund_sellPuppet): Promise<void> {
  const puppet = getAddress(entry.account)
  const master = getAddress(d.master)
  const fee = receiptRecords(entry).filter(r => isSellFeeRecord(r.record))
  if (fee.length !== 1) throw new Error(`entry ${where(entry)}: a sell carries ${fee.length} master records`)
  const record = fee[0]!.record as IAccountCall__Fund_sellMaster
  if (!isAddressEqual(fee[0]!.account, master) || !isAddressEqual(record.puppet, puppet) || record.payoutFee !== d.payoutFee) {
    throw new Error(`entry ${where(entry)}: the master record (${fee[0]!.account}, ${record.puppet}, ${record.payoutFee}) disagrees with the sell`)
  }
  const bond = bondTokenOf(entry.chainId as ChainId)
  const paid = new Map<Hex, bigint>([[d.feeToken, -d.fee]])
  paid.set(bond, (paid.get(bond) ?? 0n) - d.payoutFee)
  foldFlows(store, entry, self.owner, paid)
  const holding = await store.get(holdingTable, holdingIdOf(master, puppet))
  if (holding === undefined || holding.units < d.units) {
    throw new Error(`entry ${where(entry)} sells ${d.units} units ${puppet} never held in ${master}`)
  }
  store.set(holdingTable, {
    ...holding,
    ...d.holding,
    units: holding.units - d.units,
    lastBlock: entry.block.number,
    lastLogIndex: entry.logIndex
  })
  store.set(positionTable, { master, holder: puppet, ...d.position, lastBlock: entry.block.number, lastLogIndex: entry.logIndex })
}

async function foldSellFee(store: IStore, entry: IAccountEntry, d: IAccountCall__Fund_sellMaster): Promise<void> {
  const master = getAddress(entry.account)
  const self = await selfOf(store, entry)
  const sells = receiptRecords(entry).filter(r => isSellRecord(r.record) && isAddressEqual(r.account, d.puppet))
  if (sells.length !== 1) throw new Error(`entry ${where(entry)}: a sell fee record without its sell`)
  const sold = sells[0]!.record as IAccountCall__Fund_sellPuppet
  if (sold.payoutFee !== d.payoutFee) throw new Error(`entry ${where(entry)}: the sell fee disagrees`)
  const queue = await store.get(queueTable, master)
  foldFlows(store, entry, self.owner, new Map([[bondTokenOf(entry.chainId as ChainId), d.payoutFee]]))
  store.set(queueTable, {
    master,
    ...d.queue,
    units: (queue === undefined ? 0n : queue.units) + sold.units,
    lastBlock: entry.block.number,
    lastLogIndex: entry.logIndex
  })
}

async function foldRedeem(store: IStore, entry: IAccountEntry, self: IAccountRow, d: IAccountCall__Fund_redeem): Promise<void> {
  const master = getAddress(entry.account)
  const prior = await store.get(fundTable, master)
  if (prior === undefined) throw new Error(`entry ${where(entry)} redeems a fund the fold never opened`)
  if (prior.totalUnits < d.drained) {
    throw new Error(`entry ${where(entry)}: drains ${d.drained} of ${prior.totalUnits} units`)
  }
  if (d.payout > d.cash) throw new Error(`entry ${where(entry)}: pays puppets ${d.payout} of a ${d.cash} drain`)
  const queue = await store.get(queueTable, master)
  const queuedAfter = (queue === undefined ? 0n : queue.units) + d.retire - d.drained
  if (d.retire > 0n) {
    const holding = await store.get(holdingTable, holdingIdOf(master, master))
    if (holding === undefined || holding.units < d.retire) throw new Error(`entry ${where(entry)} retires ${d.retire} units the master does not hold`)
    store.set(holdingTable, { ...holding, units: holding.units - d.retire, lastBlock: entry.block.number, lastLogIndex: entry.logIndex })
  }
  if (queuedAfter === 0n) {
    store.set(closedAccruedTable, { master, epoch: d.drainedQueue.epoch, accrued: d.drainedQueue.accrued })
    store.set(queueTable, {
      master,
      epoch: d.drainedQueue.epoch + 1n,
      units: 0n,
      weight: 0n,
      masterWeight: 0n,
      accrued: 0n,
      lastBlock: entry.block.number,
      lastLogIndex: entry.logIndex
    })
  } else {
    store.set(queueTable, { master, ...d.drainedQueue, units: queuedAfter, lastBlock: entry.block.number, lastLogIndex: entry.logIndex })
  }
  foldFlows(store, entry, self.owner, new Map([[d.feeToken, -d.fee]]))
  store.set(fundTable, {
    ...prior,
    master,
    totalUnits: prior.totalUnits - d.drained,
    value: d.valuation.value - d.cash,
    lastBlock: entry.block.number,
    lastLogIndex: entry.logIndex
  })
  store.set(valuationTable, valuationRow(entry, 'redeem', d.valuation, prior.totalUnits, 0n))
  await meterMaster(store, master, entry.block.timestamp, { pnl: d.valuation.value - prior.value, capital: -d.cash, committed: 0n })
}

function foldClaim(store: IStore, entry: IAccountEntry, self: IAccountRow, d: IAccountCall__Fund_claimHolder): void {
  const holder = getAddress(entry.account)
  const master = getAddress(d.master)
  if (entry.callList.length !== 0) throw new Error(`entry ${where(entry)}: a claim record carries ${entry.callList.length} legs`)
  const fee = receiptRecords(entry).filter(r => isClaimFeeRecord(r.record) && isAddressEqual(r.account, master))
  if (fee.length !== (d.fee > 0n ? 1 : 0)) throw new Error(`entry ${where(entry)}: a claim with fee ${d.fee} carries ${fee.length} master records`)
  if (fee.length === 1) {
    const record = fee[0]!.record as IAccountCall__Fund_claimMaster
    if (!isAddressEqual(record.holder, holder) || record.fee !== d.fee) throw new Error(`entry ${where(entry)}: the claim fee disagrees`)
  }
  foldFlows(store, entry, self.owner, new Map([[bondTokenOf(entry.chainId as ChainId), -d.fee]]))
  store.set(positionTable, { master, holder, ...d.position, lastBlock: entry.block.number, lastLogIndex: entry.logIndex })
}

async function foldClaimFee(store: IStore, entry: IAccountEntry, d: IAccountCall__Fund_claimMaster): Promise<void> {
  if (entry.callList.length !== 0) throw new Error(`entry ${where(entry)}: a claim fee record carries ${entry.callList.length} legs`)
  const claims = receiptRecords(entry).filter(r => isClaimRecord(r.record) && isAddressEqual(r.account, d.holder))
  if (claims.length !== 1) throw new Error(`entry ${where(entry)}: a claim fee record without its claim`)
  if ((claims[0]!.record as IAccountCall__Fund_claimHolder).fee !== d.fee) throw new Error(`entry ${where(entry)}: the claim fee disagrees`)
  const self = await selfOf(store, entry)
  foldFlows(store, entry, self.owner, new Map([[bondTokenOf(entry.chainId as ChainId), d.fee]]))
}

function foldMandate(store: IStore, entry: IAccountEntry, d: IAccountCall__HubGate_mandate): void {
  const puppet = getAddress(entry.account)
  if (d.mandateList.length !== d.signatureList.length) {
    throw new Error(`entry ${where(entry)}: ${d.mandateList.length} mandates against ${d.signatureList.length} signatures`)
  }
  d.mandateList.forEach((mandate, i) => {
    const master = getAddress(mandate.master)
    if (i > 0 && BigInt(master) <= BigInt(d.mandateList[i - 1]!.master)) throw new Error(`entry ${where(entry)}: mandate ${i} is out of order`)
    if (isAddressEqual(master, puppet)) throw new Error(`entry ${where(entry)}: mandate ${i} names the puppet as its own master`)
    if (mandate.allocationRate >= PRECISION.basisPoints) throw new Error(`entry ${where(entry)}: mandate ${i} allocates ${mandate.allocationRate}, the whole route or more`)
    if (mandate.skin > PRECISION.basisPoints) throw new Error(`entry ${where(entry)}: mandate ${i} requires skin ${mandate.skin} above full`)
    store.set(mandateTable, {
      chainId: BigInt(entry.chainId),
      puppet,
      master,
      skin: mandate.skin,
      allocationRate: mandate.allocationRate,
      cooldownPeriod: mandate.cooldownPeriod,
      expiry: mandate.expiry,
      signature: d.signatureList[i]!,
      block: entry.block.number,
      blockTimestamp: entry.block.timestamp
    })
  })
}

function foldBridge(store: IStore, entry: IAccountEntry, owner: Hex, d: IAccountCall__Deposit_depositAcross): void {
  const deltas = entryDeltas(getAddress(entry.account), entry)
  if (d.destinationChainId !== BigInt(entry.chainId)) {
    const token = chainTokenOfKey(entry.chainId as ChainId, tokenKeyOf(Number(d.destinationChainId) as ChainId, d.outputToken))
    deltas.set(token, (deltas.get(token) ?? 0n) + d.outputAmount)
  }
  foldFlows(store, entry, owner, deltas)
}

function foldFundSwap(
  store: IStore,
  entry: IAccountEntry,
  d: { destinationChainId: bigint; input: Hex; inputAmount: bigint; outputToken: Hex; outputAmount: bigint }
): void {
  store.set(fundSwapTable, {
    id: entryIdOf(entry),
    chainId: BigInt(entry.chainId),
    digest: entry.digest,
    account: getAddress(entry.account),
    destinationChainId: d.destinationChainId,
    inputToken: getAddress(d.input),
    inputAmount: d.inputAmount,
    outputToken: getAddress(d.outputToken),
    outputAmount: d.outputAmount,
    block: entry.block.number,
    blockTimestamp: entry.block.timestamp,
    logIndex: entry.logIndex,
    transactionHash: entry.transactionHash
  })
  if (d.destinationChainId === BigInt(entry.chainId)) return
  const opened = entry.logs.reduce((at, log) => (log.topics[0] === ACCOUNT_CALL_TOPIC && log.logIndex < entry.logIndex && log.logIndex > at ? log.logIndex : at), -1)
  const spokePool = acrossSpokePoolOf(entry.chainId)
  const deposits = entry.logs
    .filter(log => log.logIndex > opened && log.logIndex < entry.logIndex && log.topics[0] === FUNDS_DEPOSITED_TOPIC && isAddressEqual(log.address, spokePool))
    .map(log => decodeEventLog({ abi: [FUNDS_DEPOSITED], data: log.data, topics: log.topics as [Hex, ...Hex[]] }).args)
    .filter(args => args.destinationChainId === d.destinationChainId && isAddressEqual(slice(args.depositor, 12), entry.account))
  if (deposits.length !== 1) {
    throw new Error(`entry ${where(entry)}: a fund swap to chain ${d.destinationChainId} emitted ${deposits.length} Across deposits`)
  }
  const a = deposits[0]!
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
        d.destinationChainId
      ]
    )
  )
  store.set(transitTable, {
    id: entryIdOf(entry),
    chainId: BigInt(entry.chainId),
    account: getAddress(entry.account),
    destinationChainId: d.destinationChainId,
    relayHash,
    fillDeadline: a.fillDeadline,
    inputToken: getAddress(slice(a.inputToken, 12)),
    inputAmount: a.inputAmount,
    outputToken: getAddress(slice(a.outputToken, 12)),
    outputAmount: a.outputAmount,
    block: entry.block.number,
    blockTimestamp: entry.block.timestamp,
    logIndex: entry.logIndex,
    transactionHash: entry.transactionHash
  })
}

interface IMasterMetricDelta {
  pnl: bigint
  capital: bigint
  committed: bigint
}

async function meterMaster(store: IStore, master: Hex, time: number, delta: IMasterMetricDelta): Promise<void> {
  if (delta.pnl === 0n && delta.capital === 0n && delta.committed === 0n) return
  const rows = await Promise.all(
    PLATFORM_STAT_INTERVAL.map(interval =>
      store.getOrCreate(masterMetricTable, {
        id: `${interval}:${getAddress(master)}`,
        interval,
        master: getAddress(master),
        pnlList: [],
        pnlTimestampList: [],
        pnl: 0n,
        committed: 0n,
        capital: 0n,
        roi: 0n,
        level: 0n,
        weighted: 0n,
        coverage: 0n,
        lastUpdatedTimestamp: time
      })
    )
  )
  for (const row of rows) {
    const series = windowPnlSeries(row.pnlList, row.pnlTimestampList, delta.pnl, time, row.interval)
    const pnl = series.pnlList.reduce((acc, p) => acc + p, 0n)
    const decayBps = getDecayBps(row.interval, time - row.lastUpdatedTimestamp)
    const weighted = applyDecay(row.weighted, decayBps) + (row.level * decayBps) / PRECISION.basisPoints
    const coverage = applyDecay(row.coverage, decayBps) + decayBps
    const level = row.level + delta.capital
    const capital = coverage > 0n ? (weighted * PRECISION.basisPoints) / coverage : level
    store.set(masterMetricTable, {
      ...row,
      ...series,
      pnl,
      committed: applyDecay(row.committed, decayBps) + delta.committed,
      capital,
      roi: capital > 0n ? (pnl * PRECISION.basisPoints) / capital : 0n,
      level,
      weighted,
      coverage,
      lastUpdatedTimestamp: Math.max(row.lastUpdatedTimestamp, time)
    })
  }
}

export async function foldAccountEntry(store: IStore, entry: IAccountEntry): Promise<void> {
  await foldEntry(store, entry)
  const self = await store.get(accountTable, `${entry.chainId}-${getAddress(entry.account)}`)
  if (self !== undefined) store.set(accountTable, { ...self, lastBlock: entry.block.number, lastLogIndex: entry.logIndex })
}

async function foldEntry(store: IStore, entry: IAccountEntry): Promise<void> {
  const decoded = decodeAccountCall(entry)
  if (decoded.selector === ACCOUNT_CALL_MAP.UserAccount.revokeSessions.selector) {
    const d = decoded as IAccountCall__UserAccount_revokeSessions
    const self = await selfOf(store, entry)
    if (d.epoch <= self.epoch) throw new Error(`entry ${where(entry)} revokes to epoch ${d.epoch}, not past the ${self.epoch} already folded`)
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
  if (decoded.selector === ACCOUNT_CALL_MAP.Deposit.deposit.selector) {
    const d = decoded as IAccountCall__Deposit_deposit
    const self = await selfOf(store, entry)
    foldFlows(store, entry, self.owner, new Map([[d.token, d.amount]]))
    return
  }
  if (decoded.selector === ACCOUNT_CALL_MAP.Deposit.depositEscrow.selector) {
    const self = await selfOf(store, entry)
    foldFlows(store, entry, self.owner, new Map([[decoded.token, decoded.amount]]))
    return foldEscrow(store, entry, decoded, 1n)
  }
  if (decoded.selector === ACCOUNT_CALL_MAP.UserAccount.withdraw.selector) {
    const d = decoded as IAccountCall__UserAccount_withdraw
    const self = await selfOf(store, entry)
    foldFlows(store, entry, self.owner, new Map([[d.token, -d.amount]]))
    return
  }
  if (isSellFeeRecord(decoded)) return foldSellFee(store, entry, decoded)
  if (isClaimFeeRecord(decoded)) return foldClaimFee(store, entry, decoded)
  if (decoded.selector === ACCOUNT_CALL_MAP.SpokeGate.fulfil.selector) return foldFulfil(store, entry, decoded as IAccountCall__SpokeGate_fulfil)
  const self = await selfOf(store, entry)
  if (isAllocationRecord(decoded)) return foldAllocation(store, entry, self, decoded)
  if (isSellRecord(decoded)) return foldSell(store, entry, self, decoded)
  if (isClaimRecord(decoded)) return foldClaim(store, entry, self, decoded)
  switch (decoded.selector) {
    case ACCOUNT_CALL_MAP.Fund.allocateMaster.selector:
      return foldAllocate(store, entry, self, decoded as IAccountCall__Fund_allocateMaster)
    case ACCOUNT_CALL_MAP.Fund.redeem.selector:
      return foldRedeem(store, entry, self, decoded as IAccountCall__Fund_redeem)
    case ACCOUNT_CALL_MAP.HubGate.mandate.selector:
      foldFlows(store, entry, self.owner, new Map([[decoded.feeToken, -decoded.fee]]))
      return foldMandate(store, entry, decoded)
    case ACCOUNT_CALL_MAP.SpokeGate.operate.selector:
      foldFlows(store, entry, self.owner, new Map([[decoded.feeToken, -decoded.fee]]))
      return
    case ACCOUNT_CALL_MAP.Deposit.fundSwap.selector:
      foldFlows(store, entry, self.owner, new Map([[decoded.feeToken, -decoded.fee]]))
      return foldFundSwap(store, entry, decoded)
    case ACCOUNT_CALL_MAP.HubGate.createFund.selector:
      return foldCreateFund(store, entry, decoded as IAccountCall__HubGate_createFund)
    case ACCOUNT_CALL_MAP.LiquidityGate.escrow.selector:
      foldFlows(store, entry, self.owner, new Map([[decoded.feeToken, -decoded.fee]]))
      return foldEscrow(store, entry, decoded as IAccountCall__LiquidityGate_escrow, 1n)
    case ACCOUNT_CALL_MAP.LiquidityGate.refund.selector:
      foldFlows(store, entry, self.owner, new Map([[decoded.token, -decoded.amount]]))
      return foldEscrow(store, entry, decoded, -1n)
    case ACCOUNT_CALL_MAP.UserAccount.requestWithdraw.selector:
      return
    case ACCOUNT_CALL_MAP.Deposit.depositAcross.selector:
      return foldBridge(store, entry, self.owner, decoded as IAccountCall__Deposit_depositAcross)
    case ACCOUNT_CALL_MAP.Deposit.withdraw.selector:
      foldFlows(store, entry, self.owner, entryDeltas(getAddress(entry.account), entry))
      return
    default:
      throw new Error(`entry ${where(entry)} carries selector ${(decoded as { selector: Hex }).selector}, which the fold does not know`)
  }
}

export const FOLD_SOURCE: string = [
  escrowIdOf,
  foldEscrow,
  foldRelease,
  foldCredit,
  foldCreateFund,
  foldFulfil,
  foldBridge,
  entryIdOf,
  holdingIdOf,
  where,
  receiptRecords,
  matches,
  isAllocationRecord,
  isSellRecord,
  isSellFeeRecord,
  isClaimRecord,
  isClaimFeeRecord,
  verifyPuppetOrder,
  selfOf,
  foldFlows,
  valuationRow,
  foldAllocate,
  foldAllocation,
  foldSell,
  foldSellFee,
  foldRedeem,
  foldClaim,
  foldClaimFee,
  foldMandate,
  foldFundSwap,
  meterMaster,
  foldAccountEntry,
  foldEntry
]
  .map(f => f.toString())
  .join('\n')
