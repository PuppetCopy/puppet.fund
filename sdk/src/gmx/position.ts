import { BASIS_POINTS, FLOAT_PRECISION } from '@puppet/contracts/const'
import { FUNDING_RATE_PRECISION } from '../const/common.js'
import { factor, toBasisPoints } from '../core/math.js'
import { formatFixed } from '../core/parse.js'
import { easeInExpo } from '../core/utils.js'

export function getPnL(isLong: boolean, entryPrice: bigint, priceChange: bigint, size: bigint) {
  if (size === 0n) return 0n
  const priceDelta = isLong ? priceChange - entryPrice : entryPrice - priceChange
  return (size * priceDelta) / entryPrice
}

export function getDeltaPercentage(delta: bigint, collateral: bigint) {
  return factor(delta, collateral)
}

export function getNextAveragePrice(isLong: boolean, size: bigint, nextPrice: bigint, pnl: bigint, sizeDelta: bigint) {
  const nextSize = size + sizeDelta
  const divisor = isLong ? nextSize + pnl : nextSize + -pnl
  return (nextPrice * nextSize) / divisor
}

export function getFundingFee(entryFundingRate: bigint, cumulativeFundingRate: bigint, size: bigint) {
  if (size === 0n) return 0n
  const fundingRate = cumulativeFundingRate - entryFundingRate
  return (size * fundingRate) / FUNDING_RATE_PRECISION
}

export function liquidationWeight(isLong: boolean, liquidationPrice: bigint, markPrice: bigint) {
  const weight = isLong ? toBasisPoints(liquidationPrice, markPrice) : toBasisPoints(markPrice, liquidationPrice)
  const value = easeInExpo(formatFixed(4, weight))
  return value > 1 ? 1 : value
}

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
 * Calculate the remaining collateral in USD after PnL and fees.
 *
 * @param collateralUsd - Collateral value in USD (30 decimals)
 * @param pnlUsd - Position PnL in USD (30 decimals)
 * @param feesUsd - Total fees in USD (30 decimals)
 * @returns Remaining collateral in USD (30 decimals)
 */
export function getRemainingCollateralUsd(collateralUsd: bigint, pnlUsd: bigint, feesUsd: bigint): bigint {
  return collateralUsd + pnlUsd - feesUsd
}

/**
 * Calculate the net value of a position.
 *
 * @param collateralUsd - Collateral value in USD
 * @param pnlUsd - Position PnL in USD
 * @param pendingFundingFeesUsd - Pending funding fees
 * @param pendingBorrowingFeesUsd - Pending borrowing fees
 * @param closingFeeUsd - Fee to close position
 * @returns Net position value in USD
 */
export function getPositionNetValue(
  collateralUsd: bigint,
  pnlUsd: bigint,
  pendingFundingFeesUsd: bigint,
  pendingBorrowingFeesUsd: bigint,
  closingFeeUsd: bigint
): bigint {
  const totalFeesUsd = pendingFundingFeesUsd + pendingBorrowingFeesUsd + closingFeeUsd
  return collateralUsd + pnlUsd - totalFeesUsd
}

/**
 * Calculate the liquidation price for a position.
 *
 * Liquidation occurs when remainingCollateralUsd < minCollateralUsd
 *
 * For longs: liqPrice = (sizeInUsd + feesUsd + minCollateralUsd - collateralUsd) / sizeInTokens
 * For shorts: liqPrice = (collateralUsd + sizeInUsd - feesUsd - minCollateralUsd) / sizeInTokens
 *
 * @param isLong - Position direction
 * @param sizeInUsd - Position size in USD (30 decimals)
 * @param sizeInTokens - Position size in index tokens (token decimals)
 * @param collateralUsd - Collateral value in USD (30 decimals)
 * @param feesUsd - Total fees to close position (30 decimals)
 * @param minCollateralFactor - Min collateral factor (30 decimals, e.g., 0.01e30 = 1%)
 * @returns Liquidation price (30 decimals), 0 if position cannot be liquidated
 */
export function getLiquidationPrice(
  isLong: boolean,
  sizeInUsd: bigint,
  sizeInTokens: bigint,
  collateralUsd: bigint,
  feesUsd: bigint,
  minCollateralFactor: bigint
): bigint {
  if (sizeInTokens === 0n) return 0n

  const minCollateralUsd = (sizeInUsd * minCollateralFactor) / FLOAT_PRECISION

  if (isLong) {
    const numerator = sizeInUsd + feesUsd + minCollateralUsd - collateralUsd
    if (numerator <= 0n) return 0n
    return (numerator * FLOAT_PRECISION) / sizeInTokens
  } else {
    const numerator = collateralUsd + sizeInUsd - feesUsd - minCollateralUsd
    if (numerator <= 0n) return 0n
    return (numerator * FLOAT_PRECISION) / sizeInTokens
  }
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

  return (sizeInUsd * BASIS_POINTS) / remainingCollateralUsd
}
