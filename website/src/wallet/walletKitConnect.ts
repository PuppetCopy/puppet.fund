import { CompactError, formatThrownError } from '@puppet/sdk/compact'
import { HUB_CHAIN } from '@puppet/sdk/const'
import { rpcTransport, staticTokenRegistry } from '@puppet/sdk/state'
import { type IPassthroughDeps, type IPassthroughTransaction, sendOperatePassthrough } from '@puppet/sdk/venue'
import { getConnection, disconnect as wagmiDisconnect } from '@wagmi/core'
import { SignClient } from '@walletconnect/sign-client'
import { buildApprovedNamespaces, getSdkError } from '@walletconnect/utils'
import { type Address, createPublicClient, type Hex, isAddressEqual, numberToHex } from 'viem'
import context from '../io/context.js'
import { compact } from '../io/matchmaker/index.js'
import type { IConnectedWallet } from './connectedWallet.js'
import { publicClientMap, WALLETCONNECT_PROJECT_ID, wagmi } from './wallet.js'
import {
  fundAddress,
  masterOf,
  notifyBlockedRequest,
  onActiveFundChange,
  onLinkWalletChange,
  peekActiveFund,
  peekLinkWallet,
  requestSignApproval,
  setWalletLinkSessions,
  waitForLinkWallet
} from './walletLinkState.js'
import { wcUriFromLocation } from './wcUri.js'

declare const __WC_METADATA__: { name: string; description: string; url: string; icons: string[] }

const tokenRegistry = staticTokenRegistry()
const publicClient = createPublicClient({ chain: HUB_CHAIN, transport: rpcTransport(HUB_CHAIN.rpcUrls.default.http[0], HUB_CHAIN.id) })

const SUPPORTED_METHODS = [
  'eth_sendTransaction',
  'eth_accounts',
  'eth_chainId',
  'eth_sign',
  'personal_sign',
  'eth_signTypedData',
  'eth_signTypedData_v4',
  'wallet_switchEthereumChain',
  'wallet_addEthereumChain'
]

function passthroughDeps(wallet: IConnectedWallet): IPassthroughDeps {
  const master = masterOf(wallet)
  if (!master || !wallet.session) throw new Error('Enable a signing session before connecting a dApp')
  const active = peekActiveFund(master)
  if (!active) throw new Error('Select a fund before trading from a linked dApp')
  // dApp transactions execute strictly through the user's selected active fund; the SDK derives
  // its {master, baseToken, name} CREATE2 address from this session. No default fund.
  return {
    user: wallet.address,
    signer: wallet.session.account,
    baseToken: active.baseToken,
    name: active.name,
    compact,
    publicClient,
    tokenRegistry,
    getTokenPerNativeToken: context.getTokenPerNativeToken
  }
}

const SIGN_METHODS = ['personal_sign', 'eth_signTypedData', 'eth_signTypedData_v4']
const EXECUTION_METHODS = ['eth_sendTransaction', 'eth_sign', ...SIGN_METHODS]

type ITypedData = {
  domain: Record<string, unknown>
  types: Record<string, { name: string; type: string }[]>
  primaryType: string
  message: Record<string, unknown>
}

const DAPP_ERROR_MESSAGE: Record<string, string> = {
  UNKNOWN_OPERATE: "Puppet doesn't recognize this as a supported trade, so your fund can't sign it.",
  COLLATERAL_NOT_REGISTERED:
    "This position's collateral isn't a token your fund supports yet. Pick a position collateralized in ETH, WETH, or USDC to withdraw from.",
  SENDTOKENS_NOT_BASE: "This trade's collateral token isn't supported by your fund yet.",
  FOREIGN_TARGET: 'This action calls a contract outside the supported trading venues.',
  ROUTER_FN_FORBIDDEN: "This action uses a venue operation that isn't allowed.",
  BASE_FN_FORBIDDEN: "This action uses a token operation that isn't allowed.",
  RECEIVER_NOT_ACCOUNT: 'This trade would settle to another account, so it was blocked.',
  CANCEL_RECEIVER_NOT_ACCOUNT: 'This order would refund to another account, so it was blocked.',
  SENDTOKENS_BAD_RECEIVER: 'This trade would move funds outside your fund, so it was blocked.',
  SENDWNT_BAD_RECEIVER: 'This trade would move ETH outside your fund, so it was blocked.',
  NATIVE_VALUE_MISMATCH: "This trade's ETH amount doesn't match the order, so it was blocked.",
  NATIVE_VALUE_FORBIDDEN: 'This action attaches ETH where none is allowed, so it was blocked.',
  APPROVE_BAD_SPENDER: 'This approval targets an unexpected contract.',
  ORDER_TYPE_FORBIDDEN: 'Only opening and closing positions are supported.',
  UNKNOWN_MARKET: "This market isn't supported.",
  CALLBACK_FORBIDDEN: "This order sets a callback contract, which isn't allowed.",
  UI_FEE_FORBIDDEN: "This order's fee receiver isn't allowed.",
  SWAPPATH_TOO_LONG: 'This trade routes through too many markets.',
  SWAPPATH_UNKNOWN_MARKET: 'This trade routes through an unsupported market.',
  UNDECODABLE_ROUTER_CALL: "Puppet couldn't read this trade request."
}

function friendlyDappError(e: unknown): string {
  if (e instanceof CompactError) {
    return DAPP_ERROR_MESSAGE[e.code] ?? `Your fund couldn't safely sign this action (${e.code}).`
  }
  return formatThrownError(e)
}

// Signing is gated by an explicit user-approval prompt in registerHandlers (the fund validates any
// session-signed digest via EIP-1271, so the user must confirm); by the time we sign here it's approved.
export async function handleDappRequest(
  wallet: IConnectedWallet | null,
  method: string,
  params: unknown,
  chainId: number = HUB_CHAIN.id
): Promise<unknown> {
  if (method === 'eth_sendTransaction') {
    if (!wallet?.session) throw new Error('Enable a signing session before connecting a dApp')
    const tx = (params as IPassthroughTransaction[])[0]
    return sendOperatePassthrough(passthroughDeps(wallet), tx)
  }
  if (method === 'eth_accounts' || method === 'eth_requestAccounts') {
    const active = wallet ? fundAddress(wallet) : null
    return active ? [active] : []
  }
  if (method === 'personal_sign') {
    if (!wallet?.session) throw new Error('Enable a signing session before connecting a dApp')
    const [data] = params as [Hex, Address]
    return wallet.session.account.signMessage({ message: { raw: data } })
  }
  if (method === 'eth_signTypedData' || method === 'eth_signTypedData_v4') {
    if (!wallet?.session) throw new Error('Enable a signing session before connecting a dApp')
    const [, raw] = params as [Address, string | ITypedData]
    const typed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as ITypedData
    const types = Object.fromEntries(Object.entries(typed.types).filter(([key]) => key !== 'EIP712Domain'))
    return wallet.session.account.signTypedData({
      domain: typed.domain,
      types,
      primaryType: typed.primaryType,
      message: typed.message
    } as Parameters<typeof wallet.session.account.signTypedData>[0])
  }
  if (method === 'eth_sign') {
    throw new Error('eth_sign is not supported. The dApp should request personal_sign.')
  }
  if (method === 'eth_chainId') return numberToHex(chainId)
  if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null
  // Reads answer on the chain the dApp scoped its request to (a Polygon dApp probing eth_call/eth_getCode
  // against the hub RPC gets wrong-chain answers); unconfigured chains fall back to the hub.
  const readClient = publicClientMap[chainId] ?? publicClient
  return (readClient.request as (a: { method: string; params: unknown }) => Promise<unknown>)({ method, params })
}

type ISignClient = Awaited<ReturnType<typeof SignClient.init>>
type IProposalStruct = ReturnType<ISignClient['proposal']['getAll']>[number]
type IWcSlot = { client: ISignClient | null; initPromise: Promise<ISignClient> | null }

const WC_SLOT = Symbol.for('puppet.walletconnect.signclient')
const registry = globalThis as unknown as Record<symbol, IWcSlot | undefined>
const slot: IWcSlot = registry[WC_SLOT] ?? (registry[WC_SLOT] = { client: null, initPromise: null })

function hasPersistedWalletLink(): boolean {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key?.startsWith(WC_STORAGE_PREFIX) || !key.endsWith('//session')) continue
    const sessions = readWc(key.slice(WC_STORAGE_PREFIX.length))
    return Array.isArray(sessions) && sessions.length > 0
  }
  return false
}

// One-time boot: the engine (and its relay socket) only starts when there is a persisted link to
// restore or a dApp deep-link in the URL; everyone else just carries the parsed module.
let booted = false
export function initWalletLink(): void {
  if (booted) return
  booted = true
  if (hasPersistedWalletLink()) void startWalletConnect().catch(e => console.warn('[wc] restore failed', e))
  if (wcUriFromLocation()) void pairFromUrl()
}

export async function startWalletConnect(): Promise<ISignClient> {
  if (slot.client) return slot.client
  if (slot.initPromise) return slot.initPromise
  slot.initPromise = (async () => {
    pruneDeadWcRecords()
    const client = await SignClient.init({
      projectId: WALLETCONNECT_PROJECT_ID,
      storage: wcStorage,
      metadata: { ...__WC_METADATA__, url: window.location.origin }
    })
    console.info('[wc] SignClient init done, restored sessions:', client.session.getAll().length)
    syncSessions(client)
    client.core.relayer.once('relayer_connect', () => console.info('[wc] relay connected'))
    registerHandlers(client)
    slot.client = client
    const pushFund = (w: IConnectedWallet | null) => broadcastActiveFund(w ? fundAddress(w) : null)
    onLinkWalletChange(pushFund)
    onActiveFundChange(() => pushFund(peekLinkWallet()))
    pushFund(peekLinkWallet())
    const pending = client.proposal.getAll().filter(p => p.expiryTimestamp * 1000 > Date.now())
    if (pending.length) {
      console.info('[wc] replaying pending proposals:', pending.length)
      for (const proposal of pending) void approveProposal(client, proposal)
    }
    return client
  })()
  return slot.initPromise
}

const approving = new Set<number>()

async function approveProposal(client: ISignClient, proposal: IProposalStruct): Promise<void> {
  if (approving.has(proposal.id)) return
  approving.add(proposal.id)
  try {
    const wallet = await waitForLinkWallet()
    if (!wallet?.session) {
      console.warn('[wc] rejecting proposal: no connected Puppet account with an enabled session')
      await client.reject({ id: proposal.id, reason: getSdkError('USER_REJECTED') })
      return
    }
    // The fund is the same multichain (CREATE2) address on every EVM chain, so offer it on every
    // eip155 chain the dApp asks for (forcing the hub makes a non-Arbitrum dApp's approve come back
    // empty).
    const wanted = new Set<string>()
    const collectChains = (nsMap: Record<string, { chains?: string[] }>): void => {
      for (const [key, ns] of Object.entries(nsMap)) {
        if (key.startsWith('eip155:')) wanted.add(key)
        for (const chain of ns.chains ?? []) if (chain.startsWith('eip155:')) wanted.add(chain)
      }
    }
    collectChains(proposal.requiredNamespaces)
    collectChains(proposal.optionalNamespaces)
    const chains = wanted.size > 0 ? [...wanted] : [`eip155:${HUB_CHAIN.id}`]
    const fund = fundAddress(wallet)
    if (!fund) {
      console.warn('[wc] rejecting proposal: no active fund selected')
      notifyBlockedRequest()
      await client.reject({ id: proposal.id, reason: getSdkError('USER_REJECTED') })
      return
    }
    let namespaces: ReturnType<typeof buildApprovedNamespaces> | null = null
    try {
      namespaces = buildApprovedNamespaces({
        proposal,
        supportedNamespaces: {
          eip155: {
            chains,
            methods: SUPPORTED_METHODS,
            events: ['accountsChanged', 'chainChanged'],
            accounts: chains.map(chain => `${chain}:${fund}`)
          }
        }
      })
    } catch (e) {
      console.warn('[wc] proposal not satisfiable', e)
    }
    if (!namespaces?.eip155?.accounts?.length) {
      console.warn('[wc] no approvable namespaces for proposal', {
        required: proposal.requiredNamespaces,
        optional: proposal.optionalNamespaces
      })
      await client.reject({ id: proposal.id, reason: getSdkError('UNSUPPORTED_CHAINS') })
      return
    }
    // Keep every existing link alive: a connection costs a copy-paste to establish, so one fund holds
    // many dApps and several funds (one per wallet) coexist. The popover lenses to the active fund and
    // session_request enforces the same match, so a link opened under another fund stays dormant, never
    // disconnected.
    await client.approve({ id: proposal.id, namespaces })
    syncSessions(client)
    console.info('[wc] session approved as', fund)
  } catch (e) {
    console.error('[wc] session_proposal failed', e)
    await client.reject({ id: proposal.id, reason: getSdkError('USER_REJECTED') }).catch(() => {})
  } finally {
    approving.delete(proposal.id)
  }
}

function registerHandlers(client: ISignClient): void {
  client.on('session_proposal', ({ params }) => {
    console.info('[wc] session_proposal', {
      required: params.requiredNamespaces,
      optional: params.optionalNamespaces
    })
    void approveProposal(client, params)
  })
  client.on('session_request', async ({ topic, id, params }) => {
    const method = params.request.method
    console.info('[wc] session_request', method)
    try {
      const wallet = peekLinkWallet()
      if (EXECUTION_METHODS.includes(method)) {
        // A linked dApp operates the currently-selected fund (the user picks it in the WC popover),
        // so any live session follows the active fund rather than the one it first paired to.
        const fund = wallet ? fundAddress(wallet) : null
        if (!fund) {
          notifyBlockedRequest()
          throw new Error('Select a fund to trade from a linked dApp.')
        }
      }
      if (SIGN_METHODS.includes(method)) {
        const name = client.session.get(topic).peer.metadata.name || 'This dApp'
        const approved = await requestSignApproval({ topic, name, method })
        if (!approved) throw new Error('Signature request declined')
      }
      const requestChainId = Number(params.chainId?.split(':')[1]) || HUB_CHAIN.id
      const result = await handleDappRequest(wallet, method, params.request.params, requestChainId)
      await client.respond({ topic, response: { id, jsonrpc: '2.0', result } })
    } catch (e) {
      console.error('[wc] session_request failed', method, e)
      await client.respond({
        topic,
        response: { id, jsonrpc: '2.0', error: { code: 5000, message: friendlyDappError(e) } }
      })
    }
  })
  client.on('session_delete', () => {
    console.info('[wc] session_delete')
    syncSessions(client)
  })
}

type IWcRecord = {
  topic?: string
  expiry?: number
  active?: boolean
  expiryTimestamp?: number
  pairingTopic?: string
  target?: string
  self?: { publicKey?: string }
}

const WC_STORAGE_PREFIX = 'wc/'

const wcKey = (key: string): string => WC_STORAGE_PREFIX + key

const wcKeys = (): string[] => {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(WC_STORAGE_PREFIX)) keys.push(key.slice(WC_STORAGE_PREFIX.length))
  }
  return keys
}

const readWc = (key: string): unknown => {
  const raw = localStorage.getItem(wcKey(key))
  if (raw === null) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

// WC state lives in plain localStorage we own (instead of the SDK's default IndexedDB), so the
// persisted-link probe and the boot prune below are trivial synchronous reads.
const wcStorage = {
  getKeys: async (): Promise<string[]> => wcKeys(),
  getEntries: async <T,>(): Promise<[string, T][]> => wcKeys().map(key => [key, readWc(key) as T]),
  getItem: async <T,>(key: string): Promise<T | undefined> => readWc(key) as T | undefined,
  setItem: async <T,>(key: string, value: T): Promise<void> => localStorage.setItem(wcKey(key), JSON.stringify(value)),
  removeItem: async (key: string): Promise<void> => localStorage.removeItem(wcKey(key))
}

// On connect the subscriber re-subscribes every persisted topic and batch-fetches its relay mailbox, while sign-client's
// own init cleanup deletes expired sessions; that backlog then fails validation ("Record was recently deleted") and is
// logged at error level per message. Pruning AFTER init loses that race by construction, so dead records are dropped
// BEFORE SignClient.init: a topic that is never restored is never re-subscribed, never mailbox-fetched, never logged.
function pruneDeadWcRecords(): void {
  try {
    indexedDB.deleteDatabase('WALLET_CONNECT_V2_INDEXED_DB')
  } catch {}
  try {
    const list = (name: string): IWcRecord[] => {
      const key = wcKeys().find(k => k.endsWith(`//${name}`))
      const value = key ? readWc(key) : undefined
      return Array.isArray(value) ? (value as IWcRecord[]) : []
    }
    const now = Date.now()
    const sessions = list('session')
    const pairings = list('pairing')
    const proposalPairingTopics = new Set(
      list('proposal')
        .filter(p => (p.expiryTimestamp ?? 0) * 1000 > now)
        .map(p => p.pairingTopic)
    )
    const liveSession = (s: IWcRecord): boolean => (s.expiry ?? 0) * 1000 > now
    const livePairing = (p: IWcRecord): boolean =>
      (p.expiry ?? 0) * 1000 > now && (p.active === true || proposalPairingTopics.has(p.topic))
    const live = new Set<string>()
    for (const s of sessions) if (liveSession(s) && s.topic) live.add(s.topic)
    for (const p of pairings) if (livePairing(p) && p.topic) live.add(p.topic)
    const deadKeychainKeys = new Set<string>()
    for (const s of sessions) {
      if (liveSession(s)) continue
      if (s.topic) deadKeychainKeys.add(s.topic)
      if (s.self?.publicKey) deadKeychainKeys.add(s.self.publicKey)
    }
    for (const p of pairings) if (!livePairing(p) && p.topic) deadKeychainKeys.add(p.topic)

    const rewrite = (name: string, next: (value: unknown) => unknown): void => {
      const key = wcKeys().find(k => k.endsWith(`//${name}`))
      if (!key) return
      const prev = readWc(key)
      const value = next(prev)
      if (JSON.stringify(value) !== JSON.stringify(prev)) localStorage.setItem(wcKey(key), JSON.stringify(value))
    }
    const keepList = (keep: (r: IWcRecord) => boolean) => (value: unknown) =>
      Array.isArray(value) ? (value as IWcRecord[]).filter(keep) : value
    const keepMap = (keep: (key: string) => boolean) => (value: unknown) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).filter(([key]) => keep(key)))
        : value

    rewrite('session', keepList(liveSession))
    rewrite('pairing', keepList(livePairing))
    rewrite('subscription', keepList(r => !!r.topic && live.has(r.topic)))
    rewrite('history', keepList(r => !r.topic || live.has(r.topic)))
    rewrite('request', keepList(r => !r.topic || live.has(r.topic)))
    rewrite(
      'expirer',
      keepList(r => {
        const topic = r.target?.startsWith('topic:') ? r.target.slice('topic:'.length) : null
        return !topic || live.has(topic)
      })
    )
    rewrite('messages', keepMap(topic => live.has(topic)))
    // Cleared WHOLESALE, live topics included: entries here are inbound messages whose processing did not
    // complete last load. The engine replays them EVERY boot, and the ones that can never succeed (acks to
    // requests whose awaiter died with the page) error-log and stay un-acked forever, so the pile only grows.
    // Dropping a request a dApp sent moments before reload is fine: it retries, and a wallet must not replay
    // stale execution requests anyway.
    rewrite('messages_withoutClientAck', keepMap(() => false))
    rewrite('keychain', keepMap(key => !deadKeychainKeys.has(key)))
  } catch (e) {
    console.warn('[wc] storage prune skipped', e)
  }
}

function syncSessions(client: ISignClient): void {
  setWalletLinkSessions(
    client.session.getAll().map(session => ({
      topic: session.topic,
      name: session.peer.metadata.name,
      url: session.peer.metadata.url,
      icon: session.peer.metadata.icons?.[0],
      account: session.namespaces.eip155?.accounts?.[0]?.split(':')[2] as Address | undefined
    }))
  )
}

// Re-point every live session to the active fund WITHOUT tearing it down so it follows the fund the
// user selects in the WC popover. WalletConnect rejects an accountsChanged for an account outside the
// approved set, so we session_update the namespaces to the active fund FIRST, then emit
// accountsChanged. A dApp that ignores live session updates / treats empty accounts as a hard
// disconnect is the documented exception (it needs a re-pair).
async function syncSessionAccounts(activeFund: Address | null): Promise<void> {
  if (!slot.client) return
  const data = activeFund ? [activeFund] : []
  for (const session of slot.client.session.getAll()) {
    const ns = session.namespaces.eip155
    if (!ns) continue
    const chainIds = [...new Set((ns.accounts ?? []).map(a => a.split(':').slice(0, 2).join(':')))]
    if (chainIds.length === 0) continue
    // Skip sessions already pointing at the active fund: a redundant update/emit is not just noise, its
    // peer ack lands AFTER the next reload as an orphan response the engine error-logs on every boot.
    const target = chainIds.map(c => `${c}:${activeFund}`.toLowerCase())
    const current = (ns.accounts ?? []).map(a => a.toLowerCase())
    if (activeFund && target.length === current.length && target.every((a, i) => a === current[i])) continue
    if (activeFund) {
      const namespaces = { ...session.namespaces, eip155: { ...ns, accounts: chainIds.map(c => `${c}:${activeFund}`) } }
      const updated = await slot.client
        .update({ topic: session.topic, namespaces })
        .then(() => true)
        .catch(e => {
          console.warn('[wc] session update failed', e)
          return false
        })
      // If the namespace update did not land, the active fund is NOT in the dApp's approved set; emitting
      // accountsChanged for it would be an out-of-namespace event the dApp rejects (possibly as a hard disconnect).
      if (!updated) continue
    }
    for (const chainId of chainIds) {
      await slot.client
        .emit({ topic: session.topic, chainId, event: { name: 'accountsChanged', data } })
        .catch(e => console.warn('[wc] accountsChanged emit failed', e))
    }
  }
}

let lastBroadcastFund: Address | null = null
function broadcastActiveFund(fund: Address | null): void {
  const same = fund === lastBroadcastFund || (!!fund && !!lastBroadcastFund && isAddressEqual(fund, lastBroadcastFund))
  if (same) return
  lastBroadcastFund = fund
  void syncSessionAccounts(fund)
}

export async function pairDapp(uri: string): Promise<void> {
  if (!slot.client) throw new Error('WalletConnect not initialized')
  console.info('[wc] pairing, awaiting proposal')
  try {
    await slot.client.pair({ uri })
  } catch (e) {
    // A dApp modal can re-show its cached URI after we disconnected the session it settled; the stale
    // local pairing record then hard-rejects the re-pair. Drop the record and retry once so the paste
    // flow self-heals instead of demanding a fresh link.
    const staleTopic = /^wc:([0-9a-f]+)@/i.exec(uri)?.[1]
    if (!staleTopic || !(e instanceof Error) || !e.message.includes('Pairing already exists')) throw e
    console.info('[wc] re-pairing over a stale pairing record, replacing it')
    await slot.client.core.pairing.disconnect({ topic: staleTopic }).catch(() => {})
    await slot.client.pair({ uri })
  }
}

export async function pairFromUrl(): Promise<void> {
  const uri = wcUriFromLocation()
  if (!uri) return
  console.info('[wc] pairing from deep-link')
  try {
    await startWalletConnect()
    await pairDapp(uri)
    // Strip the URI from the address bar only AFTER a successful pair, so a transient relay/init failure leaves it in
    // place for a reload-retry. Caught here so the fire-and-forget caller never sees an unhandled rejection.
    window.history.replaceState(null, '', `${location.pathname}${location.hash}`)
  } catch (e) {
    console.warn('[wc] deep-link pair failed; leaving URI in URL for retry', e)
  }
}

export async function disconnectDapp(topic: string): Promise<void> {
  if (!slot.client) return
  const pairingTopic = slot.client.session.getAll().find(s => s.topic === topic)?.pairingTopic
  try {
    await slot.client.disconnect({ topic, reason: getSdkError('USER_DISCONNECTED') })
  } catch (e) {
    console.error('[wc] disconnect failed', e)
  }
  // Retire the ride-along pairing too, so the dApp's client stops reusing its cached URI and mints a
  // fresh one on the next connect instead of colliding with a dead record on either side.
  if (pairingTopic) await slot.client.core.pairing.disconnect({ topic: pairingTopic }).catch(() => {})
  syncSessions(slot.client)
}

export async function teardownAllWc(): Promise<void> {
  if (!slot.client) return
  for (const s of slot.client.session.getAll()) {
    await slot.client.disconnect({ topic: s.topic, reason: getSdkError('USER_DISCONNECTED') }).catch(() => {})
  }
  syncSessions(slot.client)
}

// Lives here (not wallet.ts) so wallet.ts never imports the engine: the engine pulls io/context.js,
// which reads wallet.ts bindings at module scope, and a wallet.ts -> engine edge closes that cycle
// into a load-order TDZ crash.
export async function disconnect(): Promise<void> {
  await teardownAllWc().catch(() => {})
  const current = getConnection(wagmi)
  if (current.connector) await wagmiDisconnect(wagmi, { connector: current.connector })
}
