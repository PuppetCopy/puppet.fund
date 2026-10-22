import { CHAIN_NETWORK_MAP } from '@puppet/contracts/const'
import { TOKEN_NETWORK } from '@puppet/contracts/token'
import { type ChainId, VIEM_CHAINS } from '@puppet/sdk/const'
import { buildPublicClients, buildVenueClients, rpcTransport } from '@puppet/sdk/state'
import { createBrowserScheduler, type IStream } from 'aelea/stream'
import { createPublicClient, custom, fallback, type PublicClient, type Transport } from 'viem'
import { mainnet } from 'viem/chains'
import { ENDPOINTS } from '../app/endpoints.js'
import { askWallet, DISCONNECTED, type IWalletState } from './connect.js'

declare const __WALLETCONNECT_PROJECT_ID__: string

export const WALLETCONNECT_PROJECT_ID = __WALLETCONNECT_PROJECT_ID__
const WALLET_READ_MS = 4000

let reading: IWalletState = DISCONNECTED

export function bindWalletReads(wallet: IStream<IWalletState>): void {
  wallet.run(
    {
      event: (_time, state) => {
        reading = state
      },
      error: (_time, err) => {
        throw err
      },
      end: () => {}
    },
    createBrowserScheduler()
  )
}

const userTransport = (chainId: number): Transport =>
  custom(
    {
      async request({ method, params }: { method: string; params?: unknown }) {
        if (reading.status !== 'connected' || reading.chainId !== chainId) throw new Error(`user rpc unavailable for chain ${chainId}`)
        if (document.visibilityState !== 'visible') throw new Error('wallets hold requests from hidden tabs, so this read goes to Puppet RPC')
        return askWallet(reading.entry, { method, params }, WALLET_READ_MS)
      }
    },
    { retryCount: 0, methods: { exclude: ['eth_getLogs'] } }
  )

const appRpcUrl = (chainId: ChainId): string => new URL(`${ENDPOINTS.rpc}?network=${CHAIN_NETWORK_MAP[chainId]}`, location.origin).href

export const publicTransports = Object.fromEntries(
  VIEM_CHAINS.map(chain => [chain.id, fallback([userTransport(chain.id), rpcTransport(appRpcUrl(chain.id))])])
) as Record<ChainId, Transport>

export const appClientMap: Record<ChainId, PublicClient> = buildPublicClients(appRpcUrl)

export const venueClientMap: Record<number, PublicClient> = buildVenueClients(network => new URL(`${ENDPOINTS.rpc}?network=${network}`, location.origin).href)
export const tokenClient = createPublicClient({
  chain: mainnet,
  batch: { multicall: true },
  transport: rpcTransport(new URL(`${ENDPOINTS.rpc}?network=${TOKEN_NETWORK}`, location.origin).href)
})

export const publicClientMap: Record<number, PublicClient> = Object.fromEntries(
  VIEM_CHAINS.map(chain => [chain.id, createPublicClient({ chain, batch: { multicall: true }, transport: publicTransports[chain.id as ChainId] })])
)
