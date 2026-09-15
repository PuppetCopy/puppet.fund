import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { IntervalTime } from '@puppet/sdk/const'
import { formatFixed, getTokenDescription, readableTokenAmountLabel } from '@puppet/sdk/core'
import { createClient } from '@puppet/sdk/datastore'
import { VALUE_KEY } from '@puppet/sdk/evaluate'
import * as schema from '@puppet/sdk/schema'
import { backerTable, bookTable, masterMetricTable, settlementTable } from '@puppet/sdk/schema'
import { chainTokenOfKey } from '@puppet/sdk/state'
import { renderRoboAvatar, roboAvatarNameFromTraits, roboTraitsFromAddress } from '@puppet/sdk/ui-components'
import { type Address, getAddress, type Hex } from 'viem'

const chronicleUrl = Bun.env.CHRONICLE_URL
if (!chronicleUrl) throw new Error('CHRONICLE_URL is required')

const client = createClient({ storageUrl: chronicleUrl, schema, timeoutMs: 10_000 })
const value = getTokenDescription(HUB_CHAIN_ID, chainTokenOfKey(HUB_CHAIN_ID, VALUE_KEY))
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
  books: string
  pnl: string
  tone: ITone
  spark: number[]
}

function sparkSeries(pnlList: readonly bigint[]): number[] {
  if (pnlList.length < 2) return []
  let running = 0n
  const series = pnlList.map(pnl => {
    running += pnl
    return formatFixed(value.decimals, running)
  })
  if (series.length <= SPARK_POINTS) return series
  const step = (series.length - 1) / (SPARK_POINTS - 1)
  return Array.from({ length: SPARK_POINTS }, (_, i) => series[Math.round(i * step)]!)
}

export async function fetchTopMasters(limit: number): Promise<ITopMaster[]> {
  const books = await client.select(bookTable)
  const standing = new Map<Address, { backing: bigint; backers: Set<Hex> }>()
  for (const book of books) {
    const master = getAddress(book.master)
    const row = standing.get(master)
    if (row === undefined) {
      standing.set(master, { backing: book.backed, backers: new Set(book.backerList) })
      continue
    }
    row.backing += book.backed
    for (const backer of book.backerList) row.backers.add(backer)
  }
  return [...standing]
    .sort(([, a], [, b]) => (b.backing > a.backing ? 1 : b.backing < a.backing ? -1 : 0))
    .slice(0, limit)
    .map(([master, row], i) => {
      const traits = roboTraitsFromAddress(master)
      return {
        rank: i + 1,
        avatar: `data:image/svg+xml;base64,${btoa(renderRoboAvatar(traits, master.toLowerCase().slice(2, 8)))}`,
        label: roboAvatarNameFromTraits(traits),
        value: readableTokenAmountLabel(value, row.backing),
        detail: `${row.backers.size} backer${row.backers.size === 1 ? '' : 's'}`
      }
    })
}

export async function fetchMasterCard(master: Address): Promise<IMasterCard | null> {
  const [books, backers, settlements, metric] = await Promise.all([
    client.select(bookTable, { where: { master } }),
    client.select(backerTable, { where: { master } }),
    client.select(settlementTable, { where: { master } }),
    client.find(masterMetricTable, { id: `${SPARK_INTERVAL}:${master}` })
  ])
  if (books.length === 0) return null
  const traits = roboTraitsFromAddress(master)
  const openBooks = books.filter(book => {
    const settled = settlements
      .filter(s => s.kind === 'settle' && s.spokeChainId === book.chainId)
      .reduce((latest, s) => (s.cycle > latest ? s.cycle : latest), 0n)
    return book.cycle > settled
  }).length
  const live = backers.filter(b => b.stake > 0n || b.pending > 0n || b.shares > 0n)
  return {
    avatar: `data:image/svg+xml;base64,${btoa(renderRoboAvatar(traits, master.toLowerCase().slice(2, 8)))}`,
    label: roboAvatarNameFromTraits(traits),
    master,
    backing: readableTokenAmountLabel(
      value,
      books.reduce((total, book) => total + book.backed, 0n)
    ),
    backers: new Set(live.map(b => getAddress(b.puppet))).size,
    books: `${books.length} · ${openBooks} open`,
    pnl: metric === undefined ? '-' : `${metric.pnl > 0n ? '+' : ''}${readableTokenAmountLabel(value, metric.pnl)}`,
    tone: metric === undefined || metric.pnl === 0n ? 'neutral' : metric.pnl > 0n ? 'positive' : 'negative',
    spark: metric === undefined ? [] : sparkSeries(metric.pnlList)
  }
}
