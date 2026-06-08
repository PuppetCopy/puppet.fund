import { type GetConnectionReturnType, getConnection, getWalletClient } from '@wagmi/core'
import { type IStream, map, merge, op, skipRepeats, skipRepeatsWith } from 'aelea/stream'
import { state } from 'aelea/stream-extended'
import { subject } from '../utils/subject.js'
import type { IConnectedWallet } from './connectedWallet.js'
import { getStoredSessionKey } from './sessionKey.js'
import { connection, wagmi } from './wallet.js'

async function buildWallet(conn: GetConnectionReturnType): Promise<IConnectedWallet | null> {
  if (conn.status !== 'connected' || !conn.connector || !conn.chainId) return null
  if (typeof conn.connector.getChainId !== 'function') return null

  const walletClient = await getWalletClient(wagmi, { chainId: conn.chainId })
  return {
    connection: conn,
    walletClient,
    address: walletClient.account.address,
    session: getStoredSessionKey(walletClient.account.address)
  }
}

const pushed = subject<Promise<IConnectedWallet | null>>()

// Dedupe by wallet identity (status + address + connector). Chain switches via
// `switchChain` emit `chainChanged` upstream — without this filter the resulting
// re-emission tears down stream subscribers (popovers, drafts) for what is logically
// the same connected wallet. Consumers needing live chain state read it per-call
// via `getWalletClient(wagmi, { chainId })` or by sampling the wagmi config directly.
const stableConnection = op(
  connection,
  skipRepeatsWith((a, b) => {
    if (a.status !== b.status) return false
    if (a.status !== 'connected' || b.status !== 'connected') return a.status === b.status
    return a.address === b.address && a.connector?.uid === b.connector?.uid
  })
)

export const walletQuery: IStream<Promise<IConnectedWallet | null>> = op(
  merge(pushed.stream, map(buildWallet, stableConnection)),
  state()
)

// Live wallet chain id, sourced directly from the wagmi connection's `chainId`.
// Unlike `walletQuery`/`stableConnection` (which deliberately dedupe out chain
// changes so subscribers aren't torn down), this stream re-emits on every chain
// switch — letting consumers gate on the wallet's *current* chain so a
// "wrong network" warning clears the instant the user switches.
export const walletChainId: IStream<number | null> = op(
  connection,
  map(c => (c.status === 'connected' ? (c.chainId ?? null) : null)),
  skipRepeats,
  state(null)
)

export function setWallet(wallet: Promise<IConnectedWallet | null> | IConnectedWallet | null): void {
  pushed.push(wallet instanceof Promise ? wallet : Promise.resolve(wallet))
}

export function refreshWallet(): void {
  setWallet(buildWallet(getConnection(wagmi)))
}
