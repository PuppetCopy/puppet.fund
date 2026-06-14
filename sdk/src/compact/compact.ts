import { type Address, getAddress, type Hex, isAddress } from 'viem'
import { predictFundAccount, predictPuppetAccount } from '../account/index.js'
import type { IActionKind, IInputByKind, IIntentByKind } from '../attestation/index.js'
import { CompactError } from './error.js'
import { decode, encode } from './frame.js'

export const DISPATCH_TIMEOUT_MS = 5_000
export const SETTLEMENT_TIMEOUT_MS = 30_000
const RECONNECT_MIN_MS = 1_000
const RECONNECT_MAX_MS = 15_000

export type IRelayRequest<K extends IActionKind = IActionKind> = K extends IActionKind
  ? {
      kind: K
      input: IInputByKind[K]
      intent: IIntentByKind[K]
      signature: Hex
    }
  : never

export interface IDispatchedFrame {
  chainId: bigint
  account: Address
  nonce: bigint
  txHash: Hex
  actualRelayFee: bigint
}

// Broadcast by the matchmaker (on connect + heartbeat), never per-request: the relay's
// own indexed head per network. This is THE anchor for intent blockNumbers — an intent
// anchored to the live RPC head is ahead of the relay's view and silently rejected.
export interface IHeadFrame {
  kind: 'head'
  blocks: Record<string, bigint>
}

const FUND_ROUTED_KINDS: ReadonlySet<IActionKind> = new Set([
  'operate',
  'allocate',
  'redeem',
  'liquidate',
  'createFundAccount'
])

function accountForRequest(request: IRelayRequest): Address {
  const params = (request.input as { params: Parameters<typeof predictPuppetAccount>[0] }).params
  const account = predictPuppetAccount(params)
  return FUND_ROUTED_KINDS.has(request.kind) ? predictFundAccount(account) : account
}

export type IMatchmakerStatus = 'open' | 'connecting' | 'closed'

export interface ICompactOpts {
  matchmakerUrl: string
  defaultTimeoutMs?: number
}

// A pure relay client: attest() resolves at the relay's dispatch ACK. Settlement is the
// caller's concern — the ack carries (account, chainId, nonce), exactly the key
// awaitAccountCall / awaitAccountDeployed (@puppet/sdk/state) take.
export interface ICompact {
  attest(request: IRelayRequest, timeoutMs?: number): Promise<IDispatchedFrame>
  // Invokes cb immediately with the current status, then on every transition; returns
  // an unsubscribe. Stream consumers wrap it (aelea: fromCallback(cb => onStatus(cb))).
  onStatus(cb: (status: IMatchmakerStatus) => void): () => void
  // Synchronous connection check for callers that want to gate a trade without
  // subscribing to status transitions (e.g. an operator tick loop). True only while the
  // socket is OPEN; false during connecting/backoff/closed.
  isOpen(): boolean
  head(network: string): bigint | undefined
  awaitHead(network: string, timeoutMs?: number): Promise<bigint>
  close(): void
}

type Pending = {
  resolve: (result: IDispatchedFrame) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
  request: IRelayRequest
}

const keyOf = (account: Address, chainId: bigint, nonce: bigint): string =>
  `${getAddress(account).toLowerCase()}:${chainId}:${nonce}`

export function createCompact(opts: ICompactOpts): ICompact {
  const { matchmakerUrl, defaultTimeoutMs = DISPATCH_TIMEOUT_MS } = opts

  let currentStatus: IMatchmakerStatus = 'closed'
  const statusListeners = new Set<(status: IMatchmakerStatus) => void>()
  const pushStatus = (next: IMatchmakerStatus): void => {
    if (next === currentStatus) return
    currentStatus = next
    for (const cb of statusListeners) cb(next)
  }

  const pending = new Map<string, Pending>()
  const outbox: IRelayRequest[] = []
  let heads: Record<string, bigint> = {}
  const headWaiters = new Set<() => void>()

  let ws: WebSocket | null = null
  let disposed = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectDelay = RECONNECT_MIN_MS

  // A dropped connection abandons in-flight requests (their dispatch ack will never
  // arrive on the dead socket); callers re-submit once the connection is back. The
  // socket itself reconnects with backoff, so `status` recovers to 'open' on its own.
  const abandon = (err: Error): void => {
    for (const slot of pending.values()) {
      clearTimeout(slot.timer)
      slot.reject(err)
    }
    pending.clear()
    outbox.length = 0
  }
  const resolvePending = (key: string, result: IDispatchedFrame): void => {
    const slot = pending.get(key)
    if (!slot) return
    clearTimeout(slot.timer)
    pending.delete(key)
    slot.resolve(result)
  }

  const drain = (): void => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    while (outbox.length > 0) {
      const req = outbox.shift()!
      try {
        ws.send(encode(req))
      } catch {
        outbox.unshift(req)
        return
      }
    }
  }

  const scheduleReconnect = (): void => {
    if (disposed || reconnectTimer !== null) return
    // The socket auto-reconnects with backoff, so signal a transient 'connecting'
    // state rather than leaving status at 'closed' (which reads as a permanent outage).
    pushStatus('connecting')
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS)
      connect()
    }, reconnectDelay)
  }

  function connect(): void {
    if (disposed) return
    const socket = new WebSocket(matchmakerUrl)
    ws = socket
    pushStatus('connecting')

    socket.addEventListener(
      'open',
      () => {
        reconnectDelay = RECONNECT_MIN_MS
        pushStatus('open')
        drain()
      },
      { once: true }
    )

    const onDown = (): void => {
      if (ws !== socket) return
      abandon(new Error('matchmaker connection lost'))
      // scheduleReconnect() pushes 'connecting' so a transient drop self-heals as a
      // 'reconnecting' state instead of flashing a permanent-looking 'closed'.
      if (disposed) pushStatus('closed')
      else scheduleReconnect()
    }
    socket.addEventListener('error', onDown, { once: true })
    socket.addEventListener('close', onDown, { once: true })

    socket.addEventListener('message', e => {
      const raw = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data as ArrayBuffer)
      const frame = decode(raw) as IDispatchedFrame | IHeadFrame | null
      if (!frame || typeof frame !== 'object') return
      if ('kind' in frame && frame.kind === 'head') {
        heads = { ...heads, ...frame.blocks }
        const waiters = Array.from(headWaiters)
        headWaiters.clear()
        for (const wake of waiters) wake()
        return
      }
      if (!('txHash' in frame) || !isAddress(frame.account, { strict: false })) return
      const key = keyOf(frame.account, frame.chainId, frame.nonce)
      resolvePending(key, frame)
    })
  }

  connect()

  return {
    onStatus(cb: (status: IMatchmakerStatus) => void): () => void {
      statusListeners.add(cb)
      cb(currentStatus)
      return () => {
        statusListeners.delete(cb)
      }
    },
    isOpen(): boolean {
      return ws?.readyState === WebSocket.OPEN
    },
    head(network: string): bigint | undefined {
      return heads[network]
    },
    awaitHead(network: string, timeoutMs = DISPATCH_TIMEOUT_MS): Promise<bigint> {
      const known = heads[network]
      if (known !== undefined) return Promise.resolve(known)
      return new Promise<bigint>((resolve, reject) => {
        const timer = setTimeout(() => {
          headWaiters.delete(wake)
          reject(
            new Error(
              `relay announced no indexed head for ${network} within ${timeoutMs}ms; not connected, or the relay predates head broadcasting`
            )
          )
        }, timeoutMs)
        const wake = (): void => {
          const block = heads[network]
          if (block === undefined) {
            headWaiters.add(wake)
            return
          }
          clearTimeout(timer)
          resolve(block)
        }
        headWaiters.add(wake)
      })
    },
    attest(request: IRelayRequest, timeoutMs = defaultTimeoutMs): Promise<IDispatchedFrame> {
      const account = accountForRequest(request)
      const intent = request.intent as IIntentByKind[IActionKind] & { chainId: bigint; nonce: bigint }
      const key = keyOf(account, intent.chainId, intent.nonce)

      return new Promise<IDispatchedFrame>((resolve, reject) => {
        if (disposed) {
          reject(new Error('compact closed'))
          return
        }
        const timer = setTimeout(() => {
          pending.delete(key)
          const idx = outbox.indexOf(request)
          if (idx !== -1) outbox.splice(idx, 1)
          reject(
            new CompactError(
              'DISPATCH_TIMEOUT',
              `${request.kind} was not acknowledged in ${timeoutMs}ms: no agreement on the intent, or a busy relay. It can still dispatch until its deadline passes; wait it out, then retry on fresh state.`,
              'server'
            )
          )
        }, timeoutMs)
        pending.set(key, { resolve, reject, timer, request })
        outbox.push(request)
        drain()
      })
    },

    close(): void {
      disposed = true
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      abandon(new Error('compact closed'))
      ws?.close()
    }
  }
}
