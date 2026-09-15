import type { IIAccount__Call } from '@puppet/contracts/types'
import type { Address, Hex } from 'viem'
import type { ChainId } from '../const/index.js'

export type { INavPosition, IPlatformEvalParams, IPlatformValuation, IVenueFacets } from '../evaluate/types.js'

export interface IGuardReason {
  code: string
  detail: string
}

export interface IGuardResult {
  ok: boolean
  reasons: IGuardReason[]
}

export interface IScreenContext {
  chainId: ChainId
  account: Address
  releaseTargets: readonly Address[]
  registeredTokens: readonly Address[]
}

export interface IDappScreenReason {
  code: 'DAPP_DOMAIN_NOT_ADMITTED' | 'DAPP_ACTION_NOT_ADMITTED' | 'DAPP_EXIT_DESTINATION' | 'DAPP_MESSAGE_NOT_ADMITTED'
  detail: string
}

export interface IDappTypedData {
  domain?: { name?: string }
  types?: Record<string, unknown>
  primaryType: string
  message: Record<string, unknown>
}

export type IOperateStep =
  | {
      kind: 'gmx-order'
      key: Hex | null
      orderType: number
      market: Address
      isLong: boolean
      sizeDeltaUsd: bigint
      collateralToken: Address
      collateralDelta: bigint
      positionCollateralToken: Address | undefined
      triggerPrice: bigint
      acceptablePrice: bigint
      executionFee: bigint
      swapPath: Address[]
      decreasePositionSwapType: number
    }
  | { kind: 'gmx-cancel'; key: Hex }
  | { kind: 'gmx-update'; key: Hex; sizeDeltaUsd: bigint; acceptablePrice: bigint; triggerPrice: bigint }
  | { kind: 'gmx-claim'; claim: 'funding' | 'collateral'; markets: Address[]; tokens: Address[] }
  | { kind: 'venue-deposit'; venue: 'hyperliquid'; token: Address; amount: bigint }
  | { kind: 'release'; token: Address | null; to: Address; amount: bigint }
  | { kind: 'fee'; token: Address; amount: bigint }
  | { kind: 'call'; target: Address; selector: Hex; value: bigint }

export interface IVenue {
  venueId: string
  claims(ctx: IScreenContext, call: IIAccount__Call): boolean
  screen(ctx: IScreenContext, call: IIAccount__Call): IGuardReason[]
  outflows(call: IIAccount__Call): { token: Address; amount: bigint }[]
  describe(chainId: ChainId, callList: readonly IIAccount__Call[], resultList: readonly Hex[] | undefined): ReadonlyMap<number, IOperateStep[]>
  typedData(account: Address, typedData: IDappTypedData): IDappScreenReason[] | null
}
