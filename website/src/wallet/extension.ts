import {
  type IRejectConnectRequest,
  PUPPET_EXTENSION_RDNS,
  WALLET_MESSAGE,
  WALLET_TARGET
} from '@puppet/sdk/wallet'
import type { Address, Hex } from 'viem'

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

// User approves a pending dApp connection: HANDOFF_SESSION carrying the session +
// `approveOrigin`, which grants that dApp origin access and resolves its
// eth_requestAccounts with the fund address. Reject denies the pending request.
// Wallet extension sunset: handoff now needs an active-fund selection (baseToken + name)
// the site no longer provides. Kept as a no-op; revive with a fund picker (see $ExtensionBanner).
export async function approveConnection(_active: { user: Address; privateKey: Hex; origin: string }): Promise<void> {
  // const payload: IHandoffSessionRequest = {
  //   user: active.user,
  //   signerKey: active.privateKey,
  //   approveOrigin: active.origin
  // }
  // await send<IHandoffSessionResponse>(WALLET_MESSAGE.HANDOFF_SESSION, payload)
}

export async function rejectConnection(origin: string): Promise<void> {
  const payload: IRejectConnectRequest = { origin }
  await send(WALLET_MESSAGE.REJECT_CONNECT, payload)
}

export async function clearExtensionStorage(): Promise<void> {
  await send(WALLET_MESSAGE.CLEAR_ALL)
}
