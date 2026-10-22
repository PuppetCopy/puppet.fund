import type { Address, Hex } from 'viem'

export interface IGmxPositionRow {
  positionKey: Hex
  market: Address
  collateralToken: Address
  isLong: boolean
  sizeInUsd: bigint
  sizeInTokens: bigint
  collateralUsd: bigint
  collateralAmount: bigint
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
  executionFee: bigint
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
