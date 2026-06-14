import { CHAIN_NETWORK_MAP, HUB_CHAIN_ID } from '@puppet/contracts/const'
import { type ChainId, VIEM_CHAINS } from '@puppet/sdk/const'
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
  reconnect,
  disconnect as wagmiDisconnect,
  watchConnection,
  watchConnectors
} from '@wagmi/core'
import type { IStream } from 'aelea/stream'
import { fromCallback } from 'aelea/stream-extended'
import { type Chain, fallback, http, type PublicClient } from 'viem'

export const WALLETCONNECT_PROJECT_ID = '37a9b5a1299a3d3d2ddecf4f022030f5'

const proxyTransport = (slug: string, chain: Chain) =>
  fallback([http(`/api/rpc?network=${slug}`, { batch: true }), http(chain.rpcUrls.default.http[0], { batch: true })])

export const wagmi: Config = createConfig({
  chains: VIEM_CHAINS,
  connectors: [],
  storage: createStorage({ storage: localStorage }),
  syncConnectedChain: true,
  transports: Object.fromEntries(
    VIEM_CHAINS.map(chain => [chain.id, proxyTransport(CHAIN_NETWORK_MAP[chain.id], chain)])
  ) as Record<ChainId, ReturnType<typeof proxyTransport>>
})

// wagmi persists connection state to storage but drops `status` on rehydrate (it "messes
// with reconnection"), so a reload reports `disconnected` until reconnect() re-establishes
// the live connector. Fire it once at startup; consumers re-read via the `connection` stream
// (watchConnection emits the reconnecting → connected transition).
export const walletReconnected: Promise<void> = reconnect(wagmi).then(() => undefined)

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
