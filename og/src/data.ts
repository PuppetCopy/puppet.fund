import { PRECISION, TOKEN_META } from '@puppet/contracts/const'
import { symbolForBaseTokenId } from '@puppet/sdk/account'
import { BYTES32_ZERO, IntervalTime, USD_DECIMALS } from '@puppet/sdk/const'
import { dustToZeroUsd, formatFixed, getUnixTimestamp, readableUnitAmount } from '@puppet/sdk/core'
import { createClient } from '@puppet/sdk/datastore'
import * as schema from '@puppet/sdk/schema'
import {
  fundLatestMetricTable,
  fundTable,
  type IFund,
  type IFundLatestMetric,
  type IPlatformScale,
  platformScaleTable
} from '@puppet/sdk/schema'
import { PLATFORM_SCALE_ID, scalePercentile } from '@puppet/sdk/state'
import {
  decodeFundName,
  type IFundRank,
  renderRoboAvatar,
  roboAvatarNameFromTraits,
  roboTraitsFromRank
} from '@puppet/sdk/ui-components'
import { type Address, getAddress, type Hex, hexToString } from 'viem'

const journalUrl = Bun.env.JOURNAL_URL
if (!journalUrl) throw new Error('JOURNAL_URL is required')

const client = createClient({ storageUrl: journalUrl, schema })

export type ITone = 'positive' | 'neutral' | 'negative'

export interface ITopFund {
  rank: number
  avatar: string
  label: string
  token: string | null
  value: string
  tone: ITone
}

export interface IFundCard {
  avatar: string
  label: string
  address: Address
  token: string | null
  window: string | null
  pnl: string
  tone: ITone
  roi: string
  aum: string
  spark: number[]
}

export const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`

const RATE_FRESHNESS_MS = 60_000
const RATE_FAIL_TTL_MS = 5_000
const priceCache = new Map<string, { price: bigint | null; at: number }>()

async function usdPriceOf(symbol: string): Promise<bigint | null> {
  const cached = priceCache.get(symbol)
  if (cached && Date.now() - cached.at < (cached.price === null ? RATE_FAIL_TTL_MS : RATE_FRESHNESS_MS)) {
    return cached.price
  }
  let price: bigint | null = null
  try {
    const res = await fetch(
      `${journalUrl}/rate?token0=${symbol}&token1=${TOKEN_META.USDC.symbol}&freshness=${RATE_FRESHNESS_MS}`
    )
    if (res.ok) {
      const data = (await res.json()) as { token0?: string | number } | null
      if (data?.token0) price = BigInt(data.token0)
    }
  } catch {}
  priceCache.set(symbol, { price, at: Date.now() })
  return price
}

const pnlTone = (pnlUsd: bigint | null): ITone =>
  pnlUsd === null || pnlUsd === 0n ? 'neutral' : pnlUsd > 0n ? 'positive' : 'negative'

const readablePnlUsd = (pnlUsd: bigint): string => {
  const sign = pnlUsd > 0n ? '+' : pnlUsd < 0n ? '-' : ''
  return `${sign}$${readableUnitAmount(Math.abs(formatFixed(USD_DECIMALS, pnlUsd)))}`
}

function fundIdentity(
  fund: IFund | undefined,
  fallbackSeed: string,
  scale: IPlatformScale | null,
  realisedPnlUsd: bigint
): { label: string; avatar: string } {
  const seed = (fund?.shareToken ?? getAddress(fallbackSeed)) as Address
  let decoded: ReturnType<typeof decodeFundName> | null = null
  if (fund && fund.name !== BYTES32_ZERO) {
    try {
      decoded = decodeFundName(hexToString(fund.name as Hex, { size: 32 }))
    } catch {}
  }
  const rank: IFundRank =
    fund && scale
      ? {
          pnlPercentile: scalePercentile(realisedPnlUsd, scale.maxPnlUsd),
          roiPercentile: scalePercentile(fund.navPerShare - PRECISION.floatPrecisionExp, scale.maxRoi)
        }
      : { pnlPercentile: null, roiPercentile: null }
  const traits = roboTraitsFromRank(decoded?.indices ?? null, seed, rank)
  const displayName = decoded?.displayName.trim()
  return {
    label: displayName && displayName.length > 0 ? displayName : roboAvatarNameFromTraits(traits),
    avatar: `data:image/svg+xml;base64,${btoa(renderRoboAvatar(traits, seed.toLowerCase().slice(2, 8)))}`
  }
}

const WINDOW_LABEL: Record<number, string> = {
  [IntervalTime.DAY]: '24h',
  [IntervalTime.WEEK]: '7d',
  [IntervalTime.MONTH]: '30d',
  [IntervalTime.QUARTER]: '90d',
  [IntervalTime.YEAR]: '1y'
}

const SPARK_BUCKETS = 48

function sparkSeries(metric: IFundLatestMetric | null): number[] {
  if (!metric || metric.pnlTimestampList.length === 0) return []
  const slotSize = Math.max(1, Math.floor(metric.interval / SPARK_BUCKETS))
  const bySlot = new Map<number, bigint>()
  for (let i = 0; i < metric.pnlTimestampList.length; i++) {
    const slot = Math.floor(metric.pnlTimestampList[i] / slotSize) * slotSize
    bySlot.set(slot, (bySlot.get(slot) ?? 0n) + (metric.pnlList[i] ?? 0n))
  }
  const slots = [...bySlot.entries()].sort((a, b) => a[0] - b[0])
  let cumulative = 0n
  const series = [0]
  for (const [, pnl] of slots) {
    cumulative += pnl
    series.push(formatFixed(18, cumulative))
  }
  return series
}

async function readPlatformScale(): Promise<IPlatformScale | null> {
  const rows = await client.select(platformScaleTable, { where: { id: PLATFORM_SCALE_ID } }).catch(() => null)
  return rows?.[0] ?? null
}

export async function fetchTopFunds(limit: number): Promise<ITopFund[]> {
  const now = getUnixTimestamp()
  const metricList = await client.select(fundLatestMetricTable, {
    where: { interval: IntervalTime.WEEK, lastUpdatedTimestamp: { gte: now - IntervalTime.WEEK } },
    orderBy: { col: 'realisedPnl', dir: 'desc' },
    limit: limit * 4
  })
  if (metricList.length === 0) return []

  const [fundRows, scale] = await Promise.all([
    client.select(fundTable, { where: { id: { in: metricList.map(m => m.fund) } } }),
    readPlatformScale()
  ])
  const fundById = new Map(fundRows.map(r => [getAddress(r.fund), r]))

  const priced = await Promise.all(
    metricList.map(async m => {
      const symbol = symbolForBaseTokenId(m.baseToken)
      const price = symbol ? await usdPriceOf(symbol) : null
      const pnlUsd = price === null ? null : dustToZeroUsd(m.realisedPnl * price)
      return { m, symbol, pnlUsd }
    })
  )
  priced.sort((a, b) => Number((b.pnlUsd ?? 0n) - (a.pnlUsd ?? 0n)))

  return priced.slice(0, limit).map(({ m, symbol, pnlUsd }, i) => {
    const fund = fundById.get(getAddress(m.fund))
    const identity = fundIdentity(fund, m.fund, scale, m.realisedPnlUsd)
    return {
      rank: i + 1,
      avatar: identity.avatar,
      label: identity.label,
      token: symbol,
      value: pnlUsd === null ? '-' : readablePnlUsd(pnlUsd),
      tone: pnlTone(pnlUsd)
    }
  })
}

export async function fetchFundCard(address: Address): Promise<IFundCard | null> {
  const fund = getAddress(address)
  const [fundRows, metricRows, scale] = await Promise.all([
    client.select(fundTable, { where: { id: fund } }),
    client.select(fundLatestMetricTable, { where: { fund } }),
    readPlatformScale()
  ])
  const row = fundRows[0]
  if (!row) return null

  const byIntervalDesc = [...metricRows].sort((a, b) => b.interval - a.interval)
  const metric = byIntervalDesc.find(m => m.pnlTimestampList.length > 0) ?? byIntervalDesc[0] ?? null

  const identity = fundIdentity(row, fund, scale, metric?.realisedPnlUsd ?? 0n)
  const symbol = symbolForBaseTokenId(row.baseToken)
  const price = symbol ? await usdPriceOf(symbol) : null
  const pnlUsd = metric && price !== null ? dustToZeroUsd(metric.realisedPnl * price) : null
  const aumBase = (row.totalShareSupply * row.navPerShare) / PRECISION.floatPrecisionExp
  const roiPct = Number(((row.navPerShare - PRECISION.floatPrecisionExp) * 10000n) / PRECISION.floatPrecisionExp) / 100

  return {
    avatar: identity.avatar,
    label: identity.label,
    address: fund,
    token: symbol,
    window: metric ? (WINDOW_LABEL[metric.interval] ?? `${Math.round(metric.interval / IntervalTime.DAY)}d`) : null,
    pnl: pnlUsd === null ? '-' : readablePnlUsd(pnlUsd),
    tone: pnlTone(pnlUsd),
    roi: `${roiPct > 0 ? '+' : ''}${roiPct.toFixed(1)}%`,
    aum: price === null ? '-' : `$${readableUnitAmount(formatFixed(USD_DECIMALS, aumBase * price))}`,
    spark: sparkSeries(metric)
  }
}
