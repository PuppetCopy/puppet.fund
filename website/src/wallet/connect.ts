import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { IConnectedWallet } from '@puppet/sdk/client'
import { chainNameOf, VIEM_CHAINS } from '@puppet/sdk/const'
import { createBrowserScheduler, type IStream } from 'aelea/stream'
import { type Address, createWalletClient, custom, getAddress, numberToHex } from 'viem'
import { mainnet } from 'viem/chains'

export type IProvider = {
  request(args: { method: string; params?: unknown }): Promise<unknown>
  on(event: string, listener: (payload: unknown) => void): void
  removeListener(event: string, listener: (payload: unknown) => void): void
}

export type IWalletEntry = { id: string; name: string; icon: string | null; provider: IProvider }

export type IWalletState =
  | { status: 'disconnected' }
  | { status: 'connecting'; entry: IWalletEntry }
  | { status: 'connected'; entry: IWalletEntry; address: Address; chainId: number }

export type IWalletEvent =
  | { kind: 'connecting'; entry: IWalletEntry }
  | { kind: 'connected'; entry: IWalletEntry; address: Address; chainId: number }
  | { kind: 'accounts'; entry: IWalletEntry; address: Address; chainId: number | null }
  | { kind: 'chain'; entry: IWalletEntry; chainId: number }
  | { kind: 'disconnected'; entry: IWalletEntry | null }

export type IWalletIntent = { connect: string } | 'disconnect'

export type IWalletControl = {
  query: IStream<Promise<IConnectedWallet | null>>
  entries: IStream<readonly IWalletEntry[]>
  attempts: IStream<{ id: string; result: Promise<unknown> }>
  releases: IStream<{ entry: IWalletEntry; refused: Promise<{ error: unknown } | null> }>
  chainId: IStream<number | null>
}

export const DISCONNECTED: IWalletState = { status: 'disconnected' }
export const INJECTED_ID = 'injected'
export const WALLET_CONNECT_ID = 'walletConnect'
export const WALLET_ID_KEY = 'puppet/wallet'
export const RESTORE_WAIT_MS = 1500
export const WALLET_ANSWER_MS = 1500
const CHAIN_SETTLE_MS = 10_000

export function foldWallet(state: IWalletState, event: IWalletEvent): IWalletState {
  if (event.kind === 'connecting') return { status: 'connecting', entry: event.entry }
  if (event.kind === 'connected') return { status: 'connected', entry: event.entry, address: event.address, chainId: event.chainId }
  if (event.kind === 'disconnected') return event.entry === null || state.status === 'disconnected' || state.entry.id === event.entry.id ? DISCONNECTED : state
  if (state.status === 'connecting') return state
  if (event.kind === 'accounts') {
    if (state.status === 'connected') {
      if (state.entry.id !== event.entry.id) return state
      return { ...state, address: event.address, chainId: event.chainId === null ? state.chainId : event.chainId }
    }
    return event.chainId === null ? state : { status: 'connected', entry: event.entry, address: event.address, chainId: event.chainId }
  }
  return state.status === 'connected' && state.entry.id === event.entry.id ? { ...state, chainId: event.chainId } : state
}

const isProvider = (value: unknown): value is IProvider =>
  typeof value === 'object' && value !== null && 'request' in value && typeof value.request === 'function' && 'on' in value && typeof value.on === 'function' && 'removeListener' in value && typeof value.removeListener === 'function'

export function announcedEntryOf(event: Event): IWalletEntry | null {
  if (!(event instanceof CustomEvent)) return null
  const detail: unknown = event.detail
  if (typeof detail !== 'object' || detail === null || !('info' in detail) || !('provider' in detail) || !isProvider(detail.provider)) return null
  const info: unknown = detail.info
  if (typeof info !== 'object' || info === null || !('rdns' in info) || typeof info.rdns !== 'string' || !('name' in info) || typeof info.name !== 'string') return null
  return { id: info.rdns, name: info.name, icon: 'icon' in info && typeof info.icon === 'string' ? info.icon : null, provider: detail.provider }
}

export function injectedEntryOf(host: object): IWalletEntry | null {
  const provider = 'ethereum' in host ? host.ethereum : undefined
  return isProvider(provider) ? { id: INJECTED_ID, name: 'Browser wallet', icon: null, provider } : null
}

const isAnnounced = (entry: IWalletEntry): boolean => entry.id !== INJECTED_ID && entry.id !== WALLET_CONNECT_ID

export function foldEntries(list: readonly IWalletEntry[], entry: IWalletEntry): readonly IWalletEntry[] {
  if (entry.id === INJECTED_ID && list.some(isAnnounced)) return list
  return [...list.filter(each => each.id !== entry.id && !(isAnnounced(entry) && each.id === INJECTED_ID)), entry]
}

const codeOf = (err: unknown): number | null => {
  if (typeof err !== 'object' || err === null) return null
  if ('code' in err && typeof err.code === 'number') return err.code
  if ('data' in err && typeof err.data === 'object' && err.data !== null && 'originalError' in err.data) return codeOf(err.data.originalError)
  return null
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : typeof err === 'object' && err !== null && 'message' in err && typeof err.message === 'string' ? err.message : String(err))

export const isUnknownChainError = (err: unknown): boolean => codeOf(err) === 4902 || /unrecognized chain|not been added|chain .*not added|unknown chain/i.test(messageOf(err))

export function connectErrorText(err: unknown): string {
  const code = codeOf(err)
  if (code === 4001) return 'Connection cancelled in your wallet, tap to retry'
  if (code === -32002) return 'Your wallet already has a request open. Finish or close it there, then retry.'
  return messageOf(err) || 'Could not connect. Tap to retry.'
}

export function askWallet(entry: IWalletEntry, args: { method: string; params?: unknown }, ms: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${entry.name} did not answer ${args.method} within ${ms / 1000} s`)), ms)
    entry.provider.request(args).then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

export async function connectEntry(entry: IWalletEntry, prompt: boolean): Promise<{ address: Address; chainId: number } | null> {
  const accounts = await (prompt ? entry.provider.request({ method: 'eth_requestAccounts' }) : askWallet(entry, { method: 'eth_accounts' }, WALLET_ANSWER_MS))
  if (!Array.isArray(accounts)) throw new Error(`${entry.name} answered its accounts with ${String(accounts)}`)
  const [first] = accounts
  if (typeof first !== 'string') return null
  return { address: getAddress(first), chainId: Number(await askWallet(entry, { method: 'eth_chainId' }, WALLET_ANSWER_MS)) }
}

export function addChainParamsOf(chainId: number) {
  const chain = [...VIEM_CHAINS, mainnet].find(each => each.id === chainId)
  if (chain === undefined) throw new Error(`chain ${chainId} is not one Puppet uses`)
  return {
    chainId: numberToHex(chain.id),
    chainName: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: [...chain.rpcUrls.default.http],
    ...(chain.blockExplorers === undefined ? {} : { blockExplorerUrls: [chain.blockExplorers.default.url] })
  }
}

const scheduler = createBrowserScheduler()

const untilChain = (wallet: IStream<IWalletState>, chainId: number): Promise<void> =>
  new Promise((resolve, reject) => {
    let settled = false
    let stop: (() => void) | null = null
    const finish = (error: Error | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      stop?.()
      if (error === null) resolve()
      else reject(error)
    }
    const timer = setTimeout(() => finish(new Error(`your wallet did not switch to ${chainNameOf(chainId) ?? `chain ${chainId}`}; switch it in the wallet and retry`)), CHAIN_SETTLE_MS)
    const running = wallet.run(
      {
        event: (_time, state) => {
          if (state.status === 'connected' && state.chainId === chainId) finish(null)
        },
        error: (_time, err) => finish(err instanceof Error ? err : new Error(String(err))),
        end: () => finish(new Error('the wallet stream ended before the chain switched'))
      },
      scheduler
    )
    stop = () => running[Symbol.dispose]()
    if (settled) stop()
  })

export function connectedWalletOf(
  connected: { entry: IWalletEntry; address: Address; chainId: number },
  wallet: IStream<IWalletState>,
  confirm: (event: IWalletEvent) => void
): IConnectedWallet {
  const { entry, address } = connected
  const clientOn = (chainId: number) => {
    const chain = [...VIEM_CHAINS, mainnet].find(each => each.id === chainId)
    if (chain === undefined) throw new Error(`${entry.name} is on chain ${chainId}, which Puppet does not use; switch it to a supported chain`)
    return createWalletClient({ account: address, chain, transport: custom(entry.provider) })
  }
  return {
    walletClient: clientOn(VIEM_CHAINS.some(each => each.id === connected.chainId) ? connected.chainId : HUB_CHAIN_ID),
    address,
    async switchChain(chainId) {
      if (Number(await entry.provider.request({ method: 'eth_chainId' })) !== chainId) {
        const target = [{ chainId: numberToHex(chainId) }]
        try {
          await entry.provider.request({ method: 'wallet_switchEthereumChain', params: target })
        } catch (err) {
          if (!isUnknownChainError(err)) throw err
          await entry.provider.request({ method: 'wallet_addEthereumChain', params: [addChainParamsOf(chainId)] })
          await entry.provider.request({ method: 'wallet_switchEthereumChain', params: target })
        }
        if (Number(await entry.provider.request({ method: 'eth_chainId' })) === chainId) confirm({ kind: 'chain', entry, chainId })
        await untilChain(wallet, chainId)
      }
      return clientOn(chainId)
    }
  }
}
