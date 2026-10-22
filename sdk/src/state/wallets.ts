import { type Address, getAddress, isAddressEqual } from 'viem'
import { predictUserAccount } from '../account/index.js'
import type { IDigestClient } from '../datastore/index.js'
import { accountTable } from '../schema/index.js'

export async function walletsOf(client: IDigestClient, accounts: readonly Address[]): Promise<ReadonlyMap<Address, Address>> {
  const ownerOf = new Map<Address, Address>()
  let pending = [...new Set(accounts.map(account => getAddress(account)))]
  while (pending.length > 0) {
    const rows = await client.select(accountTable, { where: { account: { in: pending } } })
    const next = new Set<Address>()
    for (const account of pending) {
      const row = rows.find(r => isAddressEqual(r.account, account))
      if (row === undefined) continue
      const owner = getAddress(row.owner)
      ownerOf.set(account, owner)
      if (!ownerOf.has(owner) && !isAddressEqual(predictUserAccount(owner), account)) next.add(owner)
    }
    pending = [...next].filter(owner => !ownerOf.has(owner))
  }
  return new Map(
    accounts.map(account => {
      let wallet = getAddress(account)
      while (ownerOf.has(wallet)) wallet = ownerOf.get(wallet)!
      return [getAddress(account), wallet] as const
    })
  )
}
