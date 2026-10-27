import {
  type Account,
  type Chain,
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type Transport,
  type WalletClient,
  webSocket
} from 'viem'
import { type ChainId, VENUE_CHAINS, VIEM_CHAINS } from '../const/chains.js'

export function redactConsole(...secrets: readonly string[]): void {
  if (secrets.some(secret => secret === '')) throw new Error('redactConsole was handed an empty secret, which would mask every character of every log')
  const strip = (text: string): string => secrets.reduce((acc, secret) => acc.replaceAll(secret, '***'), text)
  for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
    const write = console[level].bind(console)
    console[level] = (...args: unknown[]) => write(...args.map(arg => strip(typeof arg === 'string' ? arg : Bun.inspect(arg))))
  }
  process.on('uncaughtException', error => {
    console.error(error)
    process.exit(1)
  })
  process.on('unhandledRejection', reason => {
    console.error(reason)
    process.exit(1)
  })
}

const RPC_SETTLE_LIMIT_MS = 20_000

const settledFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`the rpc request did not settle within ${RPC_SETTLE_LIMIT_MS}ms`)), RPC_SETTLE_LIMIT_MS)
  })
  const read = fetch(input, init).then(
    async response => new Response(await response.arrayBuffer(), { status: response.status, statusText: response.statusText, headers: response.headers })
  )
  read.catch(() => undefined)
  try {
    return await Promise.race([read, limit])
  } finally {
    clearTimeout(timer)
  }
}

const LAGGING_BACKEND = /unknown block|header not found|unsupported block number/i
const LAGGING_BACKEND_RETRY_MS = [250, 500, 1_000]

export const rpcTransport = (rpcUrl: string): Transport => {
  if (rpcUrl.startsWith('ws')) return webSocket(rpcUrl, { keepAlive: true, reconnect: { attempts: Number.POSITIVE_INFINITY, delay: 2_000 } })
  const base = http(rpcUrl, { batch: true, fetchFn: settledFetch })
  return config => {
    const transport = base(config)
    const request: typeof transport.request = async (args, options) => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await transport.request(args, options)
        } catch (err) {
          const wait = LAGGING_BACKEND_RETRY_MS[attempt]
          if (wait === undefined || !(err instanceof Error) || !LAGGING_BACKEND.test(err.message)) throw err
          await new Promise(resolve => setTimeout(resolve, wait))
        }
      }
    }
    return { ...transport, request }
  }
}

export const buildPublicClients = (rpcUrlFor: (chainId: ChainId) => string): Record<ChainId, PublicClient> =>
  Object.fromEntries(
    VIEM_CHAINS.map(chain => [
      chain.id,
      createPublicClient({
        transport: rpcTransport(rpcUrlFor(chain.id)),
        chain: chain as Chain,
        batch: { multicall: true }
      }) as PublicClient
    ])
  ) as Record<ChainId, PublicClient>

export const buildVenueClients = (rpcUrlFor: (network: string) => string): Record<number, PublicClient> =>
  Object.fromEntries(
    VENUE_CHAINS.map(({ chain, network }) => [
      chain.id,
      createPublicClient({ transport: rpcTransport(rpcUrlFor(network)), chain, batch: { multicall: true } }) as PublicClient
    ])
  )

export const buildWalletClients = (
  account: Account,
  rpcUrlFor: (chainId: ChainId) => string
): Record<ChainId, WalletClient> =>
  Object.fromEntries(
    VIEM_CHAINS.map(chain => [
      chain.id,
      createWalletClient({ account, transport: rpcTransport(rpcUrlFor(chain.id)), chain: chain as Chain })
    ])
  ) as Record<ChainId, WalletClient>
