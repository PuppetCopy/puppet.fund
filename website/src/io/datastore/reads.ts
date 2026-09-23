import { createClient } from '@puppet/sdk/datastore'
import * as schema from '@puppet/sdk/schema'
import { fundTable, masterMetricTable } from '@puppet/sdk/schema'
import { type Address, getAddress } from 'viem'

export const client = createClient({ storageUrl: '/api/chronicle', schema })

export async function fetchFundShare(master: Address): Promise<Address> {
  const rows = await client.select(fundTable, { where: { master } })
  const row = rows[0]
  if (row === undefined) throw new Error(`the chronicle holds no fund for ${master}, so its share token is unknown`)
  return getAddress(row.share)
}

export const fetchMasterMetrics = (interval: number, masters: readonly Address[]) =>
  client.select(masterMetricTable, { where: { interval, master: { in: masters } } })
