import DEPLOYMENTS from '@puppet/contracts/deployments'
import type { Address } from 'viem'

export function deploymentAddress(name: string, chainId: number): Address {
  const entry = (DEPLOYMENTS as Record<string, { address: Address } | undefined>)[`${name}:${chainId}`]
  if (!entry) throw new Error(`no deployment for ${name} on chain ${chainId}; regenerate @puppet/contracts`)
  return entry.address
}
