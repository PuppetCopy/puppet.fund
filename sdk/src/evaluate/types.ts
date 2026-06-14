import type { Address, Hex, PublicClient } from 'viem'
import type { ChainId } from '../const/index.js'
import type { IndexerHealth, LagSeverity } from '../state/health.js'
import type { ISubaccountState } from '../state/metric.js'
import type { IIndexerClient } from '../state/shared.js'

export type INavKind = 'allocate' | 'redeem' | 'liquidate' | 'view'

export interface INavChainBalance {
  chainId: ChainId
  recordedBalance: bigint
  signedBalance: bigint
  unrecognized: bigint
  ageSec: number
  severity: LagSeverity
}

export type IPriceMap = Map<Address, { price: bigint; updateTimestamp: number }>
export type IPriceProvider = (tokens: readonly Address[]) => Promise<IPriceMap>

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
  kind: 'order' | 'transfer'
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
  sql: IIndexerClient
  account: Address
  baseToken: Address
  nowSec: number
  publicClient?: PublicClient
  priceProvider?: IPriceProvider
}

export interface IPlatformEvaluator {
  platform: string
  evaluate(params: IPlatformEvalParams): Promise<IPlatformValuation>
}

export interface INavBreakdown {
  unitedSignedBalance: bigint
  positionMarkBase: bigint
  positionFloorBase: bigint
  perChain: INavChainBalance[]
  positions: INavPosition[]
  inFlight: IPlatformInFlight[]
  unavailablePlatforms: string[]
}

export interface INavGateReason {
  code: INavGateCode
  detail: string
}

export interface INavGate {
  ok: boolean
  reasons: INavGateReason[]
}

export type INavGateCode =
  | 'INDEXER_STALE'
  | 'STALE_ORACLE'
  | 'NAV_MISMATCH'
  | 'PENDING_ORDER'
  | 'PENDING_BRIDGE'
  | 'PLATFORM_UNAVAILABLE'
  | 'UNRECOGNIZED_BALANCE'
  | 'OPEN_POSITIONS'
  | 'VENUE_TOKEN_UNSUPPORTED'
  | 'VENUE_PRICE_STALE'
  | 'VENUE_PRICE_UNUSABLE'
  | 'VENUE_EXCESS_SLIPPAGE'
  | 'VENUE_BAD_INPUT'

export interface IEvaluationConfig {
  maxIndexerAgeSec: number
  maxPriceAgeSec: number
  allocateGainHaircutBps: bigint
  driftToleranceBps: bigint
  maxUnrecognizedBaseWei: bigint
  swapMaxSlippageBps: bigint
  bridgeMaxSlippageBps: bigint
}

export const DEFAULT_EVALUATION_CONFIG: IEvaluationConfig = {
  maxIndexerAgeSec: 60,
  maxPriceAgeSec: 120,
  allocateGainHaircutBps: 2000n,
  driftToleranceBps: 50n,
  maxUnrecognizedBaseWei: 0n,
  swapMaxSlippageBps: 500n,
  bridgeMaxSlippageBps: 500n
}

export interface IEvaluateAccountParams {
  master: Address
  baseToken: Address
  baseTokenId: Hex
  health: IndexerHealth
  kind: INavKind
  platforms?: IPlatformEvaluator[]
  publicClient?: PublicClient
  priceProvider?: IPriceProvider
  nowSec?: number
  config?: Partial<IEvaluationConfig>
  clientNav?: bigint
  subaccount?: ISubaccountState
}

export interface INavResult {
  navMark: bigint
  navFloor: bigint
  navSigned: bigint
  kind: INavKind
  breakdown: INavBreakdown
  gate: INavGate
}
