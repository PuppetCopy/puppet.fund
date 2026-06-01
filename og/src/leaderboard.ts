import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { IntervalTime, USD_DECIMALS } from '@puppet/sdk/const'
import { formatFixed, getUnixTimestamp } from '@puppet/sdk/core'
import { createIndexerClient, select } from '@puppet/sdk/state'
import { pixelAvatarSvg } from '@puppet/sdk/ui-components'
import { type Hex, hexToString } from 'viem'

const indexerEndpoint = Bun.env.INDEXER_ENDPOINT
if (!indexerEndpoint) throw new Error('INDEXER_ENDPOINT is required')

const indexer = createIndexerClient(indexerEndpoint)

export interface ITopMaster {
  rank: number
  avatar: string
  label: string
  value: string
  positive: boolean
}

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`

const decodeName = (name: Hex): string => {
  try {
    return hexToString(name, { size: 32 }).trim()
  } catch {
    return ''
  }
}

export async function fetchTopMasters(limit: number): Promise<ITopMaster[]> {
  const since = getUnixTimestamp() - IntervalTime.WEEK
  const metricList = await select(indexer, 'MasterLatestMetric', {
    where: { interval: { _eq: IntervalTime.WEEK }, lastUpdatedTimestamp: { _gte: since } },
    orderBy: { navPerShare: 'desc' },
    limit
  })
  if (metricList.length === 0) return []

  const nameRows = await select(indexer, 'AccountState', {
    where: { account: { _in: metricList.map(m => m.master) }, chainId: { _eq: BigInt(HUB_CHAIN_ID) } },
    fields: ['account', 'name']
  })
  const nameByMaster = new Map(nameRows.map(r => [r.account, decodeName(r.name)]))

  return metricList.map((m, i) => {
    const nav = formatFixed(USD_DECIMALS, m.navPerShare)
    return {
      rank: i + 1,
      avatar: `data:image/svg+xml;base64,${btoa(pixelAvatarSvg(m.master))}`,
      label: nameByMaster.get(m.master) || short(m.master),
      value: `${nav.toFixed(2)}×`,
      positive: nav >= 1
    }
  })
}
