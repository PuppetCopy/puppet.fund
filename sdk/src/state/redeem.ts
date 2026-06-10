import type { IFund, IFundPosition } from '@puppet/indexer-graphql/entities'
import { combine, type IStream, map } from 'aelea/stream'
import { type Address, getAddress } from 'viem'
import { applyFactor } from '../core/math.js'
import { type IIndexerClient, liveSelect, select } from './shared.js'

export interface IPuppetRedeemPosition {
  sharesHeld: bigint
  stake: bigint
  cursor: bigint
  accrued: bigint
  accruedPerStake: bigint
  totalStake: bigint
}

const EMPTY_POSITION: IPuppetRedeemPosition = {
  sharesHeld: 0n,
  stake: 0n,
  cursor: 0n,
  accrued: 0n,
  accruedPerStake: 0n,
  totalStake: 0n
}

type IPositionRow = IFundPosition | undefined
type IPoolRow = IFund | undefined

const POSITION_FIELDS = ['stake', 'cursor', 'accrued', 'sharesHeld'] as const
const POOL_FIELDS = ['accruedPerStake', 'totalStake'] as const
const POOL_STATE_FIELDS = ['totalShareSupply', 'queuedShares'] as const

function buildPosition(position: IPositionRow, pool: IPoolRow): IPuppetRedeemPosition {
  if (!position) return EMPTY_POSITION
  return {
    sharesHeld: position.sharesHeld,
    stake: position.stake,
    cursor: position.cursor,
    accrued: position.accrued,
    accruedPerStake: pool ? pool.accruedPerStake : 0n,
    totalStake: pool ? pool.totalStake : 0n
  }
}

export async function getPuppetRedeemPosition(
  sql: IIndexerClient,
  puppet: Address,
  fund: Address
): Promise<IPuppetRedeemPosition> {
  const lowerHolder = getAddress(puppet)
  const lowerFund = getAddress(fund)
  const [position, pool] = await Promise.all([
    select(sql, 'FundPosition', {
      where: { holder: { _eq: lowerHolder }, fund: { _eq: lowerFund } },
      fields: POSITION_FIELDS
    }),
    select(sql, 'Fund', { where: { id: { _eq: lowerFund } }, fields: POOL_FIELDS })
  ])
  return buildPosition(position[0], pool[0])
}

export function livePuppetRedeemPosition(
  sql: IIndexerClient,
  puppet: Address,
  fund: Address
): IStream<IPuppetRedeemPosition> {
  const lowerHolder = getAddress(puppet)
  const lowerFund = getAddress(fund)
  const position = liveSelect(sql, 'FundPosition', {
    where: { holder: { _eq: lowerHolder }, fund: { _eq: lowerFund } },
    fields: POSITION_FIELDS
  })
  const pool = liveSelect(sql, 'Fund', { where: { id: { _eq: lowerFund } }, fields: POOL_FIELDS })
  return map(parts => buildPosition(parts.position[0], parts.pool[0]), combine({ position, pool }))
}

export function computeClaimable(pos: IPuppetRedeemPosition): bigint {
  if (pos.stake === 0n) return pos.accrued
  if (pos.accruedPerStake <= pos.cursor) return pos.accrued
  return pos.accrued + applyFactor(pos.accruedPerStake - pos.cursor, pos.stake)
}

export interface IFundPoolState {
  totalShareSupply: bigint
  queuedShares: bigint
}

const EMPTY_POOL_STATE: IFundPoolState = { totalShareSupply: 0n, queuedShares: 0n }

type IPoolStateRow = Pick<IFund, 'totalShareSupply' | 'queuedShares'> | undefined

function buildPoolState(row: IPoolStateRow): IFundPoolState {
  if (!row) return EMPTY_POOL_STATE
  return { totalShareSupply: row.totalShareSupply, queuedShares: row.queuedShares }
}

export async function getFundPoolState(sql: IIndexerClient, fund: Address): Promise<IFundPoolState> {
  const rows = await select(sql, 'Fund', {
    where: { id: { _eq: getAddress(fund) } },
    fields: POOL_STATE_FIELDS
  })
  return buildPoolState(rows[0])
}

export function liveFundPoolState(sql: IIndexerClient, fund: Address): IStream<IFundPoolState> {
  return map(
    rows => buildPoolState(rows[0]),
    liveSelect(sql, 'Fund', {
      where: { id: { _eq: getAddress(fund) } },
      fields: POOL_STATE_FIELDS
    })
  )
}
