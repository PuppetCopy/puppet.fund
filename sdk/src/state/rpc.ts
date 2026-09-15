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
import { type ChainId, VIEM_CHAINS } from '../const/chains.js'

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

export const rpcTransport = (rpcUrl: string): Transport =>
  rpcUrl.startsWith('ws')
    ? webSocket(rpcUrl, { keepAlive: true, reconnect: { attempts: Number.POSITIVE_INFINITY, delay: 2_000 } })
    : http(rpcUrl, { batch: true })

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
