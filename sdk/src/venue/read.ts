import { type Address, getAddress, type Hex } from 'viem'
import { type IIndexerClient, select } from '../state/shared.js'

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
  collateralInUsd: bigint
  realizedPnlUsd: bigint
  cumulativeSizeInUsd: bigint
  openedAt: number
  closedAt: number
  lastUpdatedAt: number
}

const POSITION_FIELDS = [
  'id',
  'account',
  'venueId',
  'market',
  'collateralToken',
  'isLong',
  'status',
  'sizeInUsd',
  'collateralInUsd',
  'realizedPnlUsd',
  'cumulativeSizeInUsd',
  'openedAt',
  'closedAt',
  'lastUpdatedAt'
] as const

export async function fetchPositions(
  sql: IIndexerClient,
  account: Address,
  status?: IAccountPositionStatus
): Promise<IAccountPosition[]> {
  const acct = getAddress(account)
  const rows = await select(
    sql,
    'Position',
    status
      ? { where: { account: { _eq: acct }, status: { _eq: status } }, fields: POSITION_FIELDS }
      : { where: { account: { _eq: acct } }, fields: POSITION_FIELDS }
  )
  return rows.map(r => ({
    positionId: r.id as Hex,
    account: getAddress(r.account),
    venueId: r.venueId,
    market: getAddress(r.market),
    collateralToken: getAddress(r.collateralToken),
    isLong: r.isLong,
    status: r.status as IAccountPositionStatus,
    sizeInUsd: r.sizeInUsd,
    collateralInUsd: r.collateralInUsd,
    realizedPnlUsd: r.realizedPnlUsd,
    cumulativeSizeInUsd: r.cumulativeSizeInUsd,
    openedAt: r.openedAt,
    closedAt: r.closedAt,
    lastUpdatedAt: r.lastUpdatedAt
  }))
}

export interface IPositionPerformance {
  realizedPnlUsd: bigint
  cumulativeSizeInUsd: bigint
  openCount: number
  closedCount: number
  winCount: number
  lossCount: number
}

export function summarizePerformance(positions: readonly IAccountPosition[]): IPositionPerformance {
  const out: IPositionPerformance = {
    realizedPnlUsd: 0n,
    cumulativeSizeInUsd: 0n,
    openCount: 0,
    closedCount: 0,
    winCount: 0,
    lossCount: 0
  }
  for (const p of positions) {
    out.realizedPnlUsd += p.realizedPnlUsd
    out.cumulativeSizeInUsd += p.cumulativeSizeInUsd
    if (p.status === 'open') {
      out.openCount += 1
    } else {
      out.closedCount += 1
      if (p.realizedPnlUsd > 0n) out.winCount += 1
      else if (p.realizedPnlUsd < 0n) out.lossCount += 1
    }
  }
  return out
}
