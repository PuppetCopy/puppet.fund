import type { Address, Hex } from 'viem'
import type { IPlatformEvalParams, IPlatformValuation } from '../evaluate/types.js'

export type { INavPosition, IPlatformEvalParams, IPlatformValuation, IVenueFacets } from '../evaluate/types.js'

export interface IGuardReason {
  code: string
  detail: string
}

export interface IGuardResult {
  ok: boolean
  reasons: IGuardReason[]
}

export type IVenueActionKind = 'increase' | 'decrease'

export interface IVenueAction {
  kind: IVenueActionKind
  account: Address
  baseToken: Address
  baseDelta: bigint
  params: Record<string, unknown>
}

export interface IVenue {
  venueId: string
  subkey(params: Record<string, unknown>): Hex
  mark(params: IPlatformEvalParams): Promise<IPlatformValuation>
  guard(action: IVenueAction): IGuardResult
}
