import { FLOAT_PRECISION, HUB_CHAIN_ID } from '@puppet/contracts/const'
import { CONTRACT_EVENT_MAP } from '@puppet/contracts/events'
import type { IFund, IFundLatestMetric } from '@puppet/indexer-graphql/entities'
import { decodeRuleBody, type IAllocationPuppet } from '@puppet/sdk/attestation'
import { ADDRESS_ZERO, BALANCE_TIMELINE_BUCKETS, type IntervalTime, USD_DECIMALS } from '@puppet/sdk/const'
import { formatFixed, getMasterMatchingKey, getUnixTimestamp, resampleTimeSeries } from '@puppet/sdk/core'
import { type ISubaccountState, select, selectOne } from '@puppet/sdk/state'
import { type Address, decodeAbiParameters, getAddress, type Hex } from 'viem'
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

async function tokenByBaseId(baseTokenIdList: Hex[]): Promise<Map<Hex, Address>> {
  if (baseTokenIdList.length === 0) return new Map()
  const rows = await select(sqlClient, 'TokenRegistry', {
    where: { tokenId: { _in: baseTokenIdList }, chainId: { _eq: BigInt(HUB_CHAIN_ID) } },
    fields: ['tokenId', 'token', 'hubToken']
  })
  return new Map(rows.map(row => [row.tokenId, getAddress(row.token) === ADDRESS_ZERO ? row.hubToken : row.token]))
}

export async function fetchUserSubscriptions(puppet: Address) {
  // Current-state subscriptions live on FundPosition (an unsubscribe CLEARS body and
  // mandate): reading the raw Subscribe event log would replay every historical change,
  // duplicating re-subscribes and resurrecting unsubscribed rules.
  const rows = await select(sqlClient, 'FundPosition', {
    where: { holder: { _eq: getAddress(puppet) }, body: { _is_null: false }, mandate: { _is_null: false } },
    fields: ['holder', 'fund', 'baseTokenId', 'body', 'mandate', 'subscribedAt']
  })
  if (rows.length === 0) return []

  const fundList = [...new Set(rows.map(row => getAddress(row.fund)))]
  const fundRows = await select(sqlClient, 'Fund', { where: { id: { _in: fundList } } })
  const fundById = new Map(fundRows.map(row => [getAddress(row.fund), row]))
  const tokenMap = await tokenByBaseId([...new Set(fundRows.map(row => row.baseTokenId))])

  return rows.flatMap(row => {
    const fund = fundById.get(getAddress(row.fund))
    const baseToken = fund ? tokenMap.get(fund.baseTokenId) : undefined
    if (!fund || !baseToken) return []
    const body = decodeRuleBody(row.body as Hex)
    return [
      {
        ...row,
        ...body,
        baseTokenId: row.baseTokenId as Hex,
        master: fund.master,
        baseToken,
        masterMatchingKey: getMasterMatchingKey(baseToken, fund.master) as Hex
      }
    ]
  })
}

export async function fetchMasterPoolState(fund: Address): Promise<IFund | undefined> {
  return selectOne(sqlClient, 'Fund', { where: { id: { _eq: getAddress(fund) } } })
}

export async function fetchMasterSubscribers(fund: Address, baseTokenId: Hex): Promise<IAllocationPuppet[]> {
  const subscribed = await select(sqlClient, 'FundPosition', {
    where: { fund: { _eq: getAddress(fund) }, body: { _is_null: false }, mandate: { _is_null: false } },
    fields: ['holder', 'body', 'mandate', 'lastAllocatedAt', 'stake']
  })
  if (subscribed.length === 0) return []

  const balanceRows = await select(sqlClient, 'AccountBalanceCheckpoint', {
    where: {
      account: { _in: subscribed.map(p => p.holder) },
      chainId: { _eq: BigInt(HUB_CHAIN_ID) },
      tokenId: { _eq: baseTokenId }
    },
    distinctOn: ['account'],
    orderBy: [{ account: 'asc' }, { blockTimestamp: 'desc' }],
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

export async function fetchPuppetUsers(accounts: Address[]): Promise<Map<Address, Address>> {
  if (accounts.length === 0) return new Map()
  const rows = await select(sqlClient, 'Account__DeployPuppetAccount', {
    where: { account: { _in: accounts.map(a => getAddress(a)) } },
    fields: ['account', 'user']
  })
  return new Map(rows.map(d => [getAddress(d.account), getAddress(d.user)]))
}

export async function fetchFundAllocationDistribution(
  fund: Address,
  master: Address
): Promise<Array<{ puppet: Address; user: Address; sharesHeld: bigint; isMaster: boolean }>> {
  const rows = await select(sqlClient, 'FundPosition', {
    where: { fund: { _eq: getAddress(fund) } },
    fields: ['holder', 'sharesHeld']
  })
  const holders = rows
    .filter(r => r.sharesHeld > 0n)
    .map(r => ({ puppet: getAddress(r.holder), sharesHeld: r.sharesHeld }))
  if (holders.length === 0) return []

  const userByAccount = await fetchPuppetUsers(holders.map(h => h.puppet))
  const masterAddr = getAddress(master)
  return holders.map(h => ({
    puppet: h.puppet,
    user: userByAccount.get(h.puppet) ?? h.puppet,
    sharesHeld: h.sharesHeld,
    isMaster: h.puppet === masterAddr
  }))
}

const OPERATE_INTENT_PARAM = CONTRACT_EVENT_MAP.MasterGate.Operate.args.find(a => a.name === 'intent')!
const ALLOCATE_INTENT_PARAM = CONTRACT_EVENT_MAP.Allocate.Allocate.args.find(a => a.name === 'intent')!

export interface IOperateCall {
  target: Address
  value: bigint
  gasLimit: bigint
  callData: Hex
}
export interface IOperateTransferLeg {
  tokenId: Hex
  token: Address
  amountIn: bigint
  amountOut: bigint
}

export interface IFundAction {
  kind: 'operate' | 'allocate'
  blockTimestamp: number
  blockNumber: bigint
  transactionHash: Hex
  chainId: number
  totalMatched: bigint
  puppetCount: number
  resultCount: number
  callList: readonly IOperateCall[]
  transferList: readonly IOperateTransferLeg[]
  masterAmount: bigint
  allocated: bigint
}

export async function fetchFundActivity(fund: Address, limit = 40): Promise<IFundAction[]> {
  const acct = getAddress(fund)
  const [operates, allocates] = await Promise.all([
    select(sqlClient, 'MasterGate__Operate', {
      where: { account: { _eq: acct } },
      orderBy: { blockNumber: 'desc' },
      limit,
      fields: ['chainId', 'intent', 'result', 'blockTimestamp', 'blockNumber', 'transactionHash']
    }),
    select(sqlClient, 'Allocate__Allocate', {
      where: { fundAccount: { _eq: acct } },
      orderBy: { blockNumber: 'desc' },
      limit,
      fields: [
        'chainId',
        'intent',
        'totalMatched',
        'puppetSharesMintedList',
        'blockTimestamp',
        'blockNumber',
        'transactionHash'
      ]
    })
  ])
  const actions: IFundAction[] = [
    ...operates.map(o => {
      const decoded = decodeAbiParameters([OPERATE_INTENT_PARAM], o.intent as Hex)[0] as unknown as {
        callList: readonly IOperateCall[]
        transferList: readonly IOperateTransferLeg[]
      }
      return {
        kind: 'operate' as const,
        blockTimestamp: o.blockTimestamp,
        blockNumber: o.blockNumber,
        transactionHash: o.transactionHash as Hex,
        chainId: Number(o.chainId),
        totalMatched: 0n,
        puppetCount: 0,
        resultCount: o.result.length,
        callList: decoded.callList,
        transferList: decoded.transferList,
        masterAmount: 0n,
        allocated: 0n
      }
    }),
    ...allocates.map(a => {
      const masterAmount = (
        decodeAbiParameters([ALLOCATE_INTENT_PARAM], a.intent as Hex)[0] as unknown as {
          masterAmount: bigint
        }
      ).masterAmount
      return {
        kind: 'allocate' as const,
        blockTimestamp: a.blockTimestamp,
        blockNumber: a.blockNumber,
        transactionHash: a.transactionHash as Hex,
        chainId: Number(a.chainId),
        totalMatched: a.totalMatched,
        puppetCount: a.puppetSharesMintedList.filter(s => s > 0n).length,
        resultCount: 0,
        callList: [],
        transferList: [],
        masterAmount,
        allocated: masterAmount + a.totalMatched
      }
    })
  ]
  return actions
    .sort((x, y) => (y.blockNumber > x.blockNumber ? 1 : y.blockNumber < x.blockNumber ? -1 : 0))
    .slice(0, limit)
}

export async function findWalletDepositTxByRecipient(
  recipient: Address,
  chainId: number,
  minBlock: bigint
): Promise<Hex | null> {
  const row = await selectOne(sqlClient, 'Deposit__Deposit', {
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
      ...(params.account ? { fund: { _eq: getAddress(params.account) } } : {}),
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
      where: { fund: { _in: fundList } },
      fields: ['fund', 'holder', 'sharesHeld']
    }),
    select(sqlClient, 'Fund', {
      where: { id: { _in: fundList } },
      fields: ['fund', 'master', 'name', 'shareToken']
    })
  ])

  const userByAccount = await fetchPuppetUsers(
    positionList.filter(s => s.sharesHeld > 0n).map(s => getAddress(s.holder))
  )
  const puppetsByFund = new Map<string, Address[]>()
  for (const s of positionList) {
    if (s.sharesHeld <= 0n) continue
    const list = puppetsByFund.get(s.fund) ?? []
    list.push(userByAccount.get(getAddress(s.holder)) ?? getAddress(s.holder))
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

export interface IBalanceTimelinePoint {
  time: number
  value: number
}

// The indexer stores ONE raw checkpoint stream: cash rows key by 32-byte protocol
// tokenId, fund-share rows key by the 20-byte fund address with sharesHeld as the
// balance. The USD timeline composes here at read time: cash x price plus shares x
// nav x price, with prices from the latest oracle rows.
const isFundKey = (tokenId: string): boolean => tokenId.length === 42

export async function fetchPuppetBalanceTimeline(
  accounts: ISubaccountState[],
  activityTimeframe: IntervalTime
): Promise<IBalanceTimelinePoint[]> {
  if (accounts.length === 0) return []
  const endTime = getUnixTimestamp()
  const startTime = endTime - activityTimeframe
  const accountList = accounts.map(a => a.account)

  const windowRows = await select(sqlClient, 'AccountBalanceCheckpoint', {
    where: { account: { _in: accountList }, blockTimestamp: { _gte: startTime } },
    orderBy: { blockTimestamp: 'asc' },
    fields: ['chainId', 'account', 'tokenId', 'blockTimestamp', 'signedBalance']
  })

  const balanceKey = (chainId: bigint, account: string, tokenId: string) => `${chainId}-${account}-${tokenId}`
  const keys = new Map<string, { chainId: bigint; account: Hex; tokenId: Hex }>()
  for (const acc of accounts) {
    for (const balance of acc.balances.values()) {
      keys.set(balanceKey(balance.chainId, acc.account, balance.tokenId), {
        chainId: balance.chainId,
        account: acc.account as Hex,
        tokenId: balance.tokenId
      })
    }
    for (const pos of acc.positions) {
      keys.set(balanceKey(BigInt(HUB_CHAIN_ID), acc.account, pos.fund), {
        chainId: BigInt(HUB_CHAIN_ID),
        account: acc.account as Hex,
        tokenId: pos.fund as Hex
      })
    }
  }
  for (const row of windowRows) {
    keys.set(balanceKey(row.chainId, row.account, row.tokenId), {
      chainId: row.chainId,
      account: row.account as Hex,
      tokenId: row.tokenId as Hex
    })
  }

  const fundList = [...new Set([...keys.values()].filter(k => isFundKey(k.tokenId)).map(k => k.tokenId))]
  const [seeds, navWindow, navSeeds, fundRows] = await Promise.all([
    select(sqlClient, 'AccountBalanceCheckpoint', {
      where: { account: { _in: accountList }, blockTimestamp: { _lt: startTime } },
      distinctOn: ['chainId', 'account', 'tokenId'],
      orderBy: [{ chainId: 'asc' }, { account: 'asc' }, { tokenId: 'asc' }, { blockTimestamp: 'desc' }],
      fields: ['chainId', 'account', 'tokenId', 'signedBalance']
    }),
    fundList.length > 0
      ? select(sqlClient, 'FundCheckpoint', {
          where: { fund: { _in: fundList }, blockTimestamp: { _gte: startTime } },
          orderBy: { blockTimestamp: 'asc' },
          fields: ['fund', 'blockTimestamp', 'navPerShare']
        })
      : Promise.resolve([]),
    fundList.length > 0
      ? select(sqlClient, 'FundCheckpoint', {
          where: { fund: { _in: fundList }, blockTimestamp: { _lt: startTime } },
          distinctOn: ['fund'],
          orderBy: [{ fund: 'asc' }, { blockTimestamp: 'desc' }],
          fields: ['fund', 'navPerShare']
        })
      : Promise.resolve([]),
    fundList.length > 0
      ? select(sqlClient, 'Fund', { where: { fund: { _in: fundList } }, fields: ['fund', 'baseTokenId'] })
      : Promise.resolve([])
  ])

  const fundBaseId = new Map(fundRows.map(row => [row.fund as string, row.baseTokenId as Hex]))
  const baseTokenIdList = [
    ...new Set([...[...keys.values()].filter(k => !isFundKey(k.tokenId)).map(k => k.tokenId), ...fundBaseId.values()])
  ]
  const tokenMap = await tokenByBaseId(baseTokenIdList)
  const tokenList = [...new Set([...tokenMap.values()])]
  const priceRows =
    tokenList.length > 0
      ? await select(sqlClient, 'GmxOraclePrice', { where: { id: { _in: tokenList } }, fields: ['id', 'price'] })
      : []
  const priceByToken = new Map(priceRows.map(row => [getAddress(row.id), row.price]))
  const priceOf = (tokenId: string): bigint => {
    const token = tokenMap.get(tokenId as Hex)
    return token ? (priceByToken.get(getAddress(token)) ?? 0n) : 0n
  }

  const balanceState = new Map<string, bigint>()
  const navState = new Map<string, bigint>()
  for (const seed of seeds)
    if (seed) balanceState.set(balanceKey(seed.chainId, seed.account, seed.tokenId), seed.signedBalance)
  for (const seed of navSeeds) if (seed) navState.set(seed.fund, seed.navPerShare)
  // No checkpoint before the window: seed from current raw state so every account is
  // covered from the first point.
  for (const acc of accounts) {
    for (const balance of acc.balances.values()) {
      const key = balanceKey(balance.chainId, acc.account, balance.tokenId)
      if (!balanceState.has(key) && !windowRows.some(r => balanceKey(r.chainId, r.account, r.tokenId) === key)) {
        balanceState.set(key, balance.signedBalance)
      }
    }
    for (const pos of acc.positions) {
      const key = balanceKey(BigInt(HUB_CHAIN_ID), acc.account, pos.fund)
      if (!balanceState.has(key) && !windowRows.some(r => balanceKey(r.chainId, r.account, r.tokenId) === key)) {
        balanceState.set(key, pos.sharesHeld)
      }
    }
    for (const fund of acc.funds) {
      if (!navState.has(fund.fund) && !navWindow.some(r => r.fund === fund.fund)) {
        navState.set(fund.fund, fund.navPerShare)
      }
    }
  }

  type TimelineEvent = { time: number; apply: () => void }
  const events: TimelineEvent[] = [
    ...windowRows.map(row => ({
      time: row.blockTimestamp,
      apply: () => balanceState.set(balanceKey(row.chainId, row.account, row.tokenId), row.signedBalance)
    })),
    ...navWindow.map(row => ({
      time: row.blockTimestamp,
      apply: () => navState.set(row.fund, row.navPerShare)
    }))
  ].sort((a, b) => a.time - b.time)

  const totalUsd = (): bigint => {
    let total = 0n
    for (const [key, balance] of balanceState) {
      const tokenId = keys.get(key)?.tokenId
      if (!tokenId) continue
      if (isFundKey(tokenId)) {
        const baseId = fundBaseId.get(tokenId)
        const nav = navState.get(tokenId) ?? 0n
        if (baseId) total += ((balance * nav) / FLOAT_PRECISION) * priceOf(baseId)
      } else {
        total += balance * priceOf(tokenId)
      }
    }
    return total
  }

  if (events.length === 0 && balanceState.size === 0) return []

  const sourceList: { time: number; total: bigint }[] = [{ time: startTime, total: totalUsd() }]
  for (const ev of events) {
    ev.apply()
    const prev = sourceList[sourceList.length - 1]
    if (prev.time === ev.time) prev.total = totalUsd()
    else sourceList.push({ time: ev.time, total: totalUsd() })
  }
  sourceList.push({ time: endTime, total: totalUsd() })

  return resampleTimeSeries({
    sourceList,
    ticks: BALANCE_TIMELINE_BUCKETS,
    getTime: source => source.time,
    mapSource: source => formatFixed(USD_DECIMALS, source.total)
  })
}
