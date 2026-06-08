export function usdToBase(usd1e30: bigint, basePriceUsd: bigint): bigint {
  if (basePriceUsd === 0n) return 0n
  return usd1e30 / basePriceUsd
}

export function baseToUsd(baseWei: bigint, basePriceUsd: bigint): bigint {
  return baseWei * basePriceUsd
}
