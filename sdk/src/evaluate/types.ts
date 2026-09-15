import type { Address, Hex, PublicClient } from 'viem'
import type { ChainId } from '../const/index.js'

export type INavKind = 'operate' | 'settle' | 'view'

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

export interface IGmxPositionRow {
  positionKey: Hex
  market: Address
  collateralToken: Address
  isLong: boolean
  sizeInUsd: bigint
  sizeInTokens: bigint
  collateralUsd: bigint
  collateralAmount: bigint
  storedPnlUsd: bigint
  increasedAtTime: number
}
export type IGmxPositionProvider = (account: Address) => Promise<IGmxPositionRow[]>

export interface IGmxOrderRow {
  orderKey: Hex
  market: Address
  collateralToken: Address
  isLong: boolean
  orderType: number
  sizeDeltaUsd: bigint
  collateralDeltaAmount: bigint
  triggerPrice: bigint
  isFrozen: boolean
}
export type IGmxOrderProvider = (account: Address) => Promise<IGmxOrderRow[]>

export interface IGmxClaimableRow {
  market: Address
  token: Address
  amount: bigint
}
export type IGmxClaimableProvider = (account: Address) => Promise<IGmxClaimableRow[]>

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

export interface IPlatformEvalParams {
  chainId: ChainId
  account: Address
  baseToken: Address
  blockNumber: bigint
  blockTimestamp: number
  nowSec: number
  publicClient?: PublicClient
  getRate: IGetRate
  positions: IGmxPositionRow[]
  orders: IGmxOrderRow[]
  claimables: IGmxClaimableRow[]
}

export interface IPlatformEvaluator {
  platform: string
  chainId: ChainId
  evaluate(params: IPlatformEvalParams): Promise<IPlatformValuation>
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

export type INavGateCode =
  | 'CHAIN_UNREACHABLE'
  | 'STALE_ORACLE'
  | 'NAV_MISMATCH'
  | 'PENDING_ORDER'
  | 'PLATFORM_UNAVAILABLE'
  | 'OPEN_POSITIONS'
  | 'VENUE_TOKEN_UNSUPPORTED'
  | 'VENUE_PRICE_STALE'
  | 'VENUE_PRICE_UNUSABLE'
  | 'VENUE_EXCESS_SLIPPAGE'
  | 'VENUE_BAD_INPUT'

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

export interface IEvaluateAccountParams {
  master: Address
  baseKey: string
  blockNumber: bigint
  blockTimestamp: number
  kind: INavKind
  platforms?: IPlatformEvaluator[]
  publicClient?: PublicClient
  getRate: IGetRate
  positions: IGmxPositionRow[]
  orders: IGmxOrderRow[]
  claimables: IGmxClaimableRow[]
  nowSec?: number
  config?: Partial<IEvaluationConfig>
  clientNav?: bigint
  cashLeg: INavChainBalance[]
  holdings: INavHolding[]
}

export type INavResult = { kind: INavKind; breakdown: INavBreakdown } & (
  | { ok: true; navMark: bigint }
  | { ok: false; reasons: INavGateReason[] }
)
