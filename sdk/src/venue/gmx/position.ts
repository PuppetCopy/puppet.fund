import { PRECISION } from '@puppet/contracts/const'

export function getPositionPnlUsd(isLong: boolean, sizeInUsd: bigint, sizeInTokens: bigint, markPrice: bigint): bigint {
  if (sizeInTokens === 0n) return 0n

  const positionValueUsd = markPrice * sizeInTokens
  return isLong ? positionValueUsd - sizeInUsd : sizeInUsd - positionValueUsd
}

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
