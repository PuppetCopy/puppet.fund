import { PUPPET_EXTENSION_RDNS, WALLET_EVENT_ACCOUNTS_CHANGED, WALLET_MESSAGE, WALLET_TARGET } from '@puppet/sdk/wallet'
import { fromPromise, type IStream, merge, op } from 'aelea/stream'
import { fromCallback, state } from 'aelea/stream-extended'
import { type Address, getAddress, type Hex } from 'viem'

export { PUPPET_EXTENSION_RDNS }
export const PUPPET_EXTENSION_INSTALL_URL = 'https://puppet.tech/wallet'

const REQUEST_TIMEOUT_MS = 100

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

async function readActive(): Promise<Address | null> {
  const raw = await send<string | null>(WALLET_MESSAGE.GET_ACTIVE_WALLET)
  return raw ? getAddress(raw) : null
}

export async function setActiveSubaccount(address: Address | null, signerKey: Hex | null): Promise<void> {
  await send(WALLET_MESSAGE.SET_ACTIVE_WALLET, { subaccountAddress: address, signerKey })
}

export async function clearExtensionStorage(): Promise<void> {
  await send(WALLET_MESSAGE.CLEAR_ALL)
}

const liveActive: IStream<Address | null> = fromCallback<Address | null, [Address | null]>(cb => {
  const handler = (e: MessageEvent) => {
    if (e.source !== window || e.data?.target !== WALLET_TARGET.WEBSITE_EVENT) return
    const payload = e.data.payload
    if (payload?.event !== WALLET_EVENT_ACCOUNTS_CHANGED) return
    const accounts = payload.args?.[0] as string[] | undefined
    cb(accounts?.[0] ? getAddress(accounts[0]) : null)
  }
  window.addEventListener('message', handler)
  return () => window.removeEventListener('message', handler)
})

export const puppetActiveSubaccount: IStream<Address | null> = op(
  merge(fromPromise(readActive().catch(() => null)), liveActive),
  state()
)

export const puppetExtensionInstalled: IStream<boolean> = op(
  fromPromise(
    send(WALLET_MESSAGE.GET_ACTIVE_WALLET)
      .then(() => true)
      .catch(() => false)
  ),
  state()
)
