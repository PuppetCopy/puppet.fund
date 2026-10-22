import type { Address, PublicClient } from 'viem'
import { CompactError } from '../compact/error.js'
import { type ChainId, TOKEN_META } from '../const/index.js'
import { symbolOf } from '../state/tokenRegistry.js'
import {
  DEFAULT_EVALUATION_CONFIG,
  type IEvaluationConfig,
  type IGetRate,
  type INavGate,
  type INavGateReason
} from './types.js'
import { wethValueOf } from './unlisted.js'
import { assertNavSignable } from './verify.js'

interface IEvaluateCrossChainSwapParams {
  inputAmount: bigint
  outputAmount: bigint
  config?: Partial<IEvaluationConfig>
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
  getRate: IGetRate,
  clients: Readonly<Record<number, PublicClient>>,
  blockNumber: bigint,
  swap: {
    routeKind: 'swap' | 'across' | 'acrossSwap'
    chainId: number
    inputToken: Address
    outputToken: Address
    destinationChainId: number
    inputAmount: bigint
    outputAmount: bigint
    relayFee: bigint
  }
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
  const client = clients[swap.chainId]
  if (client === undefined) throw new CompactError('CHAIN_UNAVAILABLE', `no client for chain ${swap.chainId} to value this swap`, 'server')
  const config = DEFAULT_EVALUATION_CONFIG
  const destination = swap.destinationChainId as ChainId
  const [spent, delivered] = await Promise.all([
    wethValueOf(getRate, client, swap.chainId as ChainId, blockNumber, swap.inputToken, swap.inputAmount - swap.relayFee),
    destination === swap.chainId
      ? wethValueOf(getRate, client, destination, blockNumber, swap.outputToken, swap.outputAmount)
      : getRate(symbolOf(destination, swap.outputToken), TOKEN_META.WETH.symbol, config.maxPriceAgeSec * 1000).then(rate => ({
          value: (swap.outputAmount * rate.token0) / rate.token1,
          time: rate.time
        }))
  ])
  if (spent === null || delivered === null) {
    throw new CompactError(
      'ASSET_NOT_PRICEABLE',
      `${spent === null ? swap.inputToken : swap.outputToken} on chain ${spent === null ? swap.chainId : swap.destinationChainId} has no oracle feed and no Uniswap v3 pool that takes this amount with a 30-minute price history, so the swap cannot be valued`,
      'hard'
    )
  }
  const ageSec = Math.floor(Date.now() / 1000) - Math.min(spent.time, delivered.time)
  const reasons: INavGateReason[] = []
  if (ageSec > config.maxPriceAgeSec) reasons.push({ code: 'VENUE_PRICE_STALE', detail: `swap valued on a rate ${ageSec}s old (max ${config.maxPriceAgeSec}s)` })
  else if (delivered.value * 10_000n < spent.value * (10_000n - config.swapMaxSlippageBps)) {
    reasons.push({
      code: 'VENUE_EXCESS_SLIPPAGE',
      detail: `swap guarantees ${delivered.value} wei of WETH value for ${spent.value} spent, past the ${config.swapMaxSlippageBps} bps any swap may lose`
    })
  }
  assertNavSignable(reasons.length === 0 ? { ok: true } : { ok: false, reasons })
}
