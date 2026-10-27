import { getAddress } from 'viem'
import { type InferRow, t, table } from '../datastore/schema.js'

export const accountTable = table(
  {
    chainId: t('bigint'),
    account: t('address', { indexed: true }),
    owner: t('address', { indexed: true }),
    epoch: t('bigint'),
    revokedAt: t('int'),
    createdAt: t('int'),
    lastBlock: t('int'),
    lastLogIndex: t('int')
  },
  { key: row => `${row.chainId}-${getAddress(row.account)}` }
)
export type IAccountRow = InferRow<(typeof accountTable)['columns']>

export const flowTable = table({
  id: t('text', { pk: true }),
  chainId: t('bigint'),
  account: t('address', { indexed: true }),
  token: t('address', { indexed: true }),
  amount: t('bigint'),
  block: t('int'),
  blockTimestamp: t('int'),
  logIndex: t('int'),
  pending: t('bool', { indexed: true }),
  value: t('bigint', { optional: true }),
  ethUsd: t('bigint', { optional: true })
})
export type IFlowRow = InferRow<(typeof flowTable)['columns']>

export const venueTable = table(
  {
    account: t('address', { indexed: true }),
    venue: t('text'),
    chainId: t('bigint'),
    lastDepositTimestamp: t('int')
  },
  { key: row => `${getAddress(row.account)}-${row.venue}-${row.chainId}` }
)

export const allowanceTable = table(
  {
    chainId: t('bigint'),
    account: t('address', { indexed: true }),
    venue: t('text'),
    token: t('address'),
    spender: t('address'),
    implied: t('bigint')
  },
  { key: row => `${row.chainId}-${getAddress(row.account)}-${getAddress(row.token)}-${getAddress(row.spender)}` }
)
export type IAllowanceRow = InferRow<(typeof allowanceTable)['columns']>

export const positionTable = table({
  id: t('text', { pk: true }),
  account: t('address', { indexed: true }),
  venue: t('text'),
  holder: t('address'),
  chainId: t('bigint', { optional: true }),
  contract: t('address', { optional: true }),
  key: t('text'),
  kind: t('text'),
  label: t('text'),
  url: t('text', { optional: true }),
  size: t('bigint'),
  unit: t('text'),
  decimals: t('int'),
  long: t('bool', { optional: true }),
  entry: t('bigint', { optional: true }),
  collateral: t('bigint', { optional: true }),
  collateralUnit: t('text', { optional: true }),
  cost: t('bigint', { optional: true }),
  value: t('bigint', { optional: true }),
  accruedCost: t('bigint', { optional: true }),
  fieldLabelList: t('text[]'),
  fieldValueList: t('text[]'),
  time: t('int')
})
export type IPositionRow = InferRow<(typeof positionTable)['columns']>

export const ACCOUNT_VENUE = 'account'

export const positionSyncTable = table({
  id: t('text', { pk: true }),
  account: t('address', { indexed: true }),
  venue: t('text'),
  time: t('int'),
  idList: t('text[]')
})

export const observationTable = table({
  id: t('text', { pk: true }),
  account: t('address', { indexed: true }),
  source: t('text'),
  time: t('int'),
  data: t('text')
})

export const fundListTable = table({
  id: t('text', { pk: true }),
  masterList: t('text[]')
})

export const fundTable = table(
  {
    master: t('address', { indexed: true }),
    shareToken: t('address'),
    symbol: t('hex'),
    pixels: t('hex'),
    performanceFee: t('bigint'),
    totalShares: t('bigint'),
    value: t('bigint'),
    averageCost: t('bigint'),
    transactionHash: t('hex'),
    lastBlock: t('int')
  },
  { key: row => getAddress(row.master) }
)
export type IFundRow = InferRow<(typeof fundTable)['columns']>

export const escrowTable = table(
  {
    owner: t('address', { indexed: true }),
    chainId: t('bigint'),
    token: t('address'),
    escrowed: t('bigint'),
    released: t('bigint'),
    returned: t('bigint')
  },
  { key: row => `${getAddress(row.owner)}-${row.chainId}-${getAddress(row.token)}` }
)
export type IEscrowRow = InferRow<(typeof escrowTable)['columns']>

export const fulfilTable = table(
  {
    owner: t('address', { indexed: true }),
    master: t('address', { indexed: true }),
    chainId: t('bigint'),
    token: t('address'),
    fulfilled: t('bigint'),
    feeBilled: t('bigint'),
    lastBlock: t('int'),
    lastLogIndex: t('int')
  },
  { key: row => `${getAddress(row.owner)}-${getAddress(row.master)}-${row.chainId}-${getAddress(row.token)}` }
)
export type IFulfilRow = InferRow<(typeof fulfilTable)['columns']>

export const creditTable = table(
  {
    master: t('address', { indexed: true }),
    creditChainId: t('bigint'),
    token: t('address'),
    credited: t('bigint'),
    feeOwed: t('bigint')
  },
  { key: row => `${getAddress(row.master)}-${row.creditChainId}-${getAddress(row.token)}` }
)
export type ICreditRow = InferRow<(typeof creditTable)['columns']>

export const ownerCreditTable = table(
  {
    owner: t('address', { indexed: true }),
    chainId: t('bigint'),
    token: t('address'),
    credited: t('bigint')
  },
  { key: row => `${getAddress(row.owner)}-${row.chainId}-${getAddress(row.token)}` }
)
export type IOwnerCreditRow = InferRow<(typeof ownerCreditTable)['columns']>

export const holdingTable = table(
  {
    master: t('address', { indexed: true }),
    holder: t('address', { indexed: true }),
    shares: t('bigint', { sorted: true }),
    queued: t('bigint'),
    allocatedAt: t('bigint'),
    redeemedAt: t('bigint'),
    cost: t('bigint')
  },
  { key: row => `${getAddress(row.master)}-${getAddress(row.holder)}` }
)
export type IHoldingRow = InferRow<(typeof holdingTable)['columns']>

export const redemptionTable = table(
  {
    master: t('address', { indexed: true }),
    id: t('bigint'),
    fraction: t('int'),
    fee: t('bigint'),
    masterPay: t('bigint'),
    queued: t('bigint'),
    owedLeft: t('bigint'),
    potLeft: t('bigint'),
    token: t('address'),
    price: t('bigint'),
    rateAmount: t('bigint', { optional: true }),
    rateValue: t('bigint', { optional: true })
  },
  { key: row => getAddress(row.master) }
)
export type IRedemptionRow = InferRow<(typeof redemptionTable)['columns']>

export const balanceTable = table(
  {
    chainId: t('bigint'),
    account: t('address', { indexed: true }),
    token: t('address'),
    amount: t('bigint'),
    lastBlock: t('int')
  },
  { key: row => `${row.chainId}-${getAddress(row.account)}-${getAddress(row.token)}` }
)
export type IBalanceRow = InferRow<(typeof balanceTable)['columns']>

export const transitTable = table({
  id: t('text', { pk: true }),
  chainId: t('bigint'),
  account: t('address', { indexed: true }),
  destinationChainId: t('bigint'),
  relayHash: t('hex'),
  fillDeadline: t('int'),
  inputToken: t('address'),
  inputAmount: t('bigint'),
  outputToken: t('address'),
  outputAmount: t('bigint'),
  block: t('int'),
  blockTimestamp: t('int'),
  logIndex: t('int')
})
export type ITransitRow = InferRow<(typeof transitTable)['columns']>

export const fundMetricTable = table({
  id: t('text', { pk: true }),
  interval: t('int', { indexed: true }),
  master: t('address', { indexed: true }),
  venueList: t('text[]'),
  venueTimeList: t('int[]'),
  allocationTimeList: t('int[]'),
  pnlList: t('bigint[]'),
  performanceIndexList: t('bigint[]'),
  pnlTimestampList: t('int[]'),
  openingIndex: t('bigint'),
  pnl: t('bigint', { sorted: true }),
  roi: t('bigint', { sorted: true }),
  lastUpdatedTimestamp: t('int', { sorted: true }),
  symbol: t('hex', { optional: true }),
  pixels: t('hex', { optional: true }),
  backers: t('int'),
  totalShares: t('bigint'),
  backerShares: t('bigint'),
  valuation: t('bigint', { sorted: true })
})
export type IFundMetricRow = InferRow<(typeof fundMetricTable)['columns']>

export const mandateTable = table(
  {
    puppet: t('address', { indexed: true }),
    master: t('address', { indexed: true }),
    skin: t('bigint'),
    allocationRate: t('bigint'),
    exitCap: t('bigint'),
    cooldownPeriod: t('bigint'),
    expiry: t('bigint'),
    epoch: t('bigint')
  },
  { key: row => `${getAddress(row.puppet)}-${getAddress(row.master)}` }
)
export type IMandateRow = InferRow<(typeof mandateTable)['columns']>
