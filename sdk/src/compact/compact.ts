import { type Address, type Hex, isAddress } from 'viem'
import type { IBodyGenesis } from '../account/createAccount.js'
import type { ChainId } from '../const/chains.js'
import type { IDerivedInputByKind, ISelfInputByKind } from '../intent/index.js'
import { type IDerivedAction, type IIntentByKind, type ISealedAction, isDerivedAction } from '../intent/shared.js'
import { CompactError, OPTIMISTIC_RELAY_CLOSED } from './error.js'
import { decode, encode } from './frame.js'

const DISPATCH_TIMEOUT_MS = 15_000
export const SETTLEMENT_TIMEOUT_MS = 30_000

export type IRelayRequest<K extends ISealedAction = ISealedAction> = K extends ISealedAction
  ? {
      kind: K
      chainId: ChainId
      input: ISelfInputByKind[K]
      intent?: IIntentByKind[K]
      signature: Hex
      genesis?: IBodyGenesis
    }
  : never

export type IAttestRequest<K extends IDerivedAction = IDerivedAction> = K extends IDerivedAction
  ? {
      kind: K
      chainId: ChainId
      input: IDerivedInputByKind[K]
      signature: Hex
      genesis?: IBodyGenesis
      bodyShare?: { sid: Hex; pkA: Hex }
    }
  : never

export type IDispatchRequest = IRelayRequest | IAttestRequest

export interface IFulfilRequest {
  kind: 'fulfil'
  chainId: ChainId
  body: Address
  token: Address
  total: bigint
  feeTotal: bigint
  ownerSignature: Hex
  genesis: IBodyGenesis | null
}

export interface IDispatchedFrame {
  account: Address
  txHash: Hex
  relayFee: bigint
}

interface ICompactOpts {
  matchmakerUrl: string
  defaultTimeoutMs?: number
}

export interface ICompact {
  dispatch(request: IDispatchRequest, timeoutMs?: number): Promise<IDispatchedFrame>
  fulfil(request: IFulfilRequest, timeoutMs?: number): Promise<IDispatchedFrame>
  close(): void
}

function assertDispatchedFrame(f: unknown): asserts f is IDispatchedFrame {
  if (!f || typeof f !== 'object') {
    throw new CompactError('BAD_ACK', `relay ack was not an object (got ${f === null ? 'null' : typeof f})`, 'server')
  }
  const x = f as Record<string, unknown>
  const invalid: string[] = []
  if (typeof x.relayFee !== 'bigint') invalid.push('relayFee')
  if (typeof x.txHash !== 'string') invalid.push('txHash')
  if (typeof x.account !== 'string' || !isAddress(x.account)) invalid.push('account')
  if (invalid.length > 0) {
    throw new CompactError(
      'BAD_ACK',
      `relay ack malformed (missing/invalid: ${invalid.join(', ')}); the intent was likely dispatched; verify on-chain before retrying`,
      'server'
    )
  }
}

export function createCompact(opts: ICompactOpts): ICompact {
  const { matchmakerUrl, defaultTimeoutMs = DISPATCH_TIMEOUT_MS } = opts

  const inflight = new Set<AbortController>()
  let disposed = false

  async function post<T>(
    path: string,
    request: IDispatchRequest | IFulfilRequest,
    timeoutMs: number,
    assertReply: (f: unknown) => asserts f is T
  ): Promise<T> {
    if (disposed) throw new Error('compact closed')
    const unacknowledged = (): CompactError =>
      new CompactError(
        'DISPATCH_TIMEOUT',
        `${request.kind} was not acknowledged: the relay stays silent when it does not agree on the intent, or when it is busy. It can still dispatch until its deadline passes; wait it out, then retry on fresh state.`,
        'server'
      )
    const controller = new AbortController()
    inflight.add(controller)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    try {
      let res: Response
      try {
        res = await fetch(`${matchmakerUrl}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: encode(request),
          signal: controller.signal
        })
      } catch (err) {
        if (timedOut) throw unacknowledged()
        throw new CompactError(
          'RELAY_UNREACHABLE',
          `${request.kind} lost its connection to the relay at ${matchmakerUrl} (${err instanceof Error ? err.message : String(err)}), so whether it dispatched is unknown; reopen to refresh your history before retrying.`,
          'server'
        )
      }
      if (res.status !== 200) {
        const declined = await res.text().then(
          text => (text === '' ? null : (decode(text) as { code?: unknown })),
          () => null
        )
        if (declined?.code === OPTIMISTIC_RELAY_CLOSED) {
          throw new CompactError(
            OPTIMISTIC_RELAY_CLOSED,
            `the relay is not fronting ${request.kind} right now; submit it from the wallet instead`,
            'soft'
          )
        }
        if (res.status === 204) {
          throw new CompactError(
            'RELAY_DECLINED',
            `the relay did not agree on this ${request.kind} and stayed silent; nothing was dispatched. Re-check the intent against fresh state and submit again.`,
            'soft'
          )
        }
        if (res.status === 502 || res.status === 503 || res.status === 504) {
          throw new CompactError(
            'RELAY_UNREACHABLE',
            `the relay could not take ${request.kind} (HTTP ${res.status}); it is restarting, busy or unreachable. Retry in a moment, and refresh your history first if you are unsure whether it went out.`,
            'soft'
          )
        }
        throw new CompactError(
          'RELAY_REFUSED',
          `the relay refused ${request.kind} with HTTP ${res.status}; this is a malformed or oversized request, not a disagreement about the intent. Nothing was dispatched.`,
          'hard'
        )
      }
      let body: string
      try {
        body = await res.text()
      } catch {
        throw unacknowledged()
      }
      const frame = decode(body)
      assertReply(frame)
      return frame
    } finally {
      clearTimeout(timer)
      inflight.delete(controller)
    }
  }

  return {
    dispatch(request: IDispatchRequest, timeoutMs = defaultTimeoutMs): Promise<IDispatchedFrame> {
      return post(isDerivedAction(request.kind) ? '/attest' : '/relay', request, timeoutMs, assertDispatchedFrame)
    },
    fulfil(request: IFulfilRequest, timeoutMs = defaultTimeoutMs): Promise<IDispatchedFrame> {
      return post('/fulfil', request, timeoutMs, assertDispatchedFrame)
    },
    close(): void {
      disposed = true
      for (const controller of inflight) controller.abort()
      inflight.clear()
    }
  }
}
