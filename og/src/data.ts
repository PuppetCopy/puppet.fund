import { fundSymbolOf, gridOf } from '@puppet/sdk/account'
import { IntervalTime, USD_DECIMALS } from '@puppet/sdk/const'
import { formatFixed, readableUsd } from '@puppet/sdk/core'
import { createClient } from '@puppet/sdk/datastore'
import { cashFor } from '@puppet/sdk/pool'
import * as schema from '@puppet/sdk/schema'
import { fundTable, holdingTable, masterMetricTable } from '@puppet/sdk/schema'
import { avatarSvg } from '@puppet/sdk/ui-components'
import { type Address, getAddress } from 'viem'

const chronicleUrl = Bun.env.CHRONICLE_URL
if (!chronicleUrl) throw new Error('CHRONICLE_URL is required')

const client = createClient({ storageUrl: chronicleUrl, schema, timeoutMs: 10_000 })
const SPARK_INTERVAL = IntervalTime.MONTH
const SPARK_POINTS = 48

export type ITone = 'positive' | 'neutral' | 'negative'

export interface ITopMaster {
  rank: number
  avatar: string
  label: string
  value: string
  detail: string
}

export interface IMasterCard {
  avatar: string
  label: string
  master: Address
  backing: string
  backers: number
  fundValue: string
  pnl: string
  tone: ITone
  spark: number[]
}

function sparkSeries(pnlList: readonly bigint[]): number[] {
  if (pnlList.length < 2) return []
  let running = 0n
  const series = pnlList.map(pnl => {
    running += pnl
    return formatFixed(USD_DECIMALS, running)
  })
  if (series.length <= SPARK_POINTS) return series
  const step = (series.length - 1) / (SPARK_POINTS - 1)
  return Array.from({ length: SPARK_POINTS }, (_, i) => series[Math.round(i * step)]!)
}

export async function fetchTopMasters(limit: number): Promise<ITopMaster[]> {
  const [fundRows, holdings] = await Promise.all([client.select(fundTable), client.select(holdingTable)])
  const backed = new Map<Address, { units: bigint; backers: number }>()
  for (const holding of holdings) {
    const master = getAddress(holding.master)
    if (getAddress(holding.holder) === master || holding.units === 0n) continue
    const row = backed.get(master)
    if (row === undefined) backed.set(master, { units: holding.units, backers: 1 })
    else backed.set(master, { units: row.units + holding.units, backers: row.backers + 1 })
  }
  return fundRows
    .map(fundRow => {
      const master = getAddress(fundRow.master)
      const row = backed.get(master)
      return {
        fundRow,
        backers: row === undefined ? 0 : row.backers,
        backing: row === undefined ? 0n : cashFor(row.units, fundRow.totalUnits, fundRow.value)
      }
    })
    .sort((a, b) => (b.backing > a.backing ? 1 : b.backing < a.backing ? -1 : 0))
    .slice(0, limit)
    .map((row, i) => ({
      rank: i + 1,
      avatar: `data:image/svg+xml;base64,${btoa(avatarSvg(gridOf(row.fundRow)))}`,
      label: fundSymbolOf(row.fundRow),
      value: `$${readableUsd(row.backing)}`,
      detail: `${row.backers} backer${row.backers === 1 ? '' : 's'}`
    }))
}

export async function fetchMasterCard(master: Address): Promise<IMasterCard | null> {
  const [fundRow, holdings, metric] = await Promise.all([
    client.find(fundTable, { master }),
    client.select(holdingTable, { where: { master } }),
    client.find(masterMetricTable, { id: `${SPARK_INTERVAL}:${master}` })
  ])
  if (fundRow === undefined) return null
  const backers = holdings.filter(holding => getAddress(holding.holder) !== master && holding.units > 0n)
  return {
    avatar: `data:image/svg+xml;base64,${btoa(avatarSvg(gridOf(fundRow)))}`,
    label: fundSymbolOf(fundRow),
    master,
    backing: `$${readableUsd(
      cashFor(
        backers.reduce((total, holding) => total + holding.units, 0n),
        fundRow.totalUnits,
        fundRow.value
      )
    )}`,
    backers: backers.length,
    fundValue: `$${readableUsd(fundRow.value)}`,
    pnl: metric === undefined ? '-' : `${metric.pnl > 0n ? '+' : metric.pnl < 0n ? '-' : ''}$${readableUsd(metric.pnl < 0n ? -metric.pnl : metric.pnl)}`,
    tone: metric === undefined || metric.pnl === 0n ? 'neutral' : metric.pnl > 0n ? 'positive' : 'negative',
    spark: metric === undefined ? [] : sparkSeries(metric.pnlList)
  }
}
