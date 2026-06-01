import type { Address, Hex } from 'viem'

export interface StoredState {
  activeSubaccount: Address | null
  signerKey: Hex | null
}

export const DEFAULT_STATE: StoredState = {
  activeSubaccount: null,
  signerKey: null
}

const pendingResolvers = new Set<(addr: Address) => void>()

export function waitForActive(state: StoredState, timeoutMs = 5 * 60_000): Promise<Address> {
  if (state.activeSubaccount) return Promise.resolve(state.activeSubaccount)
  return new Promise<Address>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingResolvers.delete(wrapped)
      reject(new Error('Timed out waiting for Puppet account selection'))
    }, timeoutMs)
    const wrapped = (addr: Address) => {
      clearTimeout(timer)
      resolve(addr)
    }
    pendingResolvers.add(wrapped)
  })
}

export function notifyActiveSet(addr: Address): void {
  const drained = Array.from(pendingResolvers)
  pendingResolvers.clear()
  for (const resolve of drained) resolve(addr)
}
