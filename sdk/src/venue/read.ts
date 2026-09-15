import type { Address, Hex } from 'viem'

export type IAccountPositionStatus = 'open' | 'closed'

export interface IAccountPosition {
  positionId: Hex
  account: Address
  venueId: string
  market: Address
  collateralToken: Address
  isLong: boolean
  status: IAccountPositionStatus
  sizeInUsd: bigint
  sizeInTokens: bigint
  collateralInUsd: bigint
  collateralAmount: bigint
  pnl: bigint
  realizedPnlUsd: bigint
  cumulativeSizeInUsd: bigint
  openedAt: number | null
  closedAt: number
  lastUpdatedAt: number
}
