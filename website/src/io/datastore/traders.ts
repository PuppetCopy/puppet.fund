import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { ChainId } from '@puppet/sdk/const'
import { formatFixed, getTokenDescription } from '@puppet/sdk/core'
import { type IGmxPositionRow, VALUE_KEY } from '@puppet/sdk/evaluate'
import { bookIdOf } from '@puppet/sdk/fold'
import { GMX_V2_CHAIN_ID, makeOnchainGmxPositionProvider } from '@puppet/sdk/gmx'
import type { IBackerRow, IBookRow, IMasterMetricRow, ISettlementRow } from '@puppet/sdk/schema'
import { accountTable, backingTable, settleRowTable } from '@puppet/sdk/schema'
import { chainTokenOfKey, PNL_SLOT_COUNT } from '@puppet/sdk/state'
import { type Address, getAddress, type PublicClient } from 'viem'
import { publicClientMap } from '../../wallet/index.js'
import { getRate } from '../context.js'
import type { IAccountAction } from '../journal/history.js'
import { client, fetchAllBooks, fetchBackings, fetchBooks, fetchMarks, fetchSettlements } from './reads.js'
import { type ITradeView, tradeViews } from './trading.js'
import { walletTimeline } from './walletTimeline.js'

export interface ICycleOutcome {
  opening: bigint
  pnl: bigint
}

export interface ITraderView {
  master: Address
  createdAt: number | null
  books: ITradeView[]
  backers: IBackerRow[]
  settlements: ISettlementRow[]
  outcomes: Map<string, ICycleOutcome | null>
}

export async function traderView(master: Address): Promise<ITraderView | undefined> {
  const books = await fetchBooks({ master })
  if (books.length === 0) return undefined
  const [views, backers, settlements, accounts] = await Promise.all([
    tradeViews(books),
    fetchBackings({ master }),
    fetchSettlements({ master }),
    client.select(accountTable, { where: { account: master } })
  ])
  const marksByBook = new Map(await Promise.all(views.map(async b => [b.book.id, await fetchMarks(b.book.id)] as const)))
  const outcomes = new Map(
    settlements.map(s => {
      const marks = (marksByBook.get(bookIdOf(Number(s.spokeChainId) as ChainId, s.master)) ?? [])
        .filter(m => m.cycle === s.cycle)
        .sort((a, b) => a.block - b.block || a.logIndex - b.logIndex)
      const opening = marks[0]
      if (opening === undefined || opening.closeValue === undefined || s.value === undefined) return [s.id, null] as const
      const inflow = marks.reduce((acc, m) => acc + m.inflow, 0n)
      return [s.id, { opening: opening.closeValue, pnl: s.value - opening.closeValue - inflow }] as const
    })
  )
  const created = accounts.map(a => a.createdAt)
  return {
    master: getAddress(master),
    createdAt: created.length === 0 ? null : Math.min(...created),
    books: views,
    backers: backers.filter(b => b.stake > 0n || b.pending > 0n || b.shares > 0n),
    settlements,
    outcomes
  }
}

export interface ILeaderboardEntry {
  master: Address
  books: IBookRow[]
  settledCycle: Map<string, bigint>
  settlements: ISettlementRow[]
  backers: number
  createdAt: number | null
}

export async function leaderboardEntries(): Promise<ILeaderboardEntry[]> {
  const books = await fetchAllBooks()
  const masters = [...new Set(books.map(b => getAddress(b.master)))]
  if (masters.length === 0) return []
  const [accounts, settlements] = await Promise.all([
    client.select(accountTable, { where: { account: { in: masters } } }),
    fetchSettlements({ master: { in: masters } })
  ])
  return masters.map(master => {
    const mine = books.filter(b => getAddress(b.master) === master)
    const settled = settlements.filter(s => getAddress(s.master) === master)
    const settledCycle = new Map<string, bigint>()
    for (const s of settled) {
      if (s.kind !== 'settle') continue
      const id = bookIdOf(Number(s.spokeChainId) as ChainId, s.master)
      if (s.cycle > (settledCycle.get(id) ?? 0n)) settledCycle.set(id, s.cycle)
    }
    const created = accounts.filter(a => getAddress(a.account) === master).map(a => a.createdAt)
    return {
      master,
      books: mine,
      settledCycle,
      settlements: settled,
      backers: new Set(mine.flatMap(b => b.backerList.map(u => getAddress(u)))).size,
      createdAt: created.length === 0 ? null : Math.min(...created)
    }
  })
}

export interface ITimelinePoint {
  time: number
  value: number
}

export function traderTimeline(view: ITraderView, sinceSec: number, untilSec: number): Promise<ITimelinePoint[]> {
  return walletTimeline(
    [view.master],
    view.books.map(b => b.book),
    sinceSec,
    untilSec
  )
}

export interface IMasterMetric {
  pnl: bigint
  points: ITimelinePoint[]
}

const VALUE_DECIMALS = getTokenDescription(HUB_CHAIN_ID, chainTokenOfKey(HUB_CHAIN_ID, VALUE_KEY)).decimals

export function masterMetric(rows: readonly IMasterMetricRow[], interval: number, sinceSec: number, untilSec: number): IMasterMetric {
  const slotSize = Math.max(1, Math.ceil(interval / PNL_SLOT_COUNT))
  const slots: { slot: number; pnl: bigint }[] = []
  for (const row of rows) {
    row.pnlTimestampList.forEach((slot, i) => {
      if (slot + slotSize <= sinceSec) return
      slots.push({ slot, pnl: row.pnlList[i]! })
    })
  }
  slots.sort((a, b) => a.slot - b.slot)
  let cum = 0n
  let next = 0
  const points: ITimelinePoint[] = [{ time: sinceSec, value: 0 }]
  for (let t = sinceSec + slotSize; t < untilSec; t += slotSize) {
    while (next < slots.length && slots[next]!.slot < t) cum += slots[next++]!.pnl
    points.push({ time: t, value: formatFixed(VALUE_DECIMALS, cum) })
  }
  while (next < slots.length) cum += slots[next++]!.pnl
  points.push({ time: untilSec, value: formatFixed(VALUE_DECIMALS, cum) })
  return { pnl: cum, points }
}

export async function traderOperations(view: ITraderView): Promise<IAccountAction[]> {
  const master = view.master
  const [backings, settleRows, marksByBook] = await Promise.all([
    client.select(backingTable, { where: { master } }),
    client.select(settleRowTable, { where: { master } }),
    Promise.all(view.books.map(async b => [b.book, await fetchMarks(b.book.id)] as const))
  ])
  const out: IAccountAction[] = []
  for (const [book, marks] of marksByBook) {
    const chainId = Number(book.chainId) as ChainId
    for (const m of marks) {
      const rows = backings.filter(r => Number(r.chainId) === chainId && r.cycle === m.cycle && r.block === m.block && r.transactionHash === m.transactionHash)
      out.push({
        chainId,
        account: master,
        block: BigInt(m.block),
        logIndex: m.logIndex,
        time: m.blockTimestamp,
        txHash: m.transactionHash,
        fee: null,
        kind: 'operate',
        cycle: m.cycle,
        token: getAddress(book.token),
        value: m.openValue,
        collateral: m.collateral,
        skin: book.skin,
        backed: rows.reduce((total, r) => total + r.stake, 0n),
        backers: rows.length,
        steps: [],
        mark: m
      })
    }
  }
  for (const s of view.settlements) {
    const spokeChainId = Number(s.spokeChainId) as ChainId
    const base = { account: master, block: BigInt(s.block), logIndex: s.logIndex, time: s.blockTimestamp, txHash: s.transactionHash, fee: null }
    const rows = settleRows.filter(r => Number(r.spokeChainId) === spokeChainId && r.cycle === s.cycle)
    if (s.kind === 'settle') {
      if (s.token === undefined || s.value === undefined) continue
      out.push({ ...base, chainId: spokeChainId, kind: 'settle', cycle: s.cycle, token: getAddress(s.token), value: s.value, backers: rows.filter(r => r.kind === 'gain').length })
      continue
    }
    out.push({ ...base, chainId: HUB_CHAIN_ID as ChainId, kind: 'draw', spokeChainId: s.spokeChainId, cycle: s.cycle, backers: rows.filter(r => r.kind === 'loss').length })
  }
  return out.sort((a, b) => b.time - a.time || (b.block > a.block ? 1 : b.block < a.block ? -1 : 0) || b.logIndex - a.logIndex)
}

export async function traderPositions(view: ITraderView): Promise<IGmxPositionRow[]> {
  if (!view.books.some(b => Number(b.book.chainId) === GMX_V2_CHAIN_ID)) return []
  const gmxClient = publicClientMap[GMX_V2_CHAIN_ID]
  if (!gmxClient) return []
  return makeOnchainGmxPositionProvider(gmxClient as PublicClient, getRate)(view.master)
}
