import { PROTOCOL, TOKEN_META } from '@puppet/contracts/const'
import { type Address, getAddress, isAddressEqual } from 'viem'
import { CompactError } from '../compact/error.js'
import type { ChainId } from '../const/index.js'
import { symbolByAddress, wrappedNativeAddressOf } from '../state/tokenRegistry.js'
import {
  DEFAULT_EVALUATION_CONFIG,
  type IEvaluationConfig,
  type IGetRate,
  type INavGate,
  type INavGateReason
} from './types.js'
import { assertNavSignable } from './verify.js'

// Evaluation of the non-domain VALUE TRANSFORMATIONS a master can sign through an external
// venue (a LI.FI swap, an Across bridge), the counterpart to position valuation. The screen
// + on-chain shortfall already pin the output recipient to the fund, so value cannot leave
// the fund; this evaluation only bounds the slippage/value gap a master could leak to an
// AMM/filler, entirely from the in-domain GMX oracle (no 3rd-party route quote). Returns the
// same gate shape as NAV so attestation runs every value check through one path.

const priceAssetFor = (token: Address): string =>
  isAddressEqual(getAddress(token), PROTOCOL.nativeToken) ? TOKEN_META.WETH.symbol : symbolByAddress(token)

export interface IVenueValueLeg {
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

// A swap is attestable only on a directly observed input/output market, with a fresh rate, when the signed
// minimum output holds at least (1 - swapMaxSlippageBps) of what that rate says the input should fetch. The
// bound is expressed entirely in the OUTPUT token (the swap's own numeraire) via the direct pair rate — no USD
// proxy and no triangulation. quoteAmount(input, rate.token0, rate.token1) is the expected output wei; the
// rate comes from the injected getter (the matchmaker's median oracle, or the browser's signed-prices feed),
// the same source NAV valuation uses. Fail-closed: an unpriceable / unwhitelisted / stale pair gates the swap.
export async function evaluateSwapValue(params: IEvaluateSwapParams): Promise<INavGate> {
  const config = { ...DEFAULT_EVALUATION_CONFIG, ...params.config }
  const reasons: INavGateReason[] = []
  const { input, output } = params
  const rate = await params
    .getRate(priceAssetFor(input.token), priceAssetFor(output.token), config.maxPriceAgeSec * 1000)
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
  return { ok: reasons.length === 0, reasons }
}

// A cross-chain swap moves the SAME token cross-chain to the fund's own address (recipient
// pinned by the screen), so the bound is a same-token amount ratio: the net output must hold
// at least (1 - bridgeMaxSlippageBps) of the input, with no cross-price needed.
// PRECONDITION: the token has identical decimals on origin and destination (true for every
// registered token today, USDC 6/6, WETH 18/18). A future registration with asymmetric
// cross-chain decimals would make this raw-amount ratio meaningless and must normalize here.
export function evaluateCrossChainSwapValue(params: IEvaluateCrossChainSwapParams): INavGate {
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
  return { ok: reasons.length === 0, reasons }
}

// The ONE slippage/value gate every signed swap runs through (matchmaker AND client runner call this same function):
// a fund swap moves POOLED depositor assets on the master's signature, so the value bound is mandatory — without it a
// compromised master signs a 100k-in -> 1-wei-out trade through a whitelisted provider and the tautological on-chain
// floor passes. Dispatch by route kind:
// - 'swap' (local DEX): oracle value bound input vs output. Cross-asset cross-chain fund flows run as a COMPOSED route
//   (a local 'swap' to a bridgeable asset + a same-asset 'across' bridge), so each leg is bounded here on its own.
// - 'across' (same-asset bridge): raw amount-ratio bound; cross-ASSET pairs are refused here because the ratio would
//   pass vacuously across decimals (the on-chain across leg signs no output floor).
// - 'acrossSwap' (fused withdraw swap-and-bridge): cross-asset by nature, so it takes the oracle value bound like a
//   local swap — input priced on its own chain, output on the destination (the address→symbol map is chain-spanning).
// The native marker has no priceable identity of its own (its meta symbol collapses across chains): it is priced as
// its wrapped twin on the swap's chain (1:1 by construction).
export async function screenSwapValue(
  swap: {
    routeKind: 'swap' | 'across' | 'acrossSwap'
    chainId: number
    inputToken: Address
    outputToken: Address
    inputAmount: bigint
    outputAmount: bigint
    acceptableRelayFee: bigint
  },
  getRate: IGetRate
): Promise<void> {
  const inputToken = isAddressEqual(getAddress(swap.inputToken), getAddress(PROTOCOL.nativeToken))
    ? wrappedNativeAddressOf(swap.chainId as ChainId)
    : swap.inputToken
  // A native OUTPUT only occurs on LOCAL swaps (bridges never deliver the marker), so its priceable identity is the
  // swap chain's wrapped twin — the address-keyed symbol map would collapse the shared marker to one chain's coin.
  const outputToken = isAddressEqual(getAddress(swap.outputToken), getAddress(PROTOCOL.nativeToken))
    ? wrappedNativeAddressOf(swap.chainId as ChainId)
    : swap.outputToken
  if (swap.routeKind === 'across') {
    if (symbolByAddress(inputToken) !== symbolByAddress(outputToken)) {
      throw new CompactError(
        'CROSS_CHAIN_ASSET_MISMATCH',
        `across must bridge the same asset; ${swap.inputToken} and ${swap.outputToken} are different assets`,
        'hard'
      )
    }
    assertNavSignable(
      evaluateCrossChainSwapValue({
        inputAmount: swap.inputAmount - swap.acceptableRelayFee,
        outputAmount: swap.outputAmount
      })
    )
    return
  }
  assertNavSignable(
    await evaluateSwapValue({
      input: { token: inputToken, amount: swap.inputAmount },
      output: { token: outputToken, amount: swap.outputAmount },
      nowSec: Math.floor(Date.now() / 1000),
      getRate
    })
  )
}
