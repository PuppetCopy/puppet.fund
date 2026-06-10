import type { IStream } from 'aelea/stream'
import { state } from 'aelea/stream-extended'
import { type Address, getAddress, type Hex } from 'viem'
import { predictFundAccount, predictPuppetAccount } from '../account/index.js'
import type { IActionKind, IInputByKind, IIntentByKind } from '../attestation/index.js'
import { createAdapter } from '../core/stream/stream.js'
import { awaitAccountCall, awaitAccountDeployed } from '../state/dispatch.js'
import type { IIndexerClient as IndexerClient } from '../state/shared.js'
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

export interface IAttestResult {
  txHash: Hex
  actualRelayFee: bigint
}

export interface IDispatchedFrame {
  chainId: bigint
  account: Address
  nonce: bigint
  txHash: Hex
  actualRelayFee: bigint
}

const FUND_ROUTED_KINDS: ReadonlySet<IActionKind> = new Set(['operate', 'allocate', 'fulfill', 'createFundAccount'])

function accountForRequest(request: IRelayRequest): Address {
  const params = (request.input as { params: Parameters<typeof predictPuppetAccount>[0] }).params
  const account = predictPuppetAccount(params)
  return FUND_ROUTED_KINDS.has(request.kind) ? predictFundAccount(account) : account
}

export type IMatchmakerStatus = 'open' | 'connecting' | 'closed'

export interface ICompactOpts {
  matchmakerUrl: string
  sql: IndexerClient
  defaultTimeoutMs?: number
  settlementTimeoutMs?: number
}

export interface ICompact {
  attest(request: IRelayRequest, timeoutMs?: number): Promise<IAttestResult>
  status: IStream<IMatchmakerStatus>
  // Synchronous connection check for callers that want to gate a trade without
  // consuming the `status` stream (e.g. an operator tick loop). True only while the
  // socket is OPEN; false during connecting/backoff/closed.
  isOpen(): boolean
  close(): void
}

type Pending = {
  resolve: (result: IAttestResult) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
  request: IRelayRequest
}

const keyOf = (account: Address, chainId: bigint, nonce: bigint): string =>
  `${getAddress(account).toLowerCase()}:${chainId}:${nonce}`

export function createCompact(opts: ICompactOpts): ICompact {
  const {
    matchmakerUrl,
    sql,
    defaultTimeoutMs = DISPATCH_TIMEOUT_MS,
    settlementTimeoutMs = SETTLEMENT_TIMEOUT_MS
  } = opts

  const [pushStatus, statusStream] = createAdapter<IMatchmakerStatus>()
  const status: IStream<IMatchmakerStatus> = state('closed', statusStream)

  const pending = new Map<string, Pending>()
  const outbox: IRelayRequest[] = []

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
  const resolvePending = (key: string, result: IAttestResult): void => {
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
      const frame = decode(raw) as IDispatchedFrame | null
      if (!frame || typeof frame !== 'object') return
      resolvePending(keyOf(frame.account, frame.chainId, frame.nonce), {
        txHash: frame.txHash,
        actualRelayFee: frame.actualRelayFee
      })
    })
  }

  connect()

  return {
    status,
    isOpen(): boolean {
      return ws?.readyState === WebSocket.OPEN
    },
    async attest(request: IRelayRequest, timeoutMs = defaultTimeoutMs): Promise<IAttestResult> {
      const account = accountForRequest(request)
      const intent = request.intent as IIntentByKind[IActionKind] & { chainId: bigint; nonce: bigint }
      const key = keyOf(account, intent.chainId, intent.nonce)

      const ack = await new Promise<IAttestResult>((resolve, reject) => {
        if (disposed) {
          reject(new Error('compact closed'))
          return
        }
        const timer = setTimeout(() => {
          pending.delete(key)
          const idx = outbox.indexOf(request)
          if (idx !== -1) outbox.splice(idx, 1)
          console.error(`attest(${request.kind} nonce=${intent.nonce}) ack timed out after ${timeoutMs}ms`)
          reject(new Error(`The relay did not confirm the ${request.kind} action in time. Try again.`))
        }, timeoutMs)
        pending.set(key, { resolve, reject, timer, request })
        outbox.push(request)
        drain()
      })

      const chainId = Number(intent.chainId)
      if (request.kind === 'createPuppetAccount' || request.kind === 'createFundAccount') {
        await awaitAccountDeployed(sql, account, chainId, settlementTimeoutMs)
      } else {
        await awaitAccountCall(sql, account, chainId, intent.nonce, settlementTimeoutMs)
      }
      return ack
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
