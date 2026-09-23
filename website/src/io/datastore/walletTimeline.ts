import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { formatFixed, getTokenDescription } from '@puppet/sdk/core'
import { VALUE_KEY } from '@puppet/sdk/evaluate'
import { flowTable } from '@puppet/sdk/schema'
import { chainTokenOfKey } from '@puppet/sdk/state'
import type { Address } from 'viem'
import { client } from './reads.js'
import type { ITimelinePoint } from './traders.js'

const TICKS = 280

export interface ILedgerPoint {
  time: number
  total: bigint
}

async function ledgerPoints(owners: readonly Address[]): Promise<ILedgerPoint[]> {
  const flows = await client.select(flowTable, { where: { owner: { in: owners } }, orderBy: { col: 'blockTimestamp', dir: 'asc' } })
  const points: ILedgerPoint[] = []
  let total = 0n
  for (const f of flows) {
    if (f.pending || f.value === undefined) continue
    total += f.value
    const last = points[points.length - 1]
    if (last && last.time === f.blockTimestamp) last.total = total
    else points.push({ time: f.blockTimestamp, total })
  }
  return points
}

export function resample(points: readonly ILedgerPoint[], sinceSec: number, untilSec: number): ITimelinePoint[] {
  const decimals = getTokenDescription(HUB_CHAIN_ID, chainTokenOfKey(HUB_CHAIN_ID, VALUE_KEY)).decimals
  const before = points.filter(p => p.time < sinceSec)
  const inside = points.filter(p => p.time >= sinceSec)
  let current: ILedgerPoint = before.length ? before[before.length - 1]! : { time: sinceSec, total: 0n }
  const interval = Math.max(1, Math.floor((untilSec - sinceSec) / TICKS))
  let next = 0
  const series: ITimelinePoint[] = []
  for (let t = sinceSec; t < untilSec; t += interval) {
    while (next < inside.length && inside[next]!.time <= t) current = inside[next++]!
    series.push({ time: t, value: formatFixed(decimals, current.total) })
  }
  while (next < inside.length) current = inside[next++]!
  series.push({ time: untilSec, value: formatFixed(decimals, current.total) })
  return series
}

export const flatTimeline = (sinceSec: number, untilSec: number): ITimelinePoint[] => resample([], sinceSec, untilSec)

export async function walletTimeline(owners: readonly Address[], sinceSec: number, untilSec: number): Promise<ITimelinePoint[]> {
  return resample(await ledgerPoints(owners), sinceSec, untilSec)
}
