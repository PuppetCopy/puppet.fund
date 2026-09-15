import { PRECISION } from '@puppet/contracts/const'

export const PNL_SLOT_COUNT = 200

export function getDecayBps(interval: number, elapsed: number): bigint {
  if (elapsed <= 0) return 0n
  if (elapsed >= interval) return PRECISION.basisPoints
  return BigInt(Math.floor((elapsed / interval) * 10_000))
}

export function applyDecay(value: bigint, decayBps: bigint): bigint {
  if (decayBps >= PRECISION.basisPoints) return 0n
  return value - (decayBps * value) / PRECISION.basisPoints
}

export function windowPnlSeries(
  priorPnlList: readonly bigint[],
  priorTimestampList: readonly number[],
  periodPnl: bigint,
  time: number,
  interval: number
): { pnlList: bigint[]; pnlTimestampList: number[] } {
  const slotSize = Math.max(1, Math.ceil(interval / PNL_SLOT_COUNT))
  const slot = Math.floor(time / slotSize) * slotSize
  const cutoff = time - interval
  const pnlList: bigint[] = []
  const pnlTimestampList: number[] = []
  for (let i = 0; i < priorPnlList.length; i++) {
    if (priorTimestampList[i]! >= cutoff) {
      pnlList.push(priorPnlList[i]!)
      pnlTimestampList.push(priorTimestampList[i]!)
    }
  }
  if (periodPnl !== 0n) {
    const at = pnlTimestampList.indexOf(slot)
    if (at >= 0) pnlList[at] = pnlList[at]! + periodPnl
    else {
      pnlList.push(periodPnl)
      pnlTimestampList.push(slot)
    }
  }
  return { pnlList, pnlTimestampList }
}
