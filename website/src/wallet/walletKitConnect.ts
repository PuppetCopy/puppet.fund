import { predictFundAccount, predictPuppetAccount } from '@puppet/sdk/account'
import { CompactError, formatThrownError } from '@puppet/sdk/compact'
import { HUB_CHAIN } from '@puppet/sdk/const'
import { rpcTransport, staticTokenRegistry } from '@puppet/sdk/state'
import { type IPassthroughDeps, type IPassthroughTransaction, sendOperatePassthrough } from '@puppet/sdk/venue'
import { SignClient } from '@walletconnect/sign-client'
import { buildApprovedNamespaces, getSdkError } from '@walletconnect/utils'
import { type Address, createPublicClient, type Hex, isAddressEqual, numberToHex } from 'viem'
import context from '../io/context.js'
import { compact } from '../io/matchmaker/index.js'
import type { IConnectedWallet } from './connectedWallet.js'
import { WALLETCONNECT_PROJECT_ID } from './wallet.js'
import {
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

// Strict: no fund is exposed/operated until the user selects an active one. Returns null when
// there is no session or no active fund, so callers treat that as "not linked".
export function fundAddress(wallet: IConnectedWallet): Address | null {
  const session = wallet.session
  if (!session) return null
  const master = predictPuppetAccount({ user: session.user, signer: session.signer })
  const active = peekActiveFund(master)
  if (!active) return null
  return predictFundAccount({ master, baseToken: active.baseToken, name: active.name })
}

function passthroughDeps(wallet: IConnectedWallet): IPassthroughDeps {
  if (!wallet.session) throw new Error('Enable a signing session before connecting a dApp')
  const master = predictPuppetAccount({ user: wallet.session.user, signer: wallet.session.signer })
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
  params: unknown
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
  if (method === 'eth_chainId') return numberToHex(HUB_CHAIN.id)
  if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null
  return (publicClient.request as (a: { method: string; params: unknown }) => Promise<unknown>)({ method, params })
}

type ISignClient = Awaited<ReturnType<typeof SignClient.init>>
type IProposalStruct = ReturnType<ISignClient['proposal']['getAll']>[number]
type IWcSlot = { client: ISignClient | null; initPromise: Promise<ISignClient> | null }

const WC_SLOT = Symbol.for('puppet.walletconnect.signclient')
const registry = globalThis as unknown as Record<symbol, IWcSlot | undefined>
const slot: IWcSlot = registry[WC_SLOT] ?? (registry[WC_SLOT] = { client: null, initPromise: null })

export async function startWalletConnect(): Promise<ISignClient> {
  if (slot.client) return slot.client
  if (slot.initPromise) return slot.initPromise
  slot.initPromise = (async () => {
    const client = await SignClient.init({
      projectId: WALLETCONNECT_PROJECT_ID,
      metadata: { ...__WC_METADATA__, url: window.location.origin }
    })
    console.info('[wc] SignClient init done, restored sessions:', client.session.getAll().length)
    syncSessions(client)
    client.core.relayer.once('relayer_connect', () => console.info('[wc] relay connected'))
    registerHandlers(client)
    slot.client = client
    void pruneStaleState(client)
    onLinkWalletChange(w => broadcastActiveFund(w ? fundAddress(w) : null))
    onActiveFundChange(() => {
      const w = peekLinkWallet()
      broadcastActiveFund(w ? fundAddress(w) : null)
    })
    const current = peekLinkWallet()
    if (current) broadcastActiveFund(fundAddress(current))
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

const accountAddress = (account: string | undefined): Address | undefined =>
  account ? (account.split(':')[2] as Address | undefined) : undefined
const accountChainId = (account: string): string => account.split(':').slice(0, 2).join(':')

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
      const result = await handleDappRequest(wallet, method, params.request.params)
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

// On boot the relayer re-subscribes to every persisted topic and the relay flushes its queued backlog; messages for
// topics whose symKey/history is gone (expired sessions & pairings left over from prior loads) fail to decode and the
// sign-client engine logs each at error level (onRelayMessage -> failed to process an inbound message). Dropping the
// expired records here unsubscribes those dead topics so they are not re-pulled on the NEXT load — the backlog
// converges instead of accumulating. Only EXPIRED records are touched, never a live link. Fire-and-forget: a disconnect
// publish to a dead topic may stall, but the local removal + unsubscribe still lands.
async function pruneStaleState(client: ISignClient): Promise<void> {
  const now = Date.now()
  for (const session of client.session.getAll()) {
    if (session.expiry * 1000 > now) continue
    await client.disconnect({ topic: session.topic, reason: getSdkError('USER_DISCONNECTED') }).catch(() => {})
  }
  for (const pairing of client.core.pairing.getPairings()) {
    if (pairing.active && pairing.expiry * 1000 > now) continue
    await client.core.pairing.disconnect({ topic: pairing.topic }).catch(() => {})
  }
}

function syncSessions(client: ISignClient): void {
  setWalletLinkSessions(
    client.session.getAll().map(session => ({
      topic: session.topic,
      name: session.peer.metadata.name,
      url: session.peer.metadata.url,
      icon: session.peer.metadata.icons?.[0],
      account: accountAddress(session.namespaces.eip155?.accounts?.[0])
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
    const chainIds = [...new Set((ns.accounts ?? []).map(accountChainId))]
    if (chainIds.length === 0) continue
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
  if (fund === lastBroadcastFund) return
  if (fund && lastBroadcastFund && isAddressEqual(fund, lastBroadcastFund)) return
  lastBroadcastFund = fund
  void syncSessionAccounts(fund)
}

export async function pairDapp(uri: string): Promise<void> {
  if (!slot.client) throw new Error('WalletConnect not initialized')
  console.info('[wc] pairing, awaiting proposal')
  await slot.client.pair({ uri })
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
  try {
    await slot.client.disconnect({ topic, reason: getSdkError('USER_DISCONNECTED') })
  } catch (e) {
    console.error('[wc] disconnect failed', e)
  }
  syncSessions(slot.client)
}

export async function teardownAllWc(): Promise<void> {
  if (!slot.client) return
  for (const s of slot.client.session.getAll()) {
    await slot.client.disconnect({ topic: s.topic, reason: getSdkError('USER_DISCONNECTED') }).catch(() => {})
  }
  syncSessions(slot.client)
}
