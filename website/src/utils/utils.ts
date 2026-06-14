import type { IPosition } from '../pages/types'

export function isPositionSettled(trade: IPosition): boolean {
  return trade.settledTimestamp > 0
}
