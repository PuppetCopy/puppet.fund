import { PRECISION } from '@puppet/contracts/const'

/**
 * Calculate the PnL in USD for a position.
 *
 * For longs: pnl = (sizeInTokens * markPrice) - sizeInUsd
 * For shorts: pnl = sizeInUsd - (sizeInTokens * markPrice)
 *
 * @param isLong - Position direction
 * @param sizeInUsd - Position size in USD (30 decimals)
 * @param sizeInTokens - Position size in index tokens (token decimals)
 * @param markPrice - Current index token price (30 decimals)
 * @returns PnL in USD (30 decimals), positive = profit, negative = loss
 */
export function getPositionPnlUsd(isLong: boolean, sizeInUsd: bigint, sizeInTokens: bigint, markPrice: bigint): bigint {
  if (sizeInTokens === 0n) return 0n

  const positionValueUsd = markPrice * sizeInTokens
  return isLong ? positionValueUsd - sizeInUsd : sizeInUsd - positionValueUsd
}

/**
 * Calculate leverage factor in basis points.
 *
 * @param sizeInUsd - Position size in USD
 * @param collateralUsd - Collateral value in USD
 * @param pnlUsd - Position PnL in USD
 * @param pendingFundingFeesUsd - Pending funding fees
 * @param pendingBorrowingFeesUsd - Pending borrowing fees
 * @returns Leverage in basis points (e.g., 100000 = 10x)
 */
export function getLeverageFactor(
  sizeInUsd: bigint,
  collateralUsd: bigint,
  pnlUsd: bigint,
  pendingFundingFeesUsd: bigint,
  pendingBorrowingFeesUsd: bigint
): bigint {
  const totalPendingFeesUsd = pendingFundingFeesUsd + pendingBorrowingFeesUsd
  const remainingCollateralUsd = collateralUsd + pnlUsd - totalPendingFeesUsd

  if (remainingCollateralUsd <= 0n) return 0n

  return (sizeInUsd * PRECISION.basisPoints) / remainingCollateralUsd
}
