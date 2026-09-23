import type { IIAccount__Call } from '@puppet/contracts/types'
import type { Address, Hex, PublicClient } from 'viem'
import type { ChainId } from '../const/index.js'

import type { IGetRate, IPlatformValuation } from '../evaluate/types.js'

export type { INavPosition, IPlatformValuation, IVenueFacets } from '../evaluate/types.js'

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
  registeredTokens: readonly Address[]
}

export interface IDappScreenReason {
  code: 'DAPP_DOMAIN_NOT_ADMITTED' | 'DAPP_ACTION_NOT_ADMITTED' | 'DAPP_EXIT_DESTINATION' | 'DAPP_MESSAGE_NOT_ADMITTED'
  detail: string
}

export interface IDappTypedData {
  domain?: { name?: string; version?: string; chainId?: number | bigint | string; verifyingContract?: string }
  types?: Record<string, unknown>
  primaryType: string
  message: Record<string, unknown>
}

interface IVenueFlow {
  token: Address
  delta: bigint
}

export interface IStepField {
  label: string
  value: string
}

export interface IVenueStep {
  kind: 'venue'
  venueId: string
  label: string
  call: string
  fields: readonly IStepField[]
  key: Hex | null
  flows: readonly IVenueFlow[]
}

export type IOperateStep =
  | IVenueStep
  | { kind: 'release'; token: Address | null; to: Address; amount: bigint }
  | { kind: 'approve'; token: Address; spender: Address; amount: bigint }
  | { kind: 'fee'; token: Address; amount: bigint }
  | { kind: 'call'; target: Address; selector: Hex; value: bigint }

export interface IVenueContract {
  chainId: ChainId
  address: Address
  name: string
  detail: string
  pullsTokens?: boolean
}

export interface IVenueValueParams {
  chainId: ChainId
  account: Address
  baseToken: Address
  blockNumber: bigint
  blockTimestamp: number
  nowSec: number
  publicClient?: PublicClient
  getRate: IGetRate
}

export interface IVenueAllocationParams {
  account: Address
  clients: Readonly<Record<number, PublicClient>>
}

export interface IVenueOutcomeParams {
  chainId: ChainId
  account: Address
  key: Hex
  fromBlock: bigint
  publicClient: PublicClient
}

export interface IVenue {
  venueId: string
  name: string
  chains: readonly ChainId[]
  contracts: readonly IVenueContract[]
  claims(ctx: IScreenContext, call: IIAccount__Call): boolean
  screen(ctx: IScreenContext, call: IIAccount__Call): IGuardReason[]
  outflows(call: IIAccount__Call): { token: Address; amount: bigint }[]
  describe(chainId: ChainId, callList: readonly IIAccount__Call[], resultList: readonly Hex[] | undefined): ReadonlyMap<number, IOperateStep[]>
  typedData(account: Address, typedData: IDappTypedData): IDappScreenReason[] | null
  message(account: Address, text: string): IDappScreenReason[] | null
  value(params: IVenueValueParams): Promise<IPlatformValuation>
  outcome?(params: IVenueOutcomeParams): Promise<string | null>
  blocksAllocation?(params: IVenueAllocationParams): Promise<string | null>
}
