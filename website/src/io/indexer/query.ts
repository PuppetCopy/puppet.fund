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
      ...(params.account ? { master: { _eq: getAddress(params.account) } } : {}),
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
            sourceMap: s => formatFixed(USD_DECIMALS, s.nav)
          })
    return {
      ...m,
      name: nameByMaster.get(m.master) ?? null,
      puppetList: puppetsByMaster.get(m.master) ?? [],
      navTimeline
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
      ...(params.account ? { account: { _eq: getAddress(params.account) } } : {}),
      ...(params.collateralTokenList.length > 0
        ? { collateralToken: { _in: params.collateralTokenList.map(getAddress) } }
        : {})
    },
    orderBy: { [sortColumn[params.sortBy.selector]]: params.sortBy.direction },
    limit: params.paging.pageSize,
    offset: params.paging.offset
  })
  if (metricList.length === 0) return []

  const accountList = [...new Set(metricList.map(m => m.account))]
  const collateralList = [...new Set(metricList.map(m => m.collateralToken))]
  const [checkpointList, seedList] = await Promise.all([
    select(sqlClient, 'GmxTraderCheckpoint', {
      where: {
        account: { _in: accountList },
        collateralToken: { _in: collateralList },
        blockTimestamp: { _gte: startActivityTimeframe }
      },
      orderBy: { blockTimestamp: 'asc' }
    }),
    select(sqlClient, 'GmxTraderCheckpoint', {
      where: {
        account: { _in: accountList },
        collateralToken: { _in: collateralList },
        blockTimestamp: { _lt: startActivityTimeframe }
      },
      orderBy: { blockTimestamp: 'desc' },
      fields: ['account', 'collateralToken', 'cumulativePnl']
    })
  ])

  const seriesByKey = new Map<string, { time: number; cum: bigint }[]>()
  for (const c of checkpointList) {
    const key = `${c.account.toLowerCase()}:${c.collateralToken.toLowerCase()}`
    const series = seriesByKey.get(key) ?? []
    series.push({ time: c.blockTimestamp, cum: c.cumulativePnl })
    seriesByKey.set(key, series)
  }

  const seedByKey = new Map<string, bigint>()
  for (const s of seedList) {
    const key = `${s.account.toLowerCase()}:${s.collateralToken.toLowerCase()}`
    if (!seedByKey.has(key)) seedByKey.set(key, s.cumulativePnl)
  }

  return metricList.map(m => {
    const key = `${m.account.toLowerCase()}:${m.collateralToken.toLowerCase()}`
    const series = seriesByKey.get(key) ?? []
    const baseline = seedByKey.get(key) ?? 0n
    const pnlTimeline =
      series.length === 0
        ? []
        : resampleTimeSeries({
            sourceList: [
              { time: startActivityTimeframe, cum: 0n },
              ...series.map(s => ({ time: s.time, cum: s.cum - baseline })),
              { time: now, cum: series[series.length - 1].cum - baseline }
            ],
            ticks: BALANCE_TIMELINE_BUCKETS,
            getTime: s => s.time,
            sourceMap: s => formatFixed(USD_DECIMALS, s.cum)
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
    sourceMap: source => formatFixed(USD_DECIMALS, source.total)
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
    sourceMap: source => formatFixed(USD_DECIMALS, source.nav)
  })
}
