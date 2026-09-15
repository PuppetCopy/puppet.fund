import { PRECISION, PROTOCOL } from '@puppet/contracts/const'
import { accountCallEvent } from '@puppet/contracts/events'
import type {
  IAccountCall__CoreGate_operatePuppet,
  IAccountCall__CoreGate_settlePuppet,
  IAccountCall__HubGate_drawPuppet,
  IAccountCallEntry,
  IIAccount__Call
} from '@puppet/contracts/types'
import { decodeEventLog, getAddress, type Hex, isAddressEqual } from 'viem'
import {
  ACCOUNT_CALL_MAP,
  ACCOUNT_CALL_TOPIC,
  callDeltas,
  decodeAccountCall,
  entryDeltas,
  type IReceiptLog,
  transferLegAmount
} from '../account/index.js'
import { applyOperate, backingRoom, foldPending, type IBackerLedger, type ILedger, SHARE_PRECISION, settleNet } from '../backing/index.js'
import { PLATFORM_STAT_INTERVAL } from '../const/common.js'
import type { ChainId } from '../const/index.js'
import type { IColumns, InferRow, ITable } from '../datastore/index.js'
import {
  accountBalanceTable,
  accountTable,
  backerTable,
  backingTable,
  bondTable,
  bookTable,
  depositTable,
  flowTable,
  type IAccountRow,
  type IBackerRow,
  type IBookRow,
  type IMarkRow,
  mandateTable,
  markTable,
  masterMetricTable,
  settlementTable, 
  settleRowTable
} from '../schema/index.js'
import { applyDecay, getDecayBps, windowPnlSeries } from '../state/metricMath.js'
import { bondTokenOf } from '../state/tokenRegistry.js'

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

export const entryIdOf = (entry: Pick<IAccountEntry, 'chainId' | 'transactionHash' | 'logIndex'>): string =>
  `${entry.chainId}-${entry.transactionHash}-${entry.logIndex}`
export const bookIdOf = (chainId: number | bigint, master: Hex): string => `${chainId}-${getAddress(master)}`
export const backerIdOf = (bookId: string, puppet: Hex): string => `${bookId}-${getAddress(puppet)}`
export const markIdOf = (bookId: string, block: number, logIndex: number): string => `${bookId}-${block}-${logIndex}`
export const holdingIdOf = (chainId: number | bigint, account: Hex, token: Hex): string =>
  `${chainId}-${getAddress(account)}-${getAddress(token)}`
export const settlementIdOf = (master: Hex, spokeChainId: number | bigint, cycle: bigint, kind: 'settle' | 'draw'): string =>
  `${getAddress(master)}-${spokeChainId}-${cycle}-${kind}`
export const mandateIdOf = (puppet: Hex, master: Hex): string => `${getAddress(puppet)}-${getAddress(master)}`

const where = (entry: IAccountEntry): string => `${entry.account}@${entry.block.number}:${entry.logIndex}`

export function receiptRecords(entry: Pick<IAccountEntry, 'logs' | 'logIndex'>): { account: Hex; record: IAccountCallEntry }[] {
  const rows: { account: Hex; record: IAccountCallEntry }[] = []
  for (const log of entry.logs) {
    if (log.topics[0] !== ACCOUNT_CALL_TOPIC || log.logIndex === entry.logIndex) continue
    const { args } = decodeEventLog({ abi: [accountCallEvent], data: log.data, topics: log.topics as [Hex, ...Hex[]] })
    rows.push({ account: getAddress(args.account), record: decodeAccountCall({ source: args.source, executionData: args.executionData }) })
  }
  return rows
}

export const isBackingRecord = (r: IAccountCallEntry): r is IAccountCall__CoreGate_operatePuppet =>
  r.selector === ACCOUNT_CALL_MAP.CoreGate.operatePuppet.selector && r.size === ACCOUNT_CALL_MAP.CoreGate.operatePuppet.size
export const isGainRecord = (r: IAccountCallEntry): r is IAccountCall__CoreGate_settlePuppet =>
  r.selector === ACCOUNT_CALL_MAP.CoreGate.settlePuppet.selector && r.size === ACCOUNT_CALL_MAP.CoreGate.settlePuppet.size
export const isLossRecord = (r: IAccountCallEntry): r is IAccountCall__HubGate_drawPuppet =>
  r.selector === ACCOUNT_CALL_MAP.HubGate.drawPuppet.selector && r.size === ACCOUNT_CALL_MAP.HubGate.drawPuppet.size

function verifyPuppetOrder(entry: IAccountEntry, rows: readonly { puppet: Hex }[]): void {
  for (let i = 1; i < rows.length; i++) {
    if (BigInt(rows[i]!.puppet) <= BigInt(rows[i - 1]!.puppet)) {
      throw new Error(`entry ${where(entry)}: row ${i} (${rows[i]!.puppet}) is out of order`)
    }
  }
}

function verifyPayoutLeg(entry: IAccountEntry, leg: IIAccount__Call | undefined, token: Hex, to: Hex, amount: bigint, index: number): void {
  if (leg === undefined) throw new Error(`entry ${where(entry)}: row ${index} has no payout leg`)
  if (isAddressEqual(token, PROTOCOL.nativeToken)) {
    if (!isAddressEqual(leg.target, to) || leg.value !== amount || leg.callData !== '0x') {
      throw new Error(`entry ${where(entry)}: row ${index} should pay ${amount} native to ${to}`)
    }
    return
  }
  const transfer = transferLegAmount(leg)
  if (transfer === null || !isAddressEqual(leg.target, token) || !isAddressEqual(transfer.to, to) || transfer.amount !== amount) {
    throw new Error(`entry ${where(entry)}: row ${index} should transfer ${amount} of ${token} to ${to}`)
  }
}

async function applyBalanceDelta(store: IStore, entry: IAccountEntry, token: Hex, delta: bigint): Promise<void> {
  const row = await store.getOrCreate(accountBalanceTable, {
    id: holdingIdOf(entry.chainId, entry.account, token),
    chainId: BigInt(entry.chainId),
    account: entry.account,
    token,
    book: 0n
  })
  store.set(accountBalanceTable, { ...row, book: row.book + delta })
}

async function applyBondDelta(store: IStore, entry: IAccountEntry, token: Hex, delta: bigint): Promise<void> {
  if (delta === 0n) return
  const row = await store.getOrCreate(bondTable, {
    id: holdingIdOf(entry.chainId, entry.account, token),
    chainId: BigInt(entry.chainId),
    account: entry.account,
    token: getAddress(token),
    bond: 0n
  })
  const next = row.bond + delta
  if (next < 0n) throw new Error(`entry ${where(entry)}: takes ${-delta} from a bond of ${row.bond}`)
  store.set(bondTable, { ...row, bond: next })
}

async function applyDepositDelta(store: IStore, entry: IAccountEntry, token: Hex, delta: bigint): Promise<void> {
  if (delta === 0n) return
  const row = await store.getOrCreate(depositTable, {
    id: holdingIdOf(entry.chainId, entry.account, token),
    chainId: BigInt(entry.chainId),
    account: entry.account,
    token: getAddress(token),
    deposit: 0n
  })
  store.set(depositTable, { ...row, deposit: row.deposit + delta })
}

const ledgerOf = (book: IBookRow): ILedger => ({
  totalShares: book.totalShares,
  totalPending: book.totalPending,
  backing: book.backed,
  masterShares: book.masterShares,
  masterPending: book.masterPending
})

const backerLedgerOf = (row: IBackerRow): IBackerLedger => ({
  puppet: row.puppet,
  stake: row.stake,
  pending: row.pending,
  shares: row.shares
})

async function selfOf(store: IStore, entry: IAccountEntry): Promise<IAccountRow> {
  const self = await store.get(accountTable, `${entry.chainId}-${getAddress(entry.account)}`)
  if (!self) throw new Error(`account ${entry.account} acts before its genesis was folded`)
  return self
}

function foldFlows(store: IStore, entry: IAccountEntry, owner: Hex, deltas: Map<Hex, bigint>, settlement: boolean): void {
  for (const [token, amount] of deltas) {
    if (amount === 0n) continue
    store.set(flowTable, {
      id: `${entryIdOf(entry)}-${token}`,
      chainId: BigInt(entry.chainId),
      account: entry.account,
      owner,
      token,
      amount,
      block: entry.block.number,
      blockTimestamp: entry.block.timestamp,
      logIndex: entry.logIndex,
      transactionHash: entry.transactionHash,
      settlement,
      pending: true,
      value: undefined
    })
  }
}

async function bookBackers(store: IStore, book: IBookRow): Promise<IBackerRow[]> {
  return Promise.all(
    book.backerList.map(async puppet => {
      const row = await store.get(backerTable, backerIdOf(book.id, puppet))
      if (!row) throw new Error(`book ${book.id} lists backer ${puppet} without a row`)
      return row
    })
  )
}

function puppetValueOf(ledger: ILedger, value: bigint): bigint {
  return ledger.totalShares === 0n ? 0n : ((value + ledger.backing) * (ledger.totalShares - ledger.masterShares)) / ledger.totalShares
}

async function sealMark(store: IStore, entry: IAccountEntry, last: IMarkRow, closeValue: bigint, nextPuppetValue: bigint): Promise<void> {
  if (!last.pending) return
  await meterMaster(store, last.master, last.blockTimestamp, { pnl: markPeriodPnl(last, closeValue), capital: 0n, committed: 0n })
  store.set(markTable, { ...last, pending: false, closeValue, nextPuppetValue, evaluatedAt: entry.block.timestamp })
}

async function lastMarkOf(store: IStore, entry: IAccountEntry, book: IBookRow): Promise<IMarkRow> {
  const last = await store.get(markTable, book.lastMark)
  if (!last) throw new Error(`book ${book.id}: entry ${where(entry)} follows mark ${book.lastMark} which has no row`)
  return last
}

async function foldOperate(
  store: IStore,
  entry: IAccountEntry,
  self: IAccountRow,
  d: { cycle: bigint; token: Hex; value: bigint; collateral: bigint; skin: bigint; backed: bigint }
): Promise<void> {
  const master = getAddress(entry.account)
  const id = bookIdOf(entry.chainId, master)
  let book: IBookRow = (await store.get(bookTable, id)) ?? {
    id,
    chainId: BigInt(entry.chainId),
    master,
    owner: self.owner,
    cycle: 0n,
    token: getAddress(d.token),
    backed: 0n,
    collateral: 0n,
    skin: 0n,
    totalShares: 0n,
    totalPending: 0n,
    masterShares: 0n,
    masterPending: 0n,
    feeTokens: [],
    feeAmounts: [],
    backerList: [],
    lastMark: '',
    lastBlock: 0,
    lastLogIndex: 0
  }
  const capitalBefore = book.totalShares / SHARE_PRECISION
  let backers = await bookBackers(store, book)
  const opening = d.cycle > book.cycle
  if (!opening && d.cycle !== book.cycle) {
    throw new Error(`book ${id}: entry ${where(entry)} carries cycle ${d.cycle} below the folded cycle ${book.cycle}`)
  }
  const inflow = opening ? 0n : d.collateral - book.collateral
  if (opening) {
    for (const row of backers) store.set(backerTable, { ...row, stake: 0n, pending: 0n, shares: 0n })
    book = { ...book, cycle: d.cycle, backed: 0n, totalShares: 0n, totalPending: 0n, masterShares: 0n, masterPending: 0n, feeTokens: [], feeAmounts: [], backerList: [] }
    backers = []
  }
  let folded = { ledger: ledgerOf(book), backers: backers.map(backerLedgerOf) }
  if (!opening) {
    const last = await lastMarkOf(store, entry, book)
    folded = foldPending(folded.ledger, d.value, folded.backers)
    if (inflow > 0n) {
      folded = foldPending({ ...folded.ledger, masterPending: inflow, totalPending: inflow }, d.value + inflow, folded.backers)
    } else if (inflow < 0n) {
      const burn = (-inflow * folded.ledger.totalShares) / (d.value + folded.ledger.backing)
      if (burn > folded.ledger.masterShares) {
        throw new Error(`book ${id}: entry ${where(entry)} redeems ${-inflow} against ${folded.ledger.masterShares} master shares`)
      }
      folded = { ...folded, ledger: { ...folded.ledger, totalShares: folded.ledger.totalShares - burn, masterShares: folded.ledger.masterShares - burn } }
    }
    await sealMark(store, entry, last, d.value, puppetValueOf(folded.ledger, d.value + inflow))
  }
  const puppetValue = puppetValueOf(folded.ledger, d.value + inflow)

  const backings = receiptRecords(entry).filter(r => isBackingRecord(r.record))
  verifyPuppetOrder(entry, backings.map(r => ({ puppet: r.account })))
  const stakes = backings.map((row, i) => {
    const record = row.record as IAccountCall__CoreGate_operatePuppet
    const puppet = getAddress(row.account)
    if (isAddressEqual(puppet, master)) throw new Error(`book ${id}: entry ${where(entry)} lists the master as a backer`)
    if (!isAddressEqual(record.master, master)) {
      throw new Error(`book ${id}: entry ${where(entry)} row ${i}: ${puppet} logged a backing of ${record.master}, not ${master}`)
    }
    if (record.cycle !== d.cycle) {
      throw new Error(`book ${id}: entry ${where(entry)} row ${i}: ${puppet} logged cycle ${record.cycle} against the operate of cycle ${d.cycle}`)
    }
    if (record.stake === 0n) throw new Error(`book ${id}: entry ${where(entry)} row ${i}: ${puppet} logged a zero stake`)
    return { puppet, stake: record.stake }
  })
  const prior = d.backed - stakes.reduce((total, s) => total + s.stake, 0n)
  if (opening && prior !== 0n) throw new Error(`book ${id}: entry ${where(entry)} opens cycle ${d.cycle} with ${prior} already backed`)
  if (!opening && prior !== book.backed) {
    throw new Error(`book ${id}: entry ${where(entry)} attests ${prior} backed but the fold holds ${book.backed}`)
  }
  const room = backingRoom(d.collateral, d.skin)
  if (d.backed > room) throw new Error(`book ${id}: entry ${where(entry)} backs ${d.backed} against ${room} of room at skin ${d.skin}`)

  const applied = applyOperate(folded.ledger, opening ? d.value : 0n, folded.backers, stakes)
  const committedBefore = new Map(backers.map(b => [b.puppet, b.committedAt]))
  const committed = new Map(stakes.map(s => [s.puppet, entry.block.timestamp]))
  for (const b of applied.backers) {
    store.set(backerTable, {
      id: backerIdOf(id, b.puppet),
      chainId: BigInt(entry.chainId),
      master,
      puppet: b.puppet,
      stake: b.stake,
      pending: b.pending,
      shares: b.shares,
      committedAt: committed.get(b.puppet) ?? committedBefore.get(b.puppet) ?? 0
    })
  }

  await meterMaster(store, master, entry.block.timestamp, {
    pnl: 0n,
    capital: applied.ledger.totalShares / SHARE_PRECISION - capitalBefore,
    committed: stakes.reduce((acc, s) => acc + s.stake, 0n)
  })

  const feeLeg = entry.callList[entry.callList.length - 1]
  const transfer = feeLeg === undefined ? null : transferLegAmount(feeLeg)
  const fee =
    feeLeg === undefined
      ? null
      : transfer !== null
        ? { token: getAddress(feeLeg.target), amount: transfer.amount }
        : feeLeg.callData === '0x'
          ? { token: getAddress(PROTOCOL.nativeToken), amount: feeLeg.value }
          : null
  if (fee === null) throw new Error(`book ${id}: entry ${where(entry)} carries no relay fee leg`)
  const feeTokens = [...book.feeTokens]
  const feeAmounts = [...book.feeAmounts]
  const feeAt = feeTokens.findIndex(t => isAddressEqual(t, fee.token))
  if (feeAt < 0) {
    feeTokens.push(fee.token)
    feeAmounts.push(fee.amount)
  } else {
    feeAmounts[feeAt] = feeAmounts[feeAt]! + fee.amount
  }

  const markId = markIdOf(id, entry.block.number, entry.logIndex)
  await store.getOrCreate(markTable, {
    id: markId,
    chainId: BigInt(entry.chainId),
    book: id,
    master,
    cycle: d.cycle,
    block: entry.block.number,
    blockTimestamp: entry.block.timestamp,
    logIndex: entry.logIndex,
    transactionHash: entry.transactionHash,
    openValue: d.value,
    ledgerPuppetValue: puppetValue,
    collateral: d.collateral,
    inflow,
    opening,
    feeTokens,
    feeAmounts,
    pending: true,
    closeValue: undefined,
    nextPuppetValue: undefined,
    priceTime: undefined,
    evaluatedAt: undefined
  })

  store.set(bookTable, {
    ...book,
    token: getAddress(d.token),
    backed: applied.ledger.backing,
    collateral: d.collateral,
    skin: d.skin,
    totalShares: applied.ledger.totalShares,
    totalPending: applied.ledger.totalPending,
    masterShares: applied.ledger.masterShares,
    masterPending: applied.ledger.masterPending,
    feeTokens,
    feeAmounts,
    backerList: applied.backers.map(b => b.puppet),
    lastMark: markId,
    lastBlock: entry.block.number,
    lastLogIndex: entry.logIndex
  })
}

function foldBacking(store: IStore, entry: IAccountEntry, d: { master: Hex; cycle: bigint; stake: bigint }): void {
  if (entry.callList.length !== 0) throw new Error(`entry ${where(entry)}: a backing record carries ${entry.callList.length} legs`)
  store.set(backingTable, {
    id: entryIdOf(entry),
    chainId: BigInt(entry.chainId),
    puppet: getAddress(entry.account),
    master: getAddress(d.master),
    cycle: d.cycle,
    stake: d.stake,
    block: entry.block.number,
    blockTimestamp: entry.block.timestamp,
    logIndex: entry.logIndex,
    transactionHash: entry.transactionHash
  })
}

async function foldSettle(store: IStore, entry: IAccountEntry, d: { cycle: bigint; token: Hex; value: bigint }): Promise<void> {
  const master = getAddress(entry.account)
  const book = await store.get(bookTable, bookIdOf(entry.chainId, master))
  if (!book) throw new Error(`entry ${where(entry)} settles cycle ${d.cycle} of a book the fold never opened`)
  if (book.cycle !== d.cycle) throw new Error(`entry ${where(entry)} settles cycle ${d.cycle} but the book is at cycle ${book.cycle}`)
  const token = getAddress(d.token)
  const gains = receiptRecords(entry).filter(r => isGainRecord(r.record))
  for (const [i, row] of gains.entries()) {
    const record = row.record as IAccountCall__CoreGate_settlePuppet
    const puppet = getAddress(row.account)
    if (isAddressEqual(puppet, master)) throw new Error(`entry ${where(entry)}: row ${i} pays the master`)
    if (!isAddressEqual(record.master, master)) {
      throw new Error(`entry ${where(entry)}: row ${i}: ${puppet} logged a settlement by ${record.master}, not ${master}`)
    }
    if (record.cycle !== d.cycle || !isAddressEqual(record.token, token)) {
      throw new Error(`entry ${where(entry)}: row ${i}: ${puppet} logged (${record.cycle}, ${record.token}) against the settle of (${d.cycle}, ${token})`)
    }
    if (record.amount2 !== settleNet(record.amount, PROTOCOL.performanceFee)) {
      throw new Error(`entry ${where(entry)}: row ${i}: ${puppet} logged ${record.amount2} net of ${record.amount} owed`)
    }
    verifyPayoutLeg(entry, entry.callList[i], token, puppet, record.amount2, i)
  }
  if (entry.callList.length !== gains.length + 1) {
    throw new Error(`entry ${where(entry)}: ${entry.callList.length} legs for ${gains.length} gains and a fee`)
  }
  store.set(settlementTable, {
    id: settlementIdOf(master, entry.chainId, d.cycle, 'settle'),
    master,
    spokeChainId: BigInt(entry.chainId),
    cycle: d.cycle,
    kind: 'settle',
    token,
    value: d.value,
    block: entry.block.number,
    blockTimestamp: entry.block.timestamp,
    logIndex: entry.logIndex,
    transactionHash: entry.transactionHash
  })
  if (book.lastMark !== '') {
    const last = await lastMarkOf(store, entry, book)
    const folded = foldPending(ledgerOf(book), d.value, (await bookBackers(store, book)).map(backerLedgerOf))
    await sealMark(store, entry, last, d.value, puppetValueOf(folded.ledger, d.value))
  }
}

function foldDraw(store: IStore, entry: IAccountEntry, d: { spokeChainId: bigint; cycle: bigint; drawn: bigint }): void {
  const master = getAddress(entry.account)
  const losses = receiptRecords(entry).filter(r => isLossRecord(r.record))
  let drawn = 0n
  for (const [i, row] of losses.entries()) {
    const record = row.record as IAccountCall__HubGate_drawPuppet
    const puppet = getAddress(row.account)
    if (isAddressEqual(puppet, master)) throw new Error(`entry ${where(entry)}: row ${i} draws from the master`)
    if (!isAddressEqual(record.master, master)) {
      throw new Error(`entry ${where(entry)}: row ${i}: ${puppet} logged a draw by ${record.master}, not ${master}`)
    }
    if (record.spokeChainId !== d.spokeChainId || record.cycle !== d.cycle) {
      throw new Error(
        `entry ${where(entry)}: row ${i}: ${puppet} logged (${record.spokeChainId}, ${record.cycle}) against the draw of (${d.spokeChainId}, ${d.cycle})`
      )
    }
    if (record.loss > record.amount) {
      throw new Error(`entry ${where(entry)}: row ${i}: ${puppet} logged ${record.loss} drawn against ${record.amount} owed`)
    }
    drawn += record.loss
  }
  if (drawn !== d.drawn) throw new Error(`entry ${where(entry)}: the rows draw ${drawn} but the master logged ${d.drawn}`)
  if (entry.callList.length !== 1) throw new Error(`entry ${where(entry)}: a draw carries ${entry.callList.length} legs, expected the fee only`)
  store.set(settlementTable, {
    id: settlementIdOf(master, d.spokeChainId, d.cycle, 'draw'),
    master,
    spokeChainId: d.spokeChainId,
    cycle: d.cycle,
    kind: 'draw',
    token: undefined,
    value: undefined,
    block: entry.block.number,
    blockTimestamp: entry.block.timestamp,
    logIndex: entry.logIndex,
    transactionHash: entry.transactionHash
  })
}

function foldSettleRow(
  store: IStore,
  entry: IAccountEntry,
  d: { kind: 'gain' | 'loss'; master: Hex; spokeChainId: bigint; cycle: bigint; token: Hex; amount: bigint; moved: bigint }
): void {
  const puppet = getAddress(entry.account)
  const master = getAddress(d.master)
  if (d.kind === 'gain') {
    if (entry.callList.length !== 0) throw new Error(`entry ${where(entry)}: a gain receipt carries ${entry.callList.length} legs`)
  } else if (d.moved === 0n) {
    if (entry.callList.length !== 0) throw new Error(`entry ${where(entry)}: an empty loss receipt carries ${entry.callList.length} legs`)
  } else if (entry.callList.length !== 0) {
    throw new Error(`entry ${where(entry)}: a loss receipt carries ${entry.callList.length} legs; the bond store pays the master directly`)
  }
  store.set(settleRowTable, {
    id: entryIdOf(entry),
    chainId: BigInt(entry.chainId),
    spokeChainId: d.spokeChainId,
    master,
    puppet,
    cycle: d.cycle,
    kind: d.kind,
    token: getAddress(d.token),
    amount: d.amount,
    moved: d.moved,
    block: entry.block.number,
    blockTimestamp: entry.block.timestamp,
    logIndex: entry.logIndex,
    transactionHash: entry.transactionHash
  })
}

function foldMandate(
  store: IStore,
  entry: IAccountEntry,
  d: { mandateList: { master: Hex; skin: bigint; allocationRate: bigint; cooldownPeriod: bigint; expiry: bigint; tokenIdList: readonly Hex[] }[]; signatureList: readonly Hex[] }
): void {
  const puppet = getAddress(entry.account)
  if (d.mandateList.length !== d.signatureList.length) {
    throw new Error(`entry ${where(entry)}: ${d.mandateList.length} mandates against ${d.signatureList.length} signatures`)
  }
  d.mandateList.forEach((mandate, i) => {
    const master = getAddress(mandate.master)
    if (i > 0 && BigInt(master) <= BigInt(d.mandateList[i - 1]!.master)) throw new Error(`entry ${where(entry)}: mandate ${i} is out of order`)
    if (isAddressEqual(master, puppet)) throw new Error(`entry ${where(entry)}: mandate ${i} names the puppet as its own master`)
    if (mandate.allocationRate > PRECISION.basisPoints) throw new Error(`entry ${where(entry)}: mandate ${i} allocates ${mandate.allocationRate} above full`)
    store.set(mandateTable, {
      chainId: BigInt(entry.chainId),
      puppet,
      master,
      skin: mandate.skin,
      allocationRate: mandate.allocationRate,
      cooldownPeriod: mandate.cooldownPeriod,
      expiry: mandate.expiry,
      tokenIdList: [...mandate.tokenIdList],
      signature: d.signatureList[i]!,
      block: entry.block.number,
      blockTimestamp: entry.block.timestamp
    })
  })
}

export const markPeriodPnl = (mark: Pick<IMarkRow, 'openValue' | 'inflow' | 'opening'>, closeValue: bigint): bigint =>
  mark.opening ? 0n : closeValue - mark.openValue - mark.inflow

export interface IMasterMetricDelta {
  pnl: bigint
  capital: bigint
  committed: bigint
}

export async function meterMaster(store: IStore, master: Hex, time: number, delta: IMasterMetricDelta): Promise<void> {
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
  if (decoded.selector === ACCOUNT_CALL_MAP.AccountModule.createAccount.selector) {
    store.set(accountTable, {
      chainId: BigInt(entry.chainId),
      account: entry.account,
      owner: decoded.user,
      signer: decoded.signer,
      createdAt: entry.block.timestamp,
      lastBlock: entry.block.number,
      lastLogIndex: entry.logIndex
    })
    return
  }
  const forwarded =
    decoded.selector === ACCOUNT_CALL_MAP.CoreGate.operateMaster.selector && decoded.size !== ACCOUNT_CALL_MAP.CoreGate.operatePuppet.size
      ? entry.value
      : 0n
  const deltas = entryDeltas(entry.account, {
    chainId: entry.chainId,
    callList: entry.callList,
    logs: entry.logs,
    value: forwarded
  })
  const sweptNative =
    decoded.selector === ACCOUNT_CALL_MAP.CoreGate.deposit.selector
      ? isAddressEqual(decoded.token, PROTOCOL.nativeToken)
        ? decoded.amount
        : 0n
      : decoded.selector === ACCOUNT_CALL_MAP.HubGate.deposit.selector
        ? isAddressEqual(decoded.token, PROTOCOL.nativeToken)
          ? decoded.amount - decoded.bond
          : 0n
        : 'creditList' in decoded
          ? decoded.creditList.reduce(
              (total, token, i) => (isAddressEqual(token, PROTOCOL.nativeToken) ? total + (decoded.amountList[i] ?? 0n) : total),
              0n
            )
          : 0n
  if (sweptNative > 0n) deltas.set(PROTOCOL.nativeToken, (deltas.get(PROTOCOL.nativeToken) ?? 0n) + sweptNative)
  for (const [token, delta] of deltas) {
    await applyBalanceDelta(store, entry, token, delta)
  }
  for (const [token, delta] of callDeltas({ callList: entry.callList, value: forwarded })) {
    await applyDepositDelta(store, entry, token, delta)
  }
  switch (decoded.selector) {
    case ACCOUNT_CALL_MAP.CoreGate.operateMaster.selector: {
      if (isBackingRecord(decoded)) return foldBacking(store, entry, decoded)
      const master = await selfOf(store, entry)
      const credits = new Map<Hex, bigint>()
      for (const [i, token] of decoded.creditList.entries()) {
        const amount = decoded.amountList[i]
        if (amount === undefined) throw new Error(`entry ${where(entry)} credits ${token} without an amount`)
        credits.set(token, (credits.get(token) ?? 0n) + amount)
        await applyDepositDelta(store, entry, token, amount)
      }
      foldFlows(store, entry, master.owner, credits, false)
      return foldOperate(store, entry, master, decoded)
    }
    case ACCOUNT_CALL_MAP.CoreGate.settleMaster.selector:
      if (isGainRecord(decoded)) {
        await applyDepositDelta(store, entry, decoded.token, decoded.amount2)
        return foldSettleRow(store, entry, {
          kind: 'gain',
          master: decoded.master,
          spokeChainId: BigInt(entry.chainId),
          cycle: decoded.cycle,
          token: decoded.token,
          amount: decoded.amount,
          moved: decoded.amount2
        })
      }
      foldFlows(store, entry, (await selfOf(store, entry)).owner, deltas, true)
      return foldSettle(store, entry, decoded)
    case ACCOUNT_CALL_MAP.HubGate.drawMaster.selector:
      if (isLossRecord(decoded)) {
        await applyBondDelta(store, entry, bondTokenOf(entry.chainId as ChainId), -decoded.loss)
        return foldSettleRow(store, entry, {
          kind: 'loss',
          master: decoded.master,
          spokeChainId: decoded.spokeChainId,
          cycle: decoded.cycle,
          token: bondTokenOf(entry.chainId as ChainId),
          amount: decoded.amount,
          moved: decoded.loss
        })
      }
      foldFlows(store, entry, (await selfOf(store, entry)).owner, deltas, true)
      await applyDepositDelta(store, entry, bondTokenOf(entry.chainId as ChainId), decoded.drawn)
      return foldDraw(store, entry, decoded)
  }
  const self = await selfOf(store, entry)
  switch (decoded.selector) {
    case ACCOUNT_CALL_MAP.CoreGate.deposit.selector:
      foldFlows(store, entry, self.owner, deltas, false)
      await applyDepositDelta(store, entry, decoded.token, decoded.amount)
      return
    case ACCOUNT_CALL_MAP.HubGate.deposit.selector: {
      const flows = new Map(deltas)
      flows.set(decoded.token, (flows.get(decoded.token) ?? 0n) + decoded.bond)
      foldFlows(store, entry, self.owner, flows, false)
      await applyDepositDelta(store, entry, decoded.token, decoded.amount - decoded.bond)
      await applyBondDelta(store, entry, decoded.token, decoded.bond)
      return
    }
    case ACCOUNT_CALL_MAP.Deposit.depositAcross.selector:
      foldFlows(store, entry, self.owner, deltas, false)
      return
    case ACCOUNT_CALL_MAP.Deposit.settleCredit.selector:
      foldFlows(store, entry, self.owner, deltas, false)
      await applyDepositDelta(store, entry, decoded.token, decoded.arrived)
      return
    case ACCOUNT_CALL_MAP.CoreGate.withdraw.selector:
      foldFlows(store, entry, self.owner, deltas, false)
      return
    case ACCOUNT_CALL_MAP.AccountModule.forcedWithdrawal.selector:
      foldFlows(store, entry, self.owner, deltas, false)
      return
    case ACCOUNT_CALL_MAP.HubGate.mandate.selector: {
      const bondToken = bondTokenOf(entry.chainId as ChainId)
      const flows = new Map(deltas)
      flows.set(bondToken, (flows.get(bondToken) ?? 0n) + decoded.bond)
      foldFlows(store, entry, self.owner, flows, false)
      for (const [i, token] of decoded.creditList.entries()) {
        await applyDepositDelta(store, entry, token, decoded.amountList[i] ?? 0n)
      }
      await applyBondDelta(store, entry, bondToken, decoded.bond)
      return foldMandate(store, entry, decoded)
    }
    case ACCOUNT_CALL_MAP.HubGate.unbond.selector: {
      const bondToken = bondTokenOf(entry.chainId as ChainId)
      const flows = new Map(deltas)
      flows.set(bondToken, (flows.get(bondToken) ?? 0n) - decoded.amount)
      foldFlows(store, entry, self.owner, flows, false)
      await applyDepositDelta(store, entry, bondToken, decoded.amount)
      await applyBondDelta(store, entry, bondToken, -decoded.amount)
      return
    }
    default:
      throw new Error(`entry ${where(entry)} carries selector ${(decoded as { selector: Hex }).selector}, which the fold does not know`)
  }
}

export const FOLD_SOURCE: string = [
  entryIdOf,
  bookIdOf,
  backerIdOf,
  markIdOf,
  holdingIdOf,
  settlementIdOf,
  mandateIdOf,
  where,
  receiptRecords,
  isBackingRecord,
  isGainRecord,
  isLossRecord,
  verifyPuppetOrder,
  verifyPayoutLeg,
  applyBalanceDelta,
  applyBondDelta,
  applyDepositDelta,
  ledgerOf,
  backerLedgerOf,
  selfOf,
  foldFlows,
  bookBackers,
  puppetValueOf,
  sealMark,
  lastMarkOf,
  foldOperate,
  foldBacking,
  foldSettle,
  foldDraw,
  foldSettleRow,
  foldMandate,
  foldAccountEntry,
  foldEntry,
  foldPending,
  applyOperate
]
  .map(f => f.toString())
  .join('\n')
