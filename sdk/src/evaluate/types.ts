import type { Address, Hex, PublicClient } from 'viem'
import type { ChainId } from '../const/index.js'

export type INavKind = 'allocate' | 'redeem' | 'view'

export interface INavChainBalance {
  chainId: ChainId
  balance: bigint
  reachable: boolean
}

export interface INavHolding {
  chainId: ChainId
  token: Address
  symbol: string
  balance: bigint
}

export interface INavValuedHolding extends INavHolding {
  mark: { valueBase: bigint; priceAgeSec: number }
}

export type IPriceSource = { readonly price: bigint; readonly time: number }

export interface IRate {
  token0: bigint
  token1: bigint
  time: number
}

export type IGetRate = (asset0: string, asset1: string, freshness?: number) => Promise<IRate>


export interface INavReserved {
  holding: INavHolding
  spender: Address
}

export type IVenueFacets = Record<string, string | number | bigint | boolean | undefined>

export interface INavPosition {
  platform: string
  positionKey: Hex
  market: Address
  collateralBase: bigint
  pnlBase: bigint
  netBase: bigint
  priceAgeSec: number | undefined
  facets?: IVenueFacets
}

export interface IPlatformInFlight {
  platform: string
  ref: string
  detail: string
}

export interface IPlatformValuation {
  platform: string
  positions: INavPosition[]
  inFlight: IPlatformInFlight[]
  available: boolean
  unavailableReason?: string
}

export interface INavBreakdown {
  unitedCashBase: bigint
  positionMarkBase: bigint
  holdingMarkBase: bigint
  perChain: INavChainBalance[]
  holdings: INavValuedHolding[]
  positions: INavPosition[]
  inFlight: IPlatformInFlight[]
  unavailablePlatforms: { platform: string; reason: string | undefined }[]
}

export interface INavGateReason {
  code: INavGateCode
  detail: string
}

export type INavGate = { ok: true } | { ok: false; reasons: INavGateReason[] }

type INavGateCode =
  | 'CHAIN_UNREACHABLE'
  | 'STALE_ORACLE'
  | 'NAV_MISMATCH'
  | 'PENDING_ORDER'
  | 'PLATFORM_UNAVAILABLE'
  | 'VENUE_TOKEN_UNSUPPORTED'
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
  markWindowSec: bigint
  swapMaxSlippageBps: bigint
  bridgeMaxSlippageBps: bigint
}

export const DEFAULT_EVALUATION_CONFIG: IEvaluationConfig = {
  maxPriceAgeSec: 120,
  driftToleranceBps: 50n,
  markWindowSec: 60n,
  swapMaxSlippageBps: 500n,
  bridgeMaxSlippageBps: 500n
}

const VALUATION_CLOCK_SKEW_SEC = 15n

export const valuationDeadline = (nowSec: bigint, config: IEvaluationConfig): bigint => nowSec + config.markWindowSec - VALUATION_CLOCK_SKEW_SEC

export interface IEvaluateAccountParams {
  master: Address
  chainId: ChainId
  baseKey: string
  blockNumber: bigint
  blockTimestamp: number
  kind: INavKind
  publicClient?: PublicClient
  getRate: IGetRate
  reserved: INavReserved[]
  nowSec?: number
  config?: Partial<IEvaluationConfig>
  clientNav?: bigint
  signerGain: ISignerGain | null
  cashLeg: INavChainBalance[]
  holdings: INavHolding[]
}

export type INavResult = { kind: INavKind; breakdown: INavBreakdown } & (
  | { ok: true; navMark: bigint }
  | { ok: false; reasons: INavGateReason[] }
)
