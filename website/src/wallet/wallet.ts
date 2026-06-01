import { CHAIN_NETWORK_MAP, HUB_CHAIN_ID } from '@puppet/contracts/const'
import { type ChainId, VIEM_CHAINS } from '@puppet/sdk/const'
import { walletConnect } from '@wagmi/connectors'
import {
  type Config,
  type Connector,
  type ConnectReturnType,
  connect,
  createConfig,
  createStorage,
  type GetConnectionReturnType,
  getConnection,
  getConnectors,
  getPublicClient,
  disconnect as wagmiDisconnect,
  watchConnection,
  watchConnectors
} from '@wagmi/core'
import type { IStream } from 'aelea/stream'
import { fromCallback } from 'aelea/stream-extended'
import { type Chain, fallback, http, type PublicClient } from 'viem'

export const WALLETCONNECT_PROJECT_ID = 'b81521b9a6d17b1d070aa5899c2fdcfe'

// Injected at build time by vite's `define` from `SITE_CONFIG`.
declare const __WC_METADATA__: {
  name: string
  description: string
  url: string
  icons: string[]
}

// Caddy + vite rewrite `/api/rpc?network={slug}` to a keyed provider; mainnet's
// slug is `ethereum`, others match the chain alias from foundry.toml.
const proxyTransport = (slug: string, chain: Chain) =>
  fallback([http(`/api/rpc?network=${slug}`, { batch: true }), http(chain.rpcUrls.default.http[0], { batch: true })])

export const wagmi: Config = createConfig({
  chains: VIEM_CHAINS,
  // EIP-6963 (mipd) auto-discovers each installed wallet as its own connector
  // via wagmi's default `multiInjectedProviderDiscovery`. No manual `injected()`.
  connectors: [walletConnect({ projectId: WALLETCONNECT_PROJECT_ID, metadata: __WC_METADATA__ })],
  storage: createStorage({ storage: localStorage }),
  syncConnectedChain: true,
  transports: Object.fromEntries(
    VIEM_CHAINS.map(chain => [chain.id, proxyTransport(CHAIN_NETWORK_MAP[chain.id], chain)])
  ) as Record<ChainId, ReturnType<typeof proxyTransport>>
})

export const publicClientMap: Record<number, PublicClient> = Object.fromEntries(
  VIEM_CHAINS.flatMap(chain => {
    const client = getPublicClient(wagmi, { chainId: chain.id })
    return client ? [[chain.id, client as PublicClient]] : []
  })
)

export const homePublicClient = publicClientMap[HUB_CHAIN_ID]!

export const connection: IStream<GetConnectionReturnType<typeof wagmi>> = fromCallback(cb => {
  cb(getConnection(wagmi))
  return watchConnection(wagmi, { onChange: cb })
})

export const connectors: IStream<readonly Connector[]> = fromCallback(cb => {
  cb(getConnectors(wagmi))
  return watchConnectors(wagmi, { onChange: cb })
})

export async function connectWallet(preferredConnectorId?: string): Promise<ConnectReturnType<typeof wagmi>> {
  const currentConnection = getConnection(wagmi)
  if (currentConnection.status === 'connected') throw new Error('Wallet already connected')
  if (currentConnection.status === 'connecting') throw new Error('Wallet connection already in progress')
  const targetConnector = wagmi.connectors.find(c => c.id === preferredConnectorId) ?? wagmi.connectors[0]
  if (!targetConnector) throw new Error('No compatible wallet found. Please install a supported wallet.')
  return connect(wagmi, { connector: targetConnector })
}

export async function disconnect() {
  const current = getConnection(wagmi)
  if (current.connector) await wagmiDisconnect(wagmi, { connector: current.connector })
}
