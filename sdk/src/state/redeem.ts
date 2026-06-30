import { applyFactor } from '../core/math.js'
import type { IFund, IFundPosition } from '../schema/index.js'

export function computeClaimable(position: IFundPosition | undefined, pool: IFund | undefined): bigint {
  if (!position || !pool || position.weight === 0n) return 0n
  const rate = position.epoch < pool.epoch ? position.closedAccruedPerWeight : pool.accruedPerWeight
  return rate <= position.cursor ? 0n : applyFactor(rate - position.cursor, position.weight)
}

export function computeQueuedShares(position: IFundPosition | undefined, pool: IFund | undefined): bigint {
  if (!position || !pool || position.weight === 0n || pool.weight === 0n || position.epoch < pool.epoch) return 0n
  return (position.weight * pool.queuedShares) / pool.weight
}
