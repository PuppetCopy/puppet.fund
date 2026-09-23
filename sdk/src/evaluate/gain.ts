import { PRECISION } from '@puppet/contracts/const'
import { abs, delta, max } from '../core/math.js'
import type { ISignerGain } from './types.js'

const share = (part: bigint, whole: bigint): bigint => (whole === 0n ? 0n : (part * PRECISION.basisPoints) / whole)

export const allocateSignerGain = (input: {
  masterUnits: bigint
  supply: bigint
  masterCredit: bigint
  totalEntering: bigint
}): ISignerGain => ({
  above: share(input.masterUnits, input.supply),
  below: share(input.masterCredit, input.totalEntering)
})

export const redeemSignerGain = (input: {
  masterWeight: bigint
  queueWeight: bigint
  masterUnits: bigint
  remainingUnits: bigint
}): ISignerGain => ({
  above: share(input.masterWeight, input.queueWeight),
  below: share(input.masterUnits, input.remainingUnits)
})

const driftBps = (claimed: bigint, mark: bigint): bigint => {
  const denom = max(abs(claimed), abs(mark))
  return denom === 0n ? 0n : (delta(claimed, mark) * PRECISION.basisPoints) / denom
}

export function driftVerdict(
  claimed: bigint,
  mark: bigint,
  gain: ISignerGain | null,
  bandBps: bigint
): { drift: bigint; allowed: bigint; profits: boolean; above: boolean } {
  const above = claimed > mark
  const profits = gain !== null && (above ? gain.above > gain.below : gain.below > gain.above)
  return { drift: driftBps(claimed, mark), allowed: profits ? 0n : bandBps, profits, above }
}
