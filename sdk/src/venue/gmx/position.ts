export function getPositionPnlUsd(isLong: boolean, sizeInUsd: bigint, sizeInTokens: bigint, markPrice: bigint): bigint {
  if (sizeInTokens === 0n) return 0n

  const positionValueUsd = markPrice * sizeInTokens
  return isLong ? positionValueUsd - sizeInUsd : sizeInUsd - positionValueUsd
}
