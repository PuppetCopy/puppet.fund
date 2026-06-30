import { PRECISION } from '@puppet/contracts/const'

// The USD value scale, single-sourced from the generated protocol constant (const.toml ->
// PRECISION.floatPrecisionExp = 10^N). Value-domain math should use the bigint PRECISION.floatPrecisionExp
// directly (no Number round-trip); USD_PRICE_DECIMALS is its exponent N, needed only at the display /
// formatUnits boundary. floatPrecisionExp is a power of 10 by construction, so its digit count is N + 1.
export const USD_PRICE_DECIMALS = PRECISION.floatPrecisionExp.toString().length - 1

// GMX positions are denominated in GMX's intrinsic USD (1e30). To express them in the fund's base token we
// divide by the base token's price in that same USD scale, which the evaluator sources from the base/USDC
// market (USDC is the dollar-proxy for GMX's USD). The result is base-token wei; no USD ever leaves this hop.
export function usdToBase(usd1e30: bigint, basePriceUsd: bigint): bigint {
  if (basePriceUsd === 0n) return 0n
  return usd1e30 / basePriceUsd
}
