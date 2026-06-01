import type { IPosition } from '../pages/types'

export function isPositionSettled(trade: IPosition): boolean {
  return trade.settledTimestamp > 0
}

export function isPositionOpen(trade: IPosition): trade is IPosition {
  return trade.lastUpdateTimestamp === 0
}
