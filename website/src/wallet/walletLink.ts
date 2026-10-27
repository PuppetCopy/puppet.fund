import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { ACCOUNT_DOMAIN, CHAINLESS_DOMAIN, INTENTS } from '@puppet/contracts/intents'
import type {
  IConnectedWallet,
  IDappTransaction,
  IFundSigner,
  IPendingCall,
  IRootState,
  IWalletPair
} from '@puppet/sdk/client'
import { landedIntent } from '@puppet/sdk/client'
import { CompactError, formatThrownError } from '@puppet/sdk/compact'
import { CHAIN_ID_LIST, type ChainId, chainNameOf } from '@puppet/sdk/const'
import { readablePercentage, readableTokenAmount } from '@puppet/sdk/core'
import { DEFAULT_EVALUATION_CONFIG } from '@puppet/sdk/evaluate'
import {
  type IDappTypedData,
  type IVenue,
  screenDappMessage,
  screenDappTypedData,
  signDappTypedData,
  VENUES
} from '@puppet/sdk/venue'
import { SignClient } from '@walletconnect/sign-client'
import { buildApprovedNamespaces, getSdkError } from '@walletconnect/utils'
import { createBrowserScheduler, type IScheduler, type ISink, type IStream, propagateRunEventTask } from 'aelea/stream'
import { stream } from 'aelea/stream-extended'
import { href, pushUrl } from 'aelea/ui-router'
import { type Address, getAddress, type Hex, hashMessage, hashTypedData, hexToNumber, isAddressEqual, isHex, keccak256, numberToHex, recoverAddress, TransactionReceiptNotFoundError, type TypedData, type TypedDataDefinition, type TypedDataDomain, zeroAddress } from 'viem'
import { routeSchema } from '../app/routeSchema.js'
import { clientDeps } from '../io/clientDeps.js'
import { MINUS } from '../io/price.js'
import { installed } from '../utils/pwaInstall.js'
import { publicClientMap, WALLETCONNECT_PROJECT_ID } from './wallet.js'
import { adoptOutbound, provideSignClient, releaseOutbound } from './wcProvider.js'
import { isOutboundSession, readWc, WC_STORAGE_PREFIX, wcKeys, wcRecordsOf, wcStorage, writeWc } from './wcStorage.js'
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
  return latest.wallet === null || latestRoot === null || latestRoot.fund === null || 'unknown' in latestRoot.fund ? null : latestRoot.fund.account
}

export function linkedAccount(): Address {
  if (latest.wallet === null) throw new Error('Connect your wallet before linking a dApp')
  if (latestRoot !== null && latestRoot.fund !== null && 'unknown' in latestRoot.fund) throw new Error(latestRoot.fund.unknown)
  const account = activeAccount()
  if (account === null) {
    throw new Error('Open a fund before linking a dApp; a dApp trades through a fund, not through your wallet account')
  }
  return account
}

export type IVerifiedOrigin = { origin: string; validation: 'VALID' | 'INVALID' | 'UNKNOWN'; isScam: boolean }

type IVerifyContext = { verified: { origin: string; validation: string; isScam?: boolean } }

const verifiedOf = (context: IVerifyContext | undefined, claimed: string): IVerifiedOrigin =>
  context === undefined
    ? { origin: claimed, validation: 'UNKNOWN', isScam: false }
    : {
        origin: context.verified.origin,
        validation: context.verified.validation === 'VALID' ? 'VALID' : context.verified.validation === 'INVALID' ? 'INVALID' : 'UNKNOWN',
        isScam: context.verified.isScam === true
      }

export const prettyUrl = (url: string): string => url.replace(/^https?:\/\//, '').replace(/\/$/, '')

const VERIFIED_KEY = 'puppet/verifiedOrigin'
const PROPOSAL_VERDICT_KEY = 'puppet/proposalVerdict'

const readProposalVerdicts = (): Record<string, IVerifiedOrigin> => {
  const raw = localStorage.getItem(PROPOSAL_VERDICT_KEY)
  return raw === null ? {} : (JSON.parse(raw) as Record<string, IVerifiedOrigin>)
}

const readVerified = (): Record<string, string> => {
  const raw = localStorage.getItem(VERIFIED_KEY)
  if (raw === null) return {}
  try {
    return JSON.parse(raw) as Record<string, string>
  } catch {
    return {}
  }
}

const recordVerified = (topic: string, verified: IVerifiedOrigin): void => {
  if (verified.validation === 'UNKNOWN' && !verified.isScam) return
  const known = readVerified()
  if (verified.validation === 'VALID' && !verified.isScam) known[topic] = verified.origin
  else delete known[topic]
  localStorage.setItem(VERIFIED_KEY, JSON.stringify(known))
}

export type IWalletLinkSession = {
  topic: string
  name: string
  url: string
  verifiedOrigin: string | null
  acknowledged: boolean
  account?: Address
  signRequests: number
  repeatedSigns: number
  probe: ISignProbe
}

function held<T>(initial: T) {
  let current = initial
  const subscribers = new Set<{ sink: ISink<T>; scheduler: IScheduler }>()
  const emit = (time: number, sink: ISink<T>, value: T): void => sink.event(time, value)
  return {
    get: (): T => current,
    set: (next: T): void => {
      current = next
      for (const { sink, scheduler } of [...subscribers]) scheduler.asap(propagateRunEventTask(sink, emit, next))
    },
    stream: stream<T>((sink, scheduler) => {
      const entry = { sink, scheduler }
      subscribers.add(entry)
      const replay = scheduler.asap(propagateRunEventTask(sink, emit, current))
      return {
        [Symbol.dispose]: () => {
          subscribers.delete(entry)
          replay[Symbol.dispose]()
        }
      }
    })
  }
}

const sessions = held<IWalletLinkSession[]>([])
export const walletLinkSessions: IStream<IWalletLinkSession[]> = sessions.stream

export type IRelayState = 'connected' | 'connecting' | 'disconnected'
const relay = held<IRelayState | null>(null)
export const walletLinkRelay: IStream<IRelayState | null> = relay.stream

export type IWalletLinkLogLevel = 'info' | 'warn' | 'error'
export type IWalletLinkLogEntry = { id: number; time: number; level: IWalletLinkLogLevel; text: string }

const LOG_LIMIT = 60
const logEntries: IWalletLinkLogEntry[] = []
const log = held<IWalletLinkLogEntry[]>([])
export const walletLinkLog: IStream<IWalletLinkLogEntry[]> = log.stream
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

const wcTrace = (level: IWalletLinkLogLevel, ...parts: unknown[]): void => console[level]('[wc]', ...parts)

function wcLog(level: IWalletLinkLogLevel, ...parts: unknown[]): void {
  console[level]('[wc]', ...parts)
  logSeq += 1
  logEntries.unshift({ id: logSeq, time: Date.now(), level, text: parts.map(logPart).join(' ') })
  if (logEntries.length > LOG_LIMIT) logEntries.length = LOG_LIMIT
  log.set([...logEntries])
}

export type IPendingSign = {
  id: number
  request: number
  topic: string
  name: string
  url: string
  method: string
  verified: IVerifiedOrigin
  account: Address | null
  chains: { linked: readonly number[]; refused: readonly number[] } | null
  payload: string
  typed: ITypedData | null
  restore: boolean
  call: Promise<IPendingCall> | null
  expiresAt: number | null
  deferred: boolean
}

export type ISignOutcome = 'approved' | 'declined' | 'expired' | 'handedOff' | { ended: string }

export type IInflightIntent = { chainId: ChainId; header: { account: Address; user: Address; deadline: bigint }; digest: Hex }

const queue: IPendingSign[] = []
const queued = held<readonly IPendingSign[]>([])
export const signQueue: IStream<readonly IPendingSign[]> = queued.stream
const signResolvers = new Map<number, (outcome: ISignOutcome) => void>()
let signSeq = 0
const page = crypto.randomUUID()
const pendingTag = `puppet-pending-sign:${page}`
const ANSWERED_KEY = 'puppet//answered'
const INFLIGHT_KEY = 'puppet//inflight'

type IStoredInflight = { chainId: ChainId; account: Address; user: Address; deadline: string; digest: Hex }

const recordsOf = (store: string): [string, unknown][] => {
  const held = readWc(store)
  return Array.isArray(held) ? (held as [string, unknown][]) : []
}
const EXPIRED_TEXT = 'Expired. Ask the dApp again.'

const LINK_LOCK = 'puppet-walletconnect'
const HANDED_OFF_TEXT = 'The dApp link moved to the Puppet window in front.'
const LINK_EVENTS = ['session_proposal', 'session_request', 'session_delete', 'session_expire', 'session_event', 'session_update', 'proposal_expire', 'session_request_expire'] as const
export type IWalletLinkRoute = { walletRoot: boolean; promptHost: boolean }
let linkRole: 'owner' | 'waiting' | null = null
let linkGeneration = 0
let route: IWalletLinkRoute = { walletRoot: false, promptHost: false }
let claimQueued = false
let taking = false
const ownerWaiters = new Set<() => void>()

const inFront = (): boolean => document.visibilityState === 'visible' && document.hasFocus()

const claimInFront = (): void => {
  if (route.walletRoot && inFront() && linkRole === 'waiting') takeWalletLink()
}

const holdLink = (): Promise<never> => {
  taking = false
  linkRole = 'owner'
  for (const settle of [...ownerWaiters]) settle()
  ownerWaiters.clear()
  if (hasPersistedWalletLink()) void startWalletConnect().catch(e => wcLog('warn', 'restore failed', e))
  if (wcUriFromLocation()) void pairFromUrl()
  return new Promise<never>(() => {})
}

const loseLink = (err: unknown): void => {
  if (!(err instanceof DOMException) || err.name !== 'AbortError') throw err
  linkGeneration += 1
  linkRole = 'waiting'
  queueLinkClaim()
  for (const prompt of [...queue].reverse()) settleSign(prompt.id, 'handedOff')
  approving.clear()
  releaseOutbound()
  slot.stop?.()
  slot.client = null
  slot.initPromise = null
  slot.stop = null
  relay.set(null)
  mirrorStoredLink()
  wcLog('info', HANDED_OFF_TEXT)
}

const queueLinkClaim = (): void => {
  if (claimQueued) return
  claimQueued = true
  void navigator.locks
    .request(LINK_LOCK, () => {
      claimQueued = false
      return holdLink()
    })
    .catch(loseLink)
}

function takeWalletLink(): void {
  if (linkRole === 'owner' || taking) return
  taking = true
  void navigator.locks.request(LINK_LOCK, { steal: true }, holdLink).catch(loseLink)
}

function mirrorStoredLink(): void {
  if (linkRole !== 'owner') syncSessions(wcRecordsOf('session') as ISessionStruct[])
}

export function deferSigns(): void {
  queue.splice(0, queue.length, ...queue.map(prompt => ({ ...prompt, deferred: true })))
  queued.set([...queue])
}

if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', event => {
    const message: unknown = event.data
    if (typeof message !== 'object' || message === null || !('type' in message) || !('page' in message) || message.page !== page) return
    if (message.type !== 'sign-decision' && message.type !== 'sign-focus') return
    if (!('id' in message) || typeof message.id !== 'number') throw new Error('a notification message arrived without its request id')
    const id = message.id
    if (!queue.some(prompt => prompt.id === id)) return
    if (message.type === 'sign-focus' && !route.promptHost && installed()) pushUrl(href(routeSchema.wallet))
    event.ports[0]?.postMessage(route.promptHost || installed() ? 'held' : 'wallet')
    if (message.type === 'sign-focus') return
    if (!('approved' in message) || typeof message.approved !== 'boolean') throw new Error('a notification decision arrived without its answer')
    resolveSignApproval(id, message.approved)
  })
}

export type IRefusedSign = { id: number; topic: string; name: string; url: string; method: string; verified: IVerifiedOrigin; outcome: 'refused' | 'failed' | 'expired'; error: unknown }

const refusal = held<IRefusedSign | null>(null)
export const refusedSign: IStream<IRefusedSign | null> = refusal.stream
let refusalSeq = 0

function refuseSign(req: Omit<IRefusedSign, 'id'>): void {
  refusalSeq += 1
  refusal.set({ ...req, id: refusalSeq })
  if (typeof document === 'undefined' || (route.promptHost && inFront())) return
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const fund = latestRoot === null || latestRoot.fund === null || 'unknown' in latestRoot.fund ? null : latestRoot.fund.symbol
  const origin = req.verified.validation === 'VALID' ? prettyUrl(req.verified.origin) : `${prettyUrl(req.url)} · unverified`
  const title = `${req.name}: ${req.method === 'wc_sessionProposal' ? 'link' : SUBMIT_METHODS.includes(req.method) ? 'transaction' : 'signature'} ${req.outcome}`
  const options: NotificationOptions = { body: [friendlyDappError(req.error), [...(fund === null ? [] : [fund]), origin].join(' · ')].join('\n'), tag: `puppet-refused-sign:${page}` }
  void navigator.serviceWorker.getRegistration().then(async registration => {
    if (registration !== undefined && registration.active !== null) {
      await registration.showNotification(title, options)
      return
    }
    new Notification(title, options)
  })
}

export function dismissRefusal(id: number): void {
  if (refusal.get()?.id !== id) return
  refusal.set(null)
}

export type ISignAlertPermission = NotificationPermission | 'unsupported' | 'insecure'

function readAlertPermission(): ISignAlertPermission {
  if (typeof Notification === 'undefined') return 'unsupported'
  if (typeof window !== 'undefined' && !window.isSecureContext) return 'insecure'
  return Notification.permission
}

const alertPermission = held<ISignAlertPermission>(readAlertPermission())
export const signAlertPermission: IStream<ISignAlertPermission> = alertPermission.stream

if (typeof navigator !== 'undefined' && navigator.permissions !== undefined) {
  void navigator.permissions.query({ name: 'notifications' as PermissionName }).then(
    status => {
      const publish = (): void => {
        if (readAlertPermission() === 'insecure') return
        alertPermission.set(status.state === 'prompt' ? 'default' : status.state)
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
    alertPermission.set(current)
    return
  }
  void Notification.requestPermission().then(granted => alertPermission.set(granted))
}

let pageAlert: Notification | null = null

function surfacePendingSign(request: IPendingSign): void {
  if (typeof document === 'undefined') return
  window.focus()
  void navigator.setAppBadge?.(queue.length)
  if (route.promptHost && inFront()) return
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const fund = latestRoot === null || latestRoot.fund === null || 'unknown' in latestRoot.fund ? null : latestRoot.fund.symbol
  const origin = request.verified.validation === 'VALID' ? prettyUrl(request.verified.origin) : `${prettyUrl(request.url)} · unverified`
  const title = `${request.name} asks to ${request.method === 'wc_sessionProposal' ? 'link' : SUBMIT_METHODS.includes(request.method) ? 'send' : 'sign'}`
  const payloadLine = request.payload.split('\n')[0]!
  const trusted = request.verified.validation === 'VALID' && !request.verified.isScam
  const show = (detail: string | null, decide: boolean): void => {
    const plain: NotificationOptions = {
      body: [...(detail === null ? [] : [detail]), [...(fund === null ? [] : [fund]), origin].join(' · ')].join('\n'),
      tag: pendingTag,
      requireInteraction: true,
      data: { page, id: request.id }
    }
    const options: NotificationOptions & { actions: { action: string; title: string }[] } = {
      ...plain,
      actions: decide && trusted ? [{ action: 'decline', title: 'Decline' }, { action: 'approve', title: 'Approve' }] : []
    }
    void navigator.serviceWorker.getRegistration().then(async registration => {
      if (queue[0]?.id !== request.id) return
      if (registration !== undefined && registration.active !== null) {
        await registration.showNotification(title, options)
        return
      }
      pageAlert = new Notification(title, plain)
      pageAlert.onclick = () => window.focus()
    })
  }
  if (request.call === null) {
    show(request.method === 'wc_sessionProposal' ? null : payloadLine, true)
    return
  }
  show(payloadLine, false)
  request.call.then(
    call => {
      if (queue[0]?.id !== request.id) return
      const flows = [
        ...call.outs.map(flow => `${MINUS}${readableTokenAmount(flow.profile.decimals, flow.amount)} ${flow.profile.symbol}`),
        ...call.ins.map(flow => `${flow.exact ? '' : '≈ '}${readableTokenAmount(flow.profile.decimals, flow.amount)} ${flow.profile.symbol}`)
      ]
      show(flows.length === 0 ? payloadLine : flows.join(' · '), true)
    },
    (error: unknown) => {
      if (queue[0]?.id !== request.id) return
      show(`Could not be planned: ${friendlyDappError(error)}`, false)
    }
  )
}

function requestSignApproval(req: Omit<IPendingSign, 'id' | 'expiresAt' | 'deferred'>, expiresAt: number | undefined): Promise<{ id: number; outcome: ISignOutcome }> {
  signSeq += 1
  const request: IPendingSign = { ...req, id: signSeq, expiresAt: expiresAt === undefined ? null : expiresAt, deferred: false }
  queue.push(request)
  queued.set([...queue])
  if (queue[0] === request) surfacePendingSign(request)
  else void navigator.setAppBadge?.(queue.length)
  if (expiresAt !== undefined) {
    window.setTimeout(
      () => {
        if (!signResolvers.has(request.id)) return
        wcLog('warn', 'sign request expired unanswered', request.method)
        settleSign(request.id, 'expired')
      },
      Math.max(0, expiresAt * 1000 - Date.now())
    )
  }
  return new Promise<ISignOutcome>(resolve => signResolvers.set(request.id, resolve)).then(outcome => ({ id: request.id, outcome }))
}

function settleSign(id: number, outcome: ISignOutcome): void {
  const resolve = signResolvers.get(id)
  if (resolve !== undefined) {
    signResolvers.delete(id)
    resolve(outcome)
  }
  const at = queue.findIndex(prompt => prompt.id === id)
  if (at < 0) return
  queue.splice(at, 1)
  queued.set([...queue])
  if (at !== 0 || typeof navigator === 'undefined') return
  pageAlert?.close()
  pageAlert = null
  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker
      .getRegistration()
      .then(registration => (registration === undefined ? [] : registration.getNotifications({ tag: pendingTag })))
      .then(list => {
        for (const notification of list) notification.close()
      })
  }
  const next = queue[0]
  if (next === undefined) void navigator.clearAppBadge?.()
  else surfacePendingSign(next)
}

const endPromptsOf = (topic: string, outcome: ISignOutcome): void => {
  for (const prompt of queue.filter(each => each.topic === topic)) settleSign(prompt.id, outcome)
}

export function resolveSignApproval(id: number, approved: boolean): void {
  settleSign(id, approved ? 'approved' : 'declined')
}

export function venueOfUrl(url: string): IVenue | null {
  if (!URL.canParse(url)) return null
  const host = new URL(url).hostname
  return VENUES.find(venue => venue.dapp !== undefined && venue.dapp.hosts.some(dappHost => host === dappHost || host.endsWith(`.${dappHost}`))) ?? null
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
  'wallet_addEthereumChain',
  'wallet_getCapabilities',
  'wallet_sendCalls',
  'wallet_getCallsStatus'
]

const SIGN_METHODS = ['eth_sendTransaction', 'wallet_sendCalls', 'personal_sign', 'eth_signTypedData', 'eth_signTypedData_v4']
export const SUBMIT_METHODS = ['eth_sendTransaction', 'wallet_sendCalls']
const EXECUTION_METHODS = ['eth_sign', ...SIGN_METHODS]
const SIGNED_KEY = 'puppet//signed'
const signedKeyOf = (account: Address, message: Hex): string => `${getAddress(account)}:${keccak256(message)}`
const signedMessageOf = (account: Address, message: Hex): Hex | null => {
  const key = signedKeyOf(account, message)
  const found = recordsOf(SIGNED_KEY).find(([each]) => each === key)
  return found !== undefined && typeof found[1] === 'string' && isHex(found[1]) ? found[1] : null
}

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
      "This request tries to authorize a Puppet action as a dApp signature. Puppet won't sign it; disconnect this dApp."
    )
  }
  const verifying = typed.domain.verifyingContract
  const own = activeAccount()
  if (typeof verifying === 'string' && own !== null && isAddressEqual(getAddress(verifying), own)) {
    throw new Error('This request targets your own Puppet account. Puppet will not sign it - disconnect this dApp.')
  }
}

function dappCallsOf(method: string, params: unknown): IDappTransaction[] {
  if (method === 'eth_sendTransaction') return [(params as [IDappTransaction])[0]]
  return [...(params as [ISendCalls])[0].calls]
}

function describeSignRequest(method: string, params: unknown): string {
  if (SUBMIT_METHODS.includes(method)) {
    return dappCallsOf(method, params)
      .map(tx => `to ${tx.to ?? 'unknown'}${tx.value && tx.value !== '0x0' ? `\nvalue ${BigInt(tx.value).toString()}` : ''}\ncalldata ${(tx.data ?? '0x').slice(0, 42)}…`)
      .join('\n')
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

export const DAPP_ERROR_MESSAGE: Record<string, string> = {
  UNKNOWN_OPERATE: "Puppet doesn't recognize this as a supported trade, so your account can't sign it.",
  TRADE_UNDERPRICED: `Blocked: this trade can lose more than ${readablePercentage(DEFAULT_EVALUATION_CONFIG.swapMaxSlippageBps).replace(/\.0+%$/, '%')}. Set its slippage within that.`,
  COLLATERAL_NOT_REGISTERED:
    "Puppet can't price this collateral on this chain. Use ETH, WETH, USDC or USDT.",
  SENDTOKENS_NOT_BASE: "This trade sends a token Puppet's oracle does not price on this chain, so it was blocked.",
  FOREIGN_TARGET: 'This action calls a contract outside the supported trading venues.',
  ROUTER_FN_FORBIDDEN: "This action uses a venue operation that isn't allowed.",
  BASE_FN_FORBIDDEN: "This action uses a token operation that isn't allowed.",
  RECEIVER_NOT_ACCOUNT: 'This trade would settle to another account, so it was blocked.',
  CANCEL_RECEIVER_NOT_ACCOUNT: 'This order would refund to another account, so it was blocked.',
  SENDTOKENS_BAD_RECEIVER: 'This trade would move funds outside your account, so it was blocked.',
  SENDWNT_BAD_RECEIVER: 'This trade would move ETH outside your account, so it was blocked.',
  NATIVE_VALUE_MISMATCH: "This trade's ETH amount doesn't match the order, so it was blocked.",
  NATIVE_VALUE_FORBIDDEN: 'This action attaches ETH where none is allowed, so it was blocked.',
  ORDER_TYPE_FORBIDDEN: "This order type isn't supported; only position orders and swaps are.",
  UNKNOWN_MARKET: "This market isn't supported.",
  CALLBACK_FORBIDDEN: "This order sets a callback contract, which isn't allowed.",
  UI_FEE_FORBIDDEN: "This order's fee receiver isn't allowed.",
  SWAPPATH_TOO_LONG: 'This trade routes through too many markets.',
  SWAPPATH_UNKNOWN_MARKET: 'This trade routes through an unsupported market.',
  UNDECODABLE_ROUTER_CALL: "Puppet couldn't read this trade request.",
  SWAP_OUTPUT_NOT_REGISTERED: "Puppet can't price what this trade delivers on this chain. Receive ETH, WETH, USDC or USDT.",
  PNL_TOKEN_NOT_REGISTERED: "Puppet can't price this position's profit token on this chain, so closing it was blocked.",
  REFERRAL_CODE_FORBIDDEN: 'This order carries a foreign referral code; Puppet trades under its own code only.',
  CLAIM_BAD_RECEIVER: 'This claim would pay someone other than your account, so it was blocked.',
  VENUE_DEPOSIT_BAD_TOKEN: "This venue doesn't accept that token for deposits on this chain.",
  VENUE_DEPOSIT_BELOW_MIN: 'This venue deposit is below the minimum the venue accepts and would be forfeited.',
  VENUE_DEPOSIT_BAD_DESTINATION: 'This deposit is not addressed to the venue, so it was blocked.',
  VENUE_DEPOSIT_BAD_RECIPIENT: 'This deposit would credit someone other than your account, so it was blocked.',
  VENUE_DEPOSIT_BAD_DEX: 'This deposit targets a venue balance Puppet cannot value, so it was blocked.',
  VENUE_DEPOSIT_FEE: 'This deposit allows a larger fee than the venue charges, so it was blocked.',
  ASSET_NOT_PRICEABLE: "This would leave the fund holding something Puppet can't value, so it was blocked.",
  ORDER_BOOK_THIN: "Blocked: this market's order book is too thin to price the order. Try again later.",
  ORDER_PRICE_BOUND: "This order's price is too far from the market price, so it was blocked.",
  DAPP_EXIT_DESTINATION: 'This would send funds somewhere other than your fund, so it was blocked.',
  DAPP_DOMAIN_NOT_ADMITTED: "Puppet can't sign this request: it isn't an action of a venue Puppet supports.",
  DAPP_MESSAGE_NOT_ADMITTED: 'Not signed: Puppet only signs a Sign-In with Ethereum message naming your fund.',
  CHRONICLE_BEHIND: 'The chronicle has not caught up with your last action yet; try again in a moment.',
  COMMAND_NOT_ADMITTED: "This swap uses a router command Puppet doesn't screen, so it was blocked.",
  AMOUNT_UNBOUNDED: 'This swap pulls an amount from your fund that nothing in the request bounds, so it was blocked.',
  MIN_OUT_ZERO: 'This swap sets no minimum output, so it was blocked.',
  PERMIT_SPENDER_NOT_ROUTER: "This swap permits a spender other than the venue's router, so it was blocked.",
  PERMIT2_FN_FORBIDDEN: 'This swap asks Permit2 for more than a router allowance, so it was blocked.',
  RECIPIENT_NOT_ACCOUNT: 'This swap would deliver to another address, so it was blocked.',
  FEE_RECIPIENT_NOT_PINNED: "This swap pays a fee to an address that isn't the venue's own, so it was blocked.",
  ROUTER_BALANCE_STRANDED: 'This swap would leave tokens at the router where anyone could take them, so it was blocked.',
  TRANSFER_UNRECORDED: 'This order sends tokens to the venue that no order in the same request uses, so it was blocked.',
  DATALIST_FORBIDDEN: 'This order carries follow-up actions, which your fund never needs, so it was blocked.'
}

class DappRpcError extends Error {
  readonly code: number
  constructor(code: number, message: string) {
    super(message)
    this.code = code
  }
}

export function friendlyDappError(e: unknown): string {
  if (e instanceof CompactError) {
    const copy = DAPP_ERROR_MESSAGE[e.code]
    if (copy !== undefined) return copy
    const reason = e.detail.split('; ')[0]!.replace(/^[A-Z0-9_]+: /, '')
    return `${reason.charAt(0).toUpperCase()}${reason.slice(1)}`
  }
  return formatThrownError(e)
}

async function verifyOwnSignature(topic: string, digest: Hex, signature: Hex): Promise<void> {
  const account = activeAccount()
  if (!account) return
  recordProbe(topic, await probeSignature(account, digest, signature))
  if (slot.client) syncSessions(slot.client.session.getAll())
}

async function fundSignerForDapp(signing: Address | null): Promise<IFundSigner> {
  const wallet = latest.wallet
  const root = await latest.root
  if (wallet === null || latest.keys === null) throw new Error('Connect your wallet before connecting a dApp')
  if (root === null || root.fund === null) throw new Error('Open a fund before linking a dApp; a dApp trades through a fund, not through your wallet account')
  if ('unknown' in root.fund) throw new Error(root.fund.unknown)
  if (signing === null || !isAddressEqual(root.fund.account, signing)) throw new Error('Your fund changed while this request waited. Ask the dApp again.')
  return latest.keys.restoreFund(wallet, root.fund)
}

function assertRequestedSigner(requested: Address | undefined): void {
  const active = activeAccount()
  if (requested === undefined || active === null) return
  if (!isAddressEqual(requested, active)) {
    throw new Error(`this request names ${requested} but this wallet's account is ${active}; reconnect the dApp to the account this wallet derives`)
  }
}

function assertSubmittable(method: string, params: unknown, chainId: number): void {
  if (!(CHAIN_ID_LIST as readonly number[]).includes(chainId)) throw new Error(`Chain ${chainId} is not supported for trading from a Puppet account.`)
  if (method === 'eth_sendTransaction') {
    assertRequestedSigner((params as [IDappTransaction])[0].from)
    return
  }
  const [batch] = params as [ISendCalls]
  assertRequestedSigner(batch.from)
  if (Number(batch.chainId) !== chainId) throw new Error(`The batch names chain ${Number(batch.chainId)} but was sent on chain ${chainId}.`)
  const unsupported = [batch.capabilities ?? {}, ...batch.calls.map(call => call.capabilities ?? {})].flatMap(capabilities =>
    Object.entries(capabilities).filter(([, capability]) => capability.optional !== true).map(([name]) => name)
  )
  if (unsupported.length > 0) throw new Error(`This wallet does not support the ${unsupported.join(', ')} capability.`)
}

async function handleDappRequest(
  wallet: IConnectedWallet | null,
  signing: Address | null,
  method: string,
  params: unknown,
  chainId: number,
  pending: IPendingCall | null,
  inflight: (intent: IInflightIntent) => void,
  lateFailure: (error: unknown) => void,
  topic?: string
): Promise<unknown> {
  if (method === 'eth_sendTransaction' || method === 'wallet_sendCalls') {
    if (!wallet) throw new Error('Connect your wallet before connecting a dApp')
    if (passthrough === null || pending === null) throw new Error('Trading through a linked dApp is not wired in this build.')
    const root = await latest.root
    if (root === null) throw new Error('Your account state is not loaded yet; open the app and try again.')
    const run = passthrough(latest, root, pending, inflight)
    const txHash = await run.acked
    void run.settled.then(() => undefined, lateFailure)
    return method === 'eth_sendTransaction' ? txHash : { id: txHash, capabilities: { caip345: { caip2: `eip155:${chainId}`, transactionHashes: [txHash] } } }
  }
  if (method === 'wallet_getCallsStatus') {
    const [id] = params as [Hex]
    const readClient = publicClientMap[chainId]
    if (!readClient) throw new Error(`Reads on chain ${chainId} are not supported.`)
    const receipt = await readClient.getTransactionReceipt({ hash: id }).catch((err: unknown) => {
      if (err instanceof TransactionReceiptNotFoundError) return null
      throw err
    })
    const base = { version: '2.0.0', id, chainId: numberToHex(chainId), atomic: true }
    if (receipt === null) return { ...base, status: 100 }
    return {
      ...base,
      status: receipt.status === 'success' ? 200 : 500,
      receipts: [
        {
          logs: receipt.logs.map(log => ({ address: log.address, data: log.data, topics: log.topics })),
          status: receipt.status === 'success' ? '0x1' : '0x0',
          blockHash: receipt.blockHash,
          blockNumber: numberToHex(receipt.blockNumber),
          gasUsed: numberToHex(receipt.gasUsed),
          transactionHash: receipt.transactionHash
        }
      ]
    }
  }
  if (method === 'eth_accounts') {
    const active = activeAccount()
    return active ? [active] : []
  }
  if (method === 'personal_sign') {
    const [data] = params as [Hex, Address]
    const signer = await fundSignerForDapp(signing)
    const known = signedMessageOf(signer.account, data)
    const signature = known ?? (await signer.sign({ kind: 'message', message: data }))
    if (topic) void verifyOwnSignature(topic, hashMessage({ raw: data }), signature)
    if (known === null) {
      const key = signedKeyOf(signer.account, data)
      writeWc(SIGNED_KEY, [...recordsOf(SIGNED_KEY).filter(([each]) => each !== key), [key, signature]])
    }
    return signature
  }
  if (method === 'eth_signTypedData' || method === 'eth_signTypedData_v4') {
    const [, typedData] = params as [Address, TypedDataDefinition]
    const signer = await fundSignerForDapp(signing)
    const { signature, presignFailures } = await signDappTypedData(signer, typedData)
    for (const failure of presignFailures) wcLog('warn', 'A step the venue runs before this signature failed:', friendlyDappError(failure))
    if (topic) void verifyOwnSignature(topic, hashTypedData(typedData), signature)
    return signature
  }
  if (method === 'eth_sign') {
    throw new Error('eth_sign is not supported. The dApp should request personal_sign.')
  }
  if (method === 'eth_chainId') return numberToHex(chainId)
  if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') {
    const [{ chainId: target }] = params as [{ chainId: Hex }]
    const client = slot.client
    if (client === null || topic === undefined) throw new Error('No live session answers this chain switch.')
    const targetId = hexToNumber(target)
    const held = [...new Set((client.session.get(topic).namespaces.eip155?.accounts ?? []).map(account => Number(account.split(':')[1])))]
    if (!held.includes(targetId)) {
      throw new DappRpcError(
        method === 'wallet_switchEthereumChain' ? 4902 : 4100,
        `This link does not cover ${chainNameOf(targetId) ?? `chain ${targetId}`}; it covers ${held.map(id => chainNameOf(id) ?? `chain ${id}`).join(', ')}.`
      )
    }
    await client.emit({ topic, event: { name: 'chainChanged', data: target }, chainId: `eip155:${targetId}` })
    return null
  }
  if (method === 'wallet_getCapabilities') {
    const [requested, asked] = params as [Address, Hex[] | undefined]
    assertRequestedSigner(requested)
    const client = slot.client
    if (client === null || topic === undefined) throw new Error('No live session answers this capabilities request.')
    const held = [...new Set((client.session.get(topic).namespaces.eip155?.accounts ?? []).map(account => Number(account.split(':')[1])))]
    return Object.fromEntries(
      held
        .filter(id => (CHAIN_ID_LIST as readonly number[]).includes(id) && (asked === undefined || asked.some(hex => hexToNumber(hex) === id)))
        .map(id => [numberToHex(id), { atomic: { status: 'supported' }, alternateGasFees: { supported: true } }])
    )
  }
  throw new Error(`${method} is not a method a linked fund answers.`)
}

type ISignClient = Awaited<ReturnType<typeof SignClient.init>>
type IProposalStruct = ReturnType<ISignClient['proposal']['getAll']>[number]
type ISessionStruct = ReturnType<ISignClient['session']['getAll']>[number]
type IWcSlot = { client: ISignClient | null; initPromise: Promise<ISignClient> | null; stop: (() => void) | null }

const WC_SLOT = Symbol.for('puppet.walletconnect.signclient')
const registry = globalThis as unknown as Record<symbol, IWcSlot | undefined>
const slot: IWcSlot = registry[WC_SLOT] ?? (registry[WC_SLOT] = { client: null, initPromise: null, stop: null })

const hasPersistedWalletLink = (): boolean =>
  wcRecordsOf('session').length > 0 || (wcRecordsOf('proposal') as IProposalStruct[]).some(proposal => proposal.expiryTimestamp * 1000 > Date.now())

const rootWaiters = new Set<(root: IRootState) => void>()

function waitForRoot(until: number): Promise<IRootState | null> {
  if (latestRoot !== null) return Promise.resolve(latestRoot)
  return new Promise(resolve => {
    const settle = (root: IRootState): void => {
      rootWaiters.delete(settle)
      clearTimeout(timer)
      resolve(root)
    }
    rootWaiters.add(settle)
    const timer = setTimeout(
      () => {
        rootWaiters.delete(settle)
        resolve(latestRoot)
      },
      Math.max(0, until - Date.now())
    )
  })
}

type ISendCalls = {
  version: string
  from?: Address
  chainId: Hex
  atomicRequired: boolean
  calls: readonly (IDappTransaction & { capabilities?: Record<string, { optional?: boolean }> })[]
  capabilities?: Record<string, { optional?: boolean }>
}
export type IPlanDapp = (pair: IWalletPair, root: IRootState, chainId: number, txList: readonly IDappTransaction[]) => Promise<IPendingCall>
export type IPassthrough = (pair: IWalletPair, root: IRootState, call: IPendingCall, inflight: (intent: IInflightIntent) => void) => { acked: Promise<Hex>; settled: Promise<Hex> }
let passthrough: IPassthrough | null = null
let planOperate: IPlanDapp | null = null

let booted = false
export function initWalletLink(pair: IStream<IWalletPair>, sendTransaction: IPassthrough, plan: IPlanDapp, walletRoute: IStream<IWalletLinkRoute>): void {
  if (booted) return
  booted = true
  passthrough = sendTransaction
  planOperate = plan
  drain(pair, p => {
    const before = latest.wallet === null ? null : latest.wallet.address
    if (before !== null && (p.wallet === null || !isAddressEqual(before, p.wallet.address))) {
      for (const prompt of queue.filter(each => each.account !== null).reverse()) settleSign(prompt.id, { ended: 'Your wallet changed while this request waited. Ask the dApp again.' })
    }
    latest = p
    latestRoot = null
    p.root
      .then(root => {
        if (latest !== p) return
        latestRoot = root
        if (root !== null) for (const settle of [...rootWaiters]) settle(root)
        const account = activeAccount()
        for (const prompt of queue.filter(each => each.account !== null && (account === null || !isAddressEqual(each.account, account)))) {
          settleSign(prompt.id, { ended: 'Your fund changed while this request waited. Ask the dApp again.' })
        }
        if (slot.client) broadcastActiveAccount(account)
      })
      .catch((err: unknown) => wcLog('error', 'account state unavailable for linked dApps', err))
  })
  window.addEventListener('storage', event => {
    if (event.key !== null && event.key.startsWith(WC_STORAGE_PREFIX) && event.key.endsWith('//session')) mirrorStoredLink()
  })
  void navigator.locks
    .request(LINK_LOCK, { ifAvailable: true }, lock => {
      if (lock !== null) return holdLink()
      linkRole = 'waiting'
      queueLinkClaim()
      mirrorStoredLink()
      if ((route.walletRoot && inFront()) || wcUriFromLocation()) takeWalletLink()
      return undefined
    })
    .catch(loseLink)
  window.addEventListener('focus', claimInFront)
  document.addEventListener('visibilitychange', claimInFront)
  drain(walletRoute, next => {
    route = next
    claimInFront()
  })
}

provideSignClient({ start: startWalletConnect, running: () => slot.client })

export async function startWalletConnect(): Promise<ISignClient> {
  if (slot.client) return slot.client
  if (slot.initPromise) return slot.initPromise
  if (linkRole !== 'owner') {
    await new Promise<void>(resolve => {
      ownerWaiters.add(resolve)
      takeWalletLink()
    })
    return startWalletConnect()
  }
  const gen = linkGeneration
  const init = (async () => {
    pruneDeadWcRecords()
    const walletConnectGlobals = globalThis as unknown as Record<string, unknown>
    delete walletConnectGlobals._walletConnectCore_
    delete walletConnectGlobals._walletConnectCore__count
    const client = await SignClient.init({
      projectId: WALLETCONNECT_PROJECT_ID,
      telemetryEnabled: false,
      storage: {
        ...wcStorage,
        setItem: async (key: string, value: unknown) => {
          if (gen === linkGeneration) await wcStorage.setItem(key, value)
        },
        removeItem: async (key: string) => {
          if (gen === linkGeneration) await wcStorage.removeItem(key)
        }
      },
      metadata: { ...__WC_METADATA__, url: window.location.origin }
    })
    const relayer = client.core.relayer
    if (gen !== linkGeneration) {
      client.core.heartbeat.stop()
      void relayer.transportClose().catch((err: unknown) => wcTrace('warn', 'a handed-off relay did not close', err))
      throw new Error(HANDED_OFF_TEXT)
    }
    wcTrace('info', 'SignClient init done, restored sessions:', client.session.getAll().length)
    syncSessions(client.session.getAll())
    relay.set(relayer.connected ? 'connected' : relayer.connecting ? 'connecting' : 'disconnected')
    const onConnect = (): void => {
      relay.set('connected')
      broadcastActiveAccount(activeAccount())
    }
    const onDisconnect = (): void => relay.set('disconnected')
    relayer.on('relayer_connect', onConnect)
    relayer.on('relayer_disconnect', onDisconnect)
    const revive = (): void => {
      if (relayer.connected || relayer.connecting) return
      relay.set('connecting')
      void relayer.restartTransport().catch((err: unknown) => {
        relay.set('disconnected')
        wcLog('warn', 'the WalletConnect relay did not reconnect; Puppet tries again when the tab is in front or the network returns', err)
      })
    }
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') revive()
    }
    window.addEventListener('online', revive)
    document.addEventListener('visibilitychange', onVisible)
    registerHandlers(client, gen)
    slot.client = client
    slot.stop = () => {
      relayer.off('relayer_connect', onConnect)
      relayer.off('relayer_disconnect', onDisconnect)
      window.removeEventListener('online', revive)
      document.removeEventListener('visibilitychange', onVisible)
      for (const name of LINK_EVENTS) client.events.removeAllListeners(name)
      client.core.heartbeat.stop()
      void relayer.transportClose().catch((err: unknown) => wcTrace('warn', 'a handed-off relay did not close', err))
    }
    adoptOutbound(client)
    void latest.root.then(
      () => broadcastActiveAccount(activeAccount()),
      () => {}
    )
    const pendingProposals = client.proposal.getAll().filter(p => p.expiryTimestamp * 1000 > Date.now() && !client.core.crypto.keychain.has(p.proposer.publicKey))
    if (pendingProposals.length) {
      wcTrace('info', 'replaying pending proposals:', pendingProposals.length)
      const verdicts = readProposalVerdicts()
      for (const proposal of pendingProposals) {
        const kept = verdicts[String(proposal.id)]
        void approveProposal(client, proposal, kept === undefined ? verifiedOf(undefined, proposal.proposer?.metadata?.url ?? '') : kept, gen)
      }
    }
    return client
  })()
  slot.initPromise = init
  init.catch(() => {
    if (slot.initPromise === init) slot.initPromise = null
  })
  return init
}

const approving = new Set<number>()

async function approveProposal(client: ISignClient, proposal: IProposalStruct, verified: IVerifiedOrigin, gen: number): Promise<void> {
  if (approving.has(proposal.id)) return
  approving.add(proposal.id)
  const meta = proposal.proposer?.metadata
  const card = { topic: `proposal:${proposal.id}`, name: meta?.name || 'A dApp', url: meta?.url || 'unknown origin', method: 'wc_sessionProposal', verified }
  const reject = async (reason: string, code: 'USER_REJECTED' | 'UNSUPPORTED_CHAINS'): Promise<void> => {
    wcLog('warn', `${card.name} link refused:`, reason)
    refuseSign({ ...card, outcome: 'refused', error: new Error(reason) })
    await client.reject({ id: proposal.id, reason: getSdkError(code) }).catch(err => wcLog('warn', 'the dApp could not be told; its link request had already ended', err))
  }
  try {
    const root = await waitForRoot(proposal.expiryTimestamp * 1000)
    if (gen !== linkGeneration) return
    if (root === null) {
      refuseSign({ ...card, outcome: 'expired', error: new Error('No wallet was connected in Puppet before this link request expired. Connect your wallet, then link again.') })
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
    let account: Address
    try {
      account = linkedAccount()
    } catch (err) {
      await reject(err instanceof Error ? err.message : String(err), 'USER_REJECTED')
      return
    }
    const venue = meta?.url === undefined ? null : venueOfUrl(meta.url)
    const chainIdOf = (chain: string): number => Number(chain.slice('eip155:'.length))
    const approvedChains = venue === null ? chains : chains.filter(chain => venue.dapp?.chains.includes(chainIdOf(chain)) === true)
    if (venue !== null && approvedChains.length === 0) {
      await reject(`${venue.name} asked only for chains it does not trade on: ${chains.map(chain => chainNameOf(chainIdOf(chain)) ?? chain).join(', ')}.`, 'UNSUPPORTED_CHAINS')
      return
    }
    const methods =
      venue !== null && venue.typedData === undefined
        ? SUPPORTED_METHODS.filter(method => method !== 'eth_signTypedData' && method !== 'eth_signTypedData_v4')
        : SUPPORTED_METHODS
    const linked = approvedChains.map(chainIdOf)
    const decision = await requestSignApproval(
      {
        ...card,
        request: proposal.id,
        call: null,
        account,
        chains: { linked, refused: chains.map(chainIdOf).filter(id => !linked.includes(id)) },
        payload: [meta?.url ?? 'unknown origin', `chains ${chains.join(', ')}`, `account ${account}`].join('\n'),
        typed: null,
        restore: false
      },
      proposal.expiryTimestamp
    )
    if (decision.outcome === 'handedOff') return
    if (decision.outcome === 'expired') {
      refuseSign({ ...card, outcome: 'expired', error: new Error(EXPIRED_TEXT) })
      return
    }
    if (decision.outcome === 'declined') {
      await client.reject({ id: proposal.id, reason: getSdkError('USER_REJECTED') }).catch(err => wcLog('warn', 'the dApp could not be told; its link request had already ended', err))
      return
    }
    if (decision.outcome !== 'approved') {
      await reject(decision.outcome.ended, 'USER_REJECTED')
      return
    }
    let namespaces: ReturnType<typeof buildApprovedNamespaces> | null = null
    try {
      namespaces = buildApprovedNamespaces({
        proposal,
        supportedNamespaces: {
          eip155: {
            chains: approvedChains,
            methods,
            events: ['accountsChanged', 'chainChanged'],
            accounts: approvedChains.map(chain => `${chain}:${account}`)
          }
        }
      })
    } catch (e) {
      wcLog('warn', 'proposal not satisfiable', e)
    }
    if (!namespaces?.eip155?.accounts?.length) {
      await reject(`${card.name} requires methods or chains Puppet does not offer, so the link cannot be made.`, 'UNSUPPORTED_CHAINS')
      return
    }
    const { topic } = await client.approve({ id: proposal.id, namespaces })
    recordVerified(topic, verified)
    syncSessions(client.session.getAll())
    wcLog('info', `${card.name} linked`)
    const approvedAt = Date.now()
    const settle = window.setInterval(() => {
      const session = client.session.getAll().find(next => next.topic === topic)
      if (gen !== linkGeneration || session === undefined || session.acknowledged) {
        window.clearInterval(settle)
        if (gen === linkGeneration) syncSessions(client.session.getAll())
        return
      }
      if (Date.now() - approvedAt < SETTLE_WAIT_MS) return
      window.clearInterval(settle)
      wcLog('error', `${card.name} did not confirm the link within ${SETTLE_WAIT_MS / 1000} s`)
      refuseSign({ ...card, outcome: 'failed', error: new Error(`${card.name} did not confirm the link. Link it again from the dApp.`) })
      syncSessions(client.session.getAll())
    }, SETTLE_POLL_MS)
  } catch (e) {
    if (gen !== linkGeneration) return
    wcLog('error', `${card.name} link failed`, e)
    refuseSign({ ...card, outcome: 'failed', error: e })
    await client.reject({ id: proposal.id, reason: getSdkError('USER_REJECTED') }).catch(err => wcLog('error', 'could not decline the proposal', err))
  } finally {
    approving.delete(proposal.id)
    if (gen === linkGeneration) {
      const kept = readProposalVerdicts()
      delete kept[String(proposal.id)]
      localStorage.setItem(PROPOSAL_VERDICT_KEY, JSON.stringify(kept))
    }
  }
}

function registerHandlers(client: ISignClient, gen: number): void {
  client.on('session_proposal', ({ params, verifyContext }) => {
    wcLog('info', `${params.proposer.metadata.name || 'A dApp'} asks to link`)
    const verified = verifiedOf(verifyContext, params.proposer.metadata.url)
    localStorage.setItem(PROPOSAL_VERDICT_KEY, JSON.stringify({ ...readProposalVerdicts(), [String(params.id)]: verified }))
    void approveProposal(client, params, verified, gen)
  })
  client.on('session_request', async ({ topic, id, params, verifyContext }) => {
    const peer = client.session.get(topic).peer.metadata
    const name = peer.name || 'This dApp'
    const verified = verifiedOf(verifyContext, peer.url)
    if (verifyContext !== undefined) recordVerified(topic, verified)
    const method = params.request.method
    wcLog('info', `${name} asks for ${method}`)
    const requestKey = `${topic}:${id}`
    const respond = (response: Parameters<ISignClient['respond']>[0]['response']): Promise<void> =>
      gen === linkGeneration ? client.respond({ topic, response }).catch(err => wcLog('warn', 'the dApp could not be answered; its request had already expired', err)) : Promise.resolve()
    const replay = recordsOf(ANSWERED_KEY).find(([key]) => key === requestKey)
    if (replay !== undefined) {
      wcLog('info', `${name}: ${method} answered from its record`)
      await respond({ id, jsonrpc: '2.0', result: replay[1] })
      return
    }
    const forgetInflight = (): void => {
      const held = recordsOf(INFLIGHT_KEY)
      if (held.some(([key]) => key === requestKey)) writeWc(INFLIGHT_KEY, held.filter(([key]) => key !== requestKey))
    }
    const sent = recordsOf(INFLIGHT_KEY).find(([key]) => key === requestKey)
    if (sent !== undefined) {
      wcLog('info', `${name}: ${method} was already sent, answering from the chain`)
      const record = sent[1] as IStoredInflight
      let landed: Awaited<ReturnType<typeof landedIntent>>
      try {
        landed = await landedIntent(clientDeps, record.chainId, { account: record.account, user: record.user, deadline: BigInt(record.deadline) }, record.digest)
      } catch (err) {
        wcLog('error', 'could not tell whether the replayed request landed', err)
        refuseSign({ topic, name, url: peer.url || 'unknown origin', method, verified, outcome: 'failed', error: new Error(`Puppet could not tell whether this request landed (${friendlyDappError(err)}). Check the fund's history before asking the dApp again.`) })
        await respond({ id, jsonrpc: '2.0', error: { code: 5000, message: 'Could not confirm whether this request landed; check your fund before sending it again.' } })
        return
      }
      forgetInflight()
      if (landed === null) {
        refuseSign({ topic, name, url: peer.url || 'unknown origin', method, verified, outcome: 'failed', error: new Error('This request never landed, and nothing moved. Ask the dApp to send it again.') })
        await respond({ id, jsonrpc: '2.0', error: { code: 5000, message: 'Nothing moved: this request never landed. Send it again.' } })
        return
      }
      const landedResult = method === 'eth_sendTransaction' ? landed.txHash : { id: landed.txHash, capabilities: { caip345: { caip2: `eip155:${landed.chainId}`, transactionHashes: [landed.txHash] } } }
      writeWc(ANSWERED_KEY, [...recordsOf(ANSWERED_KEY).filter(([key]) => key !== requestKey), [requestKey, landedResult]].slice(-50))
      await respond({ id, jsonrpc: '2.0', result: landedResult })
      return
    }
    let approved: boolean | null = null
    let expired = false
    let result: unknown
    try {
      const wallet = latest.wallet
      if (EXECUTION_METHODS.includes(method)) {
        if (latest.wallet === null) throw new Error('Connect your wallet in Puppet before acting from a linked dApp.')
        const root = await latest.root
        if (root === null || isAddressEqual(root.account, zeroAddress)) throw new Error('Create your fund to act from a linked dApp; the dApp trades through the fund.')
      }
      let requestParams = params.request.params
      let planned: Promise<IPendingCall> | null = null
      let signing: Address | null = null
      if (SUBMIT_METHODS.includes(method)) {
        if (planOperate === null) throw new Error('Trading through a linked dApp is not wired in this build.')
        const scope = Number(params.chainId.split(':')[1])
        assertSubmittable(method, requestParams, scope)
        const root = await latest.root
        if (root === null) throw new Error('Your account state is not loaded yet; open the app and try again.')
        planned = planOperate(latest, root, scope, dappCallsOf(method, requestParams))
      }
      if (method === 'personal_sign' || method === 'eth_signTypedData' || method === 'eth_signTypedData_v4') {
        if (latest.wallet === null) throw new Error('Connect your wallet in Puppet before signing from a linked dApp.')
        const root = await latest.root
        if (root === null) throw new Error('Your account state is not loaded yet; open Puppet and try again.')
        if (root.fund === null) throw new Error('Open a fund before signing from a linked dApp; a dApp signs for a fund, not for your wallet account.')
        if ('unknown' in root.fund) throw new Error(root.fund.unknown)
        signing = root.fund.account
        if (method === 'personal_sign') {
          const [data, requested] = requestParams as [Hex, Address]
          assertRequestedSigner(requested)
          const refused = screenDappMessage(signing, data)
          if (refused[0] !== undefined) throw new CompactError(refused[0].code, refused.map(reason => `${reason.code}: ${reason.detail}`).join('; '))
        } else {
          const [requested, raw] = requestParams as [Address, string | ITypedData]
          assertRequestedSigner(requested)
          const typed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as ITypedData
          assertForeignTypedData(typed)
          const { EIP712Domain: _domainType, ...types } = typed.types
          const account = signing
          const sent: IDappTypedData = { domain: typed.domain, types, primaryType: typed.primaryType, message: typed.message }
          const now = BigInt(Math.floor(Date.now() / 1000))
          const signedMessage = (message: Hex): Hex | null => signedMessageOf(account, message)
          const readable = (await Promise.all(VENUES.map(venue => venue.readableTypedData?.(publicClientMap, account, now, signedMessage, sent) ?? null))).find(each => each !== null)
          const typedData = readable ?? sent
          const refused = screenDappTypedData(signing, typedData)
          if (refused[0] !== undefined) throw new CompactError(refused[0].code, refused.map(reason => `${reason.code}: ${reason.detail}`).join('; '))
          requestParams = [requested, typedData] as typeof requestParams
        }
      }
      if (SIGN_METHODS.includes(method)) {
        let payload: string
        let typed: ITypedData | null
        try {
          payload = describeSignRequest(method, requestParams)
          const [, raw] = requestParams as [Address, string | ITypedData]
          typed = method === 'eth_signTypedData' || method === 'eth_signTypedData_v4' ? ((typeof raw === 'string' ? JSON.parse(raw) : raw) as ITypedData) : null
        } catch {
          throw new Error('This signature request is malformed and will not be signed.')
        }
        const active = activeAccount()
        const restore = wallet !== null && active !== null && latest.keys !== null && latest.keys.fundSignerOf(wallet.address, active) === null
        if (gen !== linkGeneration) return
        const decision = await requestSignApproval(
          { request: id, topic, name, url: peer.url || 'unknown origin', method, verified, account: active, chains: null, payload, typed, restore, call: planned },
          params.request.expiryTimestamp
        )
        if (decision.outcome === 'handedOff') return
        if (decision.outcome === 'declined') {
          approved = false
          throw new Error('Request declined')
        }
        if (decision.outcome === 'expired') {
          expired = true
          throw new Error(EXPIRED_TEXT)
        }
        if (decision.outcome !== 'approved') throw new Error(decision.outcome.ended)
        approved = true
        if (!SUBMIT_METHODS.includes(method)) {
          recordSigned(topic, payload)
          syncSessions(client.session.getAll())
        }
      }
      const requestChainId = Number(params.chainId.split(':')[1])
      if (!Number.isInteger(requestChainId) || requestChainId <= 0) {
        throw new Error(`Unsupported request chain scope "${params.chainId}".`)
      }
      const expiry = params.request.expiryTimestamp
      if (method === 'eth_accounts' && latestRoot === null && expiry !== undefined) await waitForRoot(expiry * 1000)
      result = await handleDappRequest(
        wallet,
        signing,
        method,
        requestParams,
        requestChainId,
        planned === null ? null : await planned,
        intent => {
          if (gen !== linkGeneration) throw new Error(HANDED_OFF_TEXT)
          writeWc(
            INFLIGHT_KEY,
            [
              ...recordsOf(INFLIGHT_KEY).filter(([key]) => key !== requestKey),
              [requestKey, { chainId: intent.chainId, account: intent.header.account, user: intent.header.user, deadline: intent.header.deadline.toString(), digest: intent.digest } satisfies IStoredInflight]
            ].slice(-50)
          )
        },
        error => refuseSign({ topic, name, url: peer.url || 'unknown origin', method, verified, outcome: 'failed', error }),
        topic
      )
    } catch (e) {
      if (gen !== linkGeneration) return
      wcLog('error', `${name}: ${method} failed:`, e)
      forgetInflight()
      if (approved !== false && EXECUTION_METHODS.includes(method)) refuseSign({ topic, name, url: peer.url || 'unknown origin', method, verified, outcome: expired ? 'expired' : approved === true ? 'failed' : 'refused', error: e })
      await respond({ id, jsonrpc: '2.0', error: { code: e instanceof DappRpcError ? e.code : 5000, message: friendlyDappError(e) } })
      return
    }
    if (SIGN_METHODS.includes(method)) writeWc(ANSWERED_KEY, [...recordsOf(ANSWERED_KEY).filter(([key]) => key !== requestKey), [requestKey, result]].slice(-50))
    forgetInflight()
    await respond({ id, jsonrpc: '2.0', result })
  })
  client.on('session_delete', ({ topic }) => {
    wcLog('info', 'A dApp ended its link')
    endPromptsOf(topic, { ended: 'The dApp ended the link while this request waited.' })
    syncSessions(client.session.getAll())
  })
  client.on('session_expire', ({ topic }) => {
    wcLog('info', 'A dApp link expired')
    endPromptsOf(topic, { ended: 'The link expired while this request waited. Link the dApp again.' })
    syncSessions(client.session.getAll())
  })
  client.on('proposal_expire', ({ id }) => {
    wcLog('info', 'A link request expired')
    endPromptsOf(`proposal:${id}`, 'expired')
  })
  client.on('session_request_expire', ({ id }) => {
    wcLog('info', 'A dApp request expired')
    for (const prompt of queue.filter(each => each.request === id && !each.topic.startsWith('proposal:'))) settleSign(prompt.id, 'expired')
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

function pruneDeadWcRecords(): void {
  try {
    const now = Date.now()
    const wcSessions = wcRecordsOf('session') as IWcRecord[]
    const pairings = wcRecordsOf('pairing') as IWcRecord[]
    const proposalPairingTopics = new Set(
      (wcRecordsOf('proposal') as IWcRecord[])
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
      if (JSON.stringify(value) !== JSON.stringify(prev)) writeWc(key, value)
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
    wcTrace('warn', 'storage prune skipped', e)
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

function syncSessions(list: readonly ISessionStruct[]): void {
  const live = list.filter(session => !isOutboundSession(session))
  const known = readVerified()
  const kept = Object.fromEntries(Object.entries(known).filter(([topic]) => live.some(session => session.topic === topic)))
  if (Object.keys(kept).length !== Object.keys(known).length) localStorage.setItem(VERIFIED_KEY, JSON.stringify(kept))
  sessions.set(
    live.map(session => ({
      topic: session.topic,
      name: session.peer.metadata.name,
      url: session.peer.metadata.url,
      verifiedOrigin: kept[session.topic] ?? null,
      acknowledged: session.acknowledged,
      account: session.namespaces.eip155?.accounts?.[0]?.split(':')[2] as Address | undefined,
      signRequests: signLog.get(session.topic)?.count ?? 0,
      repeatedSigns: signLog.get(session.topic)?.repeats ?? 0,
      probe: signLog.get(session.topic)?.probe ?? 'unknown'
    }))
  )
}

const UPDATE_ACK_WAIT_MS = 10_000
const SETTLE_WAIT_MS = 60_000
const SETTLE_POLL_MS = 500

async function syncSessionAccounts(account: Address): Promise<boolean> {
  const client = slot.client
  if (!client) return false
  let synced = true
  for (const session of client.session.getAll()) {
    if (isOutboundSession(session)) continue
    const ns = session.namespaces.eip155
    if (!ns) continue
    const current = ns.accounts ?? []
    const held = [...new Set(current.map(a => a.split(':').slice(0, 2).join(':')))]
    const chainIds = held.length > 0 ? held : (ns.chains ?? [])
    if (chainIds.length === 0) continue
    const target = chainIds.map(c => `${c}:${account}`)
    const same = target.length === current.length && target.every((a, i) => a.toLowerCase() === current[i]!.toLowerCase())
    if (!same) {
      const acknowledged = await client
        .update({ topic: session.topic, namespaces: { ...session.namespaces, eip155: { ...ns, accounts: target } } })
        .then(
          r => r.acknowledged,
          e => {
            wcLog('error', `${session.peer.metadata.name} could not be moved to the new fund; Puppet retries when the relay reconnects`, e)
            return null
          }
        )
      if (acknowledged === null) {
        synced = false
        continue
      }
      await Promise.race([
        acknowledged().catch(e => wcLog('warn', `${session.peer.metadata.name} did not confirm the fund change`, e)),
        new Promise<void>(resolve => window.setTimeout(resolve, UPDATE_ACK_WAIT_MS))
      ])
    }
    for (const chainId of chainIds) {
      await client
        .emit({ topic: session.topic, chainId, event: { name: 'accountsChanged', data: [account] } })
        .catch(e => wcTrace('warn', 'accountsChanged emit failed', e))
    }
  }
  syncSessions(client.session.getAll())
  return synced
}

let lastBroadcastAccount: Address | undefined
function broadcastActiveAccount(account: Address | null): void {
  if (account === null) return
  if (lastBroadcastAccount !== undefined && isAddressEqual(account, lastBroadcastAccount)) return
  void syncSessionAccounts(account).then(
    synced => {
      if (synced) lastBroadcastAccount = account
    },
    e => wcTrace('warn', 'session account sync failed', e)
  )
}

export async function pairDapp(uri: string): Promise<void> {
  if (!slot.client) throw new Error('WalletConnect not initialized')
  wcLog('info', 'Pairing, waiting for the dApp')
  try {
    await slot.client.pair({ uri })
  } catch (e) {
    const staleTopic = /^wc:([0-9a-f]+)@/i.exec(uri)?.[1]
    if (!staleTopic || !(e instanceof Error) || !e.message.includes('Pairing already exists')) throw e
    wcTrace('info', 're-pairing over a stale pairing record, replacing it')
    await slot.client.core.pairing.disconnect({ topic: staleTopic }).catch(err => wcLog('error', 'could not clear the stale pairing', err))
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
  endPromptsOf(topic, 'declined')
  let client: ISignClient
  try {
    client = await startWalletConnect()
  } catch (err) {
    wcLog('error', 'Could not end the dApp link: WalletConnect did not start. Try again online.', err)
    return
  }
  const session = client.session.getAll().find(s => s.topic === topic)
  try {
    if (session !== undefined) {
      await client.disconnect({ topic, reason: getSdkError('USER_DISCONNECTED') })
      if (client.core.pairing.getPairings().some(pairing => pairing.topic === session.pairingTopic)) {
        await client.core.pairing.disconnect({ topic: session.pairingTopic })
      }
    }
  } catch (err) {
    wcLog('error', `Could not end the link with ${session === undefined ? 'the dApp' : session.peer.metadata.name}; it stays linked until the relay is reachable. Try again online.`, err)
  } finally {
    syncSessions(client.session.getAll())
  }
}

export async function endDappLinks(): Promise<void> {
  if (!(wcRecordsOf('session') as ISessionStruct[]).some(session => !isOutboundSession(session))) return
  let client: ISignClient
  try {
    client = await startWalletConnect()
  } catch (err) {
    wcLog('error', 'dApp links not ended: WalletConnect did not start. End them from the link panel once online.', err)
    return
  }
  for (const s of client.session.getAll().filter(session => !isOutboundSession(session))) {
    endPromptsOf(s.topic, 'declined')
    try {
      await client.disconnect({ topic: s.topic, reason: getSdkError('USER_DISCONNECTED') })
    } catch (error) {
      wcLog('error', 'dApp link not ended:', s.topic, error)
    }
  }
  syncSessions(client.session.getAll())
}

