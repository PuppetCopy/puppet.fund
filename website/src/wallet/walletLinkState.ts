import type { IStream } from 'aelea/stream'
import { fromCallback } from 'aelea/stream-extended'
import type { Address, Hex } from 'viem'
import type { IConnectedWallet } from './connectedWallet.js'

export type IWalletLinkSession = { topic: string; name: string; url: string; icon?: string; account?: Address }

let currentSessions: IWalletLinkSession[] = []
let currentWallet: IConnectedWallet | null = null
const connectedListeners = new Set<(connected: boolean) => void>()
const sessionListeners = new Set<(sessions: IWalletLinkSession[]) => void>()
const walletListeners = new Set<(wallet: IConnectedWallet | null) => void>()

export function setLinkWallet(wallet: IConnectedWallet | null): void {
  currentWallet = wallet
  for (const listener of [...walletListeners]) listener(wallet)
}

export function peekLinkWallet(): IConnectedWallet | null {
  return currentWallet
}

export function waitForLinkWallet(timeoutMs = 3000): Promise<IConnectedWallet | null> {
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

export function onLinkWalletChange(cb: (wallet: IConnectedWallet | null) => void): () => void {
  walletListeners.add(cb)
  return () => {
    walletListeners.delete(cb)
  }
}

// Which of the connected wallet's funds is active: every fund shares the same master (the
// puppet account), so {baseToken, name} fully identifies it. The popover selects it, the
// session lens filters by it, and the wallet-responder operates it.
export type IActiveFund = { baseToken: Hex; name: Hex }

// Persisted PER MASTER (puppet account) so a refresh restores the wallet's last-selected fund
// instead of resetting to the first, and each wallet keeps its own active fund.
// localStorage shape: { [masterAddress]: { baseToken, name } }.
const ACTIVE_FUND_KEY = 'puppet.activeFundByMaster'
type IActiveFundByMaster = Record<string, IActiveFund>

const readActiveFunds = (): IActiveFundByMaster => {
  try {
    const raw = localStorage.getItem(ACTIVE_FUND_KEY)
    return raw ? (JSON.parse(raw) as IActiveFundByMaster) : {}
  } catch {
    return {}
  }
}

const activeFundByMaster: IActiveFundByMaster = readActiveFunds()
const activeFundListeners = new Set<() => void>()

export function setActiveFund(master: Address, fund: IActiveFund | null): void {
  const key = master.toLowerCase()
  const current = activeFundByMaster[key] ?? null
  if (current?.baseToken === fund?.baseToken && current?.name === fund?.name) return
  if (fund) activeFundByMaster[key] = fund
  else delete activeFundByMaster[key]
  try {
    localStorage.setItem(ACTIVE_FUND_KEY, JSON.stringify(activeFundByMaster))
  } catch {}
  for (const listener of [...activeFundListeners]) listener()
}

export function peekActiveFund(master: Address): IActiveFund | null {
  return activeFundByMaster[master.toLowerCase()] ?? null
}

export function onActiveFundChange(cb: () => void): () => void {
  activeFundListeners.add(cb)
  return () => {
    activeFundListeners.delete(cb)
  }
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

export function hasActiveWcSession(): boolean {
  return currentSessions.length > 0
}

let blockedSeq = 0
const blockedRequestListeners = new Set<(seq: number) => void>()

export function notifyBlockedRequest(): void {
  blockedSeq += 1
  for (const listener of [...blockedRequestListeners]) listener(blockedSeq)
}

export const blockedRequest: IStream<number> = fromCallback(cb => {
  blockedRequestListeners.add(cb)
  return () => {
    blockedRequestListeners.delete(cb)
  }
})

export const walletLinkConnected: IStream<boolean> = fromCallback(cb => {
  cb(currentSessions.length > 0)
  connectedListeners.add(cb)
  return () => {
    connectedListeners.delete(cb)
  }
})

export type IPendingSign = { id: number; topic: string; name: string; method: string }

let signSeq = 0
let currentPendingSign: IPendingSign | null = null
const pendingSignListeners = new Set<(pending: IPendingSign | null) => void>()
const signResolvers = new Map<number, (approved: boolean) => void>()

// A dApp signature request (e.g. a Hyperliquid login) waits here for the user's explicit decision in
// the popover, rather than signing automatically.
export function requestSignApproval(req: { topic: string; name: string; method: string }): Promise<boolean> {
  signSeq += 1
  const pending: IPendingSign = { ...req, id: signSeq }
  const priorResolve = currentPendingSign ? signResolvers.get(currentPendingSign.id) : undefined
  if (currentPendingSign && priorResolve) {
    signResolvers.delete(currentPendingSign.id)
    priorResolve(false)
  }
  currentPendingSign = pending
  for (const listener of [...pendingSignListeners]) listener(pending)
  return new Promise<boolean>(resolve => {
    signResolvers.set(pending.id, resolve)
  })
}

export function resolveSignApproval(id: number, approved: boolean): void {
  const resolve = signResolvers.get(id)
  if (resolve) {
    signResolvers.delete(id)
    resolve(approved)
  }
  if (currentPendingSign?.id === id) {
    currentPendingSign = null
    for (const listener of [...pendingSignListeners]) listener(null)
  }
}

export const pendingSign: IStream<IPendingSign | null> = fromCallback(cb => {
  cb(currentPendingSign)
  pendingSignListeners.add(cb)
  return () => {
    pendingSignListeners.delete(cb)
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
          const has = keys.some(
            (k, i) =>
              typeof k === 'string' &&
              k.includes('session') &&
              isNonEmpty(typeof vals![i] === 'string' ? safeParse(vals![i] as string) : vals![i])
          )
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
