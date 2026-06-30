import { symbolForBaseTokenId } from '@puppet/sdk/account'
import { BYTES32_ZERO, IntervalTime } from '@puppet/sdk/const'
import { dustToZeroUsd, getUnixTimestamp, readablePnl } from '@puppet/sdk/core'
import { createClient } from '@puppet/sdk/datastore'
import * as schema from '@puppet/sdk/schema'
import { fundLatestMetricTable, fundTable } from '@puppet/sdk/schema'
import { roboAvatarSvg } from '@puppet/sdk/ui-components'
import { type Address, getAddress, type Hex, hexToString } from 'viem'

// Folded reads (/query) are served by the journal, not the attest-only matchmaker.
const journalUrl = Bun.env.JOURNAL_URL
if (!journalUrl) throw new Error('JOURNAL_URL is required')

const client = createClient({ storageUrl: journalUrl, schema })

export interface ITopFund {
  rank: number
  avatar: string
  label: string
  token: string | null
  value: string
  tone: 'positive' | 'neutral' | 'negative'
}

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`

const decodeName = (name: Hex): string => {
  if (!name || name === BYTES32_ZERO) return ''
  try {
    return hexToString(name, { size: 32 }).trim()
  } catch {
    return ''
  }
}

export async function fetchTopFunds(limit: number): Promise<ITopFund[]> {
  const now = getUnixTimestamp()
  const metricList = await client.select(fundLatestMetricTable, {
    where: { interval: IntervalTime.WEEK, lastUpdatedTimestamp: { gte: now - IntervalTime.WEEK } },
    orderBy: { col: 'realisedPnl', dir: 'desc' },
    limit
  })
  if (metricList.length === 0) return []

  const fundRows = await client.select(fundTable, { where: { id: { in: metricList.map(m => m.fund) } } })
  const fundById = new Map(fundRows.map(r => [getAddress(r.fund), r]))

  return metricList.map((m, i) => {
    const fund = fundById.get(getAddress(m.fund))
    const name = fund ? decodeName(fund.name) : ''
    const seed: Address = fund?.shareToken ?? m.fund
    const pnl = dustToZeroUsd(m.realisedPnl)
    return {
      rank: i + 1,
      avatar: `data:image/svg+xml;base64,${btoa(roboAvatarSvg(seed))}`,
      label: name || short(m.fund),
      token: symbolForBaseTokenId(m.baseTokenId),
      value: readablePnl(pnl),
      tone: pnl > 0n ? 'positive' : pnl < 0n ? 'negative' : 'neutral'
    }
  })
}
