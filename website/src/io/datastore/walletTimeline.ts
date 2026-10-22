import type { ITimelinePoint } from './traders.js'

const TICKS = 280

export function resample(points: readonly ITimelinePoint[], sinceSec: number, untilSec: number, samples: number): ITimelinePoint[] {
  const before = points.filter(p => p.time < sinceSec)
  const inside = points.filter(p => p.time >= sinceSec)
  let current: ITimelinePoint = before.length ? before[before.length - 1]! : { time: sinceSec, value: 0 }
  const interval = Math.max(1, Math.floor((untilSec - sinceSec) / samples))
  let next = 0
  const series: ITimelinePoint[] = []
  for (let t = sinceSec; t < untilSec; t += interval) {
    while (next < inside.length && inside[next]!.time <= t) current = inside[next++]!
    series.push({ time: t, value: current.value })
  }
  while (next < inside.length) current = inside[next++]!
  series.push({ time: untilSec, value: current.value })
  return series
}

export const flatTimeline = (sinceSec: number, untilSec: number): ITimelinePoint[] => resample([], sinceSec, untilSec, TICKS)
