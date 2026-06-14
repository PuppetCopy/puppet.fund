import {
  type IConnectionsResponse,
  type IHandoffSessionRequest,
  type IHandoffSessionResponse,
  type IRejectConnectRequest,
  PUPPET_EXTENSION_RDNS,
  WALLET_EVENT,
  WALLET_MESSAGE,
  WALLET_PROTOCOL_VERSION,
  WALLET_TARGET
} from '@puppet/sdk/wallet'
import { fromPromise, type IStream, map, merge, op, skipRepeats, switchMap } from 'aelea/stream'
import { fromCallback, state } from 'aelea/stream-extended'
import { type Address, getAddress, type Hex } from 'viem'
import { lastStoredSession } from './sessionKey.js'

export { PUPPET_EXTENSION_RDNS }
export const PUPPET_EXTENSION_INSTALL_URL = 'https://puppet.fund/wallet'

// A cold MV3 service-worker start routinely takes several hundred ms before the
// extension can answer; anything tighter false-negatives the installed probe.
// Generous enough to absorb a cold MV3 service-worker wake on the first message.
const REQUEST_TIMEOUT_MS = 3_000

let nextRequestId = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

if (typeof window !== 'undefined') {
  window.addEventListener('message', e => {
    if (e.source !== window || e.data?.target !== WALLET_TARGET.WEBSITE) return
    const { id, response } = e.data
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id)
    if (response?.success === false) entry.reject(new Error(response.error ?? 'extension error'))
    else entry.resolve(response?.result)
  })

  // The extension holds the signer key in MEMORY only; when an MV3 worker recycle drops
  // it, the extension asks any open puppet tab to re-hand the session. The site is the
  // wallet — the stored session answers without needing a live EOA connection.
  window.addEventListener('message', e => {
    if (e.source !== window || e.data?.target !== WALLET_TARGET.WEBSITE_EVENT) return
    if (e.data.payload?.event !== WALLET_EVENT.SESSION_REQUEST) return
    const session = lastStoredSession()
    if (session) rearmActiveAccount(session).catch(() => {})
  })
}

function send<T>(type: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = nextRequestId++
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('extension request timeout'))
    }, REQUEST_TIMEOUT_MS)
    pending.set(id, {
      resolve: v => {
        clearTimeout(timer)
        resolve(v as T)
      },
      reject: e => {
        clearTimeout(timer)
        reject(e)
      }
    })
    window.postMessage({ target: WALLET_TARGET.EXTENSION, id, type, payload }, '*')
  })
}

export interface IExtensionConnection {
  fund: Address | null
  origins: string[]
  // true when the installed extension speaks an older protocol than this site build.
  outdated: boolean
}

const NO_CONNECTION: IExtensionConnection = { fund: null, origins: [], outdated: false }

async function readConnection(): Promise<IExtensionConnection> {
  const raw = await send<IConnectionsResponse>(WALLET_MESSAGE.GET_CONNECTIONS)
  return {
    fund: raw.fund ? getAddress(raw.fund) : null,
    origins: raw.origins ?? [],
    outdated: raw.version !== WALLET_PROTOCOL_VERSION
  }
}

// Re-arm after an MV3 worker recycle: refill the in-memory signer key. The extension
// derives the fund from the pair and keeps its origin grants.
export async function rearmActiveAccount(session: { user: Address; privateKey: Hex }): Promise<void> {
  const payload: IHandoffSessionRequest = { user: session.user, signerKey: session.privateKey }
  await send(WALLET_MESSAGE.HANDOFF_SESSION, payload)
}

// User approves a pending dApp connection: HANDOFF_SESSION carrying the session +
// `approveOrigin`, which grants that dApp origin access and resolves its
// eth_requestAccounts with the fund address. Reject denies the pending request.
export async function approveConnection(active: { user: Address; privateKey: Hex; origin: string }): Promise<void> {
  const payload: IHandoffSessionRequest = {
    user: active.user,
    signerKey: active.privateKey,
    approveOrigin: active.origin
  }
  await send<IHandoffSessionResponse>(WALLET_MESSAGE.HANDOFF_SESSION, payload)
}

export async function rejectConnection(origin: string): Promise<void> {
  const payload: IRejectConnectRequest = { origin }
  await send(WALLET_MESSAGE.REJECT_CONNECT, payload)
}

export async function clearExtensionStorage(): Promise<void> {
  await send(WALLET_MESSAGE.CLEAR_ALL)
}

// Re-read the full connection (fund + approved origins) whenever the extension broadcasts a
// change — the accountsChanged event itself only carries the account, not the origin list.
const connectionTick: IStream<number> = fromCallback<number, [number]>(cb => {
  const handler = (e: MessageEvent) => {
    if (e.source !== window || e.data?.target !== WALLET_TARGET.WEBSITE_EVENT) return
    if (e.data.payload?.event !== WALLET_EVENT.ACCOUNTS_CHANGED) return
    cb(performance.now())
  }
  window.addEventListener('message', handler)
  return () => window.removeEventListener('message', handler)
})

export const puppetConnection: IStream<IExtensionConnection> = op(
  merge(
    fromPromise(readConnection().catch(() => NO_CONNECTION)),
    switchMap(() => fromPromise(readConnection().catch(() => NO_CONNECTION)), connectionTick)
  ),
  state(NO_CONNECTION)
)

export const puppetActiveAccount: IStream<Address | null> = op(
  puppetConnection,
  map(c => c.fund),
  skipRepeats,
  state(null)
)

export const puppetConnectedOrigins: IStream<string[]> = op(
  puppetConnection,
  map(c => c.origins),
  state([])
)

// The installed extension speaks an older protocol than this site build — prompt an update.
export const puppetExtensionOutdated: IStream<boolean> = op(
  puppetConnection,
  map(c => c.outdated),
  skipRepeats,
  state(false)
)

export const puppetExtensionInstalled: IStream<boolean> = op(
  fromPromise(
    send(WALLET_MESSAGE.GET_CONNECTIONS)
      .then(() => true)
      .catch(() => false)
  ),
  state()
)
