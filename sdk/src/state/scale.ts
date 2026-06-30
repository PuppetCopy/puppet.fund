import { applyDecay, getDecayBps, PLATFORM_STAT_INTERVAL } from './metricMath.js'

export const BADGE_INTERVAL = PLATFORM_STAT_INTERVAL[PLATFORM_STAT_INTERVAL.length - 1]

export const PLATFORM_SCALE_ID = 'global'

export const decayMax = (max: bigint, elapsed: number): bigint => applyDecay(max, getDecayBps(BADGE_INTERVAL, elapsed))

export const raiseMax = (max: bigint, elapsed: number, value: bigint): bigint => {
  const decayed = decayMax(max, elapsed)
  return value > decayed ? value : decayed
}

export const scalePercentile = (value: bigint, max: bigint): number => {
  if (max <= 0n || value <= 0n) return 0
  if (value >= max) return 1
  return Number((value * 1_000_000n) / max) / 1_000_000
}
