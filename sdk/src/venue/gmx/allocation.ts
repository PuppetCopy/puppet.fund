import { encodeAbiParameters, keccak256 } from 'viem'
import type { IVenueAllocationParams } from '../types.js'
import { GMX_V2_CONTRACT_MAP } from './contractMap.js'
import { GMX_V2_CHAIN_ID } from './market.js'

const SUBACCOUNT_LIST = keccak256(encodeAbiParameters([{ type: 'string' }], ['SUBACCOUNT_LIST']))

export async function gmxSubaccountBlock({ account, clients }: IVenueAllocationParams): Promise<string | null> {
  const client = clients[GMX_V2_CHAIN_ID]
  if (client === undefined) return `no client for chain ${GMX_V2_CHAIN_ID}; a registered GMX subaccount cannot be ruled out`
  const count = await client.readContract({
    address: GMX_V2_CONTRACT_MAP.GmxDatastore.address,
    abi: GMX_V2_CONTRACT_MAP.GmxDatastore.abi,
    functionName: 'getAddressCount',
    args: [keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'address' }], [SUBACCOUNT_LIST, account]))]
  })
  return count > 0n ? 'a GMX subaccount can trade this account without an attested operate' : null
}
