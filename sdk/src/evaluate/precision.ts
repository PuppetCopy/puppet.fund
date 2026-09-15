import { PRECISION } from '@puppet/contracts/const'

export const USD_PRICE_DECIMALS = PRECISION.floatPrecisionExp.toString().length - 1

export function usdToBase(usd1e30: bigint, basePriceUsd: bigint): bigint {
  if (basePriceUsd === 0n) return 0n
  return usd1e30 / basePriceUsd
}

export function usdPriceFromRate(rate: { token0: bigint; token1: bigint }, quoteDecimals: number): bigint {
  if (rate.token1 === 0n) return 0n
  return (rate.token0 * 10n ** BigInt(USD_PRICE_DECIMALS - quoteDecimals)) / rate.token1
}
