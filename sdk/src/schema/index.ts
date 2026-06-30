import { getAddress } from 'viem'
import { type InferRow, t, table } from '../datastore/schema.js'

// The puppet-domain tables. Each is declared WITHOUT a name; the SQL name is the export const it is bound to, stamped at
// the instantiation that consumes it (`openDigest` for the fold, `createClient({ schema })` for a read client) by
// passing this module as `import * as schema`. So a table name is never written as a string literal.

export const fundTable = table(
  {
    id: t('text', { pk: true }),
    fund: t('address'),
    shareToken: t('address'),
    baseToken: t('address'),
    name: t('hex'),
    master: t('address', { indexed: true }),
    totalAllocated: t('bigint'),
    totalShareSupply: t('bigint'),
    queuedShares: t('bigint'),
    epoch: t('bigint'),
    accruedPerWeight: t('bigint'),
    weight: t('bigint'),
    liquidationRate: t('bigint'),
    navPerShare: t('bigint'),
    seeded: t('bool')
  },
  { key: row => getAddress(row.fund) }
)
export type IFund = InferRow<(typeof fundTable)['columns']>

export const fundPositionTable = table(
  {
    id: t('text', { pk: true }),
    holder: t('address', { indexed: true }),
    fund: t('address', { indexed: true }),
    baseToken: t('address', { optional: true }),
    body: t('hex', { optional: true }),
    mandate: t('hex', { optional: true }),
    mandatedAt: t('int'),
    lastAllocatedAt: t('int'),
    allocated: t('bigint'),
    sharesHeld: t('bigint'),
    epoch: t('bigint'),
    weight: t('bigint'),
    cursor: t('bigint'),
    closedAccruedPerWeight: t('bigint')
  },
  { key: row => `${getAddress(row.holder)}-${getAddress(row.fund)}` }
)
export type IFundPosition = InferRow<(typeof fundPositionTable)['columns']>

export const tokenRegistryTable = table({
  id: t('text', { pk: true }),
  chainId: t('bigint'),
  token: t('address'),
  cap: t('bigint')
})
export type ITokenRegistry = InferRow<(typeof tokenRegistryTable)['columns']>

// Latest-collapsed signed balance, one row per (chain, account, token).
export const accountBalanceTable = table(
  {
    id: t('text', { pk: true }),
    chainId: t('bigint'),
    account: t('address', { indexed: true }),
    token: t('address'),
    blockNumber: t('bigint'),
    blockTimestamp: t('int'),
    signedBalance: t('bigint')
  },
  { key: row => `${row.chainId}-${getAddress(row.account)}-${getAddress(row.token)}` }
)
export type IAccountBalanceCheckpoint = InferRow<(typeof accountBalanceTable)['columns']>

// Per-block balance history (one row per block, last-write-wins within a block) for the portfolio-value timeline.
export const accountBalanceHistoryTable = table({
  id: t('text', { pk: true }),
  chainId: t('bigint'),
  account: t('address', { indexed: true }),
  token: t('address'),
  blockNumber: t('bigint'),
  blockTimestamp: t('int', { indexed: true }),
  signedBalance: t('bigint')
})
export type IAccountBalanceHistory = InferRow<(typeof accountBalanceHistoryTable)['columns']>

export const fundCheckpointTable = table({
  id: t('text', { pk: true }),
  fund: t('address', { indexed: true }),
  blockTimestamp: t('int'),
  navPerShare: t('bigint')
})
export type IFundCheckpoint = InferRow<(typeof fundCheckpointTable)['columns']>

export const fundLatestMetricTable = table({
  id: t('text', { pk: true }),
  interval: t('int'),
  user: t('address', { optional: true }),
  baseToken: t('address'),
  fund: t('address', { indexed: true }),
  allocated: t('bigint'),
  navPerShare: t('bigint'),
  realisedPnl: t('bigint'),
  realisedPnlUsd: t('bigint'),
  openPnl: t('bigint'),
  pnlList: t('bigint[]'),
  pnlTimestampList: t('int[]'),
  lastUpdatedTimestamp: t('int')
})
export type IFundLatestMetric = InferRow<(typeof fundLatestMetricTable)['columns']>

export const platformScaleTable = table({
  id: t('text', { pk: true }),
  maxPnlUsd: t('bigint'),
  maxRoi: t('bigint'),
  lastUpdatedTimestamp: t('int')
})
export type IPlatformScale = InferRow<(typeof platformScaleTable)['columns']>

export const accountIdentityTable = table(
  {
    id: t('text', { pk: true }),
    chainId: t('bigint'),
    account: t('address', { indexed: true }),
    isFund: t('bool'),
    user: t('address', { indexed: true }),
    signer: t('address'),
    route: t('address'),
    baseToken: t('address', { optional: true }),
    name: t('hex', { optional: true })
  },
  { key: row => `${row.chainId}-${getAddress(row.account)}` }
)
export type IAccountIdentityRow = InferRow<(typeof accountIdentityTable)['columns']>

// ---- GMX-trader (shadow) leaderboard: a second datastore fold over GMX EventLog1 PositionIncrease/Decrease. ----

export const gmxPositionTable = table({
  id: t('text', { pk: true }),
  account: t('address', { indexed: true }),
  venueId: t('text'),
  market: t('address'),
  collateralToken: t('address'),
  isLong: t('bool'),
  status: t('text'),
  sizeInUsd: t('bigint'),
  sizeInTokens: t('bigint'),
  collateralInUsd: t('bigint'),
  pnl: t('bigint'),
  realizedPnlUsd: t('bigint'),
  cumulativeSizeInUsd: t('bigint'),
  openedAt: t('int'),
  closedAt: t('int'),
  lastUpdatedAt: t('int')
})
export type IGmxPosition = InferRow<(typeof gmxPositionTable)['columns']>

// Per-(account, collateralToken) running aggregate over that account's OPEN GMX positions, folded incrementally so the
// trader metric reads it in O(1) instead of re-scanning + decoding the account's whole position set on every event. Held
// drift-free by the datastore-wide reorg reset (resetAll wipes this with every table and re-folds from genesis).
export const gmxCrossOpenTable = table(
  {
    id: t('text', { pk: true }),
    account: t('address', { indexed: true }),
    collateralToken: t('address'),
    sizeInUsd: t('bigint'),
    longSizeInUsd: t('bigint'),
    collateralInUsd: t('bigint'),
    pnl: t('bigint')
  },
  { key: row => `${getAddress(row.account)}-${getAddress(row.collateralToken)}` }
)
export type IGmxCrossOpen = InferRow<(typeof gmxCrossOpenTable)['columns']>

export const gmxTraderMetricTable = table({
  id: t('text', { pk: true }),
  interval: t('int'),
  account: t('address', { indexed: true }),
  collateralToken: t('address'),
  realisedSizeInUsd: t('bigint'),
  realisedCollateralInUsd: t('bigint'),
  realisedSizeLongInUsd: t('bigint'),
  openSizeInUsd: t('bigint'),
  openCollateralInUsd: t('bigint'),
  openSizeLongInUsd: t('bigint'),
  realisedPnl: t('bigint'),
  pnl: t('bigint'),
  realisedRoi: t('bigint'),
  roi: t('bigint'),
  longShortRatio: t('bigint'),
  winCount: t('int'),
  lossCount: t('int'),
  pnlList: t('bigint[]'),
  pnlTimestampList: t('int[]'),
  lastUpdatedTimestamp: t('int')
})
export type IGmxTraderMetric = InferRow<(typeof gmxTraderMetricTable)['columns']>
