import { HUB_CANONICAL_TOKEN, HUB_CHAIN_ID } from '@puppet/contracts/const'
import { type ChainId, TOKEN_META } from '@puppet/sdk/const'
import { formatFixed, getTokenDescription } from '@puppet/sdk/core'
import type { IDigestClient } from '@puppet/sdk/datastore'
import type { IGetRate } from '@puppet/sdk/evaluate'
import { type IFundBook, markPrice } from '@puppet/sdk/intent'
import { balanceTable, fundMetricTable, type IFundMetricRow } from '@puppet/sdk/schema'
import { fundMetric, PNL_SLOT_COUNT, pnlEventsOf } from '@puppet/sdk/state'
import { getAddress, isAddressEqual } from 'viem'
import { PRICE_FRESHNESS_MS } from '../context.js'
import type { IFundLive } from '../venue.js'

export const LEADERBOARD_ROWS = 100
const ACTIVITY_BUCKETS = 24

export type ILeaderboardRank = 'pnl' | 'roi' | 'valuation'

export async function leaderboardEntries(reader: IDigestClient, interval: number, rank: ILeaderboardRank, dir: 'asc' | 'desc', sinceSec: number) {
  const bucket = interval / ACTIVITY_BUCKETS
  const rows = await reader.select(fundMetricTable, {
    where: rank === 'valuation' ? { interval } : { interval, lastUpdatedTimestamp: { gte: Math.floor(sinceSec / bucket) * bucket } },
    orderBy: { col: rank, dir },
    limit: LEADERBOARD_ROWS
  })
  return rows.flatMap(row => (row.symbol === undefined || row.pixels === undefined ? [] : [{ ...row, profile: { symbol: row.symbol, pixels: row.pixels } }]))
}
export type ILeaderboardEntry = Awaited<ReturnType<typeof leaderboardEntries>>[number]

export interface ITimelinePoint {
  time: number
  value: number | null
}

export const CHART_POINTS = 1000

export const pnlTipOf = (pnl: bigint, row: Pick<IFundMetricRow, 'lastUpdatedTimestamp' | 'valuation'>, worth: IFundLive['worth'] | null): { time: number; pnl: bigint } | null =>
  worth === null || worth.value === undefined || worth.time <= row.lastUpdatedTimestamp ? null : { time: worth.time, pnl: pnl + worth.value - row.valuation }

export function traderPerformance(row: IFundMetricRow, interval: number, sinceSec: number, untilSec: number) {
  const profit = fundMetric(pnlEventsOf(row), interval, sinceSec, untilSec, PNL_SLOT_COUNT)
  const levels = pnlEventsOf(row)
    .map((event, k) => ({ time: event.time, index: row.performanceIndexList[k]! }))
    .sort((a, b) => a.time - b.time)
  const step = Math.max(1, Math.ceil(interval / PNL_SLOT_COUNT))
  const indexPoints: { time: number; value: number }[] = []
  let next = 0
  let level = row.openingIndex
  for (let time = sinceSec; time < untilSec; time += step) {
    while (next < levels.length && levels[next]!.time <= time) level = levels[next++]!.index
    indexPoints.push({ time, value: formatFixed(TOKEN_META.WETH.decimals, level) })
  }
  while (next < levels.length) level = levels[next++]!.index
  indexPoints.push({ time: untilSec, value: formatFixed(TOKEN_META.WETH.decimals, level) })
  const opening = indexPoints[0]!.value
  return {
    pnl: profit.pnl,
    roi: opening === 0 ? null : (indexPoints[indexPoints.length - 1]!.value / opening - 1) * 100,
    pnlPoints: profit.points,
    indexPoints,
    tip: null as { time: number; value: number } | null,
    allocations: row.allocationTimeList.filter(time => time >= sinceSec)
  }
}
export type ITraderPerformance = ReturnType<typeof traderPerformance>

export async function holdersOf(reader: IDigestClient, rate: IGetRate, book: IFundBook) {
  const mandating = book.mandates.map(row => getAddress(row.puppet)).filter(puppet => !isAddressEqual(puppet, book.master))
  const tokens = Object.values(HUB_CANONICAL_TOKEN).map(token => getAddress(token))
  const [rows, quotes] = await Promise.all([
    mandating.length === 0 ? [] : reader.select(balanceTable, { where: { account: { in: mandating } } }),
    Promise.all(
      tokens.map(async token => ({
        token,
        price: await markPrice(rate, HUB_CHAIN_ID as ChainId, token, 10n ** BigInt(getTokenDescription(HUB_CHAIN_ID as ChainId, token).decimals), PRICE_FRESHNESS_MS)
      }))
    )
  ])
  return {
    balances: rows.flatMap(row =>
      Number(row.chainId) === HUB_CHAIN_ID && row.amount > 0n && tokens.some(token => isAddressEqual(token, row.token))
        ? [{ puppet: getAddress(row.account), token: getAddress(row.token), amount: row.amount }]
        : []
    ),
    quotes
  }
}
