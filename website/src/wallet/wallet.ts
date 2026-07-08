import { CHAIN_NETWORK_MAP, HUB_CHAIN_ID } from '@puppet/contracts/const'
import { type ChainId, VIEM_CHAINS } from '@puppet/sdk/const'
import { rpcTransport } from '@puppet/sdk/state'
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
  watchConnection,
  watchConnectors
} from '@wagmi/core'
import type { IStream } from 'aelea/stream'
import { fromCallback } from 'aelea/stream-extended'
import type { PublicClient, Transport } from 'viem'

export const WALLETCONNECT_PROJECT_ID = '37a9b5a1299a3d3d2ddecf4f022030f5'

// Per-chain public transport: the same-origin /api/rpc proxy (resolved absolute against the page origin, since viem's
// http transport rejects a bare relative path) handed to the shared rpcTransport, which trails the chain's viem default.
// Exported so plain viem clients (io/chain/balances) reuse the exact transport wagmi uses.
export const publicTransports = Object.fromEntries(
  VIEM_CHAINS.map(chain => [
    chain.id,
    rpcTransport(new URL(`/api/rpc?network=${CHAIN_NETWORK_MAP[chain.id]}`, location.origin).href, chain.id)
  ])
) as Record<ChainId, Transport>

export const wagmi: Config = createConfig({
  chains: VIEM_CHAINS,
  connectors: [],
  storage: createStorage({ storage: localStorage }),
  syncConnectedChain: true,
  transports: publicTransports
})

// wagmi persists connection state to storage but drops `status` on rehydrate (it "messes
// with reconnection"), so a reload reports `disconnected` until reconnect() re-establishes
// the live connector. Fire it once at startup; consumers re-read via the `connection` stream
// (watchConnection emits the reconnecting → connected transition).
export const walletReconnected: Promise<void> = reconnect(wagmi).then(
  () => undefined,
  (err: unknown) => {
    console.error('wallet reconnect failed', err)
  }
)

export const publicClientMap: Record<number, PublicClient> = Object.fromEntries(
  VIEM_CHAINS.flatMap(chain => {
    const client = getPublicClient(wagmi, { chainId: chain.id })
    return client ? [[chain.id, client as PublicClient]] : []
  })
)

export const homePublicClient: PublicClient = publicClientMap[HUB_CHAIN_ID]!

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
