import type { Address } from 'viem'
import { CompactError } from '../compact/error.js'
import type { ChainId } from '../const/index.js'
import { symbolOf } from '../state/tokenRegistry.js'
import {
  DEFAULT_EVALUATION_CONFIG,
  type IEvaluationConfig,
  type IGetRate,
  type INavGate,
  type INavGateReason
} from './types.js'
import { assertNavSignable } from './verify.js'

export interface IVenueValueLeg {
  chainId: ChainId
  token: Address
  amount: bigint
}

export interface IEvaluateSwapParams {
  input: IVenueValueLeg
  output: IVenueValueLeg
  nowSec: number
  config?: Partial<IEvaluationConfig>
  getRate: IGetRate
}

export interface IEvaluateCrossChainSwapParams {
  inputAmount: bigint
  outputAmount: bigint
  config?: Partial<IEvaluationConfig>
}

async function evaluateSwapValue(params: IEvaluateSwapParams): Promise<INavGate> {
  const config = { ...DEFAULT_EVALUATION_CONFIG, ...params.config }
  const reasons: INavGateReason[] = []
  const { input, output } = params
  const rate = await params
    .getRate(symbolOf(input.chainId, input.token), symbolOf(output.chainId, output.token), config.maxPriceAgeSec * 1000)
    .catch((e: unknown) => {
      reasons.push({
        code: 'VENUE_PRICE_UNUSABLE',
        detail: `swap ${input.token} -> ${output.token} has no usable direct rate: ${e instanceof Error ? e.message : String(e)}`
      })
      return null
    })
  if (rate) {
    if (params.nowSec - rate.time > config.maxPriceAgeSec) {
      reasons.push({
        code: 'VENUE_PRICE_STALE',
        detail: `swap rate ${params.nowSec - rate.time}s old (max ${config.maxPriceAgeSec}s)`
      })
    } else {
      const expectedOutput = (input.amount * rate.token0) / rate.token1
      const floor = (expectedOutput * (10_000n - config.swapMaxSlippageBps)) / 10_000n
      if (output.amount < floor) {
        reasons.push({
          code: 'VENUE_EXCESS_SLIPPAGE',
          detail: `swap output ${output.amount} below floor ${floor} (expected ${expectedOutput}, ${config.swapMaxSlippageBps}bps)`
        })
      }
    }
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons }
}

function evaluateCrossChainSwapValue(params: IEvaluateCrossChainSwapParams): INavGate {
  const config = { ...DEFAULT_EVALUATION_CONFIG, ...params.config }
  const reasons: INavGateReason[] = []
  if (params.inputAmount <= 0n) {
    reasons.push({
      code: 'VENUE_BAD_INPUT',
      detail: `cross-chain swap input amount ${params.inputAmount} must be positive`
    })
  } else {
    const floor = (params.inputAmount * (10_000n - config.bridgeMaxSlippageBps)) / 10_000n
    if (params.outputAmount < floor) {
      reasons.push({
        code: 'VENUE_EXCESS_SLIPPAGE',
        detail: `cross-chain swap output ${params.outputAmount} below floor ${floor} (input ${params.inputAmount}, ${config.bridgeMaxSlippageBps}bps)`
      })
    }
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons }
}

export async function screenSwapValue(
  swap: {
    routeKind: 'swap' | 'across' | 'acrossSwap'
    chainId: number
    inputToken: Address
    outputToken: Address
    destinationChainId: number
    inputAmount: bigint
    outputAmount: bigint
    relayFee: bigint
  },
  getRate: IGetRate
): Promise<void> {
  if (swap.routeKind === 'across') {
    if (
      symbolOf(swap.chainId as ChainId, swap.inputToken) !==
      symbolOf(swap.destinationChainId as ChainId, swap.outputToken)
    ) {
      throw new CompactError(
        'CROSS_CHAIN_ASSET_MISMATCH',
        `across must bridge the same asset; ${swap.inputToken} and ${swap.outputToken} are different assets`,
        'hard'
      )
    }
    assertNavSignable(
      evaluateCrossChainSwapValue({
        inputAmount: swap.inputAmount - swap.relayFee,
        outputAmount: swap.outputAmount
      })
    )
    return
  }
  assertNavSignable(
    await evaluateSwapValue({
      input: { chainId: swap.chainId as ChainId, token: swap.inputToken, amount: swap.inputAmount - swap.relayFee },
      output: {
        chainId: swap.destinationChainId as ChainId,
        token: swap.outputToken,
        amount: swap.outputAmount
      },
      nowSec: Math.floor(Date.now() / 1000),
      getRate
    })
  )
}
