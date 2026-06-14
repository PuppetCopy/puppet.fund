import { predictFundAccount, predictPuppetAccount } from '@puppet/sdk/account'
import type { Address, Hex } from 'viem'
import { requestSessionFromSite } from './broadcast.js'

export interface IWalletState {
  user: Address | null
  signer: Address | null
  signerKey: Hex | null
  // The dApp ORIGINS the user approved — the fund can be connected to many dApps at once.
  // Each origin is gated independently: a request from an unlisted origin sees nothing.
  authorizedOrigins: string[]
}

export interface ISession {
  user: Address
  signer: Address
  account: Address
  fund: Address
}

// The signer key is handed for IN-MEMORY use only — it must never touch any
// chrome.storage tier. Public facts (user, signer ADDRESS) persist in
// storage.session so eth_accounts keeps answering across MV3 worker recycles;
// when the key itself is gone, the site re-hands it on request (it is the wallet).
let signerKey: Hex | null = null

type IPersistedState = Pick<IWalletState, 'user' | 'signer' | 'authorizedOrigins'>

const STORAGE_KEY = 'puppet-wallet-state'

let loaded = false
let persisted: IPersistedState = {
  user: null,
  signer: null,
  authorizedOrigins: []
}

// Hydrate the in-memory `persisted` from storage ONCE. Must read the live `persisted` var
// afterwards (not a captured snapshot) so writes made by setState are visible to later reads.
async function ensureLoaded(): Promise<void> {
  if (loaded) return
  const raw = await chrome.storage.session.get(STORAGE_KEY)
  const stored = raw[STORAGE_KEY] as IPersistedState | undefined
  if (stored) persisted = stored
  loaded = true
}

export async function getState(): Promise<IWalletState> {
  await ensureLoaded()
  return { ...persisted, signerKey }
}

export async function setState(next: IWalletState): Promise<IWalletState> {
  await ensureLoaded()
  signerKey = next.signerKey
  persisted = {
    user: next.user,
    signer: next.signer,
    authorizedOrigins: next.authorizedOrigins
  }
  await chrome.storage.session.set({ [STORAGE_KEY]: persisted })
  if (signerKey) {
    const drained = Array.from(keyWaiters)
    keyWaiters.clear()
    for (const wake of drained) wake()
  }
  return { ...persisted, signerKey }
}

// The fund is fully determined by (user, signer): one puppet account per pair, one fund
// per puppet account. Deriving it here is what guarantees the session can sign for it.
export function deriveSession(state: Pick<IWalletState, 'user' | 'signer'>): ISession | null {
  if (!state.user || !state.signer) return null
  const account = predictPuppetAccount({ user: state.user, signer: state.signer })
  return { user: state.user, signer: state.signer, account, fund: predictFundAccount(account) }
}

const keyWaiters = new Set<() => void>()

// Memory-only key, durable site: when a sign request arrives after a worker recycle,
// ask any open puppet-site tab to re-hand the session and wait briefly for it.
export async function ensureSignerKey(puppetUrl: string, timeoutMs = 3_000): Promise<Hex> {
  if (signerKey) return signerKey
  await requestSessionFromSite(puppetUrl)
  return new Promise<Hex>((resolve, reject) => {
    const timer = setTimeout(() => {
      keyWaiters.delete(wake)
      reject(
        new Error('Session signer is not in memory — open the Puppet site so it can re-hand your session, then retry')
      )
    }, timeoutMs)
    const wake = (): void => {
      if (!signerKey) return
      clearTimeout(timer)
      resolve(signerKey)
    }
    keyWaiters.add(wake)
  })
}

type IPending = { origin: string; resolve: (addr: Address) => void; reject: (err: Error) => void }
const pendingApprovals = new Set<IPending>()

// Block a dApp's eth_requestAccounts until the user approves THIS origin on the site (or
// rejects / times out). Resolves with the fund address immediately if already authorized.
export async function waitForApproval(origin: string, timeoutMs = 5 * 60_000): Promise<Address> {
  const state = await getState()
  const session = deriveSession(state)
  if (session && state.authorizedOrigins.includes(origin)) return session.fund
  return new Promise<Address>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingApprovals.delete(slot)
      reject(new Error('Timed out waiting for approval in Puppet'))
    }, timeoutMs)
    const slot: IPending = {
      origin,
      resolve: addr => {
        clearTimeout(timer)
        resolve(addr)
      },
      reject: err => {
        clearTimeout(timer)
        reject(err)
      }
    }
    pendingApprovals.add(slot)
  })
}

// Release any connection request pending for the just-authorized origin.
export function releaseApprovals(origin: string, fund: Address): void {
  for (const slot of Array.from(pendingApprovals)) {
    if (slot.origin !== origin) continue
    pendingApprovals.delete(slot)
    slot.resolve(fund)
  }
}

export function rejectApprovals(origin: string): void {
  for (const slot of Array.from(pendingApprovals)) {
    if (slot.origin !== origin) continue
    pendingApprovals.delete(slot)
    slot.reject(new Error('User rejected the connection in Puppet'))
  }
}
