import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { IMasterLatestMetric, IPuppetAllocation, IShareTokenMetric } from '@puppet/indexer-graphql/entities'
import { decodeRuleBody, type IAllocationPuppet } from '@puppet/sdk/attestation'
import { BALANCE_TIMELINE_BUCKETS, type IntervalTime, USD_DECIMALS } from '@puppet/sdk/const'
import { formatFixed, getMasterMatchingKey, getUnixTimestamp, resampleTimeSeries } from '@puppet/sdk/core'
import { type ISubaccountState, select, selectOne } from '@puppet/sdk/state'
import { type Address, getAddress, type Hex } from 'viem'
import { sqlClient } from './sql.js'

export type { IMasterLatestMetric } from '@puppet/indexer-graphql/entities'
export type ILeaderboardView = 'masters' | 'shadow'
export type IPerformanceMetric = 'navPerShare' | 'realisedPnl'
interface IGmxPositionBase {
  account: Address
  collateralToken: Address
  indexToken: Address
  market: Address
  positionKey: Hex
  blockTimestamp: number
  isLong: boolean
  sizeInUsd: bigint
  sizeInTokens: bigint
  sizeDeltaUsd: bigint
  collateralInTokens: bigint
  collateralTokenPriceMax: bigint
}
export interface IGmxPositionIncrease extends IGmxPositionBase {
  increasedAtTime: number
  collateralTokenPriceMin: bigint
}
export interface IGmxPositionDecrease extends IGmxPositionBase {
  decreasedAtTime: number
  basePnlUsd: bigint
}
export type ISubscribeRule = Awaited<ReturnType<typeof fetchUserSubscriptions>>[number]

export async function fetchUserSigner(user: Address): Promise<Address | null> {
  const row = await selectOne(sqlClient, 'AccountState', {
    where: { user: { _eq: getAddress(user) } },
    fields: ['signer']
  })
  return row?.signer ?? null
}

export async function fetchUserSubscriptions(puppet: Address) {
  const rows = await select(sqlClient, 'SubscribeModule__Subscribe', {
    where: { puppetAccount: { _eq: getAddress(puppet) } }
  })
  return rows.map(row => {
    const body = decodeRuleBody(row.body)
    return {
      ...row,
      ...body,
      master: row.masterAddr,
      baseToken: row.baseToken,
      masterMatchingKey: getMasterMatchingKey(row.baseToken, row.masterAddr) as Hex
    }
  })
}

export async function fetchMasterPoolState(masterAccount: Address): Promise<IShareTokenMetric | undefined> {
  return selectOne(sqlClient, 'ShareTokenMetric', { where: { id: { _eq: getAddress(masterAccount) } } })
}

export type IPuppetAllocationRow = Awaited<ReturnType<typeof fetchPuppetAllocationList>>[number]

export async function fetchPuppetAllocationList(
  puppetAccounts: Address[]
): Promise<(IPuppetAllocation & { shareToken: IShareTokenMetric | null })[]> {
  if (puppetAccounts.length === 0) return []
  const allocationList = await select(sqlClient, 'PuppetAllocation', {
    where: {
      puppet: { _in: puppetAccounts.map(getAddress) },
      _or: [{ sharesHeld: { _gt: 0n } }, { stake: { _gt: 0n } }, { allocated: { _gt: 0n } }]
    }
  })
  if (allocationList.length === 0) return []

  const masterAccountList = [...new Set(allocationList.map(a => a.masterAccount))]
  const shareList = await select(sqlClient, 'ShareTokenMetric', { where: { id: { _in: masterAccountList } } })
  const shareByMaster = new Map(shareList.map(row => [row.id, row]))
  return allocationList.map(a => ({ ...a, shareToken: shareByMaster.get(a.masterAccount) ?? null }))
}

export async function fetchMasterSubscribers(master: Address): Promise<IAllocationPuppet[]> {
  const subscribed = await select(sqlClient, 'PuppetAllocation', {
    where: { master: { _eq: getAddress(master) }, body: { _is_null: false }, mandate: { _is_null: false } },
    fields: ['puppet', 'body', 'mandate', 'lastAllocatedAt', 'stake']
  })
  if (subscribed.length === 0) return []

  const metrics = await select(sqlClient, 'AccountState', {
    where: { account: { _in: subscribed.map(p => p.puppet) }, chainId: { _eq: BigInt(HUB_CHAIN_ID) } },
    fields: ['account', 'signedBalance']
  })
  const signedBalanceByPuppet = new Map(metrics.map(m => [m.account, m.signedBalance]))
  return subscribed.map(p => ({
    puppet: p.puppet,
    body: p.body as Hex,
    mandate: p.mandate as Hex,
    signedBalance: signedBalanceByPuppet.get(p.puppet) ?? 0n,
    lastAllocatedAt: p.lastAllocatedAt,
    hasOpenRedeem: p.stake > 0n
  }))
}

export async function findWalletDepositTxByRecipient(
  recipient: Address,
  chainId: number,
  minBlock: bigint
): Promise<Hex | null> {
  const row = await selectOne(sqlClient, 'WalletDepositModule__WalletDeposit', {
    where: {
      recipient: { _eq: getAddress(recipient) },
      chainId: { _eq: BigInt(chainId) },
      blockNumber: { _gte: minBlock }
    },
    orderBy: { blockNumber: 'desc' },
    fields: ['transactionHash']
  })
  return row?.transactionHash ?? null
}

export async function fetchMasterRouteMetricList(params: {
  master: Address
  activityTimeframe: IntervalTime
  collateralTokenList: Address[]
}): Promise<IMasterLatestMetric[]> {
  const startActivityTimeframe = getUnixTimestamp() - params.activityTimeframe
  return select(sqlClient, 'MasterLatestMetric', {
    where: {
      master: { _eq: getAddress(params.master) },
      interval: { _eq: params.activityTimeframe },
      lastUpdatedTimestamp: { _gte: startActivityTimeframe },
      ...(params.collateralTokenList.length > 0
        ? { baseTokenId: { _in: params.collateralTokenList.map(getAddress) } }
        : {})
    }
  })
}

export type ILeaderboardRow = IMasterLatestMetric & {
  name: Hex | null
  puppetList: Address[]
  navTimeline: IBalanceTimelinePoint[]
  // Consistency metric derived on the website from the per-trade `pnlList` the indexer already exposes.
  // TODO(indexer): needs maxDrawdown (bps) and sharpeRatio on MasterLatestMetric to surface downside/risk-adjusted
  // return alongside win-rate; drawdown/Sharpe can't be reconstructed from the leaderboard payload alone.
  winCount: number
  lossCount: number
}

export async function fetchLeaderboardPage(params: {
  activityTimeframe: IntervalTime
  account?: Address
  collateralTokenList: Address[]
  sortBy: { direction: 'asc' | 'desc'; selector: keyof IMasterLatestMetric }
  paging: { pageSize: number; offset: number }
}): Promise<ILeaderboardRow[]> {
  const startActivityTimeframe = getUnixTimestamp() - params.activityTimeframe

  const metricList = await select(sqlClient, 'MasterLatestMetric', {
    where: {
      interval: { _eq: params.activityTimeframe },
      lastUpdatedTimestamp: { _gte: startActivityTimeframe },
      // Match either stored casing (event-derived rows are lowercase; predicted accounts are checksummed),
      // so the "Find trader" address search isn't silently filtered out by a case mismatch.
      ...(params.account
        ? { master: { _in: [params.account.toLowerCase() as Address, getAddress(params.account)] } }
        : {}),
      ...(params.collateralTokenList.length > 0
        ? { baseTokenId: { _in: params.collateralTokenList.map(getAddress) } }
        : {})
    },
    orderBy: { [params.sortBy.selector]: params.sortBy.direction },
    limit: params.paging.pageSize,
    offset: params.paging.offset
  })
  if (metricList.length === 0) return []

  const masterList = metricList.map(m => m.master)
  const [subscriberList, checkpointList, nameRows] = await Promise.all([
    select(sqlClient, 'PuppetAllocation', {
      where: { master: { _in: masterList }, body: { _is_null: false }, mandate: { _is_null: false } },
      fields: ['master', 'puppet']
    }),
    select(sqlClient, 'MasterCheckpoint', {
      where: { masterAccount: { _in: masterList }, blockTimestamp: { _gte: startActivityTimeframe } },
      orderBy: { blockTimestamp: 'asc' },
      fields: ['masterAccount', 'blockTimestamp', 'navPerShare']
    }),
    select(sqlClient, 'AccountState', {
      where: { account: { _in: masterList }, chainId: { _eq: BigInt(HUB_CHAIN_ID) } },
      fields: ['account', 'name']
    })
  ])

  const puppetsByMaster = new Map<string, Address[]>()
  for (const s of subscriberList) {
    const list = puppetsByMaster.get(s.master) ?? []
    list.push(s.puppet)
    puppetsByMaster.set(s.master, list)
  }

  const nameByMaster = new Map(nameRows.map(r => [r.account, r.name]))

  const navSourceByMaster = new Map<string, { time: number; nav: bigint }[]>()
  for (const c of checkpointList) {
    const list = navSourceByMaster.get(c.masterAccount) ?? []
    list.push({ time: c.blockTimestamp, nav: c.navPerShare })
    navSourceByMaster.set(c.masterAccount, list)
  }

  const endTime = getUnixTimestamp()
  return metricList.map(m => {
    const source = navSourceByMaster.get(m.master) ?? []
    const navTimeline =
      source.length === 0
        ? []
        : resampleTimeSeries({
            sourceList: [
              { time: startActivityTimeframe, nav: source[0].nav },
              ...source,
              { time: endTime, nav: source[source.length - 1].nav }
            ],
            ticks: BALANCE_TIMELINE_BUCKETS,
            getTime: s => s.time,
            mapSource: s => formatFixed(USD_DECIMALS, s.nav)
          })
    // Derive win/loss consistency from the per-trade realised PnL series the indexer already provides.
    let winCount = 0
    let lossCount = 0
    for (const pnl of m.pnlList) {
      if (pnl > 0n) winCount++
      else if (pnl < 0n) lossCount++
    }
    return {
      ...m,
      name: nameByMaster.get(m.master) ?? null,
      puppetList: puppetsByMaster.get(m.master) ?? [],
      navTimeline,
      winCount,
      lossCount
    }
  })
}

export interface IGmxTraderRow {
  account: Address
  collateralToken: Address
  sizeUsd: bigint
  collateralUsd: bigint
  realisedPnlUsd: bigint
  winCount: number
  lossCount: number
  pnlTimeline: IBalanceTimelinePoint[]
}

export async function fetchGmxTraderLeaderboardPage(params: {
  activityTimeframe: IntervalTime
  account?: Address
  collateralTokenList: Address[]
  sortBy: { direction: 'asc' | 'desc'; selector: 'size' | 'pnl' | 'roi' }
  paging: { pageSize: number; offset: number }
}): Promise<IGmxTraderRow[]> {
  const now = getUnixTimestamp()
  const startActivityTimeframe = now - params.activityTimeframe
  const sortColumn = { size: 'realisedSizeInUsd', pnl: 'pnl', roi: 'roi' } as const

  const metricList = await select(sqlClient, 'GmxTraderRouteMetric', {
    where: {
      interval: { _eq: params.activityTimeframe },
      lastUpdatedTimestamp: { _gte: startActivityTimeframe },
      // Match either stored casing so the address search isn't silently filtered out by case mismatch.
      ...(params.account
        ? { account: { _in: [params.account.toLowerCase() as Address, getAddress(params.account)] } }
        : {}),
      ...(params.collateralTokenList.length > 0
        ? { collateralToken: { _in: params.collateralTokenList.map(getAddress) } }
        : {})
    },
    orderBy: { [sortColumn[params.sortBy.selector]]: params.sortBy.direction },
    limit: params.paging.pageSize,
    offset: params.paging.offset
  })
  if (metricList.length === 0) return []

  return metricList.map(m => {
    // Build a VALID bucketed timeline before cumulating. The indexed per-period series (pnlList/
    // pnlTimestampList on GmxTraderRouteMetric) can arrive out of block-time order, so we bucket each
    // (timestamp, pnl) into a fixed time-slot, sum per slot, sort by time, then cumulate in TIME order.
    // Accumulating in raw array order (as before) both mis-ordered the curve and produced wrong cum
    // values — a later-time pnl folded in early — which is what tripped resampleTimeSeries' sorted-check.
    const slotSize = Math.max(1, Math.floor(params.activityTimeframe / BALANCE_TIMELINE_BUCKETS))
    const pnlBySlot = new Map<number, bigint>()
    for (let i = 0; i < m.pnlTimestampList.length; i++) {
      const slot = Math.floor(m.pnlTimestampList[i] / slotSize) * slotSize
      pnlBySlot.set(slot, (pnlBySlot.get(slot) ?? 0n) + (m.pnlList[i] ?? 0n))
    }
    let cum = 0n
    const points = [...pnlBySlot.keys()]
      .sort((a, b) => a - b)
      .map(slot => {
        cum += pnlBySlot.get(slot) as bigint
        return { time: slot, cum }
      })
    // Slots are pruned indexer-side against the LAST EVENT's time, not wall-clock now, so the oldest
    // slot can predate startActivityTimeframe (now - interval). Clamp the 0-anchor to <= the first point.
    const anchorTime = points.length > 0 ? Math.min(startActivityTimeframe, points[0].time) : startActivityTimeframe
    const pnlTimeline =
      points.length === 0
        ? []
        : resampleTimeSeries({
            sourceList: [{ time: anchorTime, cum: 0n }, ...points, { time: now, cum: points[points.length - 1].cum }],
            ticks: BALANCE_TIMELINE_BUCKETS,
            getTime: s => s.time,
            mapSource: s => formatFixed(USD_DECIMALS, s.cum)
          })
    return {
      account: m.account,
      collateralToken: m.collateralToken,
      sizeUsd: m.realisedSizeInUsd + m.openSizeInUsd,
      collateralUsd: m.realisedCollateralInUsd + m.openCollateralInUsd,
      realisedPnlUsd: m.pnl,
      winCount: m.winCount,
      lossCount: m.lossCount,
      pnlTimeline
    }
  })
}

export async function fetchPositionIncreaseList(_params: {
  account: Address
  collateralTokenList: Address[]
  since: number
}): Promise<(IGmxPositionIncrease & { feeCollected: unknown })[]> {
  return []
}

export async function fetchPositionDecreaseList(_params: {
  account: Address
  collateralTokenList: Address[]
  since: number
}): Promise<(IGmxPositionDecrease & { feeCollected: unknown })[]> {
  return []
}

export interface IBalanceTimelinePoint {
  time: number
  value: number
}

async function currentBalanceUsdByAccount(accounts: ISubaccountState[]): Promise<Map<string, bigint>> {
  const baseTokenIdList = [...new Set(accounts.map(a => a.baseTokenId))]
  const tokenRows = await select(sqlClient, 'RegisterModule__RegisterToken', {
    where: { tokenId: { _in: baseTokenIdList }, chainId: { _eq: BigInt(HUB_CHAIN_ID) } },
    fields: ['tokenId', 'token']
  })
  const tokenByBaseId = new Map(tokenRows.map(row => [row.tokenId as Hex, row.token]))
  const tokenList = [...new Set([...tokenByBaseId.values()])]
  const priceRows =
    tokenList.length > 0
      ? await select(sqlClient, 'GmxOraclePrice', { where: { id: { _in: tokenList } }, fields: ['id', 'price'] })
      : []
  const priceByToken = new Map(priceRows.map(row => [row.id, row.price]))

  const out = new Map<string, bigint>()
  for (const acc of accounts) {
    const token = tokenByBaseId.get(acc.baseTokenId)
    const price = token ? priceByToken.get(token) : undefined
    if (price === undefined) continue
    const cashBalance = acc.isMaster ? 0n : acc.signedBalance
    out.set(acc.account, (cashBalance + acc.positionBalance) * price)
  }
  return out
}

export async function fetchPuppetBalanceTimeline(
  accounts: ISubaccountState[],
  activityTimeframe: IntervalTime
): Promise<IBalanceTimelinePoint[]> {
  if (accounts.length === 0) return []
  const endTime = getUnixTimestamp()
  const startTime = endTime - activityTimeframe

  const accountList = accounts.map(a => a.account)
  const [windowRows, seedRowList] = await Promise.all([
    select(sqlClient, 'PuppetBalanceCheckpoint', {
      where: { account: { _in: accountList }, blockTimestamp: { _gte: startTime } },
      orderBy: { blockTimestamp: 'asc' },
      fields: ['account', 'blockTimestamp', 'balanceUsd']
    }),
    Promise.all(
      accountList.map(account =>
        selectOne(sqlClient, 'PuppetBalanceCheckpoint', {
          where: { account: { _eq: account }, blockTimestamp: { _lt: startTime } },
          orderBy: { blockTimestamp: 'desc' },
          fields: ['account', 'balanceUsd']
        })
      )
    )
  ])

  const checkpointed = new Set<string>()
  for (const row of windowRows) checkpointed.add(row.account)
  const balanceByAccount = new Map<string, bigint>()
  for (const seed of seedRowList) {
    if (seed) {
      balanceByAccount.set(seed.account, seed.balanceUsd)
      checkpointed.add(seed.account)
    }
  }

  // Accounts with no checkpoint at all (just-settled, or a checkpoint skipped when the
  // oracle price was momentarily absent) still hold value in IAccountState. Seed them
  // with their current USD value so the aggregate covers every account, not just the
  // checkpointed ones.
  const uncheckpointed = accounts.filter(a => !checkpointed.has(a.account))
  if (uncheckpointed.length > 0) {
    for (const [account, balanceUsd] of await currentBalanceUsdByAccount(uncheckpointed)) {
      balanceByAccount.set(account, balanceUsd)
    }
  }

  if (windowRows.length === 0 && balanceByAccount.size === 0) return []

  const totalUsd = (): bigint => {
    let total = 0n
    for (const value of balanceByAccount.values()) total += value
    return total
  }

  const sourceList: { time: number; total: bigint }[] = [{ time: startTime, total: totalUsd() }]
  for (const row of windowRows) {
    balanceByAccount.set(row.account, row.balanceUsd)
    const prev = sourceList[sourceList.length - 1]
    if (prev.time === row.blockTimestamp) prev.total = totalUsd()
    else sourceList.push({ time: row.blockTimestamp, total: totalUsd() })
  }
  sourceList.push({ time: endTime, total: totalUsd() })

  return resampleTimeSeries({
    sourceList,
    ticks: BALANCE_TIMELINE_BUCKETS,
    getTime: source => source.time,
    mapSource: source => formatFixed(USD_DECIMALS, source.total)
  })
}

export async function fetchMasterPerformanceTimeline(
  masterAccount: Address,
  activityTimeframe: IntervalTime
): Promise<IBalanceTimelinePoint[]> {
  const endTime = getUnixTimestamp()
  const startTime = endTime - activityTimeframe

  const account = getAddress(masterAccount)
  const [windowRows, seedRow] = await Promise.all([
    select(sqlClient, 'MasterCheckpoint', {
      where: { masterAccount: { _eq: account }, blockTimestamp: { _gte: startTime } },
      orderBy: { blockTimestamp: 'asc' },
      fields: ['blockTimestamp', 'navPerShare']
    }),
    selectOne(sqlClient, 'MasterCheckpoint', {
      where: { masterAccount: { _eq: account }, blockTimestamp: { _lt: startTime } },
      orderBy: { blockTimestamp: 'desc' },
      fields: ['navPerShare']
    })
  ])
  if (windowRows.length === 0 && !seedRow) return []

  const sourceList: { time: number; nav: bigint }[] = []
  let nav = 0n
  if (seedRow) {
    nav = seedRow.navPerShare
    sourceList.push({ time: startTime, nav })
  }
  for (const row of windowRows) {
    nav = row.navPerShare
    const prev = sourceList[sourceList.length - 1]
    if (prev && prev.time === row.blockTimestamp) prev.nav = nav
    else sourceList.push({ time: row.blockTimestamp, nav })
  }
  if (sourceList.length === 0) return []
  sourceList.push({ time: endTime, nav })

  return resampleTimeSeries({
    sourceList,
    ticks: BALANCE_TIMELINE_BUCKETS,
    getTime: source => source.time,
    mapSource: source => formatFixed(USD_DECIMALS, source.nav)
  })
}
