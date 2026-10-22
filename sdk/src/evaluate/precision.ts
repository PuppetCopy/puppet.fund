import { PRECISION } from '../const/common.js'

export const USD_PRICE_DECIMALS = PRECISION.floatPrecisionExp.toString().length - 1

export function usdPriceFromRate(rate: { token0: bigint; token1: bigint }, quoteDecimals: number): bigint {
  if (rate.token1 === 0n) throw new Error('a rate with a zero denominator prices nothing')
  return (rate.token0 * 10n ** BigInt(USD_PRICE_DECIMALS - quoteDecimals)) / rate.token1
}
