import { predictFundAccount, predictPuppetAccount } from '@puppet/sdk/account'
import { type IStream, map, op } from 'aelea/stream'
import { fromCallback } from 'aelea/stream-extended'
import type { Address, Hex } from 'viem'
import type { IConnectedWallet } from './connectedWallet.js'

// One reactive primitive backs every piece of wallet-link state: an imperative get/set the WC
// engine drives, a subscribe the async waiters use, and a replaying stream the UI binds to.
interface ICell<T> {
  get(): T
  set(value: T): void
  subscribe(listener: (value: T) => void): () => void
  readonly stream: IStream<T>
}

function cell<T>(initial: T): ICell<T> {
  let current = initial
  const listeners = new Set<(value: T) => void>()
  const subscribe = (listener: (value: T) => void): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
  return {
    get: () => current,
    set: value => {
      current = value
      for (const listener of [...listeners]) listener(value)
    },
    subscribe,
    stream: fromCallback(cb => {
      cb(current)
      return subscribe(cb)
    })
  }
}

// The connected wallet the linked dApps operate through. The WC engine reads it on every
// session_request; the UI is the only writer (via setLinkWallet).
const linkWallet = cell<IConnectedWallet | null>(null)
export const setLinkWallet = linkWallet.set
export const peekLinkWallet = linkWallet.get
export const onLinkWalletChange = linkWallet.subscribe

// A pending proposal (replayed at boot) waits here for the wallet + session to come online, so a
// dApp deep-link that lands before the app has restored its wallet still gets approved.
export function waitForLinkWallet(timeoutMs = 3000): Promise<IConnectedWallet | null> {
  if (linkWallet.get()?.session) return Promise.resolve(linkWallet.get())
  return new Promise(resolve => {
    const unsubscribe = linkWallet.subscribe(wallet => {
      if (!wallet?.session) return
      unsubscribe()
      clearTimeout(timer)
      resolve(wallet)
    })
    const timer = setTimeout(() => {
      unsubscribe()
      resolve(linkWallet.get())
    }, timeoutMs)
  })
}

// Which of the connected wallet's funds is active: every fund shares the same master (the puppet
// account), so {baseToken, name} fully identifies it. The popover selects it, the engine operates
// it, and every linked dApp follows it.
export type IActiveFund = { baseToken: Hex; name: Hex }

// Persisted PER MASTER (puppet account) so a refresh restores the wallet's last-selected fund
// instead of resetting to the first, and each wallet keeps its own active fund.
// localStorage shape: { [masterAddress]: { baseToken, name } }.
const ACTIVE_FUND_KEY = 'puppet.activeFundByMaster'
type IActiveFundByMaster = Record<string, IActiveFund>

const activeFundByMaster: IActiveFundByMaster = (() => {
  try {
    const raw = localStorage.getItem(ACTIVE_FUND_KEY)
    return raw ? (JSON.parse(raw) as IActiveFundByMaster) : {}
  } catch {
    return {}
  }
})()

const activeFundBump = cell(0)

export function setActiveFund(master: Address, fund: IActiveFund | null): void {
  const key = master.toLowerCase()
  const current = activeFundByMaster[key] ?? null
  if (current?.baseToken === fund?.baseToken && current?.name === fund?.name) return
  if (fund) activeFundByMaster[key] = fund
  else delete activeFundByMaster[key]
  try {
    localStorage.setItem(ACTIVE_FUND_KEY, JSON.stringify(activeFundByMaster))
  } catch {}
  activeFundBump.set(activeFundBump.get() + 1)
}

export function peekActiveFund(master: Address): IActiveFund | null {
  return activeFundByMaster[master.toLowerCase()] ?? null
}

export const onActiveFundChange = (cb: () => void): (() => void) => activeFundBump.subscribe(() => cb())

export const sameFund = (a: IActiveFund | null, b: IActiveFund): boolean =>
  !!a && a.baseToken === b.baseToken && a.name === b.name

// The active fund resolution shared by the UI: an explicit in-session selection wins (while it's
// still in the list), else the per-master remembered fund (survives refresh), else the first fund.
// A wallet with no funds resolves to null, so no account is ever exposed to a linked dApp.
export function resolveActiveFund(
  master: Address | null,
  funds: IActiveFund[],
  selection: IActiveFund | null
): IActiveFund | null {
  const listed = (f: IActiveFund | null): f is IActiveFund => !!f && funds.some(x => sameFund(f, x))
  const remembered = master ? peekActiveFund(master) : null
  if (listed(selection)) return selection
  if (listed(remembered)) return remembered
  return funds[0] ? { baseToken: funds[0].baseToken, name: funds[0].name } : null
}

// The master (puppet account) and the resolved fund address for a wallet. Both the UI and the WC
// engine derive them the same way, so a linked dApp and the popover always agree on the account.
export function masterOf(wallet: IConnectedWallet | null): Address | null {
  return wallet?.session ? predictPuppetAccount({ user: wallet.session.user, signer: wallet.session.signer }) : null
}

export function fundAddress(wallet: IConnectedWallet | null): Address | null {
  const master = masterOf(wallet)
  if (!master) return null
  const active = peekActiveFund(master)
  return active ? predictFundAccount({ master, baseToken: active.baseToken, name: active.name }) : null
}

export type IWalletLinkSession = { topic: string; name: string; url: string; icon?: string; account?: Address }

const sessions = cell<IWalletLinkSession[]>([])
export const setWalletLinkSessions = sessions.set
export const walletLinkSessions = sessions.stream
export const walletLinkConnected: IStream<boolean> = op(
  walletLinkSessions,
  map(s => s.length > 0)
)

// A blocked request (no fund selected) nudges the popover open. Deliberately non-replaying: a fresh
// subscriber must not re-open the popover for a stale block.
const blocked = cell(0)
export const notifyBlockedRequest = (): void => blocked.set(blocked.get() + 1)
export const blockedRequest: IStream<number> = fromCallback(cb => blocked.subscribe(cb))

export type IPendingSign = { id: number; topic: string; name: string; method: string }

const pending = cell<IPendingSign | null>(null)
export const pendingSign = pending.stream
const signResolvers = new Map<number, (approved: boolean) => void>()
let signSeq = 0

// A dApp signature request (e.g. a Hyperliquid login) waits here for the user's explicit decision in
// the popover, rather than signing automatically. A newer request supersedes (declines) an older one.
export function requestSignApproval(req: { topic: string; name: string; method: string }): Promise<boolean> {
  signSeq += 1
  const prior = pending.get()
  if (prior) resolveSignApproval(prior.id, false)
  const request: IPendingSign = { ...req, id: signSeq }
  pending.set(request)
  return new Promise<boolean>(resolve => signResolvers.set(request.id, resolve))
}

export function resolveSignApproval(id: number, approved: boolean): void {
  const resolve = signResolvers.get(id)
  if (resolve) {
    signResolvers.delete(id)
    resolve(approved)
  }
  if (pending.get()?.id === id) pending.set(null)
}
