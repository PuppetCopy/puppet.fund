import type { IStream } from 'aelea/stream'
import { fromCallback } from 'aelea/stream-extended'
import type { IConnectedWallet } from './connectedWallet.js'

let activeCount = 0
let currentWallet: IConnectedWallet | null = null
const listeners = new Set<(connected: boolean) => void>()

const notify = (): void => {
  for (const listener of [...listeners]) listener(activeCount > 0)
}

export function setLinkWallet(wallet: IConnectedWallet | null): void {
  currentWallet = wallet
}

export function getLinkWallet(): IConnectedWallet | null {
  return currentWallet
}

export function addWalletLink(): void {
  activeCount += 1
  notify()
}

export function removeWalletLink(): void {
  activeCount = Math.max(0, activeCount - 1)
  notify()
}

export function setWalletLinkCount(count: number): void {
  activeCount = Math.max(0, count)
  notify()
}

export const walletLinkConnected: IStream<boolean> = fromCallback(cb => {
  cb(activeCount > 0)
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
})

// Lightweight check (no SignClient load) for a persisted WalletConnect session, so the heavy
// wallet-connect chunk is only restored on load when there is actually a session to revive.
export function hasPersistedWalletLink(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.includes('wc@2') || !key.includes('session')) continue
      const value = localStorage.getItem(key)
      if (!value) continue
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed) ? parsed.length > 0 : parsed && Object.keys(parsed).length > 0) return true
    }
  } catch {}
  return false
}
