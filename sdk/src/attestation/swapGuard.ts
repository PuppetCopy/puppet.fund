import { CompactContractError } from '../compact/error.js'
import { CompactError } from '../compact/index.js'

export const SWAP_MAX_SLIPPAGE_BPS = 100n

export function verifySwapQuoteRatio(outputAmount: bigint, expectedOutputAmount: bigint | null): void {
  if (expectedOutputAmount === null) return
  if (expectedOutputAmount <= 0n) {
    throw new CompactError('BAD_REQUEST', 'swap rate quote is unusable (non-positive expected output)')
  }
  const floor = (expectedOutputAmount * (10_000n - SWAP_MAX_SLIPPAGE_BPS)) / 10_000n
  if (outputAmount < floor) {
    throw new CompactError('BAD_REQUEST', `swap output ${outputAmount} below slippage floor ${floor}`)
  }
}

export function verifyQuoteFreshness(expires: number, fillDeadline: number): void {
  const nowSec = Math.floor(Date.now() / 1000)
  if (expires <= nowSec) {
    throw new CompactError('STALE_QUOTE', `swap quote expired (expires ${expires} in the past)`)
  }
  if (fillDeadline > expires) {
    throw new CompactError('BAD_REQUEST', `fillDeadline ${fillDeadline} exceeds expires ${expires}`)
  }
}

export function verifyOutputFloor(outputAmount: bigint, expectedOutputAmount: bigint | null): void {
  if (outputAmount === 0n) {
    throw new CompactContractError('Balance__ZeroSwapOutput', [])
  }
  verifySwapQuoteRatio(outputAmount, expectedOutputAmount)
}

interface ISwapBounds {
  inputAmount: bigint
  acceptableRelayFee: bigint
  outputAmount: bigint
}

interface ISwapBoundsContext {
  sourceBalance: bigint
  expectedOutputAmount: bigint | null
}

export function verifySwapBounds(bounds: ISwapBounds, ctx: ISwapBoundsContext): void {
  if (ctx.sourceBalance < bounds.inputAmount) {
    throw new CompactContractError('Balance__InsufficientBalance', [ctx.sourceBalance, bounds.inputAmount])
  }
  if (bounds.acceptableRelayFee >= bounds.inputAmount) {
    throw new CompactContractError('Balance__RelayFeeTooHigh', [])
  }
  verifyOutputFloor(bounds.outputAmount, ctx.expectedOutputAmount)
}
