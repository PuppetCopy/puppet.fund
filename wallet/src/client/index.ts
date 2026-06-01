import { WALLET_EVENT_ACCOUNTS_CHANGED, WALLET_MESSAGE, WALLET_TARGET } from '@puppet/sdk/wallet'
import type { Address, Hex } from 'viem'

if (typeof window === 'undefined') {
  throw new Error('@puppet/wallet/client requires a browser environment')
}

let extensionRequestId = 0
const pendingExtensionRequests = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

window.addEventListener('message', event => {
  if (event.source !== window || event.data?.target !== WALLET_TARGET.WEBSITE) return

  const { id, response } = event.data
  if (id !== undefined && pendingExtensionRequests.has(id)) {
    const { resolve, reject } = pendingExtensionRequests.get(id)!
    pendingExtensionRequests.delete(id)
    if (response?.success === false) {
      reject(new Error(response.error || 'Extension request failed'))
    } else {
      resolve(response?.result)
    }
  }
})

export async function sendExtensionMessage<T = unknown>(type: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = extensionRequestId++
    const timeout = setTimeout(() => {
      pendingExtensionRequests.delete(id)
      reject(new Error('Extension request timeout'))
    }, 50)

    pendingExtensionRequests.set(id, {
      resolve: (v: unknown) => {
        clearTimeout(timeout)
        resolve(v as T)
      },
      reject: (e: Error) => {
        clearTimeout(timeout)
        reject(e)
      }
    })

    window.postMessage({ target: WALLET_TARGET.EXTENSION, id, type, payload }, '*')
  })
}

export async function getActiveSubaccount(): Promise<Address | null> {
  try {
    return await sendExtensionMessage<Address | null>(WALLET_MESSAGE.GET_ACTIVE_WALLET)
  } catch {
    return null
  }
}

export function onActiveSubaccountChanged(cb: (address: Address | null) => void): () => void {
  const handler = (event: MessageEvent) => {
    if (event.source !== window || event.data?.target !== WALLET_TARGET.WEBSITE_EVENT) return
    const payload = event.data.payload
    if (payload?.event !== WALLET_EVENT_ACCOUNTS_CHANGED) return
    const accounts = payload.args?.[0] as string[] | undefined
    cb((accounts?.[0] as Address) ?? null)
  }
  window.addEventListener('message', handler)
  return () => window.removeEventListener('message', handler)
}

export async function isExtensionInstalled(): Promise<boolean> {
  try {
    await sendExtensionMessage(WALLET_MESSAGE.GET_ACTIVE_WALLET)
    return true
  } catch {
    return false
  }
}

export async function setActiveSubaccount(subaccountAddress: Address | null, signerKey: Hex | null): Promise<void> {
  try {
    await sendExtensionMessage(WALLET_MESSAGE.SET_ACTIVE_WALLET, { subaccountAddress, signerKey })
  } catch {
    // Extension not installed, ignore
  }
}

export async function clearAllExtensionStorage(): Promise<void> {
  await sendExtensionMessage(WALLET_MESSAGE.CLEAR_ALL)
}
