import { CompactError } from '../compact/index.js'

export const SWAP_MAX_SLIPPAGE_BPS = 100n

export function verifySwapQuoteRatio(outputAmount: bigint, expectedOutputAmount: bigint | null): void {
  // null is a deliberate skip (puppet routes that pre-checked their own output); a
  // non-positive quote is NOT a skip — it would silently disable the floor, so reject it.
  if (expectedOutputAmount === null) return
  if (expectedOutputAmount <= 0n) {
    throw new CompactError('BAD_REQUEST', 'swap rate quote is unusable (non-positive expected output)')
  }
  const floor = (expectedOutputAmount * (10_000n - SWAP_MAX_SLIPPAGE_BPS)) / 10_000n
  if (outputAmount < floor) {
    throw new CompactError('BAD_REQUEST', `swap output ${outputAmount} below slippage floor ${floor}`)
  }
}
