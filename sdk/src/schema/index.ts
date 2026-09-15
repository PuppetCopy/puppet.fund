import { getAddress } from 'viem'
import { type InferRow, t, table } from '../datastore/schema.js'

export const accountTable = table(
  {
    chainId: t('bigint'),
    account: t('address', { indexed: true }),
    owner: t('address', { indexed: true }),
    signer: t('address'),
    createdAt: t('int'),
    lastBlock: t('int'),
    lastLogIndex: t('int')
  },
  { key: row => `${row.chainId}-${getAddress(row.account)}` }
)
export type IAccountRow = InferRow<(typeof accountTable)['columns']>

export const accountBalanceTable = table({
  id: t('text', { pk: true }),
  chainId: t('bigint'),
  account: t('address', { indexed: true }),
  token: t('address'),
  book: t('bigint')
})
export type IAccountBalanceRow = InferRow<(typeof accountBalanceTable)['columns']>

export const bondTable = table({
  id: t('text', { pk: true }),
  chainId: t('bigint'),
  account: t('address', { indexed: true }),
  token: t('address'),
  bond: t('bigint')
})
export type IBondRow = InferRow<(typeof bondTable)['columns']>

export const depositTable = table({
  id: t('text', { pk: true }),
  chainId: t('bigint'),
  account: t('address', { indexed: true }),
  token: t('address'),
  deposit: t('bigint')
})
export type IDepositRow = InferRow<(typeof depositTable)['columns']>

export const flowTable = table({
  id: t('text', { pk: true }),
  chainId: t('bigint'),
  account: t('address', { indexed: true }),
  owner: t('address', { indexed: true }),
  token: t('address'),
  amount: t('bigint'),
  block: t('int'),
  blockTimestamp: t('int'),
  logIndex: t('int'),
  transactionHash: t('hex'),
  settlement: t('bool'),
  pending: t('bool', { indexed: true }),
  value: t('bigint', { optional: true })
})
export type IFlowRow = InferRow<(typeof flowTable)['columns']>

export const bookTable = table({
  id: t('text', { pk: true }),
  chainId: t('bigint'),
  master: t('address', { indexed: true }),
  owner: t('address', { indexed: true }),
  cycle: t('bigint'),
  token: t('address'),
  backed: t('bigint'),
  collateral: t('bigint'),
  skin: t('bigint'),
  totalShares: t('bigint'),
  totalPending: t('bigint'),
  masterShares: t('bigint'),
  masterPending: t('bigint'),
  feeTokens: t('hex[]'),
  feeAmounts: t('bigint[]'),
  backerList: t('hex[]'),
  lastMark: t('text'),
  lastBlock: t('int'),
  lastLogIndex: t('int')
})
export type IBookRow = InferRow<(typeof bookTable)['columns']>

export const backerTable = table({
  id: t('text', { pk: true }),
  chainId: t('bigint'),
  master: t('address', { indexed: true }),
  puppet: t('address', { indexed: true }),
  stake: t('bigint'),
  pending: t('bigint'),
  shares: t('bigint'),
  committedAt: t('int')
})
export type IBackerRow = InferRow<(typeof backerTable)['columns']>

export const backingTable = table({
  id: t('text', { pk: true }),
  chainId: t('bigint'),
  puppet: t('address', { indexed: true }),
  master: t('address', { indexed: true }),
  cycle: t('bigint'),
  stake: t('bigint'),
  block: t('int'),
  blockTimestamp: t('int'),
  logIndex: t('int'),
  transactionHash: t('hex')
})
export type IBackingRow = InferRow<(typeof backingTable)['columns']>

export const markTable = table({
  id: t('text', { pk: true }),
  chainId: t('bigint'),
  book: t('text', { indexed: true }),
  master: t('address', { indexed: true }),
  cycle: t('bigint'),
  block: t('int'),
  blockTimestamp: t('int'),
  logIndex: t('int'),
  transactionHash: t('hex'),
  openValue: t('bigint'),
  ledgerPuppetValue: t('bigint'),
  collateral: t('bigint'),
  inflow: t('bigint'),
  opening: t('bool'),
  feeTokens: t('hex[]'),
  feeAmounts: t('bigint[]'),
  pending: t('bool', { indexed: true }),
  closeValue: t('bigint', { optional: true }),
  closeRate0: t('bigint', { optional: true }),
  closeRate1: t('bigint', { optional: true }),
  nextPuppetValue: t('bigint', { optional: true }),
  priceTime: t('int', { optional: true }),
  evaluatedAt: t('int', { optional: true })
})
export type IMarkRow = InferRow<(typeof markTable)['columns']>

export const masterMetricTable = table({
  id: t('text', { pk: true }),
  interval: t('int', { indexed: true }),
  master: t('address', { indexed: true }),
  pnlList: t('bigint[]'),
  pnlTimestampList: t('int[]'),
  pnl: t('bigint'),
  committed: t('bigint'),
  capital: t('bigint'),
  roi: t('bigint'),
  level: t('bigint'),
  weighted: t('bigint'),
  coverage: t('bigint'),
  lastUpdatedTimestamp: t('int')
})
export type IMasterMetricRow = InferRow<(typeof masterMetricTable)['columns']>

export const settlementTable = table({
  id: t('text', { pk: true }),
  master: t('address', { indexed: true }),
  spokeChainId: t('bigint'),
  cycle: t('bigint'),
  kind: t('text'),
  token: t('address', { optional: true }),
  value: t('bigint', { optional: true }),
  block: t('int'),
  blockTimestamp: t('int'),
  logIndex: t('int'),
  transactionHash: t('hex')
})
export type ISettlementRow = InferRow<(typeof settlementTable)['columns']>

export const settleRowTable = table({
  id: t('text', { pk: true }),
  chainId: t('bigint'),
  spokeChainId: t('bigint'),
  master: t('address', { indexed: true }),
  puppet: t('address', { indexed: true }),
  cycle: t('bigint'),
  kind: t('text'),
  token: t('address'),
  amount: t('bigint'),
  moved: t('bigint'),
  block: t('int'),
  blockTimestamp: t('int'),
  logIndex: t('int'),
  transactionHash: t('hex')
})
export type ISettleRowRow = InferRow<(typeof settleRowTable)['columns']>

export const mandateTable = table(
  {
    chainId: t('bigint'),
    puppet: t('address', { indexed: true }),
    master: t('address', { indexed: true }),
    skin: t('bigint'),
    allocationRate: t('bigint'),
    cooldownPeriod: t('bigint'),
    expiry: t('bigint'),
    tokenIdList: t('hex[]'),
    signature: t('hex'),
    block: t('int'),
    blockTimestamp: t('int')
  },
  { key: row => `${getAddress(row.puppet)}-${getAddress(row.master)}` }
)
export type IMandateRow = InferRow<(typeof mandateTable)['columns']>
