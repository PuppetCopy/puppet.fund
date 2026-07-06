import { HUB_CHAIN_ID, PRECISION } from '@puppet/contracts/const'
import { CONTRACT_EVENT_MAP } from '@puppet/contracts/events'
import type { IIAccount__Call, IIAccount__SignTransfer } from '@puppet/contracts/types'
import { decodeRuleBody, type IAllocationPuppet } from '@puppet/sdk/attestation'
import { BALANCE_TIMELINE_BUCKETS, type IntervalTime, USD_DECIMALS } from '@puppet/sdk/const'
import { formatFixed, getMasterMatchingKey, getUnixTimestamp, resampleTimeSeries } from '@puppet/sdk/core'
import {
  fundLatestMetricTable,
  fundPositionTable,
  fundTable,
  gmxTraderMetricTable,
  type IFund,
  type IFundLatestMetric
} from '@puppet/sdk/schema'
import type { ISubaccountState, ITokenRegistryMap } from '@puppet/sdk/state'
import { type Address, decodeAbiParameters, getAddress, type Hex } from 'viem'
import context, { getPrice } from '../context.js'
import { readSignedBalance } from '../onchain/account.js'
import {
  client,
  fetchBalanceHistory,
  fetchFundCheckpointsForFunds,
  fetchFundsByIds,
  fetchIdentitiesForAccounts,
  fetchLeaderboardMetrics,
  fetchRawActivity,
  type IRawEvent
} from './reads.js'

export type { IFundLatestMetric } from '@puppet/sdk/schema'
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

function tokenByBaseId(registry: ITokenRegistryMap, baseTokenIdList: Hex[]): Map<Hex, Address> {
  const hub = registry.get(HUB_CHAIN_ID)
  const map = new Map<Hex, Address>()
  if (!hub) return map
  for (const tid of baseTokenIdList) {
    const info = hub.get(tid)
    if (info) map.set(tid, getAddress(info.token))
  }
  return map
}

// Fund-metric pnl (realisedPnl / pnlList) is denominated in the fund's BASE-TOKEN wei (fundPeriodPnl = ΔnavPerShare *
// supply / FLOAT_PRECISION), NOT USD. Convert to USD at USD_DECIMALS scale (base-wei * price) so the cross-fund
// summary, performance chart and headline read in dollars rather than ~0 dust. An unpriceable base degrades to 0
// (flat) instead of a mis-scaled value. The GMX-trader metric is already USD-denominated and is NOT routed through here.
async function metricsPnlToUsd(metrics: IFundLatestMetric[]): Promise<IFundLatestMetric[]> {
  if (metrics.length === 0) return metrics
  const registry = await context.getTokenRegistry()
  const baseTokenIdList = [...new Set(metrics.map(m => m.baseToken))]
  const tokenMap = tokenByBaseId(registry, baseTokenIdList)
  const priceByBase = new Map<Hex, bigint>()
  await Promise.all(
    baseTokenIdList.map(async bid => {
      const token = tokenMap.get(bid)
      if (!token) return
      const { price } = await getPrice(getAddress(token))
      if (price !== 0n) priceByBase.set(bid, price)
    })
  )
  return metrics.map(m => {
    const price = priceByBase.get(m.baseToken) ?? 0n
    return { ...m, realisedPnl: m.realisedPnl * price, pnlList: m.pnlList.map(p => p * price) }
  })
}

export async function fetchUserSubscriptions(registry: ITokenRegistryMap, puppet: Address) {
  // Current-state subscriptions live on FundPosition (an unsubscribe CLEARS body and
  // mandate): reading the raw Subscribe event log would replay every historical change,
  // duplicating re-subscribes and resurrecting unsubscribed rules.
  const rows = (await client.select(fundPositionTable, { where: { holder: getAddress(puppet) } })).filter(
    r => r.body !== undefined && r.mandate !== undefined
  )
  if (rows.length === 0) return []

  const fundList = [...new Set(rows.map(row => getAddress(row.fund)))]
  const fundRows = await fetchFundsByIds(fundList)
  const fundById = new Map(fundRows.map(row => [getAddress(row.fund), row]))
  const tokenMap = tokenByBaseId(registry, [...new Set(fundRows.map(row => row.baseToken))])

  return rows.flatMap(row => {
    const fund = fundById.get(getAddress(row.fund))
    const baseToken = fund ? tokenMap.get(fund.baseToken) : undefined
    if (!fund || !baseToken) return []
    const body = decodeRuleBody(row.body as Hex)
    return [
      {
        ...row,
        ...body,
        master: fund.master,
        name: fund.name as Hex,
        baseToken,
        masterMatchingKey: getMasterMatchingKey(baseToken, fund.master) as Hex
      }
    ]
  })
}

export async function fetchMasterPoolState(fund: Address): Promise<IFund | undefined> {
  return client.find(fundTable, { id: getAddress(fund) })
}

export async function fetchMasterSubscribers(fund: Address, baseToken: Address): Promise<IAllocationPuppet[]> {
  const subscribed = (await client.select(fundPositionTable, { where: { fund: getAddress(fund) } })).filter(
    p => p.body !== undefined && p.mandate !== undefined
  )
  if (subscribed.length === 0) return []

  const holders = [...new Set(subscribed.map(p => getAddress(p.holder)))]
  // The mandate pulls STRICTLY from the hub-chain base-token deposit, so read exactly that one signed balance per
  // holder — a full readAccountBalances sweep here cost chains × tokens view calls per subscriber for one used row.
  const balanceEntries = await Promise.all(
    holders.map(async holder => {
      const signed = await readSignedBalance(holder, HUB_CHAIN_ID, baseToken).catch(() => 0n)
      return [holder, signed] as const
    })
  )
  const signedBalanceByHolder = new Map(balanceEntries)
  return subscribed.map(p => ({
    puppet: getAddress(p.holder),
    body: p.body as Hex,
    mandate: p.mandate as Hex,
    signedBalance: signedBalanceByHolder.get(getAddress(p.holder)) ?? 0n,
    lastAllocatedAt: p.lastAllocatedAt,
    hasOpenRedeem: p.weight > 0n
  }))
}

export async function fetchPuppetUsers(accounts: Address[]): Promise<Map<Address, Address>> {
  if (accounts.length === 0) return new Map()
  const rows = await fetchIdentitiesForAccounts(accounts.map(a => getAddress(a)))
  return new Map(rows.map(d => [getAddress(d.account), getAddress(d.user)]))
}

export async function fetchFundAllocationDistribution(
  fund: Address,
  master: Address
): Promise<Array<{ puppet: Address; user: Address; sharesHeld: bigint; isMaster: boolean }>> {
  const rows = await client.select(fundPositionTable, { where: { fund: getAddress(fund) } })
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

export interface IFundAction {
  kind: 'operate' | 'allocate' | 'event'
  label?: string
  blockTimestamp: number
  blockNumber: bigint
  transactionHash: Hex
  chainId: number
  totalMatched: bigint
  puppetCount: number
  resultCount: number
  callList: readonly IIAccount__Call[]
  transferList: readonly IIAccount__SignTransfer[]
  masterAmount: bigint
  allocated: bigint
  relayFee: bigint
  wrapAmount?: bigint
  // The relay fee's denomination (a registry BASE id): a dest-chain credit charges its fee in the credited token, not
  // the fund base. Absent = base-token fee (the hub default).
  feeToken?: Hex
  // The action's principal amount for kind:'event' rows that carry one (credit/swap input).
  tokenAmount?: { token: Hex; amount: bigint }
  // This action's tx ALSO deployed the fund (the genesis allocate): rendered as "Create fund" with the action's detail.
  createdFund?: boolean
}

const EVENT_NAME_BY_HASH = new Map<Hex, string>([
  [CONTRACT_EVENT_MAP.Account.DeployPuppetAccount.hash, 'Open account'],
  [CONTRACT_EVENT_MAP.PuppetGate.Recognize.hash, 'Deposit'],
  [CONTRACT_EVENT_MAP.PuppetGate.Swap.hash, 'Swap'],
  [CONTRACT_EVENT_MAP.FundGate.Wrap.hash, 'Wrap'],
  [CONTRACT_EVENT_MAP.HubGate.Withdraw.hash, 'Withdraw'],
  [CONTRACT_EVENT_MAP.Redeem.Claim.hash, 'Claim'],
  [CONTRACT_EVENT_MAP.Redeem.Sell.hash, 'Sell'],
  [CONTRACT_EVENT_MAP.Redeem.Liquidate.hash, 'Liquidate'],
  [CONTRACT_EVENT_MAP.Redeem.Redeem.hash, 'Redeem'],
  [CONTRACT_EVENT_MAP.Account.DeployFundAccount.hash, 'Create fund'],
  [CONTRACT_EVENT_MAP.Account.DeployPuppetAccount.hash, 'Open account']
])

// The fund lifecycle events (Redeem module) that share the FA-routed shape [intent, actualRelayFee, fund, …]: the fund
// address sits at arg index 2, exactly like Operate.account and Allocate.fundAccount. Labelled via EVENT_NAME_BY_HASH.
const REDEMPTION_EVENTS = [
  CONTRACT_EVENT_MAP.Redeem.Redeem,
  CONTRACT_EVENT_MAP.Redeem.Sell,
  CONTRACT_EVENT_MAP.Redeem.Claim,
  CONTRACT_EVENT_MAP.Redeem.Liquidate
] as const
const REDEMPTION_BY_HASH = new Map<Hex, (typeof REDEMPTION_EVENTS)[number]>(REDEMPTION_EVENTS.map(ev => [ev.hash, ev]))
// Every remaining fee-bearing event shares the [intent, actualRelayFee, ...] head; decode the fee generically so no
// action row renders without its relay fee.
const FEE_EVENTS = [...REDEMPTION_EVENTS, CONTRACT_EVENT_MAP.HubGate.Withdraw] as const
const FEE_BY_HASH = new Map<Hex, (typeof FEE_EVENTS)[number]>(FEE_EVENTS.map(ev => [ev.hash, ev]))

// Every master-initiated action bound to THIS fund account: allocate, operate, and the redemptions (redeem/sell/claim/
// liquidate), plus fund creation. The journal's /activity route returns the raw signed-domain events whose decoded
// account/fund field equals the fund (Operate.account / Allocate.fundAccount / Redeem*.fund all sit at arg index 2), so
// a single account=fund query covers them. We decode each event's `data` for its detail (call/transfer legs, allocated
// amounts, relay fee); unknown/label-only events fall through to a plain row.
export async function fetchFundActivity(fund: Address, limit = 40): Promise<IFundAction[]> {
  const rawList = await fetchRawActivity(getAddress(fund), limit).catch(() => [] as IRawEvent[])

  const base = (e: IRawEvent) => ({
    blockTimestamp: e.blockTimestamp,
    blockNumber: e.blockNumber,
    transactionHash: e.transactionHash,
    chainId: Number(e.chainId),
    totalMatched: 0n,
    puppetCount: 0,
    resultCount: 0,
    callList: [] as readonly IIAccount__Call[],
    transferList: [] as readonly IIAccount__SignTransfer[],
    masterAmount: 0n,
    allocated: 0n,
    relayFee: 0n
  })

  const actions: IFundAction[] = []
  for (const e of rawList) {
    if (e.method === CONTRACT_EVENT_MAP.FundGate.Operate.hash) {
      const [intent, actualRelayFee, , result] = decodeAbiParameters(
        CONTRACT_EVENT_MAP.FundGate.Operate.args,
        e.data
      ) as unknown as [
        { callList: readonly IIAccount__Call[]; transferList: readonly IIAccount__SignTransfer[] },
        bigint,
        Address,
        readonly Hex[]
      ]
      actions.push({
        ...base(e),
        kind: 'operate',
        resultCount: result.length,
        callList: intent.callList,
        transferList: intent.transferList,
        relayFee: actualRelayFee
      })
    } else if (e.method === CONTRACT_EVENT_MAP.Allocate.Allocate.hash) {
      const [intent, actualRelayFee, , , puppetSharesPostList, totalAllocated] = decodeAbiParameters(
        CONTRACT_EVENT_MAP.Allocate.Allocate.args,
        e.data
      ) as unknown as [{ masterAmount: bigint }, bigint, Address, bigint, readonly bigint[], bigint]
      const masterAmount = intent.masterAmount
      actions.push({
        ...base(e),
        kind: 'allocate',
        totalMatched: totalAllocated,
        puppetCount: puppetSharesPostList.filter(s => s > 0n).length,
        masterAmount,
        allocated: masterAmount + totalAllocated,
        relayFee: actualRelayFee
      })
    } else if (e.method === CONTRACT_EVENT_MAP.FundGate.Wrap.hash) {
      const [intent, actualRelayFee] = decodeAbiParameters(CONTRACT_EVENT_MAP.FundGate.Wrap.args, e.data) as unknown as [
        { amount: bigint; unwrap: boolean },
        bigint,
        Address
      ]
      actions.push({
        ...base(e),
        kind: 'event',
        label: intent.unwrap ? 'Unwrap' : 'Wrap',
        wrapAmount: intent.amount,
        relayFee: actualRelayFee
      })
    } else if (e.method === CONTRACT_EVENT_MAP.FundGate.Recognize.hash) {
      const [intent, actualRelayFee] = decodeAbiParameters(
        CONTRACT_EVENT_MAP.FundGate.Recognize.args,
        e.data
      ) as unknown as [{ token: Hex; amount: bigint }, bigint]
      actions.push({
        ...base(e),
        kind: 'event',
        label: 'Credit',
        tokenAmount: { token: intent.token, amount: intent.amount },
        feeToken: intent.token,
        relayFee: actualRelayFee
      })
    } else if (e.method === CONTRACT_EVENT_MAP.PuppetGate.Swap.hash) {
      // FundGate.Swap and PuppetGate.Swap share the topic hash (same event name) with different arg layouts; a fund's
      // activity is FundGate-shaped. A failed decode falls back to a label-only row rather than dropping the action.
      try {
        const [intent, actualRelayFee] = decodeAbiParameters(CONTRACT_EVENT_MAP.FundGate.Swap.args, e.data) as unknown as [
          { swap: { inputToken: Hex; inputAmount: bigint } },
          bigint
        ]
        actions.push({
          ...base(e),
          kind: 'event',
          label: 'Swap',
          tokenAmount: { token: intent.swap.inputToken, amount: intent.swap.inputAmount },
          feeToken: intent.swap.inputToken,
          relayFee: actualRelayFee
        })
      } catch {
        actions.push({ ...base(e), kind: 'event', label: 'Swap', relayFee: 0n })
      }
    } else {
      const feeEvent = FEE_BY_HASH.get(e.method)
      const relayFee = feeEvent
        ? (decodeAbiParameters(feeEvent.args, e.data) as unknown as [unknown, bigint])[1]
        : 0n
      actions.push({ ...base(e), kind: 'event', label: EVENT_NAME_BY_HASH.get(e.method) ?? 'Event', relayFee })
    }
  }
  // A create-on-missing recognize emits DeployFundAccount + Recognize in ONE tx: coalesce them into a single row that
  // keeps the deploy's label (the page renders it chain-aware as "Open <chain> account") and the recognize's
  // amount/fee, instead of a bare marker row next to an orphan credit.
  const deployTxes = new Set(actions.filter(a => a.label === 'Create fund').map(a => a.transactionHash))
  const coalesced = actions.flatMap(a => {
    if (a.label === 'Create fund') {
      const sibling = actions.find(
        c => c.transactionHash === a.transactionHash && (c.label === 'Credit' || c.kind === 'allocate')
      )
      if (!sibling) return [a]
      return [sibling.kind === 'allocate' ? { ...sibling, createdFund: true } : { ...sibling, label: 'Create fund' }]
    }
    if ((a.label === 'Credit' || a.kind === 'allocate') && deployTxes.has(a.transactionHash)) return []
    return [a]
  })
  return coalesced
    .sort((x, y) => (y.blockNumber > x.blockNumber ? 1 : y.blockNumber < x.blockNumber ? -1 : 0))
    .slice(0, limit)
}

export async function fetchFundAccountMetricList(params: {
  fund: Address
  activityTimeframe: IntervalTime
  collateralTokenList: Hex[]
}): Promise<IFundLatestMetric[]> {
  const startActivityTimeframe = getUnixTimestamp() - params.activityTimeframe
  const metrics = (await client.select(fundLatestMetricTable, { where: { fund: getAddress(params.fund) } })).filter(
    m =>
      m.interval === params.activityTimeframe &&
      m.lastUpdatedTimestamp >= startActivityTimeframe &&
      (params.collateralTokenList.length === 0 || params.collateralTokenList.includes(m.baseToken))
  )
  return metricsPnlToUsd(metrics)
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
  // Slots are pruned datastore-side against the LAST EVENT's time, not wall-clock now, so the oldest
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
  queuedShares: bigint
  totalShareSupply: bigint
  puppetList: Address[]
  pnlTimeline: IBalanceTimelinePoint[]
  // Consistency metric derived on the website from the per-trade `pnlList` the datastore already exposes.
  // TODO(datastore): needs maxDrawdown (bps) and sharpeRatio on FundLatestMetric to surface downside/risk-adjusted
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
  const now = getUnixTimestamp()
  const startActivityTimeframe = now - params.activityTimeframe

  const serverSortable =
    params.sortBy.selector === 'realisedPnl' ||
    params.sortBy.selector === 'navPerShare' ||
    params.sortBy.selector === 'allocated'
  const canServerSide =
    serverSortable &&
    params.sortBy.direction === 'desc' &&
    params.account === undefined &&
    params.collateralTokenList.length <= 1

  let metricList: IFundLatestMetric[]
  if (canServerSide) {
    metricList = await fetchLeaderboardMetrics(params.activityTimeframe, {
      sort: params.sortBy.selector as 'realisedPnl' | 'navPerShare' | 'allocated',
      limit: params.paging.pageSize,
      offset: params.paging.offset,
      now,
      baseToken: params.collateralTokenList.length === 1 ? params.collateralTokenList[0] : undefined
    })
  } else {
    const broad = await fetchLeaderboardMetrics(params.activityTimeframe, { now })
    const account = params.account ? getAddress(params.account) : undefined
    const filtered = broad.filter(
      m =>
        m.interval === params.activityTimeframe &&
        m.lastUpdatedTimestamp >= startActivityTimeframe &&
        (account === undefined || getAddress(m.fund) === account) &&
        (params.collateralTokenList.length === 0 || params.collateralTokenList.includes(m.baseToken))
    )
    const sel = params.sortBy.selector
    const dir = params.sortBy.direction === 'asc' ? 1 : -1
    filtered.sort((a, b) => {
      const av = a[sel]
      const bv = b[sel]
      if (typeof av === 'bigint' && typeof bv === 'bigint') return av > bv ? dir : av < bv ? -dir : 0
      if (typeof av === 'number' && typeof bv === 'number') return av > bv ? dir : av < bv ? -dir : 0
      return 0
    })
    metricList = filtered.slice(params.paging.offset, params.paging.offset + params.paging.pageSize)
  }
  if (metricList.length === 0) return []
  metricList = await metricsPnlToUsd(metricList)

  const fundList = metricList.map(m => m.fund)
  const [positionList, fundRows] = await Promise.all([
    client.select(fundPositionTable, { where: { fund: { in: fundList } } }),
    fetchFundsByIds(fundList)
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
  // Drop liquidated funds: a liquidated fund is dead (cannot allocate or trade), so it must not rank in the active
  // leaderboard. liquidationRate is the folded post-state on the fund row, so this self-heals the moment a fund liquidates.
  return metricList
    .filter(m => (fundById.get(getAddress(m.fund))?.liquidationRate ?? 0n) === 0n)
    .map(m => {
    // Derive win/loss consistency from the per-trade realised PnL series the datastore already provides.
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
      queuedShares: fundRow?.queuedShares ?? 0n,
      totalShareSupply: fundRow?.totalShareSupply ?? 0n,
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

export interface IBalanceTimelinePoint {
  time: number
  value: number
}

// The GMX-trader ("shadow") leaderboard row: ranks GMX traders from the gmxTraderMetric fold (re-ingested on our
// datastore). size/collateral are realised + open; realisedPnlUsd is the metric's total pnl (realised + open mark).
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
  const sortColumn = { size: 'realisedSizeInUsd', pnl: 'pnl', roi: 'roi' } as const
  const metricList = await client.select(gmxTraderMetricTable, {
    where: {
      interval: params.activityTimeframe,
      lastUpdatedTimestamp: { gte: now - params.activityTimeframe },
      ...(params.account ? { account: getAddress(params.account) } : {}),
      ...(params.collateralTokenList.length > 0
        ? { collateralToken: { in: params.collateralTokenList.map(getAddress) } }
        : {})
    },
    orderBy: { col: sortColumn[params.sortBy.selector], dir: params.sortBy.direction },
    limit: params.paging.pageSize,
    offset: params.paging.offset
  })
  if (metricList.length === 0) return []
  return metricList.map(m => ({
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
  }))
}

// The datastore stores ONE raw checkpoint stream: cash rows key by 32-byte protocol
// token, fund-share rows key by the 20-byte fund address with sharesHeld as the
// balance. The USD timeline composes here at read time: cash x price plus shares x
// nav x price, with prices from the latest oracle rows.
const isFundKey = (token: string): boolean => token.length === 42

// The logstore retains ONE balance-checkpoint history stream: cash rows key by 32-byte protocol token, fund-share
// rows key by the 20-byte fund address with sharesHeld as the balance. The USD timeline composes here at read time:
// cash x price plus shares x nav x price, with prices from the latest oracle snapshot (every point is valued at the
// current price). The full history is replayed: pre-window checkpoints seed the starting state.
export async function fetchPuppetBalanceTimeline(
  registry: ITokenRegistryMap,
  accounts: ISubaccountState[],
  activityTimeframe: IntervalTime
): Promise<IBalanceTimelinePoint[]> {
  if (accounts.length === 0) return []
  const endTime = getUnixTimestamp()
  const startTime = endTime - activityTimeframe
  const accountList = accounts.map(a => a.account as Hex)

  // Full balance history first, to discover every fund whose shares the account has ever held (current positions plus
  // any fully-exited ones still in the history), then that funds' full NAV history + rows.
  const balanceRows = await fetchBalanceHistory(accountList)
  const fundSet = new Set<Hex>()
  for (const acc of accounts) {
    for (const pos of acc.positions) fundSet.add(pos.fund as Hex)
    for (const fund of acc.funds) fundSet.add(fund.fund as Hex)
  }
  for (const row of balanceRows) if (isFundKey(row.token)) fundSet.add(row.token as Hex)
  const fundList = [...fundSet]
  const [navRows, fundRows] = await Promise.all([fetchFundCheckpointsForFunds(fundList), fetchFundsByIds(fundList)])

  const balanceKey = (chainId: bigint, account: string, token: Address) => `${chainId}-${account}-${token}`
  const keys = new Map<string, { token: Hex }>()
  for (const acc of accounts) {
    for (const balance of acc.balances.values())
      keys.set(balanceKey(balance.chainId, acc.account, balance.token), { token: balance.token })
    for (const pos of acc.positions)
      keys.set(balanceKey(BigInt(HUB_CHAIN_ID), acc.account, pos.fund), { token: pos.fund as Hex })
  }
  for (const row of balanceRows)
    keys.set(balanceKey(row.chainId, row.account, row.token), { token: row.token as Hex })

  // In-window changes drive the line; pre-window checkpoints (asc-ordered, so the last write per slot wins) seed it.
  const windowRows = balanceRows.filter(r => r.blockTimestamp >= startTime)
  const navWindow = navRows.filter(r => r.blockTimestamp >= startTime)

  const fundBaseId = new Map(fundRows.map(row => [row.fund as string, row.baseToken as Hex]))
  const baseTokenIdList = [
    ...new Set([...[...keys.values()].filter(k => !isFundKey(k.token)).map(k => k.token), ...fundBaseId.values()])
  ]
  const tokenMap = tokenByBaseId(registry, baseTokenIdList)
  // Price every distinct token in parallel through the single getter; the TTL-cached source dedups the fetch.
  const priceByToken = new Map<Address, bigint>()
  await Promise.all(
    [...new Set(tokenMap.values())].map(async token => {
      const { price } = await getPrice(getAddress(token))
      if (price !== 0n) priceByToken.set(getAddress(token), price)
    })
  )
  const priceOf = (symbol: string): bigint => {
    const mapped = tokenMap.get(symbol as Hex)
    return mapped ? (priceByToken.get(getAddress(mapped)) ?? 0n) : 0n
  }

  const balanceState = new Map<string, bigint>()
  const navState = new Map<string, bigint>()
  for (const row of balanceRows)
    if (row.blockTimestamp < startTime)
      balanceState.set(balanceKey(row.chainId, row.account, row.token), row.signedBalance)
  for (const row of navRows) if (row.blockTimestamp < startTime) navState.set(row.fund, row.navPerShare)
  // No checkpoint before the window: seed from current raw state so every account is
  // covered from the first point.
  for (const acc of accounts) {
    for (const balance of acc.balances.values()) {
      const key = balanceKey(balance.chainId, acc.account, balance.token)
      if (!balanceState.has(key) && !windowRows.some(r => balanceKey(r.chainId, r.account, r.token) === key)) {
        balanceState.set(key, balance.signedBalance)
      }
    }
    for (const pos of acc.positions) {
      const key = balanceKey(BigInt(HUB_CHAIN_ID), acc.account, pos.fund)
      if (!balanceState.has(key) && !windowRows.some(r => balanceKey(r.chainId, r.account, r.token) === key)) {
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
      apply: () => balanceState.set(balanceKey(row.chainId, row.account, row.token), row.signedBalance)
    })),
    ...navWindow.map(row => ({
      time: row.blockTimestamp,
      apply: () => navState.set(row.fund, row.navPerShare)
    }))
  ].sort((a, b) => a.time - b.time)

  const totalUsd = (): bigint => {
    let total = 0n
    for (const [key, balance] of balanceState) {
      const token = keys.get(key)?.token
      if (!token) continue
      if (isFundKey(token)) {
        const baseId = fundBaseId.get(token)
        const nav = navState.get(token) ?? 0n
        if (baseId) total += ((balance * nav) / PRECISION.floatPrecisionExp) * priceOf(baseId)
      } else {
        total += balance * priceOf(token)
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
