import type { IPuppetAllocation, IShareTokenMetric } from '@puppet/indexer-graphql/entities'
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

type IPositionRow = IPuppetAllocation | undefined
type IPoolRow = IShareTokenMetric | undefined

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
  masterAccount: Address
): Promise<IPuppetRedeemPosition> {
  const lowerPuppet = getAddress(puppet)
  const lowerMaster = getAddress(masterAccount)
  const [position, pool] = await Promise.all([
    select(sql, 'PuppetAllocation', {
      where: { puppet: { _eq: lowerPuppet }, masterAccount: { _eq: lowerMaster } },
      fields: POSITION_FIELDS
    }),
    select(sql, 'ShareTokenMetric', { where: { id: { _eq: lowerMaster } }, fields: POOL_FIELDS })
  ])
  return buildPosition(position[0], pool[0])
}

export function livePuppetRedeemPosition(
  sql: IIndexerClient,
  puppet: Address,
  masterAccount: Address
): IStream<IPuppetRedeemPosition> {
  const lowerPuppet = getAddress(puppet)
  const lowerMaster = getAddress(masterAccount)
  const position = liveSelect(sql, 'PuppetAllocation', {
    where: { puppet: { _eq: lowerPuppet }, masterAccount: { _eq: lowerMaster } },
    fields: POSITION_FIELDS
  })
  const pool = liveSelect(sql, 'ShareTokenMetric', { where: { id: { _eq: lowerMaster } }, fields: POOL_FIELDS })
  return map(parts => buildPosition(parts.position[0], parts.pool[0]), combine({ position, pool }))
}

export function computeClaimable(pos: IPuppetRedeemPosition): bigint {
  if (pos.stake === 0n) return pos.accrued
  if (pos.accruedPerStake <= pos.cursor) return pos.accrued
  return pos.accrued + applyFactor(pos.accruedPerStake - pos.cursor, pos.stake)
}

export interface IMasterPoolState {
  totalShareSupply: bigint
  queuedShares: bigint
}

const EMPTY_POOL_STATE: IMasterPoolState = { totalShareSupply: 0n, queuedShares: 0n }

type IPoolStateRow = Pick<IShareTokenMetric, 'totalShareSupply' | 'queuedShares'> | undefined

function buildPoolState(row: IPoolStateRow): IMasterPoolState {
  if (!row) return EMPTY_POOL_STATE
  return { totalShareSupply: row.totalShareSupply, queuedShares: row.queuedShares }
}

export async function getMasterPoolState(sql: IIndexerClient, masterAccount: Address): Promise<IMasterPoolState> {
  const rows = await select(sql, 'ShareTokenMetric', {
    where: { id: { _eq: getAddress(masterAccount) } },
    fields: POOL_STATE_FIELDS
  })
  return buildPoolState(rows[0])
}

export function liveMasterPoolState(sql: IIndexerClient, masterAccount: Address): IStream<IMasterPoolState> {
  return map(
    rows => buildPoolState(rows[0]),
    liveSelect(sql, 'ShareTokenMetric', {
      where: { id: { _eq: getAddress(masterAccount) } },
      fields: POOL_STATE_FIELDS
    })
  )
}
