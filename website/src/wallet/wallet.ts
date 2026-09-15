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
import { custom, fallback, type PublicClient, type Transport } from 'viem'

export const WALLETCONNECT_PROJECT_ID = '37a9b5a1299a3d3d2ddecf4f022030f5'

const userTransport = (chainId: number): Transport =>
  custom(
    {
      async request({ method, params }: { method: string; params?: unknown }) {
        const conn = getConnection(wagmi)
        if (conn.status !== 'connected' || conn.chainId !== chainId || !conn.connector) {
          throw new Error(`user rpc unavailable for chain ${chainId}`)
        }
        const provider = (await conn.connector.getProvider({ chainId })) as {
          request: (args: { method: string; params?: unknown }) => Promise<unknown>
        }
        return provider.request({ method, params })
      }
    },
    { retryCount: 0, methods: { exclude: ['eth_getLogs'] } }
  )

export const publicTransports = Object.fromEntries(
  VIEM_CHAINS.map(chain => [
    chain.id,
    fallback([
      userTransport(chain.id),
      rpcTransport(new URL(`/api/rpc?network=${CHAIN_NETWORK_MAP[chain.id]}`, location.origin).href)
    ])
  ])
) as Record<ChainId, Transport>

export const wagmi: Config = createConfig({
  chains: VIEM_CHAINS,
  connectors: [],
  storage: createStorage({ storage: localStorage }),
  syncConnectedChain: true,
  transports: publicTransports
})

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
