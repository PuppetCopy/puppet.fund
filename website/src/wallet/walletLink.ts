import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { ACCOUNT_DOMAIN, CHAINLESS_DOMAIN, INTENTS } from '@puppet/contracts/intents'
import { CompactError, formatThrownError } from '@puppet/sdk/compact'
import { CHAIN_ID_LIST, type ChainId } from '@puppet/sdk/const'
import { assertDappSignable, type IDappTypedData, screenDappMessage, screenDappTypedData } from '@puppet/sdk/venue'
import { getConnection, disconnect as wagmiDisconnect } from '@wagmi/core'
import { SignClient } from '@walletconnect/sign-client'
import { buildApprovedNamespaces, getSdkError } from '@walletconnect/utils'
import { createBrowserScheduler, type IStream, op } from 'aelea/stream'
import { state } from 'aelea/stream-extended'
import { type Address, getAddress, type Hex, hashMessage, hashTypedData, isAddress, isAddressEqual, numberToHex, recoverAddress, type TypedData, type TypedDataDefinition, type TypedDataDomain, zeroAddress } from 'viem'
import { subject } from '../utils/subject.js'
import type { IConnectedWallet } from './connectedWallet.js'
import type { IRootState, IWalletPair } from './root.js'
import { publicClientMap, WALLETCONNECT_PROJECT_ID, wagmi } from './wallet.js'
import type { IFundSigner } from './walletKeys.js'
import { wcUriFromLocation } from './wcUri.js'

declare const __WC_METADATA__: { name: string; description: string; url: string; icons: string[] }


let latest: IWalletPair = { wallet: null, root: Promise.resolve(null), keys: null }
let latestRoot: IRootState | null = null

const scheduler = createBrowserScheduler()
const drain = <T>(source: IStream<T>, onValue: (value: T) => void): void => {
  source.run(
    {
      event: (_t, value) => onValue(value),
      error: (_t, err) => wcLog('error', 'wallet stream error', err),
      end: () => {}
    },
    scheduler
  )
}

export function activeAccount(): Address | null {
  return latest.wallet === null || latestRoot === null || latestRoot.fund === null ? null : latestRoot.fund.account
}

export function linkedAccount(): Address {
  if (latest.wallet === null) throw new Error('Connect your wallet before linking a dApp')
  const account = activeAccount()
  if (account === null) {
    throw new Error('Open a fund before linking a dApp; a dApp trades through a fund, not through your wallet account')
  }
  return account
}

export type IWalletLinkSession = {
  topic: string
  name: string
  url: string
  icon?: string
  account?: Address
  signRequests: number
  repeatedSigns: number
  probe: ISignProbe
  reachable: boolean | null
}

const PING_TIMEOUT_MS = 8_000
const reachability = new Map<string, boolean>()

const sessions = subject<IWalletLinkSession[]>()
export const walletLinkSessions: IStream<IWalletLinkSession[]> = op(sessions.stream, state([]))

export type IWalletLinkLogLevel = 'info' | 'warn' | 'error'
export type IWalletLinkLogEntry = { id: number; time: number; level: IWalletLinkLogLevel; text: string }

const LOG_LIMIT = 60
const logEntries: IWalletLinkLogEntry[] = []
const logSubject = subject<IWalletLinkLogEntry[]>()
export const walletLinkLog: IStream<IWalletLinkLogEntry[]> = op(logSubject.stream, state([]))
let logSeq = 0

const logPart = (part: unknown): string => {
  if (typeof part === 'string') return part
  if (part instanceof Error) return part.message
  if (typeof part === 'bigint') return part.toString()
  try {
    return JSON.stringify(part, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) ?? String(part)
  } catch {
    return String(part)
  }
}

function wcLog(level: IWalletLinkLogLevel, ...parts: unknown[]): void {
  console[level]('[wc]', ...parts)
  logSeq += 1
  logEntries.unshift({ id: logSeq, time: Date.now(), level, text: parts.map(logPart).join(' ') })
  if (logEntries.length > LOG_LIMIT) logEntries.length = LOG_LIMIT
  logSubject.push([...logEntries])
}

const blocked = subject<number>()
export const blockedRequest: IStream<number> = blocked.stream
let blockedCount = 0
const notifyBlockedRequest = (): void => blocked.push((blockedCount += 1))

export interface IPendingCall {
  chainId: ChainId
  target: Address
  callData: Hex
  value: bigint
}

export type IPendingSign = {
  id: number
  topic: string
  name: string
  method: string
  payload: string
  restore: boolean
  call: IPendingCall | null
}

const pending = subject<IPendingSign | null>()
export const pendingSign: IStream<IPendingSign | null> = op(pending.stream, state(null))
const signResolvers = new Map<number, (approved: boolean) => void>()
let signSeq = 0
let pendingRequest: IPendingSign | null = null

export type ISignAlertPermission = NotificationPermission | 'unsupported' | 'insecure'

function readAlertPermission(): ISignAlertPermission {
  if (typeof Notification === 'undefined') return 'unsupported'
  if (typeof window !== 'undefined' && !window.isSecureContext) return 'insecure'
  return Notification.permission
}

const alertPermission = subject<ISignAlertPermission>()
export const signAlertPermission: IStream<ISignAlertPermission> = op(alertPermission.stream, state(readAlertPermission()))

if (typeof navigator !== 'undefined' && navigator.permissions !== undefined) {
  void navigator.permissions.query({ name: 'notifications' as PermissionName }).then(
    status => {
      const publish = (): void => {
        if (readAlertPermission() === 'insecure') return
        alertPermission.push(status.state === 'prompt' ? 'default' : status.state)
      }
      publish()
      status.addEventListener('change', publish)
    },
    () => {}
  )
}

export function enableSignAlerts(): void {
  const current = readAlertPermission()
  if (current === 'unsupported' || current === 'insecure') return
  if (current !== 'default') {
    alertPermission.push(current)
    return
  }
  void Notification.requestPermission().then(granted => alertPermission.push(granted))
}

function surfacePendingSign(request: IPendingSign): void {
  if (typeof document === 'undefined') return
  window.focus()
  void navigator.setAppBadge?.(1)
  if (document.hasFocus()) return
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  void navigator.serviceWorker.ready.then(registration =>
    registration.showNotification(`Approve in Puppet`, {
      body: `${request.name} requested ${request.method}`,
      tag: 'puppet-pending-sign',
      requireInteraction: true
    })
  )
}

function requestSignApproval(
  req: { topic: string; name: string; method: string; payload: string; restore: boolean; call: IPendingCall | null },
  expiresAt: number | undefined
): Promise<boolean> {
  signSeq += 1
  if (pendingRequest) resolveSignApproval(pendingRequest.id, false)
  const request: IPendingSign = { ...req, id: signSeq }
  pendingRequest = request
  pending.push(request)
  surfacePendingSign(request)
  if (expiresAt !== undefined && expiresAt * 1000 > Date.now()) {
    window.setTimeout(() => {
      if (!signResolvers.has(request.id)) return
      wcLog('warn', 'sign request expired unanswered', request.method)
      resolveSignApproval(request.id, false)
    }, expiresAt * 1000 - Date.now())
  }
  return new Promise<boolean>(resolve => signResolvers.set(request.id, resolve))
}

export function resolveSignApproval(id: number, approved: boolean): void {
  const resolve = signResolvers.get(id)
  if (resolve) {
    signResolvers.delete(id)
    resolve(approved)
  }
  if (pendingRequest?.id === id) {
    pendingRequest = null
    pending.push(null)
  }
  if (typeof navigator !== 'undefined') {
    void navigator.clearAppBadge?.()
    void navigator.serviceWorker.ready
      .then(registration => registration.getNotifications({ tag: 'puppet-pending-sign' }))
      .then(list => {
        for (const notification of list) notification.close()
      })
  }
}

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

const SIGN_METHODS = ['eth_sendTransaction', 'personal_sign', 'eth_signTypedData', 'eth_signTypedData_v4']
const EXECUTION_METHODS = ['eth_sign', ...SIGN_METHODS]

const PUPPET_DOMAIN_NAMES: ReadonlySet<string> = new Set([ACCOUNT_DOMAIN.name, CHAINLESS_DOMAIN.name])
const INTENT_PRIMARY_TYPES: ReadonlySet<string> = new Set(Object.values(INTENTS).map(spec => spec.primaryType))

type ITypedData = {
  domain: TypedDataDomain
  types: TypedData
  primaryType: string
  message: Record<string, unknown>
}

function assertForeignTypedData(typed: ITypedData): void {
  const domainName = typeof typed.domain.name === 'string' ? typed.domain.name : ''
  if (PUPPET_DOMAIN_NAMES.has(domainName) || INTENT_PRIMARY_TYPES.has(typed.primaryType)) {
    throw new Error(
      'This request asks your trading account to authorize a Puppet action while presenting itself as a dApp signature. Puppet will not sign it - disconnect this dApp.'
    )
  }
  const verifying = typed.domain.verifyingContract
  const own = activeAccount()
  if (typeof verifying === 'string' && own !== null && isAddressEqual(getAddress(verifying), own)) {
    throw new Error('This request targets your own Puppet account. Puppet will not sign it - disconnect this dApp.')
  }
}

function pendingCallOf(scope: string, params: unknown): IPendingCall | null {
  const chainId = Number(scope.split(':')[1])
  if (!(CHAIN_ID_LIST as readonly number[]).includes(chainId)) return null
  const [tx] = params as [{ to?: string; value?: string; data?: string } | undefined]
  if (tx?.to === undefined || !isAddress(tx.to)) return null
  return {
    chainId: chainId as ChainId,
    target: getAddress(tx.to),
    callData: (tx.data ?? '0x') as Hex,
    value: tx.value === undefined ? 0n : BigInt(tx.value)
  }
}

function describeSignRequest(method: string, params: unknown): string {
  if (method === 'eth_sendTransaction') {
    const [tx] = params as [{ to?: string; value?: string; data?: string }]
    const value = tx.value && tx.value !== '0x0' ? `\nvalue ${BigInt(tx.value).toString()}` : ''
    return `to ${tx.to ?? 'unknown'}${value}\ncalldata ${(tx.data ?? '0x').slice(0, 42)}…`
  }
  if (method === 'personal_sign') {
    const [data] = params as [Hex]
    try {
      return new TextDecoder().decode(Uint8Array.from((data.slice(2).match(/../g) ?? []).map(b => Number.parseInt(b, 16))))
    } catch {
      return data
    }
  }
  const [, raw] = params as [Address, string | ITypedData]
  const typed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as ITypedData
  return `${typed.primaryType} on ${typeof typed.domain.name === 'string' ? typed.domain.name : 'unknown domain'}`
}

const DAPP_ERROR_MESSAGE: Record<string, string> = {
  UNKNOWN_OPERATE: "Puppet doesn't recognize this as a supported trade, so your account can't sign it.",
  COLLATERAL_NOT_REGISTERED:
    "This position's collateral isn't a token your account supports yet. Pick a position collateralized in ETH, WETH, or USDC to withdraw from.",
  SENDTOKENS_NOT_BASE: "This trade's collateral token isn't supported by your account yet.",
  FOREIGN_TARGET: 'This action calls a contract outside the supported trading venues.',
  ROUTER_FN_FORBIDDEN: "This action uses a venue operation that isn't allowed.",
  BASE_FN_FORBIDDEN: "This action uses a token operation that isn't allowed.",
  RECEIVER_NOT_ACCOUNT: 'This trade would settle to another account, so it was blocked.',
  CANCEL_RECEIVER_NOT_ACCOUNT: 'This order would refund to another account, so it was blocked.',
  SENDTOKENS_BAD_RECEIVER: 'This trade would move funds outside your account, so it was blocked.',
  SENDWNT_BAD_RECEIVER: 'This trade would move ETH outside your account, so it was blocked.',
  NATIVE_VALUE_MISMATCH: "This trade's ETH amount doesn't match the order, so it was blocked.",
  NATIVE_VALUE_FORBIDDEN: 'This action attaches ETH where none is allowed, so it was blocked.',
  ORDER_TYPE_FORBIDDEN: 'Only opening and closing positions are supported.',
  UNKNOWN_MARKET: "This market isn't supported.",
  CALLBACK_FORBIDDEN: "This order sets a callback contract, which isn't allowed.",
  UI_FEE_FORBIDDEN: "This order's fee receiver isn't allowed.",
  SWAPPATH_TOO_LONG: 'This trade routes through too many markets.',
  SWAPPATH_UNKNOWN_MARKET: 'This trade routes through an unsupported market.',
  UNDECODABLE_ROUTER_CALL: "Puppet couldn't read this trade request.",
  SWAP_OUTPUT_NOT_REGISTERED: "The token this trade delivers isn't registered for your account on this chain. Pick a registered token to receive, such as ETH or USDC.",
  PNL_TOKEN_NOT_REGISTERED: "This position's profit would arrive in a token your account doesn't register on this chain. Close it into a registered token instead.",
  REFERRAL_CODE_FORBIDDEN: 'This order carries a foreign referral code; Puppet trades under its own code only.',
  CLAIM_BAD_RECEIVER: 'This claim would pay someone other than your account, so it was blocked.',
  VENUE_DEPOSIT_BAD_TOKEN: 'This venue only accepts USDC deposits.',
  VENUE_DEPOSIT_BELOW_MIN: 'This venue deposit is below the minimum the venue accepts and would be forfeited.',
  VENUE_DEPOSIT_BAD_DESTINATION: 'This deposit is not addressed to the venue, so it was blocked.',
  VENUE_DEPOSIT_BAD_RECIPIENT: 'This deposit would credit someone other than your account, so it was blocked.',
  VENUE_DEPOSIT_BAD_DEX: 'This deposit tacrgets a venue balance Puppet cannot value, so it was blocked.',
  VENUE_DEPOSIT_FEE: 'This deposit allows a larger bridge fee than the venue charges, so it was blocked.',
  DISTRIBUTE_PENDING: 'Your last trade or fund swap is still being valued on the hub; try again once it records.',
  CHRONICLE_BEHIND: 'The chronicle has not caught up with your last action yet; try again in a moment.'
}

function friendlyDappError(e: unknown): string {
  if (e instanceof CompactError) {
    return DAPP_ERROR_MESSAGE[e.code] ?? e.message
  }
  return formatThrownError(e)
}

async function verifyOwnSignature(topic: string, digest: Hex, signature: Hex): Promise<void> {
  const account = activeAccount()
  if (!account) return
  recordProbe(topic, await probeSignature(account, digest, signature))
  if (slot?.client) syncSessions(slot.client)
}

async function fundSignerForDapp(): Promise<IFundSigner> {
  const wallet = latest.wallet
  const fund = latestRoot === null ? null : latestRoot.fund
  if (wallet === null || latest.keys === null) throw new Error('Connect your wallet before connecting a dApp')
  if (fund === null) throw new Error('Open a fund before linking a dApp; a dApp trades through a fund, not through your wallet account')
  return latest.keys.restoreFund(wallet, fund)
}

function assertRequestedSigner(requested: Address | undefined): void {
  const active = activeAccount()
  if (requested === undefined || active === null) return
  if (!isAddressEqual(requested, active)) {
    throw new Error(`this request names ${requested} but this wallet's account is ${active}; reconnect the dApp to the account this wallet derives`)
  }
}

async function handleDappRequest(
  wallet: IConnectedWallet | null,
  method: string,
  params: unknown,
  chainId: number,
  topic?: string
): Promise<unknown> {
  if (method === 'eth_sendTransaction') {
    if (!wallet) throw new Error('Connect your wallet before connecting a dApp')
    if (passthrough === null) throw new Error('Trading through a linked dApp is not wired in this build.')
    const [tx] = params as [IDappTransaction]
    assertRequestedSigner(tx.from)
    const root = await latest.root
    if (root === null) throw new Error('Your account state is not loaded yet; open the app and try again.')
    return passthrough(latest, root, chainId, tx)
  }
  if (method === 'eth_accounts' || method === 'eth_requestAccounts') {
    const active = activeAccount()
    return active ? [active] : []
  }
  if (method === 'personal_sign') {
    const [data] = params as [Hex, Address]
    const signature = await (await fundSignerForDapp()).sign({ kind: 'message', message: data })
    if (topic) void verifyOwnSignature(topic, hashMessage({ raw: data }), signature)
    return signature
  }
  if (method === 'eth_signTypedData' || method === 'eth_signTypedData_v4') {
    const [, typedData] = params as [Address, TypedDataDefinition]
    const signature = await (await fundSignerForDapp()).sign({ kind: 'typedData', typedData })
    if (topic) void verifyOwnSignature(topic, hashTypedData(typedData), signature)
    return signature
  }
  if (method === 'eth_sign') {
    throw new Error('eth_sign is not supported. The dApp should request personal_sign.')
  }
  if (method === 'eth_chainId') return numberToHex(chainId)
  if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null
  const readClient = publicClientMap[chainId]
  if (!readClient) throw new Error(`Reads on chain ${chainId} are not supported.`)
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
    const persisted = readWc(key.slice(WC_STORAGE_PREFIX.length))
    if (Array.isArray(persisted) && persisted.length > 0) return true
  }
  return false
}

const walletWaiters = new Set<(wallet: IConnectedWallet) => void>()

function waitForWallet(timeoutMs = 3000): Promise<IConnectedWallet | null> {
  if (latest.wallet) return Promise.resolve(latest.wallet)
  return new Promise(resolve => {
    const settle = (wallet: IConnectedWallet): void => {
      walletWaiters.delete(settle)
      clearTimeout(timer)
      resolve(wallet)
    }
    walletWaiters.add(settle)
    const timer = setTimeout(() => {
      walletWaiters.delete(settle)
      resolve(latest.wallet)
    }, timeoutMs)
  })
}

export type IDappTransaction = { from?: Address; to?: string; value?: string; data?: string; gas?: string }
export type IPassthrough = (pair: IWalletPair, root: IRootState, chainId: number, tx: IDappTransaction) => Promise<Hex>
export type IPrepareDappTransaction = (chainId: number, account: Address, tx: IDappTransaction) => Promise<IDappTransaction>
let passthrough: IPassthrough | null = null
let prepareTransaction: IPrepareDappTransaction | null = null

let booted = false
export function initWalletLink(pair: IStream<IWalletPair>, sendTransaction: IPassthrough, prepare: IPrepareDappTransaction): void {
  if (booted) return
  booted = true
  passthrough = sendTransaction
  prepareTransaction = prepare
  drain(pair, p => {
    latest = p
    latestRoot = null
    if (p.wallet) for (const settle of [...walletWaiters]) settle(p.wallet)
    p.root
      .then(root => {
        if (latest !== p) return
        latestRoot = root
        if (slot.client) broadcastActiveAccount(activeAccount())
      })
      .catch((err: unknown) => wcLog('error', 'account state unavailable for linked dApps', err))
  })
  if (hasPersistedWalletLink()) void startWalletConnect().catch(e => wcLog('warn', 'restore failed', e))
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
    wcLog('info', 'SignClient init done, restored sessions:', client.session.getAll().length)
    syncSessions(client)
    client.core.relayer.once('relayer_connect', () => wcLog('info', 'relay connected'))
    registerHandlers(client)
    void probeSessions(client)
    slot.client = client
    void latest.root.then(
      () => broadcastActiveAccount(activeAccount()),
      () => {}
    )
    const pendingProposals = client.proposal.getAll().filter(p => p.expiryTimestamp * 1000 > Date.now())
    if (pendingProposals.length) {
      wcLog('info', 'replaying pending proposals:', pendingProposals.length)
      for (const proposal of pendingProposals) void approveProposal(client, proposal)
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
    const wallet = await waitForWallet()
    if (!wallet) {
      wcLog('warn', 'rejecting proposal: no connected wallet')
      await client.reject({ id: proposal.id, reason: getSdkError('USER_REJECTED') })
      return
    }
    const wanted = new Set<string>()
    const collectChains = (nsMap: Record<string, { chains?: string[] }>): void => {
      for (const [key, ns] of Object.entries(nsMap)) {
        if (key.startsWith('eip155:')) wanted.add(key)
        for (const chain of ns.chains ?? []) if (chain.startsWith('eip155:')) wanted.add(chain)
      }
    }
    collectChains(proposal.requiredNamespaces)
    collectChains(proposal.optionalNamespaces)
    const chains = wanted.size > 0 ? [...wanted] : [`eip155:${HUB_CHAIN_ID}`]
    let account: Address | null
    try {
      account = linkedAccount()
    } catch (err) {
      wcLog('warn', 'no fund is open for this wallet', err)
      account = null
    }
    if (!account) {
      wcLog('warn', 'rejecting proposal: no fund is open; open one first')
      notifyBlockedRequest()
      await client.reject({ id: proposal.id, reason: getSdkError('USER_REJECTED') })
      return
    }
    const meta = proposal.proposer?.metadata
    const approvedByUser = await requestSignApproval({
      call: null,
      topic: '',
      name: meta?.name || 'A dApp',
      method: 'wc_sessionProposal',
      payload: [meta?.url ?? 'unknown origin', `chains ${chains.join(', ')}`, `account ${account}`].join('\n'),
      restore: false
    }, proposal.expiryTimestamp)
    if (!approvedByUser) {
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
            accounts: chains.map(chain => `${chain}:${account}`)
          }
        }
      })
    } catch (e) {
      wcLog('warn', 'proposal not satisfiable', e)
    }
    if (!namespaces?.eip155?.accounts?.length) {
      wcLog('warn', 'no approvable namespaces for proposal', {
        required: proposal.requiredNamespaces,
        optional: proposal.optionalNamespaces
      })
      await client.reject({ id: proposal.id, reason: getSdkError('UNSUPPORTED_CHAINS') })
      return
    }
    await client.approve({ id: proposal.id, namespaces })
    syncSessions(client)
    wcLog('info', 'session approved as', account)
  } catch (e) {
    wcLog('error', 'session_proposal failed', e)
    await client.reject({ id: proposal.id, reason: getSdkError('USER_REJECTED') }).catch(() => {})
  } finally {
    approving.delete(proposal.id)
  }
}

function registerHandlers(client: ISignClient): void {
  client.on('session_proposal', ({ params }) => {
    wcLog('info', 'session_proposal', {
      required: params.requiredNamespaces,
      optional: params.optionalNamespaces
    })
    void approveProposal(client, params)
  })
  client.on('session_request', async ({ topic, id, params }) => {
    const method = params.request.method
    wcLog('info', 'session_request', method)
    if (reachability.get(topic) !== true) {
      reachability.set(topic, true)
      syncSessions(client)
    }
    try {
      const wallet = latest.wallet
      if (EXECUTION_METHODS.includes(method)) {
        if (latest.wallet === null) throw new Error('Connect your wallet in Puppet before acting from a linked dApp.')
        const root = await latest.root
        if (root === null || isAddressEqual(root.account, zeroAddress)) {
          notifyBlockedRequest()
          throw new Error('Create your trading account to act from a linked dApp.')
        }
      }
      let requestParams = params.request.params
      if (method === 'eth_sendTransaction' && prepareTransaction !== null) {
        const account = activeAccount()
        const [tx] = requestParams as [IDappTransaction]
        const scope = Number(params.chainId.split(':')[1])
        if (account !== null && (CHAIN_ID_LIST as readonly number[]).includes(scope)) {
          requestParams = [await prepareTransaction(scope, account, tx)] as typeof requestParams
        }
      }
      if (method === 'personal_sign' || method === 'eth_signTypedData' || method === 'eth_signTypedData_v4') {
        const signing = activeAccount()
        if (signing === null) throw new Error('Create your trading account to sign from a linked dApp.')
        if (method === 'personal_sign') {
          const [data, requested] = requestParams as [Hex, Address]
          assertRequestedSigner(requested)
          assertDappSignable(screenDappMessage(signing, data))
        } else {
          const [requested, raw] = requestParams as [Address, string | ITypedData]
          assertRequestedSigner(requested)
          const typed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as ITypedData
          assertForeignTypedData(typed)
          const { EIP712Domain: _domainType, ...types } = typed.types
          const typedData: TypedDataDefinition = { domain: typed.domain, types, primaryType: typed.primaryType, message: typed.message }
          assertDappSignable(screenDappTypedData(signing, typedData as unknown as IDappTypedData))
          requestParams = [requested, typedData] as typeof requestParams
        }
      }
      if (SIGN_METHODS.includes(method)) {
        const name = client.session.get(topic).peer.metadata.name || 'This dApp'
        let payload: string
        try {
          payload = describeSignRequest(method, requestParams)
        } catch {
          throw new Error('This signature request is malformed and will not be signed.')
        }
        const active = activeAccount()
        const restore = wallet !== null && active !== null && latest.keys !== null && latest.keys.fundSignerOf(wallet.address, active) === null
        const call = method === 'eth_sendTransaction' ? pendingCallOf(params.chainId, requestParams) : null
        const approved = await requestSignApproval({ topic, name, method, payload, restore, call }, params.request.expiryTimestamp)
        if (!approved) throw new Error('Request declined')
        if (method !== 'eth_sendTransaction') {
          recordSigned(topic, payload)
          syncSessions(client)
        }
      }
      const requestChainId = Number(params.chainId.split(':')[1])
      if (!Number.isInteger(requestChainId) || requestChainId <= 0) {
        throw new Error(`Unsupported request chain scope "${params.chainId}".`)
      }
      const result = await handleDappRequest(wallet, method, requestParams, requestChainId, topic)
      await client.respond({ topic, response: { id, jsonrpc: '2.0', result } })
    } catch (e) {
      wcLog('error', 'session_request failed', method, e)
      await client
        .respond({
          topic,
          response: { id, jsonrpc: '2.0', error: { code: 5000, message: friendlyDappError(e) } }
        })
        .catch(err => wcLog('warn', 'the dApp could not be answered; its request had already expired', err))
    }
  })
  client.on('session_delete', () => {
    wcLog('info', 'session_delete')
    syncSessions(client)
  })
  client.on('session_expire', () => {
    wcLog('info', 'session_expire')
    syncSessions(client)
  })
  client.on('session_ping', ({ topic }) => {
    reachability.set(topic, true)
    syncSessions(client)
  })
}

async function probeSessions(client: ISignClient): Promise<void> {
  await Promise.all(
    client.session.getAll().map(async session => {
      const alive = await Promise.race([
        client.ping({ topic: session.topic }).then(
          () => true,
          () => false
        ),
        new Promise<boolean>(resolve => setTimeout(() => resolve(false), PING_TIMEOUT_MS))
      ])
      reachability.set(session.topic, alive)
      wcLog('info', `${session.peer.metadata.name || session.topic.slice(0, 8)} ${alive ? 'answered the ping' : 'did not answer the ping'}`)
    })
  )
  syncSessions(client)
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

const wcStorage = {
  getKeys: async (): Promise<string[]> => wcKeys(),
  getEntries: async <T,>(): Promise<[string, T][]> => wcKeys().map(key => [key, readWc(key) as T]),
  getItem: async <T,>(key: string): Promise<T | undefined> => readWc(key) as T | undefined,
  setItem: async <T,>(key: string, value: T): Promise<void> => localStorage.setItem(wcKey(key), JSON.stringify(value)),
  removeItem: async (key: string): Promise<void> => localStorage.removeItem(wcKey(key))
}

function pruneDeadWcRecords(): void {
  try {
    const list = (name: string): IWcRecord[] => {
      const key = wcKeys().find(k => k.endsWith(`//${name}`))
      const value = key ? readWc(key) : undefined
      return Array.isArray(value) ? (value as IWcRecord[]) : []
    }
    const now = Date.now()
    const wcSessions = list('session')
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
    for (const s of wcSessions) if (liveSession(s) && s.topic) live.add(s.topic)
    for (const p of pairings) if (livePairing(p) && p.topic) live.add(p.topic)
    const deadKeychainKeys = new Set<string>()
    for (const s of wcSessions) {
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
    rewrite('messages_withoutClientAck', keepMap(() => false))
    rewrite('keychain', keepMap(key => !deadKeychainKeys.has(key)))
  } catch (e) {
    wcLog('warn', 'storage prune skipped', e)
  }
}


export type ISignProbe = 'valid' | 'rejected' | 'unknown'

async function probeSignature(account: Address, digest: Hex, signature: Hex): Promise<ISignProbe> {
  return isAddressEqual(await recoverAddress({ hash: digest, signature }), account) ? 'valid' : 'rejected'
}

const signLog = new Map<string, { last: string; count: number; repeats: number; probe: ISignProbe }>()

function recordSigned(topic: string, payload: string): void {
  const prev = signLog.get(topic)
  signLog.set(topic, {
    last: payload,
    count: (prev?.count ?? 0) + 1,
    repeats: prev && prev.last === payload ? prev.repeats + 1 : (prev?.repeats ?? 0),
    probe: prev?.probe ?? 'unknown'
  })
}

function recordProbe(topic: string, probe: ISignProbe): void {
  const prev = signLog.get(topic)
  if (!prev) return
  signLog.set(topic, { ...prev, probe })
}

function syncSessions(client: ISignClient): void {
  sessions.push(
    client.session.getAll().map(session => ({
      topic: session.topic,
      name: session.peer.metadata.name,
      url: session.peer.metadata.url,
      icon: session.peer.metadata.icons?.[0],
      account: session.namespaces.eip155?.accounts?.[0]?.split(':')[2] as Address | undefined,
      signRequests: signLog.get(session.topic)?.count ?? 0,
      repeatedSigns: signLog.get(session.topic)?.repeats ?? 0,
      probe: signLog.get(session.topic)?.probe ?? 'unknown',
      reachable: reachability.get(session.topic) ?? null
    }))
  )
}

const heldChainsByTopic = new Map<string, string[]>()
const UPDATE_ACK_WAIT_MS = 10_000

async function syncSessionAccounts(account: Address | null): Promise<boolean> {
  const client = slot.client
  if (!client) return false
  let synced = true
  for (const session of client.session.getAll()) {
    const ns = session.namespaces.eip155
    if (!ns) continue
    const current = ns.accounts ?? []
    const held = [...new Set(current.map(a => a.split(':').slice(0, 2).join(':')))]
    const chainIds = held.length > 0 ? held : (heldChainsByTopic.get(session.topic) ?? ns.chains ?? [])
    if (chainIds.length === 0) continue
    const target = account === null ? [] : chainIds.map(c => `${c}:${account}`)
    const same = target.length === current.length && target.every((a, i) => a.toLowerCase() === current[i]!.toLowerCase())
    if (!same) {
      if (account === null) heldChainsByTopic.set(session.topic, held)
      const acknowledged = await client
        .update({ topic: session.topic, namespaces: { ...session.namespaces, eip155: { ...ns, accounts: target } } })
        .then(
          r => r.acknowledged,
          e => {
            wcLog('warn', 'session update failed', e)
            return null
          }
        )
      if (acknowledged === null) {
        synced = false
        continue
      }
      await Promise.race([
        acknowledged().catch(e => wcLog('warn', 'session update not acknowledged', e)),
        new Promise<void>(resolve => window.setTimeout(resolve, UPDATE_ACK_WAIT_MS))
      ])
    }
    if (account === null) continue
    for (const chainId of chainIds) {
      await client
        .emit({ topic: session.topic, chainId, event: { name: 'accountsChanged', data: [account] } })
        .catch(e => wcLog('warn', 'accountsChanged emit failed', e))
    }
  }
  syncSessions(client)
  return synced
}

let lastBroadcastAccount: Address | null | undefined
function broadcastActiveAccount(account: Address | null): void {
  if (account === null) return
  if (lastBroadcastAccount !== undefined && lastBroadcastAccount !== null && isAddressEqual(account, lastBroadcastAccount)) return
  void syncSessionAccounts(account).then(
    synced => {
      if (synced) lastBroadcastAccount = account
    },
    e => wcLog('warn', 'session account sync failed', e)
  )
}

export async function pairDapp(uri: string): Promise<void> {
  if (!slot.client) throw new Error('WalletConnect not initialized')
  wcLog('info', 'pairing, awaiting proposal')
  try {
    await slot.client.pair({ uri })
  } catch (e) {
    const staleTopic = /^wc:([0-9a-f]+)@/i.exec(uri)?.[1]
    if (!staleTopic || !(e instanceof Error) || !e.message.includes('Pairing already exists')) throw e
    wcLog('info', 're-pairing over a stale pairing record, replacing it')
    await slot.client.core.pairing.disconnect({ topic: staleTopic }).catch(() => {})
    await slot.client.pair({ uri })
  }
}

async function pairFromUrl(): Promise<void> {
  const uri = wcUriFromLocation()
  if (!uri) return
  wcLog('info', 'pairing from deep-link')
  try {
    await startWalletConnect()
    await pairDapp(uri)
    window.history.replaceState(null, '', `${location.pathname}${location.hash}`)
  } catch (e) {
    wcLog('warn', 'deep-link pair failed; leaving URI in URL for retry', e)
  }
}

export async function disconnectDapp(topic: string): Promise<void> {
  if (!slot.client) return
  const pairingTopic = slot.client.session.getAll().find(s => s.topic === topic)?.pairingTopic
  try {
    await slot.client.disconnect({ topic, reason: getSdkError('USER_DISCONNECTED') })
  } catch (e) {
    wcLog('error', 'disconnect failed', e)
  }
  if (pairingTopic) await slot.client.core.pairing.disconnect({ topic: pairingTopic }).catch(() => {})
  syncSessions(slot.client)
}

async function teardownAllWc(): Promise<void> {
  if (!slot.client) return
  for (const s of slot.client.session.getAll()) {
    await slot.client.disconnect({ topic: s.topic, reason: getSdkError('USER_DISCONNECTED') }).catch(() => {})
  }
  syncSessions(slot.client)
}

export async function disconnect(): Promise<void> {
  await teardownAllWc().catch(() => {})
  const current = getConnection(wagmi)
  if (current.connector) await wagmiDisconnect(wagmi, { connector: current.connector })
}
