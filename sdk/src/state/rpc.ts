import {
  type Account,
  type Chain,
  createPublicClient,
  createWalletClient,
  fallback,
  http,
  type PublicClient,
  type Transport,
  type WalletClient,
  webSocket
} from 'viem'
import { CHAIN_MAP, type ChainId, VIEM_CHAINS } from '../const/chains.js'

export const rpcTransport = (rpcUrl: string, chainId: ChainId): Transport =>
  fallback([
    rpcUrl.startsWith('ws')
      ? webSocket(rpcUrl, { keepAlive: true, reconnect: { attempts: Number.POSITIVE_INFINITY, delay: 2_000 } })
      : http(rpcUrl, { batch: true }),
    http(CHAIN_MAP[chainId].rpcUrls.default.http[0], { batch: true })
  ])

export const buildPublicClients = (rpcUrlFor: (chainId: ChainId) => string): Record<ChainId, PublicClient> =>
  Object.fromEntries(
    VIEM_CHAINS.map(chain => [
      chain.id,
      createPublicClient({
        transport: rpcTransport(rpcUrlFor(chain.id), chain.id),
        chain: chain as Chain,
        batch: { multicall: true }
      }) as PublicClient
    ])
  ) as Record<ChainId, PublicClient>

export const buildWalletClients = (
  account: Account,
  rpcUrlFor: (chainId: ChainId) => string
): Record<ChainId, WalletClient> =>
  Object.fromEntries(
    VIEM_CHAINS.map(chain => [
      chain.id,
      createWalletClient({ account, transport: rpcTransport(rpcUrlFor(chain.id), chain.id), chain: chain as Chain })
    ])
  ) as Record<ChainId, WalletClient>
