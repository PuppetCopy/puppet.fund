import { CHAIN_TOKEN_MAP, HUB_CHAIN_ID } from '@puppet/contracts/const'
import { type Address, getAddress, isAddressEqual } from 'viem'
import { ADDRESS_ZERO } from '../const/common.js'
import type { IIndexerClient } from '../state/shared.js'
import { type IGmxPriceMap, readOraclePrices } from './platform/gmx.js'
import { baseToUsd } from './precision.js'
import { DEFAULT_EVALUATION_CONFIG, type IEvaluationConfig, type INavGate, type INavGateReason } from './types.js'

// Evaluation of the non-domain VALUE TRANSFORMATIONS a master can sign through an external
// venue (a LI.FI swap, an Across bridge), the counterpart to position valuation. The screen
// + on-chain shortfall already pin the output recipient to the fund, so value cannot leave
// the fund; this evaluation only bounds the slippage/value gap a master could leak to an
// AMM/filler, entirely from the in-domain GMX oracle (no 3rd-party route quote). Returns the
// same gate shape as NAV so attestation runs every value check through one path.

// The GMX oracle prices WETH, not native ETH (token 0). Native ETH is valued 1:1 against the
// hub WETH row (identical 18 decimals). operate intents and the oracle feed are hub-chain.
const NATIVE_PRICE_TOKEN = getAddress(CHAIN_TOKEN_MAP[HUB_CHAIN_ID].WETH as Address)
const priceTokenFor = (token: Address): Address =>
  isAddressEqual(getAddress(token), ADDRESS_ZERO) ? NATIVE_PRICE_TOKEN : getAddress(token)

export interface IVenueValueLeg {
  token: Address
  amount: bigint
}

export interface IEvaluateSwapParams {
  input: IVenueValueLeg
  output: IVenueValueLeg
  nowSec: number
  config?: Partial<IEvaluationConfig>
}

export interface IEvaluateBridgeParams {
  inputAmount: bigint
  outputAmount: bigint
  config?: Partial<IEvaluationConfig>
}

function legUsd(
  label: string,
  leg: IVenueValueLeg,
  prices: IGmxPriceMap,
  nowSec: number,
  maxPriceAgeSec: number,
  reasons: INavGateReason[]
): bigint | null {
  const row = prices.get(priceTokenFor(leg.token))
  if (!row) {
    reasons.push({
      code: 'VENUE_TOKEN_UNSUPPORTED',
      detail: `${label} token ${leg.token} has no in-domain oracle price; venue not attestable`
    })
    return null
  }
  if (row.price <= 0n) {
    reasons.push({ code: 'VENUE_PRICE_UNUSABLE', detail: `${label} token ${leg.token} oracle price is non-positive` })
    return null
  }
  if (nowSec - row.updateTimestamp > maxPriceAgeSec) {
    reasons.push({
      code: 'VENUE_PRICE_STALE',
      detail: `${label} token ${leg.token} price ${nowSec - row.updateTimestamp}s old (max ${maxPriceAgeSec}s)`
    })
    return null
  }
  return baseToUsd(leg.amount, row.price)
}

// A swap is attestable only between tokens we can price, with fresh prices, when the signed
// minimum output holds at least (1 - swapMaxSlippageBps) of the input's USD value. Both GMX
// prices are 1e30 per native unit, so amount * price is a USD-1e30 value comparable across
// token decimals.
export async function evaluateSwapValue(sql: IIndexerClient, params: IEvaluateSwapParams): Promise<INavGate> {
  const config = { ...DEFAULT_EVALUATION_CONFIG, ...params.config }
  const reasons: INavGateReason[] = []
  const prices = await readOraclePrices(sql, [priceTokenFor(params.input.token), priceTokenFor(params.output.token)])
  const inputUsd = legUsd('swap input', params.input, prices, params.nowSec, config.maxPriceAgeSec, reasons)
  const outputUsd = legUsd('swap output', params.output, prices, params.nowSec, config.maxPriceAgeSec, reasons)
  if (inputUsd !== null && outputUsd !== null) {
    const floor = (inputUsd * (10_000n - config.swapMaxSlippageBps)) / 10_000n
    if (outputUsd < floor) {
      reasons.push({
        code: 'VENUE_EXCESS_SLIPPAGE',
        detail: `swap output value ${outputUsd} below floor ${floor} (input ${inputUsd}, ${config.swapMaxSlippageBps}bps)`
      })
    }
  }
  return { ok: reasons.length === 0, reasons }
}

// A bridge moves the SAME token cross-chain to the fund's own address (recipient pinned by
// the screen), so the bound is a same-token amount ratio: the net output must hold at least
// (1 - bridgeMaxSlippageBps) of the input, with no cross-price needed.
// PRECONDITION: the token has identical decimals on origin and destination (true for every
// registered token today, USDC 6/6, WETH 18/18). A future registration with asymmetric
// cross-chain decimals would make this raw-amount ratio meaningless and must normalize here.
export function evaluateBridgeValue(params: IEvaluateBridgeParams): INavGate {
  const config = { ...DEFAULT_EVALUATION_CONFIG, ...params.config }
  const reasons: INavGateReason[] = []
  if (params.inputAmount <= 0n) {
    reasons.push({ code: 'VENUE_BAD_INPUT', detail: `bridge input amount ${params.inputAmount} must be positive` })
  } else {
    const floor = (params.inputAmount * (10_000n - config.bridgeMaxSlippageBps)) / 10_000n
    if (params.outputAmount < floor) {
      reasons.push({
        code: 'VENUE_EXCESS_SLIPPAGE',
        detail: `bridge output ${params.outputAmount} below floor ${floor} (input ${params.inputAmount}, ${config.bridgeMaxSlippageBps}bps)`
      })
    }
  }
  return { ok: reasons.length === 0, reasons }
}
