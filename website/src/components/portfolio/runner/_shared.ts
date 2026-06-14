import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { getSubaccountState, IndexerHealth, ISubaccountState, ITokenRegistryMap } from '@puppet/sdk/state'
import { getPublicClient, getWalletClient } from '@wagmi/core'
import type { IStream } from 'aelea/stream'
import type { Address } from 'viem/accounts'
import { getCallsStatus, getCapabilities, getCode } from 'viem/actions'
import { homePublicClient, type IConnectedWallet, type ISessionKey, wagmi } from '../../../wallet/index.js'

export const DEFAULT_DEADLINE_SEC = 5 * 60
export const SESSION_BIND_KEY = 'session-bind'

export interface ExecContext {
  sql: Parameters<typeof getSubaccountState>[0]
  tokenRegistry: ITokenRegistryMap
  wallet: IConnectedWallet
  session: ISessionKey
  gasPrice: bigint
  indexerHealth: IndexerHealth
  walletState: IStream<ISubaccountState | null>
}

export async function walletClientForChain(
  current: IConnectedWallet['walletClient'],
  chainId: number
): Promise<IConnectedWallet['walletClient']> {
  if (current.chain?.id === chainId) {
    const live = await current.getChainId().catch(() => null)
    if (live === chainId) return current
  }
  await current.switchChain({ id: chainId })
  for (let attempt = 0; attempt < 15; attempt++) {
    const next = await getWalletClient(wagmi, { chainId })
    const live = await next.getChainId().catch(() => null)
    if (live === chainId) return next
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error(`wallet did not switch to chain ${chainId}; switch in your wallet and retry`)
}

export async function isDeployed(puppet: Address, chainId?: number): Promise<boolean> {
  const client =
    chainId === undefined || chainId === HUB_CHAIN_ID ? homePublicClient : getPublicClient(wagmi, { chainId })
  if (!client) throw new Error(`No public client for chain ${chainId}`)
  const code = await getCode(client, { address: puppet })
  return !!code && code !== '0x'
}

export async function supportsAtomicBatch(
  walletClient: IConnectedWallet['walletClient'],
  chainId: number
): Promise<boolean> {
  try {
    const caps = await getCapabilities(walletClient, { chainId })
    return caps.atomic?.status === 'supported' || caps.atomic?.status === 'ready'
  } catch {
    return false
  }
}

export async function pollCallsStatus(
  walletClient: IConnectedWallet['walletClient'],
  id: string,
  pollMs = 1_000,
  timeoutMs = 90_000
): Promise<Awaited<ReturnType<typeof getCallsStatus>>> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const status = await getCallsStatus(walletClient, { id })
    if (status.status && status.status !== 'pending') return status
    await new Promise(r => setTimeout(r, pollMs))
  }
  throw new Error(`getCallsStatus did not settle for id ${id} within ${timeoutMs}ms`)
}
