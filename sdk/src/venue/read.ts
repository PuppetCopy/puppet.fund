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
  // Marked PnL at the last on-chain update; callers re-mark live against the index price.
  pnl: bigint
  realizedPnlUsd: bigint
  cumulativeSizeInUsd: bigint
  openedAt: number
  closedAt: number
  lastUpdatedAt: number
}
