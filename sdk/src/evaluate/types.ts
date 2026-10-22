import type { Address, Hex } from 'viem'
import type { ChainId } from '../const/index.js'

export interface INavHolding {
  chainId: ChainId
  token: Address
  label: string
  balance: bigint
  mark: { value: bigint; priceAgeSec: number }
}

export type IPriceSource = { readonly price: bigint; readonly time: number }

export interface IRate {
  token0: bigint
  token1: bigint
  time: number
}

export type IGetRate = (asset0: string, asset1: string, freshness: number) => Promise<IRate>

export interface INavPosition {
  venue: string
  id: Hex
  value: bigint
}

export interface INavGateReason {
  code: INavGateCode
  detail: string
}

export type INavGate = { ok: true } | { ok: false; reasons: INavGateReason[] }

type INavGateCode =
  | 'ASSET_UNPRICED'
  | 'STALE_ORACLE'
  | 'PENDING_ORDER'
  | 'PLATFORM_UNAVAILABLE'
  | 'VENUE_PRICE_STALE'
  | 'VENUE_PRICE_UNUSABLE'
  | 'VENUE_EXCESS_SLIPPAGE'
  | 'VENUE_BAD_INPUT'

export interface ISignerGain {
  above: bigint
  below: bigint
}

export interface IEvaluationConfig {
  maxPriceAgeSec: number
  driftToleranceBps: bigint
  swapMaxSlippageBps: bigint
  bridgeMaxSlippageBps: bigint
}

export const DEFAULT_EVALUATION_CONFIG: IEvaluationConfig = {
  maxPriceAgeSec: 120,
  driftToleranceBps: 50n,
  swapMaxSlippageBps: 500n,
  bridgeMaxSlippageBps: 500n
}

export type INavResult = { ok: true; navMark: bigint; holdings: INavHolding[]; positions: INavPosition[] } | { ok: false; reasons: INavGateReason[] }
