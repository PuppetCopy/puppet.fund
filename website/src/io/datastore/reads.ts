import { PRECISION } from '@puppet/contracts/const'
import { ADDRESS_ZERO } from '@puppet/sdk/const'
import { createClient } from '@puppet/sdk/datastore'
import * as schema from '@puppet/sdk/schema'
import {
  type IGmxClaimableRow,
  type IGmxOrderRow,
  makeOnchainGmxClaimableProvider,
  makeOnchainGmxOrderProvider,
  makeOnchainGmxPositionProvider
} from '@puppet/sdk/gmx'
import {
  accountBalanceHistoryTable,
  accountIdentityTable,
  fundCheckpointTable,
  fundLatestMetricTable,
  fundTable,
  type IAccountBalanceHistory,
  type IAccountIdentityRow,
  type IFund,
  type IFundCheckpoint,
  type IFundLatestMetric,
  type IPlatformScale,
  platformScaleTable
} from '@puppet/sdk/schema'
import { PLATFORM_SCALE_ID, scalePercentile } from '@puppet/sdk/state'
import type { IFundRank } from '@puppet/sdk/ui-components'
import { GMX_V2_CHAIN_ID } from '@puppet/sdk/venue'
import type { IAccountPosition, IAccountPositionStatus } from '@puppet/sdk/venue'
import { getPublicClient } from '@wagmi/core'
import { type Address, getAddress, type Hex, type PublicClient } from 'viem'
import { wagmi } from '../../wallet/index.js'
import { getRate } from '../context.js'

// The datastore read client, used directly at call sites: client.select(table, { where, orderBy, … }) / client.find(
// table, where) execute against journal's /query (filter + sort + page server-side via the shared runRows engine). The
// browser hits the same-origin path, proxied to JOURNAL_ENDPOINT in dev and the journal service via Caddy in prod.
// Only reads that carry real logic (empty-set short-circuits, opts → where building) keep a named wrapper below.
export const client = createClient({
  storageUrl: '/api/journal',
  schema
})

const selectWithEmptyGuard = <T>(list: readonly unknown[], fn: () => Promise<T[]>): Promise<T[]> =>
  list.length === 0 ? Promise.resolve([]) : fn()

export const fetchFundsByIds = (ids: Hex[]): Promise<IFund[]> =>
  selectWithEmptyGuard(ids, () => client.select(fundTable, { where: { id: { in: ids } } }))

export const fetchPlatformScale = async (): Promise<IPlatformScale | null> => {
  const rows = await client.select(platformScaleTable, { where: { id: PLATFORM_SCALE_ID } })
  return rows[0] ?? null
}

export const fundRank = (
  metric: Pick<IFundLatestMetric, 'navPerShare' | 'realisedPnlUsd'> | null,
  scale: IPlatformScale | null
): IFundRank => {
  if (!metric || !scale) return { pnlPercentile: null, roiPercentile: null }
  return {
    pnlPercentile: scalePercentile(metric.realisedPnlUsd, scale.maxPnlUsd),
    roiPercentile: scalePercentile(metric.navPerShare - PRECISION.floatPrecisionExp, scale.maxRoi)
  }
}

export const fetchIdentitiesForAccounts = (accounts: Hex[]): Promise<IAccountIdentityRow[]> =>
  selectWithEmptyGuard(accounts, () => client.select(accountIdentityTable, { where: { account: { in: accounts } } }))

export interface ILeaderboardQuery {
  sort?: 'realisedPnl' | 'navPerShare' | 'allocated'
  limit?: number
  offset?: number
  baseToken?: Hex
  now?: number
}

export const fetchLeaderboardMetrics = (interval: number, opts: ILeaderboardQuery = {}): Promise<IFundLatestMetric[]> =>
  client.select(fundLatestMetricTable, {
    where: {
      interval,
      baseToken: opts.baseToken,
      lastUpdatedTimestamp: opts.now === undefined ? undefined : { gte: opts.now - interval }
    },
    orderBy: { col: opts.sort ?? 'realisedPnl', dir: 'desc' },
    limit: opts.limit,
    offset: opts.offset
  })

// Full balance-checkpoint history for the portfolio-value timeline (replayed in the browser; pre-window checkpoints
// establish the starting balance, so no separate seed read is needed).
export const fetchBalanceHistory = (accounts: Hex[]): Promise<IAccountBalanceHistory[]> =>
  selectWithEmptyGuard(accounts, () =>
    client.select(accountBalanceHistoryTable, {
      where: { account: { in: accounts } },
      orderBy: { col: 'blockTimestamp', dir: 'asc' }
    })
  )

export const fetchFundCheckpointsForFunds = (funds: Hex[]): Promise<IFundCheckpoint[]> =>
  selectWithEmptyGuard(funds, () =>
    client.select(fundCheckpointTable, {
      where: { fund: { in: funds } },
      orderBy: { col: 'blockTimestamp', dir: 'asc' }
    })
  )

// Raw signed-domain events for the fund activity feed (journal-filtered to the account); the caller decodes the intent.
// These are not folded-table reads, so journal serves them raw off the log on dedicated routes (/activity, /deposit-tx).
const qs = (params: Record<string, string | number | undefined>): string => {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v))
  return q.toString()
}

export interface IRawEvent {
  chainId: bigint
  method: Hex
  data: Hex
  blockNumber: bigint
  blockTimestamp: number
  transactionHash: Hex
}

export async function fetchRawActivity(account: Hex, limit = 40): Promise<IRawEvent[]> {
  const res = await fetch(`/api/journal/activity?${qs({ account, limit })}`)
  if (!res.ok) throw new Error(`activity fetch failed: ${res.status}`)
  return ((await res.json()) as Record<string, unknown>[]).map(r => ({
    chainId: BigInt(r.chainId as string),
    method: r.method as Hex,
    data: r.data as Hex,
    blockNumber: BigInt(r.blockNumber as string),
    blockTimestamp: r.blockTimestamp as number,
    transactionHash: r.transactionHash as Hex
  }))
}

// Open GMX positions for an account, read ON-CHAIN (GmxReaderV2 over RPC) — the exact provider the relay's co-sign
// path uses. An account's own positions are SELF data (RPC, never the indexer), and the journal carries no
// gmxPositionTable fold — the old /query read returned a permanently empty set that rendered as "No open positions"
// and silently zeroed browser-side NAV. Throws (like every client read) so a safety/signing caller never mistakes an
// unreadable position set for "no positions"; display callers catch and degrade explicitly. History-only fields the
// chain doesn't carry (realized pnl, timestamps) return zero-values; open-row consumers don't render them.
export async function fetchOpenPositions(account: Hex): Promise<IAccountPosition[]> {
  const publicClient = getPublicClient(wagmi, { chainId: GMX_V2_CHAIN_ID })
  if (!publicClient) throw new Error(`no public client for chain ${GMX_V2_CHAIN_ID}`)
  // The provider signature carries the fund's numeraire for implementations that need it; the on-chain reader prices
  // collateral through its own rate getter and ignores it.
  const rows = await makeOnchainGmxPositionProvider(publicClient as PublicClient, getRate)(
    getAddress(account),
    ADDRESS_ZERO
  )
  return rows.map(r => ({
    positionId: r.positionKey as Hex,
    account: getAddress(account),
    venueId: 'gmx',
    market: r.market,
    collateralToken: r.collateralToken,
    isLong: r.isLong,
    status: 'open' as IAccountPositionStatus,
    sizeInUsd: r.sizeInUsd,
    sizeInTokens: r.sizeInTokens,
    collateralInUsd: r.collateralUsd,
    collateralAmount: r.collateralAmount,
    pnl: r.storedPnlUsd,
    realizedPnlUsd: 0n,
    cumulativeSizeInUsd: r.sizeInUsd,
    openedAt: 0,
    closedAt: 0,
    lastUpdatedAt: 0
  }))
}

export async function fetchOpenOrders(account: Hex): Promise<IGmxOrderRow[]> {
  const publicClient = getPublicClient(wagmi, { chainId: GMX_V2_CHAIN_ID })
  if (!publicClient) throw new Error(`no public client for chain ${GMX_V2_CHAIN_ID}`)
  return makeOnchainGmxOrderProvider(publicClient as PublicClient)(getAddress(account))
}

export async function fetchClaimableFunding(account: Hex): Promise<IGmxClaimableRow[]> {
  const publicClient = getPublicClient(wagmi, { chainId: GMX_V2_CHAIN_ID })
  if (!publicClient) throw new Error(`no public client for chain ${GMX_V2_CHAIN_ID}`)
  return makeOnchainGmxClaimableProvider(publicClient as PublicClient)(getAddress(account))
}

export async function findDepositTx(recipient: Address, chainId: number, minBlock: bigint): Promise<Hex | null> {
  try {
    const res = await fetch(
      `/api/journal/deposit-tx?${qs({ recipient: getAddress(recipient), chainId, minBlock: minBlock.toString() })}`
    )
    if (!res.ok) return null
    return ((await res.json()) as { transactionHash: Hex | null }).transactionHash
  } catch {
    return null
  }
}
