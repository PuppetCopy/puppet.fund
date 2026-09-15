import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { bondTokenOf } from '@puppet/sdk/state'
import type { Address } from 'viem'
import { getAddress } from 'viem'
import { fetchBonds, fetchDeposits, fetchOwnedAccount } from '../io/datastore/reads.js'

export interface IFundedCoordinate {
  chainId: number
  token: Address
}

export async function fundedFromChronicle(user: Address): Promise<IFundedCoordinate> {
  const account = await fetchOwnedAccount(user)
  if (account === null) {
    throw new Error(`${user} has no account the chronicle knows of; fund your deposit route from the Deposit panel, which names what you funded`)
  }
  const richest = (await fetchDeposits([account])).filter(row => row.deposit > 0n).sort((a, b) => (a.deposit > b.deposit ? -1 : a.deposit < b.deposit ? 1 : 0))[0]
  if (richest !== undefined) return { chainId: Number(richest.chainId), token: getAddress(richest.token) }
  const bonded = (await fetchBonds([account])).some(row => Number(row.chainId) === HUB_CHAIN_ID && row.bond > 0n)
  if (!bonded) {
    throw new Error(`${account} holds no credited deposit or bond the chronicle knows of; fund your deposit route from the Deposit panel first`)
  }
  return { chainId: HUB_CHAIN_ID, token: bondTokenOf(HUB_CHAIN_ID) }
}
