import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { formatFixed, getTokenDescription } from '@puppet/sdk/core'
import { VALUE_KEY } from '@puppet/sdk/evaluate'
import { flowTable, type IBookRow } from '@puppet/sdk/schema'
import { chainTokenOfKey } from '@puppet/sdk/state'
import { type Address, getAddress } from 'viem'
import { client, fetchMarks, fetchSettlements } from './reads.js'
import type { ITimelinePoint } from './traders.js'

interface IValueEvent {
  time: number
  order: number
  ledger: string
  absolute: boolean
  settlement: boolean
  value: bigint
}

const ledgerOf = (chainId: bigint, account: Address): string => `${chainId}:${getAddress(account)}`

const TICKS = 280

interface ILedgerPoint {
  time: number
  total: bigint
  flowed: bigint
}

async function ledgerPoints(accounts: readonly Address[], books: readonly IBookRow[]): Promise<ILedgerPoint[]> {
  const [flows, marks, settlements] = await Promise.all([
    client.select(flowTable, { where: { account: { in: accounts } }, orderBy: { col: 'blockTimestamp', dir: 'asc' } }),
    Promise.all(books.map(b => fetchMarks(b.id))).then(lists => lists.flat()),
    Promise.all(accounts.map(account => fetchSettlements({ master: account }))).then(lists => lists.flat())
  ])
  const events: IValueEvent[] = [
    ...flows
      .filter(f => !f.pending && f.value !== undefined)
      .map(f => ({
        time: f.blockTimestamp,
        order: f.logIndex,
        ledger: ledgerOf(f.chainId, f.account),
        absolute: false,
        settlement: f.settlement,
        value: f.value!
      })),
    ...marks
      .filter(m => !m.pending && m.closeValue !== undefined)
      .map(m => ({ time: m.blockTimestamp, order: m.logIndex, ledger: ledgerOf(m.chainId, m.master), absolute: true, settlement: false, value: m.closeValue! })),
    ...settlements
      .filter(s => s.value !== undefined)
      .map(s => ({
        time: s.blockTimestamp,
        order: Number.MAX_SAFE_INTEGER,
        ledger: ledgerOf(s.spokeChainId, s.master),
        absolute: true,
        settlement: true,
        value: s.value!
      }))
  ].sort((a, b) => a.time - b.time || a.order - b.order)
  const marked = new Map<string, bigint>()
  const flowed = new Map<string, bigint>()
  const points: ILedgerPoint[] = []
  let contributed = 0n
  for (const e of events) {
    if (e.absolute) {
      marked.set(e.ledger, e.value)
      flowed.set(e.ledger, 0n)
    } else {
      flowed.set(e.ledger, (flowed.get(e.ledger) ?? 0n) + e.value)
      if (!e.settlement) contributed += e.value
    }
    let total = 0n
    for (const ledger of new Set([...marked.keys(), ...flowed.keys()])) {
      total += (marked.get(ledger) ?? 0n) + (flowed.get(ledger) ?? 0n)
    }
    const last = points[points.length - 1]
    if (last && last.time === e.time) {
      last.total = total
      last.flowed = contributed
    } else points.push({ time: e.time, total, flowed: contributed })
  }
  return points
}

function resample(
  points: readonly ILedgerPoint[],
  sinceSec: number,
  untilSec: number,
  measure: (p: ILedgerPoint, start: ILedgerPoint) => bigint
): ITimelinePoint[] {
  const decimals = getTokenDescription(HUB_CHAIN_ID, chainTokenOfKey(HUB_CHAIN_ID, VALUE_KEY)).decimals
  const before = points.filter(p => p.time < sinceSec)
  const inside = points.filter(p => p.time >= sinceSec)
  const start: ILedgerPoint = before.length ? before[before.length - 1]! : { time: sinceSec, total: 0n, flowed: 0n }
  const interval = Math.max(1, Math.floor((untilSec - sinceSec) / TICKS))
  let current = start
  let next = 0
  const series: ITimelinePoint[] = []
  for (let t = sinceSec; t < untilSec; t += interval) {
    while (next < inside.length && inside[next]!.time <= t) current = inside[next++]!
    series.push({ time: t, value: formatFixed(decimals, measure(current, start)) })
  }
  while (next < inside.length) current = inside[next++]!
  series.push({ time: untilSec, value: formatFixed(decimals, measure(current, start)) })
  return series
}

export const flatTimeline = (sinceSec: number, untilSec: number): ITimelinePoint[] => resample([], sinceSec, untilSec, () => 0n)

export async function walletTimeline(
  accounts: readonly Address[],
  books: readonly IBookRow[],
  sinceSec: number,
  untilSec: number
): Promise<ITimelinePoint[]> {
  return resample(await ledgerPoints(accounts, books), sinceSec, untilSec, p => p.total)
}
