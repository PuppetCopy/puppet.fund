import type { IStream } from 'aelea/stream'
import { fromCallback } from 'aelea/stream-extended'
import type { IConnectedWallet } from './connectedWallet.js'

export type IWalletLinkSession = { topic: string; name: string; url: string; icon?: string }

let currentSessions: IWalletLinkSession[] = []
let currentWallet: IConnectedWallet | null = null
const connectedListeners = new Set<(connected: boolean) => void>()
const sessionListeners = new Set<(sessions: IWalletLinkSession[]) => void>()
const walletListeners = new Set<(wallet: IConnectedWallet | null) => void>()

export function setLinkWallet(wallet: IConnectedWallet | null): void {
  currentWallet = wallet
  for (const listener of [...walletListeners]) listener(wallet)
}

export function waitForLinkWallet(timeoutMs = 12000): Promise<IConnectedWallet | null> {
  if (currentWallet?.session) return Promise.resolve(currentWallet)
  return new Promise(resolve => {
    let settled = false
    const finish = (wallet: IConnectedWallet | null): void => {
      if (settled) return
      settled = true
      walletListeners.delete(listener)
      clearTimeout(timer)
      resolve(wallet)
    }
    const listener = (wallet: IConnectedWallet | null): void => {
      if (wallet?.session) finish(wallet)
    }
    walletListeners.add(listener)
    const timer = setTimeout(() => finish(currentWallet), timeoutMs)
  })
}

export function setWalletLinkSessions(sessions: IWalletLinkSession[]): void {
  currentSessions = sessions
  for (const listener of [...sessionListeners]) listener(sessions)
  for (const listener of [...connectedListeners]) listener(sessions.length > 0)
}

export const walletLinkSessions: IStream<IWalletLinkSession[]> = fromCallback(cb => {
  cb(currentSessions)
  sessionListeners.add(cb)
  return () => {
    sessionListeners.delete(cb)
  }
})

export const walletLinkConnected: IStream<boolean> = fromCallback(cb => {
  cb(currentSessions.length > 0)
  connectedListeners.add(cb)
  return () => {
    connectedListeners.delete(cb)
  }
})

const safeParse = (s: string): unknown => {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}

const isNonEmpty = (v: unknown): boolean =>
  Array.isArray(v) ? v.length > 0 : !!v && typeof v === 'object' && Object.keys(v).length > 0

export async function hasPersistedWalletLink(): Promise<boolean> {
  const WC_DB = 'WALLET_CONNECT_V2_INDEXED_DB'
  const WC_STORE = 'keyvaluestorage'
  try {
    if (typeof indexedDB === 'undefined') return false
    if (typeof indexedDB.databases === 'function') {
      const dbs = await indexedDB.databases()
      if (!dbs.some(d => d.name === WC_DB)) return false
    }
    return await new Promise<boolean>(resolve => {
      const req = indexedDB.open(WC_DB)
      req.onerror = () => resolve(false)
      req.onupgradeneeded = () => {
        try {
          req.transaction?.abort()
        } catch {}
        resolve(false)
      }
      req.onsuccess = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(WC_STORE)) {
          db.close()
          resolve(false)
          return
        }
        const store = db.transaction(WC_STORE, 'readonly').objectStore(WC_STORE)
        const keyReq = store.getAllKeys()
        const valReq = store.getAll()
        let keys: IDBValidKey[] | null = null
        let vals: unknown[] | null = null
        const finish = () => {
          if (keys === null || vals === null) return
          const has = keys.some((k, i) => typeof k === 'string' && k.includes('session') && isNonEmpty(typeof vals![i] === 'string' ? safeParse(vals![i] as string) : vals![i]))
          db.close()
          resolve(has)
        }
        keyReq.onsuccess = () => {
          keys = keyReq.result
          finish()
        }
        valReq.onsuccess = () => {
          vals = valReq.result
          finish()
        }
        keyReq.onerror = () => {
          db.close()
          resolve(false)
        }
        valReq.onerror = () => {
          db.close()
          resolve(false)
        }
      }
    })
  } catch {
    return false
  }
}
