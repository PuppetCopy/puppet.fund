import DEPLOYMENTS from '@puppet/contracts/deployments'
import { type Address, getAddress, isAddressEqual } from 'viem'
import type { ChainId } from '../const/index.js'
import { SWAP_PROVIDER } from '../const/network.js'
import { readableContractName, readableKey } from '../core/readable.js'
import { getTokenDescription } from '../core/token.js'
import { VENUES } from '../venue/venues.js'

interface IContractLabel {
  name: string
  detail: string
  source: string
}

const ownLabel = (chainId: ChainId, address: Address): IContractLabel | null => {
  for (const [key, entry] of Object.entries(DEPLOYMENTS as Record<string, { address: Address }>)) {
    const [name, deployed] = key.split(':')
    if (Number(deployed) !== chainId || !isAddressEqual(entry.address, address)) continue
    return { name: readableContractName('Puppet', name ?? key), detail: 'a Puppet protocol contract', source: 'puppet' }
  }
  return null
}

const venueLabel = (chainId: ChainId, address: Address): IContractLabel | null => {
  for (const venue of VENUES) {
    const entry = venue.contracts.find(c => c.chainId === chainId && isAddressEqual(c.address, address))
    if (entry !== undefined) return { name: entry.name, detail: entry.detail, source: venue.venueId }
  }
  return null
}

const routeLabel = (chainId: ChainId, address: Address): IContractLabel | null => {
  const providers = (SWAP_PROVIDER as Record<number, Record<string, Address> | undefined>)[chainId]
  if (providers === undefined) return null
  for (const [key, provider] of Object.entries(providers)) {
    if (!isAddressEqual(provider, address)) continue
    return { name: readableKey(key), detail: 'a route provider this protocol swaps and bridges through', source: 'route' }
  }
  return null
}

const tokenLabel = (chainId: ChainId, address: Address): IContractLabel | null => {
  try {
    const token = getTokenDescription(chainId, address)
    return { name: token.symbol, detail: `a ${token.decimals}-decimal token this protocol values`, source: 'token' }
  } catch {
    return null
  }
}

export function contractLabelOf(chainId: ChainId, target: Address): IContractLabel {
  const address = getAddress(target)
  return (
    ownLabel(chainId, address) ??
    venueLabel(chainId, address) ??
    routeLabel(chainId, address) ??
    tokenLabel(chainId, address) ?? { name: 'Unlabeled', detail: 'this protocol does not recognise this contract', source: 'unknown' }
  )
}
