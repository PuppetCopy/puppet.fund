import { PRECISION } from '@puppet/contracts/const'

// Fund-leaderboard metric math, lifted into the SDK so the logstore aggregator folds a decayed, time-bucketed
// series directly from the journal. Pure bigint arithmetic, browser-safe.

export const PLATFORM_STAT_INTERVAL = [86400, 604800, 2628000, 7884000, 31536000]
export const PNL_SLOT_COUNT = 200

export function getDecayBps(interval: number, elapsed: number): bigint {
  if (elapsed <= 0) return 0n
  if (elapsed >= interval) return PRECISION.basisPoints
  return BigInt(Math.floor((elapsed / interval) * 10000))
}

export function applyDecay(value: bigint, decayBps: bigint): bigint {
  if (decayBps >= PRECISION.basisPoints) return 0n
  return value - (decayBps * value) / PRECISION.basisPoints
}

// PnL accrued to a fund's existing shareholders over one NAV-update period, in base-token units:
// (newNav - prevNav) * prevSupply / FLOAT_PRECISION. prevNav === 0 marks the seed baseline (not profit) so it is 0n.
export function fundPeriodPnl(prevNav: bigint, newNav: bigint, prevSupply: bigint): bigint {
  if (prevNav === 0n) return 0n
  return ((newNav - prevNav) * prevSupply) / PRECISION.floatPrecisionExp
}

// Per-interval time-bucketed pnl series for the leaderboard sparkline. The window is sliced into PNL_SLOT_COUNT slots
// (slotSize = ceil(interval / PNL_SLOT_COUNT)); events in the current slot accumulate into its single candle, entries
// older than `interval` are pruned, and realisedPnl == sum(slots) so the headline matches the sparkline.
export function windowPnlSeries(
  priorPnlList: readonly bigint[],
  priorTimestampList: readonly number[],
  periodPnl: bigint,
  blockTimestamp: number,
  interval: number
): { pnlList: bigint[]; pnlTimestampList: number[]; realisedPnl: bigint } {
  const slotSize = Math.max(1, Math.ceil(interval / PNL_SLOT_COUNT))
  const slot = Math.floor(blockTimestamp / slotSize) * slotSize
  const cutoff = blockTimestamp - interval
  const pnlList: bigint[] = []
  const pnlTimestampList: number[] = []
  for (let i = 0; i < priorPnlList.length; i++) {
    if (priorTimestampList[i] >= cutoff) {
      pnlList.push(priorPnlList[i])
      pnlTimestampList.push(priorTimestampList[i])
    }
  }
  if (periodPnl !== 0n) {
    const last = pnlList.length - 1
    if (last >= 0 && pnlTimestampList[last] === slot) {
      pnlList[last] += periodPnl
    } else {
      pnlList.push(periodPnl)
      pnlTimestampList.push(slot)
    }
  }
  let realisedPnl = 0n
  for (const p of pnlList) realisedPnl += p
  return { pnlList, pnlTimestampList, realisedPnl }
}
