import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { IFund, IFundLatestMetric, IFundPosition } from '@puppet/indexer-graphql/entities'
import { decodeRuleBody, type IAllocationPuppet } from '@puppet/sdk/attestation'
import { BALANCE_TIMELINE_BUCKETS, type IntervalTime, USD_DECIMALS } from '@puppet/sdk/const'
import { formatFixed, getMasterMatchingKey, getUnixTimestamp, resampleTimeSeries } from '@puppet/sdk/core'
import { type ISubaccountState, select, selectOne } from '@puppet/sdk/state'
import { type Address, getAddress, type Hex } from 'viem'
import { sqlClient } from './sql.js'

export type { IFundLatestMetric } from '@puppet/indexer-graphql/entities'
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
  const row = await selectOne(sqlClient, 'Account', {
    where: { user: { _eq: getAddress(user) } },
    fields: ['signer']
  })
  return row?.signer ?? null
}

async function tokenByBaseId(baseTokenIdList: Hex[]): Promise<Map<Hex, Address>> {
  if (baseTokenIdList.length === 0) return new Map()
  const rows = await select(sqlClient, 'TokenRegistry', {
    where: { tokenId: { _in: baseTokenIdList }, chainId: { _eq: BigInt(HUB_CHAIN_ID) } },
    fields: ['tokenId', 'token']
  })
  return new Map(rows.map(row => [row.tokenId, row.token]))
}

export async function fetchUserSubscriptions(puppet: Address) {
  const rows = await select(sqlClient, 'SubscribeModule__Subscribe', {
    where: { puppetAccount: { _eq: getAddress(puppet) } }
  })
  if (rows.length === 0) return []

  const fundList = [...new Set(rows.map(row => getAddress(row.fund)))]
  const fundRows = await select(sqlClient, 'Fund', { where: { id: { _in: fundList } } })
  const fundById = new Map(fundRows.map(row => [getAddress(row.fund), row]))
  const tokenMap = await tokenByBaseId([...new Set(fundRows.map(row => row.baseTokenId))])

  return rows.map(row => {
    const body = decodeRuleBody(row.body)
    const fund = fundById.get(getAddress(row.fund))
    const master = (fund?.master ?? getAddress(row.fund)) as Address
    const baseTokenId = fund?.baseTokenId ?? ('0x' as Hex)
    const baseToken = (tokenMap.get(baseTokenId) ?? master) as Address
    return {
      ...row,
      ...body,
      master,
      baseToken,
      masterMatchingKey: getMasterMatchingKey(baseToken, master) as Hex
    }
  })
}

export async function fetchMasterPoolState(fund: Address): Promise<IFund | undefined> {
  return selectOne(sqlClient, 'Fund', { where: { id: { _eq: getAddress(fund) } } })
}

export type IPuppetAllocationRow = Awaited<ReturnType<typeof fetchPuppetAllocationList>>[number]

export async function fetchPuppetAllocationList(
  holderAccounts: Address[]
): Promise<(IFundPosition & { fundState: IFund | null })[]> {
  if (holderAccounts.length === 0) return []
  const positionList = await select(sqlClient, 'FundPosition', {
    where: {
      holder: { _in: holderAccounts.map(getAddress) },
      _or: [{ sharesHeld: { _gt: 0n } }, { stake: { _gt: 0n } }, { allocated: { _gt: 0n } }]
    }
  })
  if (positionList.length === 0) return []

  const fundList = [...new Set(positionList.map(p => getAddress(p.fund)))]
  const fundRows = await select(sqlClient, 'Fund', { where: { id: { _in: fundList } } })
  const fundById = new Map(fundRows.map(row => [getAddress(row.fund), row]))
  return positionList.map(p => ({ ...p, fundState: fundById.get(getAddress(p.fund)) ?? null }))
}

export async function fetchMasterSubscribers(fund: Address): Promise<IAllocationPuppet[]> {
  const fundRow = await selectOne(sqlClient, 'Fund', {
    where: { id: { _eq: getAddress(fund) } },
    fields: ['baseTokenId']
  })
  if (!fundRow) return []

  const subscribed = await select(sqlClient, 'FundPosition', {
    where: { fund: { _eq: getAddress(fund) }, body: { _is_null: false }, mandate: { _is_null: false } },
    fields: ['holder', 'body', 'mandate', 'lastAllocatedAt', 'stake']
  })
  if (subscribed.length === 0) return []

  const balanceRows = await select(sqlClient, 'AccountBalance', {
    where: {
      account: { _in: subscribed.map(p => p.holder) },
      chainId: { _eq: BigInt(HUB_CHAIN_ID) },
      tokenId: { _eq: fundRow.baseTokenId }
    },
    fields: ['account', 'signedBalance']
  })
  const signedBalanceByHolder = new Map(balanceRows.map(b => [getAddress(b.account), b.signedBalance]))
  return subscribed.map(p => ({
    puppet: getAddress(p.holder),
    body: p.body as Hex,
    mandate: p.mandate as Hex,
    signedBalance: signedBalanceByHolder.get(getAddress(p.holder)) ?? 0n,
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
  fund: Address
  activityTimeframe: IntervalTime
  collateralTokenList: Hex[]
}): Promise<IFundLatestMetric[]> {
  const startActivityTimeframe = getUnixTimestamp() - params.activityTimeframe
  return select(sqlClient, 'FundLatestMetric', {
    where: {
      fund: { _eq: getAddress(params.fund) },
      interval: { _eq: params.activityTimeframe },
      lastUpdatedTimestamp: { _gte: startActivityTimeframe },
      ...(params.collateralTokenList.length > 0 ? { baseTokenId: { _in: params.collateralTokenList } } : {})
    }
  })
}

// Build a VALID bucketed timeline before cumulating. The indexed per-period series (pnlList/
// pnlTimestampList inlined on the metric entities) can arrive out of block-time order, so we bucket
// each (timestamp, pnl) into a fixed time-slot, sum per slot, sort by time, then cumulate in TIME order.
function buildPnlTimeline(params: {
  pnlList: readonly bigint[]
  pnlTimestampList: readonly number[]
  activityTimeframe: IntervalTime
  now: number
}): IBalanceTimelinePoint[] {
  const startActivityTimeframe = params.now - params.activityTimeframe
  const slotSize = Math.max(1, Math.floor(params.activityTimeframe / BALANCE_TIMELINE_BUCKETS))
  const pnlBySlot = new Map<number, bigint>()
  for (let i = 0; i < params.pnlTimestampList.length; i++) {
    const slot = Math.floor(params.pnlTimestampList[i] / slotSize) * slotSize
    pnlBySlot.set(slot, (pnlBySlot.get(slot) ?? 0n) + (params.pnlList[i] ?? 0n))
  }
  let cum = 0n
  const points = [...pnlBySlot.keys()]
    .sort((a, b) => a - b)
    .map(slot => {
      cum += pnlBySlot.get(slot) as bigint
      return { time: slot, cum }
    })
  // No activity in the window still renders a flat zero line so the row keeps some graph visual.
  if (points.length === 0) {
    return [
      { time: startActivityTimeframe, value: 0 },
      { time: params.now, value: 0 }
    ]
  }
  // Slots are pruned indexer-side against the LAST EVENT's time, not wall-clock now, so the oldest
  // slot can predate startActivityTimeframe (now - interval). Clamp the 0-anchor to <= the first point.
  const anchorTime = Math.min(startActivityTimeframe, points[0].time)
  return resampleTimeSeries({
    sourceList: [{ time: anchorTime, cum: 0n }, ...points, { time: params.now, cum: points[points.length - 1].cum }],
    ticks: BALANCE_TIMELINE_BUCKETS,
    getTime: s => s.time,
    mapSource: s => formatFixed(USD_DECIMALS, s.cum)
  })
}

export type ILeaderboardRow = IFundLatestMetric & {
  master: Address
  name: Hex | null
  shareToken: Address | null
  puppetList: Address[]
  pnlTimeline: IBalanceTimelinePoint[]
  // Consistency metric derived on the website from the per-trade `pnlList` the indexer already exposes.
  // TODO(indexer): needs maxDrawdown (bps) and sharpeRatio on FundLatestMetric to surface downside/risk-adjusted
  // return alongside win-rate; drawdown/Sharpe can't be reconstructed from the leaderboard payload alone.
  winCount: number
  lossCount: number
}

export async function fetchLeaderboardPage(params: {
  activityTimeframe: IntervalTime
  account?: Address
  collateralTokenList: Hex[]
  sortBy: { direction: 'asc' | 'desc'; selector: keyof IFundLatestMetric }
  paging: { pageSize: number; offset: number }
}): Promise<ILeaderboardRow[]> {
  const startActivityTimeframe = getUnixTimestamp() - params.activityTimeframe

  const metricList = await select(sqlClient, 'FundLatestMetric', {
    where: {
      interval: { _eq: params.activityTimeframe },
      lastUpdatedTimestamp: { _gte: startActivityTimeframe },
      // Match either stored casing (event-derived rows are lowercase; predicted accounts are checksummed),
      // so the "Find trader" address search isn't silently filtered out by a case mismatch.
      ...(params.account
        ? { fund: { _in: [params.account.toLowerCase() as Address, getAddress(params.account)] } }
        : {}),
      ...(params.collateralTokenList.length > 0 ? { baseTokenId: { _in: params.collateralTokenList } } : {})
    },
    orderBy: { [params.sortBy.selector]: params.sortBy.direction },
    limit: params.paging.pageSize,
    offset: params.paging.offset
  })
  if (metricList.length === 0) return []

  const fundList = metricList.map(m => m.fund)
  const [positionList, fundRows] = await Promise.all([
    select(sqlClient, 'FundPosition', {
      where: { fund: { _in: fundList }, body: { _is_null: false }, mandate: { _is_null: false } },
      fields: ['fund', 'holder']
    }),
    select(sqlClient, 'Fund', {
      where: { id: { _in: fundList } },
      fields: ['fund', 'master', 'name', 'shareToken']
    })
  ])

  const puppetsByFund = new Map<string, Address[]>()
  for (const s of positionList) {
    const list = puppetsByFund.get(s.fund) ?? []
    list.push(s.holder)
    puppetsByFund.set(s.fund, list)
  }

  const fundById = new Map(fundRows.map(r => [getAddress(r.fund), r]))

  const endTime = getUnixTimestamp()
  return metricList.map(m => {
    // Derive win/loss consistency from the per-trade realised PnL series the indexer already provides.
    let winCount = 0
    let lossCount = 0
    for (const pnl of m.pnlList) {
      if (pnl > 0n) winCount++
      else if (pnl < 0n) lossCount++
    }
    const fundRow = fundById.get(getAddress(m.fund))
    return {
      ...m,
      master: (fundRow?.master ?? m.fund) as Address,
      name: fundRow?.name ?? null,
      shareToken: (fundRow?.shareToken ?? null) as Address | null,
      puppetList: puppetsByFund.get(m.fund) ?? [],
      pnlTimeline: buildPnlTimeline({
        pnlList: m.pnlList,
        pnlTimestampList: m.pnlTimestampList,
        activityTimeframe: params.activityTimeframe,
        now: endTime
      }),
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
    return {
      account: m.account,
      collateralToken: m.collateralToken,
      sizeUsd: m.realisedSizeInUsd + m.openSizeInUsd,
      collateralUsd: m.realisedCollateralInUsd + m.openCollateralInUsd,
      realisedPnlUsd: m.pnl,
      winCount: m.winCount,
      lossCount: m.lossCount,
      pnlTimeline: buildPnlTimeline({
        pnlList: m.pnlList,
        pnlTimestampList: m.pnlTimestampList,
        activityTimeframe: params.activityTimeframe,
        now
      })
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
  const baseTokenIdList = [...new Set(accounts.flatMap(a => [...a.balances.keys()]))]
  const tokenMap = await tokenByBaseId(baseTokenIdList)
  const tokenList = [...new Set([...tokenMap.values()])]
  const priceRows =
    tokenList.length > 0
      ? await select(sqlClient, 'GmxOraclePrice', { where: { id: { _in: tokenList } }, fields: ['id', 'price'] })
      : []
  const priceByToken = new Map(priceRows.map(row => [getAddress(row.id), row.price]))

  const out = new Map<string, bigint>()
  for (const acc of accounts) {
    let usd = 0n
    for (const [baseTokenId, balance] of acc.balances) {
      const token = tokenMap.get(baseTokenId)
      const price = token ? priceByToken.get(getAddress(token)) : undefined
      if (price === undefined) continue
      usd += balance.signedBalance * price
    }
    out.set(acc.account, usd)
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
    select(sqlClient, 'AccountBalanceCheckpoint', {
      where: { account: { _in: accountList }, blockTimestamp: { _gte: startTime } },
      orderBy: { blockTimestamp: 'asc' },
      fields: ['account', 'blockTimestamp', 'balanceUsd']
    }),
    Promise.all(
      accountList.map(account =>
        selectOne(sqlClient, 'AccountBalanceCheckpoint', {
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
  // oracle price was momentarily absent) still hold value across their AccountBalance rows.
  // Seed them with their current USD value so the aggregate covers every account, not just
  // the checkpointed ones.
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
  fund: Address,
  activityTimeframe: IntervalTime
): Promise<IBalanceTimelinePoint[]> {
  const endTime = getUnixTimestamp()
  const startTime = endTime - activityTimeframe

  const fundAddress = getAddress(fund)
  const [windowRows, seedRow] = await Promise.all([
    select(sqlClient, 'FundCheckpoint', {
      where: { fund: { _eq: fundAddress }, blockTimestamp: { _gte: startTime } },
      orderBy: { blockTimestamp: 'asc' },
      fields: ['blockTimestamp', 'navPerShare']
    }),
    selectOne(sqlClient, 'FundCheckpoint', {
      where: { fund: { _eq: fundAddress }, blockTimestamp: { _lt: startTime } },
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
