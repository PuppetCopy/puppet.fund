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
  owner: t('address', { indexed: true }),
  token: t('address'),
  amount: t('bigint'),
  block: t('int'),
  blockTimestamp: t('int'),
  logIndex: t('int'),
  transactionHash: t('hex'),
  pending: t('bool', { indexed: true }),
  value: t('bigint', { optional: true })
})
export type IFlowRow = InferRow<(typeof flowTable)['columns']>

export const fundTable = table(
  {
    master: t('address', { indexed: true }),
    share: t('address'),
    symbol: t('hex'),
    pixels: t('hex'),
    performanceFee: t('bigint'),
    totalUnits: t('bigint'),
    skin: t('bigint'),
    value: t('bigint'),
    lastBlock: t('int'),
    lastLogIndex: t('int')
  },
  { key: row => getAddress(row.master) }
)
export type IFundRow = InferRow<(typeof fundTable)['columns']>

export const escrowTable = table(
  {
    parent: t('address', { indexed: true }),
    master: t('address', { indexed: true }),
    chainId: t('bigint'),
    token: t('address'),
    escrowed: t('bigint'),
    fulfilled: t('bigint'),
    feeBilled: t('bigint'),
    lastBlock: t('int'),
    lastLogIndex: t('int')
  },
  { key: row => `${getAddress(row.parent)}-${getAddress(row.master)}-${row.chainId}-${getAddress(row.token)}` }
)
export type IEscrowRow = InferRow<(typeof escrowTable)['columns']>

export const creditTable = table(
  {
    master: t('address', { indexed: true }),
    creditChainId: t('bigint'),
    token: t('address'),
    round: t('hex'),
    credited: t('bigint'),
    feeOwed: t('bigint'),
    lastBlock: t('int'),
    lastLogIndex: t('int')
  },
  { key: row => `${getAddress(row.master)}-${row.creditChainId}-${getAddress(row.token)}` }
)
export type ICreditRow = InferRow<(typeof creditTable)['columns']>

export const holdingTable = table(
  {
    master: t('address', { indexed: true }),
    holder: t('address', { indexed: true }),
    units: t('bigint'),
    basis: t('bigint'),
    allocatedAt: t('bigint'),
    lastBlock: t('int'),
    lastLogIndex: t('int')
  },
  { key: row => `${getAddress(row.master)}-${getAddress(row.holder)}` }
)
export type IHoldingRow = InferRow<(typeof holdingTable)['columns']>

export const queueTable = table(
  {
    master: t('address', { indexed: true }),
    epoch: t('bigint'),
    units: t('bigint'),
    weight: t('bigint'),
    masterWeight: t('bigint'),
    accrued: t('bigint'),
    lastBlock: t('int'),
    lastLogIndex: t('int')
  },
  { key: row => getAddress(row.master) }
)
export type IQueueRow = InferRow<(typeof queueTable)['columns']>

export const closedAccruedTable = table(
  {
    master: t('address', { indexed: true }),
    epoch: t('bigint'),
    accrued: t('bigint')
  },
  { key: row => `${getAddress(row.master)}-${row.epoch}` }
)
export type IClosedAccruedRow = InferRow<(typeof closedAccruedTable)['columns']>

export const positionTable = table(
  {
    master: t('address', { indexed: true }),
    holder: t('address', { indexed: true }),
    epoch: t('bigint'),
    weight: t('bigint'),
    units: t('bigint'),
    basis: t('bigint'),
    cursor: t('bigint'),
    lastBlock: t('int'),
    lastLogIndex: t('int')
  },
  { key: row => `${getAddress(row.master)}-${getAddress(row.holder)}` }
)
export type IPositionRow = InferRow<(typeof positionTable)['columns']>

export const valuationTable = table(
  {
    master: t('address', { indexed: true }),
    kind: t('text'),
    value: t('bigint'),
    totalUnits: t('bigint'),
    contribution: t('bigint'),
    assetChainIdList: t('bigint[]'),
    assetTokenList: t('hex[]'),
    assetAmountList: t('bigint[]'),
    positionChainIdList: t('bigint[]'),
    positionVenueList: t('hex[]'),
    positionIdList: t('hex[]'),
    positionValueList: t('bigint[]'),
    block: t('int'),
    blockTimestamp: t('int'),
    logIndex: t('int'),
    transactionHash: t('hex')
  },
  { key: row => `${getAddress(row.master)}-${row.block}-${row.logIndex}` }
)
export type IValuationRow = InferRow<(typeof valuationTable)['columns']>

export const allocationTable = table({
  id: t('text', { pk: true }),
  master: t('address', { indexed: true }),
  contribution: t('bigint'),
  staked: t('bigint'),
  minted: t('bigint'),
  skin: t('bigint'),
  value: t('bigint'),
  block: t('int'),
  blockTimestamp: t('int'),
  logIndex: t('int'),
  transactionHash: t('hex')
})
export type IAllocationRow = InferRow<(typeof allocationTable)['columns']>

export const fundSwapTable = table({
  id: t('text', { pk: true }),
  chainId: t('bigint'),
  digest: t('hex', { indexed: true }),
  account: t('address', { indexed: true }),
  destinationChainId: t('bigint'),
  inputToken: t('address'),
  inputAmount: t('bigint'),
  outputToken: t('address'),
  outputAmount: t('bigint'),
  block: t('int'),
  blockTimestamp: t('int'),
  logIndex: t('int'),
  transactionHash: t('hex')
})

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
  logIndex: t('int'),
  transactionHash: t('hex')
})
export type ITransitRow = InferRow<(typeof transitTable)['columns']>

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

export const mandateTable = table(
  {
    chainId: t('bigint'),
    puppet: t('address', { indexed: true }),
    master: t('address', { indexed: true }),
    skin: t('bigint'),
    allocationRate: t('bigint'),
    cooldownPeriod: t('bigint'),
    expiry: t('bigint'),
    signature: t('hex'),
    block: t('int'),
    blockTimestamp: t('int')
  },
  { key: row => `${getAddress(row.puppet)}-${getAddress(row.master)}` }
)
export type IMandateRow = InferRow<(typeof mandateTable)['columns']>
