import type { Address, Hex, PublicClient } from 'viem'
import type { ChainId } from '../const/index.js'

export type INavKind = 'allocate' | 'redeem' | 'liquidate' | 'view'

export interface INavChainBalance {
  chainId: ChainId
  signedBalance: bigint
  unrecognized: bigint
  reachable: boolean
}

// A non-base spot holding in the fund's signed domain, priced into base by the evaluation. The CALLER builds the
// list (website via composeHoldings() from its fold subaccount; the relay from its per-token on-chain reads) and
// resolves `symbol` chain-aware to the PRICED asset (WMON -> MON): the native marker is the same address on every
// chain, so it cannot be address-keyed.
export interface INavHolding {
  chainId: ChainId
  token: Address
  symbol: string
  signedBalance: bigint
  unrecognized: bigint
}

export interface INavValuedHolding extends INavHolding {
  valueBase: bigint
  unrecognizedBase: bigint
  priceAgeSec: number | undefined
}


export type IPriceSource = { readonly price: bigint; readonly time: number }

// A pair exchange rate: two non-directional per-wei legs scaled to the protocol precision. The oracle sources
// it from a directly observed market; `quoteAmount(fromWei, token0, token1)` converts a token0 amount to token1
// wei (reverse the args for the other direction). Defined here (not in @puppet/oracle) so the consensus
// evaluation layer owns the contract; the oracle imports it back (it already depends on this module).
export interface IRate {
  token0: bigint
  token1: bigint
  time: number
}

// The sole injected pricing primitive: an explicit pair rate keyed by canonical asset SYMBOL ('ETH', 'USDC', …). The
// caller names both legs by symbol (swap = the two legs; NAV/position = token vs the dollar-proxy 'USDC'), resolving any
// token ADDRESS it holds to its symbol via symbolByAddress at the call site. Symbol, not the keccak tokenId, is the rate
// key end to end: the oracle prices markets by symbol, so a hash would only get mapped back to a symbol at the wire.
export type IGetRate = (asset0: string, asset1: string, freshness?: number) => Promise<IRate>

// An open venue position, valuation-ready. Sourced from an injected reader: the matchmaker's
// GmxReaderV2.getAccountPositions over RPC, or the browser's relay /positions client.
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
}
export type IGmxPositionProvider = (account: Address, baseToken: Address) => Promise<IGmxPositionRow[]>

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
  account: Address
  baseToken: Address
  nowSec: number
  publicClient?: PublicClient
  getRate: IGetRate
  positions: IGmxPositionRow[]
  orders: IGmxOrderRow[]
  claimables: IGmxClaimableRow[]
}

export interface IPlatformEvaluator {
  platform: string
  evaluate(params: IPlatformEvalParams): Promise<IPlatformValuation>
}

export interface INavBreakdown {
  unitedSignedBalance: bigint
  positionMarkBase: bigint
  positionFloorBase: bigint
  holdingMarkBase: bigint
  perChain: INavChainBalance[]
  holdings: INavValuedHolding[]
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
  | 'CHAIN_UNREACHABLE'
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
  maxPriceAgeSec: number
  allocateGainHaircutBps: bigint
  driftToleranceBps: bigint
  maxUnrecognizedBaseWei: bigint
  swapMaxSlippageBps: bigint
  bridgeMaxSlippageBps: bigint
}

export const DEFAULT_EVALUATION_CONFIG: IEvaluationConfig = {
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
  // The base-token cash leg per chain (signedBalance, unrecognized = held − signed, reachable). The CALLER builds it — the
  // website via composeCashLeg() from its fold subaccount; the relay directly from its on-chain reads (no synthetic fold).
  cashLeg: INavChainBalance[]
  // Non-base spot holdings to price into base (same caller-built contract as cashLeg). Omitted = none.
  holdings?: INavHolding[]
}

export interface INavResult {
  navMark: bigint
  navFloor: bigint
  navSigned: bigint
  kind: INavKind
  breakdown: INavBreakdown
  gate: INavGate
}
