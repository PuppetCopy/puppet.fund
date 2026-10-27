import { HUB_CANONICAL_TOKEN, HUB_CHAIN_ID, PRICE_PRECISION } from '@puppet/contracts/const'
import { fundSymbolOf, gridOf } from '@puppet/sdk/account'
import { type ChainId, IntervalTime, TOKEN_META, USD_DECIMALS, USD_SYMBOL } from '@puppet/sdk/const'
import { readableUsd } from '@puppet/sdk/core'
import { createClient } from '@puppet/sdk/datastore'
import { oracleRate, USD_PRICE_DECIMALS, usdPriceFromRate } from '@puppet/sdk/evaluate'
import { cashFor, profitFeeOf } from '@puppet/sdk/pool'
import * as schema from '@puppet/sdk/schema'
import { fundMetricTable } from '@puppet/sdk/schema'
import { fundMetric, PNL_SLOT_COUNT, pnlEventsAcross, pnlEventsOf, symbolOf, walletsOf } from '@puppet/sdk/state'
import { avatarSvg, jazziconSvg, robotCellsOf } from '@puppet/sdk/ui-components'
import { type Address, formatUnits, getAddress, isAddressEqual } from 'viem'

const chronicleUrl = Bun.env.CHRONICLE_URL
if (!chronicleUrl) throw new Error('CHRONICLE_URL is required')

const oracleUrl = Bun.env.ORACLE_URL
if (!oracleUrl) throw new Error('ORACLE_URL is required')

export const TICK_MS = Number(Bun.env.CHRONICLE_TICK_MS)
if (!Number.isInteger(TICK_MS) || TICK_MS <= 0) throw new Error('CHRONICLE_TICK_MS is required')

const client = createClient({ storageUrl: chronicleUrl, schema, timeoutMs: 10_000 })
const getRate = oracleRate(oracleUrl)
const SPARK_INTERVAL = IntervalTime.MONTH

const MINUS = '\u2212'
const usd = (wei: bigint, price: bigint): string => `$${readableUsd((wei * price) / 10n ** BigInt(USD_PRICE_DECIMALS - USD_DECIMALS))}`

export type ITone = 'positive' | 'neutral' | 'negative'

export interface ILeaderRow {
  avatar: string
  label: string
  master: Address
  venues: string[]
  pnl: string
  roi: string | null
  tone: ITone
  spark: { time: number; value: number }[]
  tick: number
}

export const LEADERBOARD_WINDOW = '7 Day'
const LEADERBOARD_INTERVAL = IntervalTime.WEEK

export interface IMasterCard {
  avatar: string
  label: string
  master: Address
  allocated: string
  puppets: string[]
  puppetCount: number
  fundValue: string
  pnl: string
  roi: string | null
  window: string
  tone: ITone
  spark: { time: number; value: number }[]
  tick: number
}

export interface IPuppetCard {
  avatar: string
  account: Address
  masterOf: string | null
  inFunds: string
  funds: string[]
  fundCount: number
  tick: number | null
}

export async function fetchLeaderboard(limit: number): Promise<ILeaderRow[]> {
  const until = Math.floor(Date.now() / 1000)
  const since = until - LEADERBOARD_INTERVAL
  const [rows, rate] = await Promise.all([
    client.select(fundMetricTable, { where: { interval: LEADERBOARD_INTERVAL, lastUpdatedTimestamp: { gte: since } }, orderBy: { col: 'pnl', dir: 'desc' }, limit }),
    getRate(symbolOf(HUB_CHAIN_ID as ChainId, HUB_CANONICAL_TOKEN.WETH), USD_SYMBOL, TICK_MS)
  ])
  const price = usdPriceFromRate(rate, USD_DECIMALS)
  const usdPerEth = Number(formatUnits(price * 10n ** BigInt(TOKEN_META.WETH.decimals), USD_PRICE_DECIMALS))
  const funds = rows.flatMap(row => (row.symbol === undefined || row.pixels === undefined ? [] : [{ row, profile: { symbol: row.symbol, pixels: row.pixels } }]))
  return funds.map(({ row, profile }) => {
    const events = pnlEventsOf(row)
    const { pnl, points } = fundMetric(events, LEADERBOARD_INTERVAL, since, until, PNL_SLOT_COUNT)
    const levels = events.map((event, k) => ({ time: event.time, index: row.performanceIndexList[k]! })).sort((a, b) => a.time - b.time)
    const opening = levels.findLast(level => level.time <= since)?.index ?? row.openingIndex
    const closing = levels.at(-1)?.index ?? row.openingIndex
    const roi = opening === 0n ? null : (Number(closing) / Number(opening) - 1) * 100
    return {
      avatar: `data:image/svg+xml;base64,${btoa(avatarSvg(gridOf(profile)))}`,
      label: fundSymbolOf(profile),
      master: getAddress(row.master),
      venues: row.venueList
        .map((venue, index) => ({ venue, time: row.venueTimeList[index]! }))
        .filter(active => active.time >= since)
        .sort((a, b) => b.time - a.time)
        .map(active => active.venue),
      pnl: `${pnl < 0n ? MINUS : ''}${usd(pnl < 0n ? -pnl : pnl, price)}`,
      roi: roi === null ? null : `${roi < 0 ? MINUS : ''}${Math.abs(roi).toFixed(2)}%`,
      tone: pnl === 0n ? 'neutral' : pnl > 0n ? 'positive' : 'negative',
      spark: points.map(point => ({ time: point.time, value: point.value * usdPerEth })),
      tick: row.lastUpdatedTimestamp * 1000
    }
  })
}

export async function fetchMasterCard(master: Address): Promise<IMasterCard | null> {
  const [rows, rate, holdings, fundRows] = await Promise.all([
    client.select(fundMetricTable, { where: { master } }),
    getRate(symbolOf(HUB_CHAIN_ID as ChainId, HUB_CANONICAL_TOKEN.WETH), USD_SYMBOL, TICK_MS),
    client.select(schema.holdingTable, { where: { master } }),
    client.select(schema.fundTable, { where: { master } })
  ])
  const held = holdings.filter(h => h.shares > 0n && !isAddressEqual(h.holder, master))
  const wallets = await walletsOf(client, held.map(h => h.holder))
  const price = usdPriceFromRate(rate, USD_DECIMALS)
  const usdPerEth = Number(formatUnits(price * 10n ** BigInt(TOKEN_META.WETH.decimals), USD_PRICE_DECIMALS))
  const row = rows.find(each => each.interval === SPARK_INTERVAL)
  if (row === undefined || row.symbol === undefined || row.pixels === undefined) return null
  const until = Math.floor(Date.now() / 1000)
  const first = pnlEventsAcross(rows, SPARK_INTERVAL).reduce((earliest, event) => (event.time > until - SPARK_INTERVAL && event.time < earliest ? event.time : earliest), until)
  const interval = until - IntervalTime.DAY < first ? IntervalTime.DAY : until - IntervalTime.WEEK < first ? IntervalTime.WEEK : SPARK_INTERVAL
  const start = first === until ? until - interval : Math.max(until - interval, first - Math.ceil((until - first) / 12))
  const events = pnlEventsAcross(rows, interval)
  const { pnl, points } = fundMetric(events, until - start, start, until, PNL_SLOT_COUNT)
  const windowRow = rows.find(each => each.interval === interval)
  if (windowRow === undefined) throw new Error(`the fund ${master} has a ${SPARK_INTERVAL}s metric row but no ${interval}s one`)
  const levels = [...events].sort((a, b) => a.time - b.time)
  const opening = levels.findLast(level => level.time <= until - interval)?.index ?? windowRow.openingIndex
  const closing = levels.at(-1)?.index ?? windowRow.openingIndex
  const roi = opening === 0n ? null : (Number(closing) / Number(opening) - 1) * 100
  const profile = { symbol: row.symbol, pixels: row.pixels }
  const [fundRow] = fundRows
  if (fundRow === undefined) throw new Error(`the fund ${master} has metric rows but no fund row`)
  const puppetShares = held.reduce((total, h) => total + h.shares, 0n)
  return {
    avatar: `data:image/svg+xml;base64,${btoa(avatarSvg(gridOf(profile)))}`,
    label: fundSymbolOf(profile),
    master,
    allocated: usd(cashFor(puppetShares, fundRow.totalShares, fundRow.value), price),
    puppets: [...held]
      .sort((a, b) => (a.shares > b.shares ? -1 : a.shares < b.shares ? 1 : 0))
      .slice(0, 5)
      .map(h => `data:image/svg+xml;base64,${btoa(jazziconSvg(wallets.get(getAddress(h.holder)) ?? getAddress(h.holder)))}`),
    puppetCount: held.length,
    fundValue: usd(row.valuation, price),
    pnl: `${pnl < 0n ? MINUS : ''}${usd(pnl < 0n ? -pnl : pnl, price)}`,
    roi: roi === null ? null : `${roi < 0 ? MINUS : ''}${Math.abs(roi).toFixed(2)}%`,
    window: interval === IntervalTime.DAY ? '1 Day' : interval === IntervalTime.WEEK ? '7 Day' : '30 Day',
    tone: pnl === 0n ? 'neutral' : pnl > 0n ? 'positive' : 'negative',
    spark: points.map(point => ({ time: point.time, value: point.value * usdPerEth })),
    tick: rows.reduce((latest, each) => Math.max(latest, each.lastUpdatedTimestamp), 0) * 1000
  }
}

export async function fetchPuppetCard(account: Address): Promise<IPuppetCard | null> {
  const [accounts, bodies, mandates, holdings, rate] = await Promise.all([
    client.select(schema.accountTable, { where: { account } }),
    client.select(schema.accountTable, { where: { owner: account } }),
    client.select(schema.mandateTable, { where: { puppet: account } }),
    client.select(schema.holdingTable, { where: { holder: account } }),
    getRate(symbolOf(HUB_CHAIN_ID as ChainId, HUB_CANONICAL_TOKEN.WETH), USD_SYMBOL, TICK_MS)
  ])
  const [first] = accounts
  if (first === undefined) return null
  const owned = [...new Set(bodies.map(row => getAddress(row.account)))]
  const masters = [...new Set([...mandates, ...holdings].map(row => getAddress(row.master)))].filter(master => !isAddressEqual(master, account))
  const [fundRows, metrics] =
    masters.length + owned.length === 0
      ? [[], []]
      : await Promise.all([
          client.select(schema.fundTable, { where: { master: { in: [...masters, ...owned] } } }),
          client.select(fundMetricTable, { where: { master: { in: masters } } })
        ])
  const price = usdPriceFromRate(rate, USD_DECIMALS)
  const inFunds = holdings.filter(holding => !isAddressEqual(holding.master, account)).reduce((total, holding) => {
    const fundRow = fundRows.find(row => isAddressEqual(row.master, holding.master))
    if (fundRow === undefined) throw new Error(`${account} holds ${holding.master} with no fund row`)
    const [latest] = metrics.filter(row => isAddressEqual(row.master, holding.master)).sort((a, b) => b.lastUpdatedTimestamp - a.lastUpdatedTimestamp)
    const nav = latest === undefined ? fundRow.value : latest.valuation
    const gross = cashFor(holding.shares, fundRow.totalShares, nav)
    return total + gross - profitFeeOf(gross, holding.cost, cashFor(PRICE_PRECISION, fundRow.totalShares, nav), fundRow.performanceFee)
  }, 0n)
  const [firstFund, ...moreFunds] = fundRows.filter(row => owned.some(body => isAddressEqual(body, row.master))).map(row => fundSymbolOf(row))
  const wallet = getAddress(first.owner)
  return {
    avatar: `data:image/svg+xml;base64,${btoa(jazziconSvg(wallet))}`,
    account: wallet,
    masterOf: firstFund === undefined ? null : moreFunds.length === 0 ? firstFund : `${firstFund} +${moreFunds.length}`,
    inFunds: usd(inFunds, price),
    funds: masters.slice(0, 5).map(master => {
      const fundRow = fundRows.find(row => isAddressEqual(row.master, master))
      return `data:image/svg+xml;base64,${btoa(avatarSvg(fundRow === undefined ? robotCellsOf(master) : gridOf(fundRow)))}`
    }),
    fundCount: masters.length,
    tick: metrics.length === 0 ? null : metrics.reduce((latest, row) => Math.max(latest, row.lastUpdatedTimestamp), 0) * 1000
  }
}
