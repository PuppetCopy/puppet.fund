import { PRECISION } from '../const/common.js'
import { abs, delta, max } from '../core/math.js'
import type { IRedeemPlan } from '../pool/index.js'
import type { ISignerGain } from './types.js'

const share = (part: bigint, whole: bigint): bigint => (whole === 0n ? 0n : (part * PRECISION.basisPoints) / whole)

export const allocateSignerGain = (input: {
  masterShares: bigint
  supply: bigint
  valuation: bigint
  creditValue: bigint
  puppetValue: bigint
  performanceFee: bigint
  protocolFeeShare: bigint
}): { valuation: ISignerGain; price: ISignerGain } => {
  const entering = input.creditValue + input.puppetValue
  const weight = input.valuation + entering
  const price = {
    above: weight === 0n ? 0n : (share(input.masterShares, input.supply) * entering) / weight,
    below: weight === 0n ? 0n : (input.creditValue * PRECISION.basisPoints) / weight
  }
  const fee = weight === 0n ? 0n : (input.performanceFee * (PRECISION.basisPoints - input.protocolFeeShare) * input.puppetValue) / (PRECISION.basisPoints * weight)
  return { valuation: { above: price.above, below: price.below + fee }, price }
}

export const redeemSignerGain = (input: {
  plan: Pick<IRedeemPlan, 'supply' | 'masterShares' | 'masterPart' | 'full' | 'redemption'>
  performanceFee: bigint
  protocolFeeShare: bigint
}): ISignerGain => {
  const { plan } = input
  const whole = plan.supply * PRECISION.basisPoints
  const owed = plan.redemption.owedLeft
  const fee = whole === 0n ? 0n : (input.performanceFee * (PRECISION.basisPoints - input.protocolFeeShare) * owed) / (PRECISION.basisPoints * whole)
  if (plan.full) return { above: fee, below: share(owed, whole) }
  const exiting = owed + plan.masterPart * PRECISION.basisPoints
  return {
    above: share(plan.masterPart, plan.supply) + fee,
    below: ((plan.masterShares - plan.masterPart) * exiting * PRECISION.basisPoints) / (plan.supply * (whole - exiting))
  }
}

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
