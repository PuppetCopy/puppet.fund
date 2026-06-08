import { CompactError } from '../compact/index.js'

export const BRIDGE_MAX_SLIPPAGE_BPS = 100n

export function verifyBridgeQuoteRatio(outputAmount: bigint, expectedOutputAmount: bigint | null): void {
  if (expectedOutputAmount === null || expectedOutputAmount === 0n) return
  const floor = (expectedOutputAmount * (10_000n - BRIDGE_MAX_SLIPPAGE_BPS)) / 10_000n
  if (outputAmount < floor) {
    throw new CompactError('BAD_REQUEST', `bridge output ${outputAmount} below slippage floor ${floor}`)
  }
}
