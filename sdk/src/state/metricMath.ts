import { TOKEN_META } from '../const/network.js'
import { formatFixed } from '../core/parse.js'
import type { IFundMetricRow } from '../schema/index.js'

export const PNL_SLOT_COUNT = 200

export function windowPnlSeries(
  priorPnlList: readonly bigint[],
  priorIndexList: readonly bigint[],
  priorTimestampList: readonly number[],
  priorOpening: bigint,
  periodPnl: bigint,
  index: bigint | null,
  time: number,
  interval: number
): { pnlList: bigint[]; performanceIndexList: bigint[]; pnlTimestampList: number[]; openingIndex: bigint } {
  if (priorIndexList.length !== priorPnlList.length || priorTimestampList.length !== priorPnlList.length) {
    throw new Error(`metric slots are misaligned: ${priorPnlList.length} PnL, ${priorIndexList.length} index and ${priorTimestampList.length} timestamp entries`)
  }
  const slotSize = Math.max(1, Math.ceil(interval / PNL_SLOT_COUNT))
  const slot = Math.floor(time / slotSize) * slotSize
  const cutoff = time - interval
  const pnlList: bigint[] = []
  const performanceIndexList: bigint[] = []
  const pnlTimestampList: number[] = []
  let openingIndex = priorOpening
  for (let i = 0; i < priorPnlList.length; i++) {
    if (priorTimestampList[i]! >= cutoff) {
      pnlList.push(priorPnlList[i]!)
      performanceIndexList.push(priorIndexList[i]!)
      pnlTimestampList.push(priorTimestampList[i]!)
    } else {
      openingIndex = priorIndexList[i]!
    }
  }
  if (periodPnl === 0n && index === null) return { pnlList, performanceIndexList, pnlTimestampList, openingIndex }
  const at = pnlTimestampList.indexOf(slot)
  if (at >= 0) {
    pnlList[at] = pnlList[at]! + periodPnl
    if (index !== null) performanceIndexList[at] = index
    return { pnlList, performanceIndexList, pnlTimestampList, openingIndex }
  }
  if (index === null) throw new Error(`a PnL of ${periodPnl} at ${time} opens a metric slot with no performance index`)
  pnlList.push(periodPnl)
  performanceIndexList.push(index)
  pnlTimestampList.push(slot)
  return { pnlList, performanceIndexList, pnlTimestampList, openingIndex }
}

export function windowVenueSeries(
  priorVenueList: readonly string[],
  priorTimeList: readonly number[],
  venue: string,
  time: number,
  interval: number
): { venueList: string[]; venueTimeList: number[] } {
  const cutoff = time - interval
  const venueList: string[] = []
  const venueTimeList: number[] = []
  let last = time
  for (let i = 0; i < priorVenueList.length; i++) {
    if (priorVenueList[i] === venue) last = Math.max(last, priorTimeList[i]!)
    else if (priorTimeList[i]! >= cutoff) {
      venueList.push(priorVenueList[i]!)
      venueTimeList.push(priorTimeList[i]!)
    }
  }
  venueList.push(venue)
  venueTimeList.push(last)
  return { venueList, venueTimeList }
}

const slotOf = (interval: number): number => Math.max(1, Math.ceil(interval / PNL_SLOT_COUNT))

export const pnlEventsOf = (row: Pick<IFundMetricRow, 'interval' | 'pnlList' | 'pnlTimestampList' | 'lastUpdatedTimestamp'>) => {
  const size = slotOf(row.interval)
  return row.pnlTimestampList.map((slot, k) => ({ slot, time: Math.min(slot + size, row.lastUpdatedTimestamp), delta: row.pnlList[k]! }))
}

export function pnlEventsAcross(rows: readonly IFundMetricRow[], interval: number) {
  const [own, ...finer] = rows.filter(row => row.interval <= interval).sort((a, b) => b.interval - a.interval)
  if (own === undefined) return []
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const eventsOf = (row: IFundMetricRow) => pnlEventsOf(row).map((event, k) => ({ ...event, index: row.performanceIndexList[k]! }))
  let events = eventsOf(own)
  let grid = slotOf(own.interval)
  let floor = -Infinity
  for (const row of finer) {
    const size = slotOf(row.interval)
    const covered = Math.ceil((row.lastUpdatedTimestamp - row.interval) / size) * size
    if (events.every(event => event.slot >= covered)) {
      events = eventsOf(row)
      grid = size
      continue
    }
    const step = (grid / gcd(grid, size)) * size
    const edge = Math.ceil(Math.max(covered, floor) / step) * step
    if (edge >= row.lastUpdatedTimestamp) continue
    events = [...events.filter(event => event.time <= edge), ...eventsOf(row).filter(event => event.time > edge)]
    grid = size
    floor = edge
  }
  return events
}

export function fundMetric(pnlEvents: readonly { time: number; delta: bigint }[], interval: number, sinceSec: number, untilSec: number, samples: number) {
  const step = Math.max(1, Math.ceil(interval / samples))
  const events = pnlEvents.filter(event => event.time > sinceSec).sort((a, b) => a.time - b.time)
  let cum = 0n
  let next = 0
  const points: { time: number; value: number }[] = [{ time: sinceSec, value: 0 }]
  for (let t = sinceSec + step; t < untilSec; t += step) {
    while (next < events.length && events[next]!.time <= t) cum += events[next++]!.delta
    points.push({ time: t, value: formatFixed(TOKEN_META.WETH.decimals, cum) })
  }
  while (next < events.length) cum += events[next++]!.delta
  points.push({ time: untilSec, value: formatFixed(TOKEN_META.WETH.decimals, cum) })
  return { pnl: cum, points }
}
