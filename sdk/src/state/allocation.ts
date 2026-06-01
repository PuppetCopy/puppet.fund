import type { IAccountState, IShareTokenMetric } from '@puppet/indexer-graphql/entities'
import { combine, type IStream, map } from 'aelea/stream'
import { type Address, getAddress } from 'viem'
import { type IIndexerClient, liveSelect, select } from './shared.js'

export interface IMasterAllocation {
  idle: bigint
  atRisk: bigint
  total: bigint
}

type IShareRow = IShareTokenMetric | undefined
type IBalanceRow = Pick<IAccountState, 'signedBalance'>

const SHARE_FIELDS = ['totalAllocated', 'totalShareSupply', 'queuedShares'] as const
const BALANCE_FIELDS = ['signedBalance'] as const

function buildAllocation(rows: IBalanceRow[], share: IShareRow): IMasterAllocation {
  let idle = 0n
  for (const r of rows) idle += r.signedBalance
  const totalAllocated = share ? share.totalAllocated : 0n
  const totalShareSupply = share ? share.totalShareSupply : 0n
  const queuedShares = share ? share.queuedShares : 0n
  const openShares = totalShareSupply > queuedShares ? totalShareSupply - queuedShares : 0n
  const deployed = totalAllocated > idle ? totalAllocated - idle : 0n
  const atRisk = totalShareSupply > 0n ? (deployed * openShares) / totalShareSupply : 0n
  return { idle, atRisk, total: idle + atRisk }
}

export async function getMasterAllocation(sql: IIndexerClient, masterAccount: Address): Promise<IMasterAllocation> {
  const lower = getAddress(masterAccount)
  const [balance, share] = await Promise.all([
    select(sql, 'AccountState', { where: { account: { _eq: lower } }, fields: BALANCE_FIELDS }),
    select(sql, 'ShareTokenMetric', { where: { id: { _eq: lower } }, fields: SHARE_FIELDS })
  ])
  return buildAllocation(balance, share[0])
}

export function liveMasterAllocation(sql: IIndexerClient, masterAccount: Address): IStream<IMasterAllocation> {
  const lower = getAddress(masterAccount)
  const rows = liveSelect(sql, 'AccountState', { where: { account: { _eq: lower } }, fields: BALANCE_FIELDS })
  const share = liveSelect(sql, 'ShareTokenMetric', { where: { id: { _eq: lower } }, fields: SHARE_FIELDS })
  return map(parts => buildAllocation(parts.rows, parts.share[0]), combine({ rows, share }))
}
