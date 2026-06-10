import type { IAccountBalance, IFund } from '@puppet/indexer-graphql/entities'
import { type IStream, just, map, op, switchMap } from 'aelea/stream'
import { type Address, getAddress } from 'viem'
import { type IIndexerClient, liveSelect, select, selectOne } from './shared.js'

export interface IFundAllocation {
  idle: bigint
  atRisk: bigint
  total: bigint
}

type IBalanceRow = Pick<IAccountBalance, 'signedBalance'>

const FUND_FIELDS = ['baseTokenId', 'totalAllocated', 'totalShareSupply', 'queuedShares'] as const
const BALANCE_FIELDS = ['signedBalance'] as const

const EMPTY_ALLOCATION: IFundAllocation = { idle: 0n, atRisk: 0n, total: 0n }

function buildAllocation(rows: IBalanceRow[], fund: IFund): IFundAllocation {
  let idle = 0n
  for (const r of rows) idle += r.signedBalance
  const openShares = fund.totalShareSupply > fund.queuedShares ? fund.totalShareSupply - fund.queuedShares : 0n
  const deployed = fund.totalAllocated > idle ? fund.totalAllocated - idle : 0n
  const atRisk = fund.totalShareSupply > 0n ? (deployed * openShares) / fund.totalShareSupply : 0n
  return { idle, atRisk, total: idle + atRisk }
}

export async function getFundAllocation(sql: IIndexerClient, fund: Address): Promise<IFundAllocation> {
  const lower = getAddress(fund)
  const fundRow = await selectOne(sql, 'Fund', { where: { id: { _eq: lower } }, fields: FUND_FIELDS })
  if (!fundRow) return EMPTY_ALLOCATION
  const balance = await select(sql, 'AccountBalance', {
    where: { account: { _eq: lower }, tokenId: { _eq: fundRow.baseTokenId } },
    fields: BALANCE_FIELDS
  })
  return buildAllocation(balance, fundRow)
}

export function liveFundAllocation(sql: IIndexerClient, fund: Address): IStream<IFundAllocation> {
  const lower = getAddress(fund)
  const fundStream = liveSelect(sql, 'Fund', { where: { id: { _eq: lower } }, fields: FUND_FIELDS })
  return op(
    fundStream,
    switchMap(funds => {
      const fundRow = funds[0]
      if (!fundRow) return just(EMPTY_ALLOCATION)
      const rows = liveSelect(sql, 'AccountBalance', {
        where: { account: { _eq: lower }, tokenId: { _eq: fundRow.baseTokenId } },
        fields: BALANCE_FIELDS
      })
      return map(balance => buildAllocation(balance, fundRow), rows)
    })
  )
}
