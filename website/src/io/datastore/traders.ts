import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { formatFixed, getTokenDescription } from '@puppet/sdk/core'
import { VALUE_KEY } from '@puppet/sdk/evaluate'
import { cashFor, VIRTUAL_UNITS } from '@puppet/sdk/pool'
import {
  accountTable,
  fundTable,
  holdingTable,
  type IFundRow,
  type IHoldingRow,
  type IMasterMetricRow,
  type IQueueRow,
  type IValuationRow,
  queueTable,
  valuationTable
} from '@puppet/sdk/schema'
import { chainTokenOfKey, PNL_SLOT_COUNT } from '@puppet/sdk/state'
import type { IGmxPositionRow } from '@puppet/sdk/venue'
import { GMX_V2_CHAIN_ID, makeOnchainGmxPositionProvider } from '@puppet/sdk/venue'
import { type Address, getAddress, isAddressEqual, type PublicClient } from 'viem'
import { publicClientMap } from '../../wallet/index.js'
import { getRate } from '../context.js'
import { client } from './reads.js'
import { resample } from './walletTimeline.js'

const VALUE_DECIMALS = getTokenDescription(HUB_CHAIN_ID, chainTokenOfKey(HUB_CHAIN_ID, VALUE_KEY)).decimals

export const POOL_UNIT_DECIMALS = VALUE_DECIMALS + VIRTUAL_UNITS.toString().length - 1
const POOL_UNIT = 10n ** BigInt(POOL_UNIT_DECIMALS)

export interface ITraderView {
  master: Address
  user: Address | null
  createdAt: number | null
  fundRow: IFundRow | undefined
  queue: IQueueRow | undefined
  holdings: IHoldingRow[]
  valuations: IValuationRow[]
}

export async function traderView(master: Address): Promise<ITraderView | undefined> {
  const [fundRow, queue, holdings, valuations, accounts] = await Promise.all([
    client.find(fundTable, { master }),
    client.find(queueTable, { master }),
    client.select(holdingTable, { where: { master } }),
    client.select(valuationTable, { where: { master }, orderBy: { col: 'block', dir: 'asc' } }),
    client.select(accountTable, { where: { account: master } })
  ])
  if (fundRow === undefined) return undefined
  const parent = accounts[0]?.owner
  const parents = parent === undefined ? [] : await client.select(accountTable, { where: { account: getAddress(parent) } })
  const created = accounts.map(a => a.createdAt)
  return {
    master: getAddress(master),
    user: parents.length === 0 ? null : getAddress(parents[0]!.owner),
    createdAt: created.length === 0 ? null : Math.min(...created),
    fundRow,
    queue,
    holdings: holdings.filter(h => h.units > 0n),
    valuations
  }
}

export interface ILeaderboardEntry {
  master: Address
  fundRow: IFundRow
  backers: number
  backing: bigint
  createdAt: number | null
  valuations: IValuationRow[]
}

export async function leaderboardEntries(): Promise<ILeaderboardEntry[]> {
  const fundRows = await client.select(fundTable)
  const masters = fundRows.map(p => getAddress(p.master))
  if (masters.length === 0) return []
  const [accounts, holdings, valuations] = await Promise.all([
    client.select(accountTable, { where: { account: { in: masters } } }),
    client.select(holdingTable, { where: { master: { in: masters } } }),
    client.select(valuationTable, { where: { master: { in: masters } }, orderBy: { col: 'block', dir: 'asc' } })
  ])
  return fundRows.map(fundRow => {
    const master = getAddress(fundRow.master)
    const backers = holdings.filter(h => isAddressEqual(h.master, master) && !isAddressEqual(h.holder, master) && h.units > 0n)
    const created = accounts.filter(a => isAddressEqual(a.account, master)).map(a => a.createdAt)
    return {
      master,
      fundRow,
      backers: backers.length,
      backing: cashFor(
        backers.reduce((total, h) => total + h.units, 0n),
        fundRow.totalUnits,
        fundRow.value
      ),
      createdAt: created.length === 0 ? null : Math.min(...created),
      valuations: valuations.filter(v => isAddressEqual(v.master, master))
    }
  })
}

export interface ITimelinePoint {
  time: number
  value: number
}

export const unitPriceOf = (row: Pick<IValuationRow, 'value' | 'totalUnits'>): bigint => cashFor(POOL_UNIT, row.totalUnits, row.value)

export function traderTimeline(valuations: readonly IValuationRow[], sinceSec: number, untilSec: number): ITimelinePoint[] {
  const first = valuations[0]
  if (first === undefined) return []
  const points = valuations.map(v => ({ time: v.blockTimestamp, total: unitPriceOf(v) }))
  return resample(points, Math.max(sinceSec, first.blockTimestamp), untilSec)
}

export interface IMasterMetric {
  pnl: bigint
  points: ITimelinePoint[]
}

export function masterMetric(rows: readonly IMasterMetricRow[], interval: number, sinceSec: number, untilSec: number): IMasterMetric {
  const slotSize = Math.max(1, Math.ceil(interval / PNL_SLOT_COUNT))
  const slots: { slot: number; pnl: bigint }[] = []
  for (const row of rows) {
    row.pnlTimestampList.forEach((slot, i) => {
      if (slot + slotSize <= sinceSec) return
      slots.push({ slot, pnl: row.pnlList[i]! })
    })
  }
  slots.sort((a, b) => a.slot - b.slot)
  let cum = 0n
  let next = 0
  const points: ITimelinePoint[] = [{ time: sinceSec, value: 0 }]
  for (let t = sinceSec + slotSize; t < untilSec; t += slotSize) {
    while (next < slots.length && slots[next]!.slot < t) cum += slots[next++]!.pnl
    points.push({ time: t, value: formatFixed(VALUE_DECIMALS, cum) })
  }
  while (next < slots.length) cum += slots[next++]!.pnl
  points.push({ time: untilSec, value: formatFixed(VALUE_DECIMALS, cum) })
  return { pnl: cum, points }
}

export function traderPerformance(
  fundRow: Pick<IFundRow, 'value' | 'totalUnits'>,
  valuations: readonly IValuationRow[],
  rows: readonly IMasterMetricRow[],
  interval: number,
  sinceSec: number,
  untilSec: number
) {
  const profit = masterMetric(rows, interval, sinceSec, untilSec)
  const pnl = rows.length === 0 ? null : profit.pnl
  const capital = rows.reduce((acc, row) => acc + row.capital, 0n)
  const unitPrice = unitPriceOf(fundRow)
  const opening = valuations.findLast(v => v.blockTimestamp <= sinceSec) ?? { value: 0n, totalUnits: 0n }
  const openingPrice = unitPriceOf(opening)
  return {
    pnl,
    roi: pnl === null || capital <= 0n ? null : (Number(pnl) / Number(capital)) * 100,
    unitPrice,
    change: valuations.length === 0 || openingPrice === 0n ? null : (Number(unitPrice - openingPrice) / Number(openingPrice)) * 100,
    pnlPoints: profit.points,
    pricePoints: traderTimeline(valuations, sinceSec, untilSec)
  }
}
export type ITraderPerformance = ReturnType<typeof traderPerformance>

export async function traderPositions(master: Address): Promise<IGmxPositionRow[]> {
  const gmxClient = publicClientMap[GMX_V2_CHAIN_ID]
  if (!gmxClient) throw new Error(`no public client for chain ${GMX_V2_CHAIN_ID}`)
  return makeOnchainGmxPositionProvider(gmxClient as PublicClient, getRate)(master)
}
