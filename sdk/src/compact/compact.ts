import { type Address, type Hex, isAddress } from 'viem'
import type { IActionKind, IInputByKind, IIntentByKind } from '../attestation/index.js'
import { AUTH_HEADER, AUTH_MAX_TTL_SEC, buildAuthAssertion } from './auth.js'
import { CompactError } from './error.js'
import { decode, encode } from './frame.js'

export const DISPATCH_TIMEOUT_MS = 5_000
export const SETTLEMENT_TIMEOUT_MS = 30_000

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
  // The net asset value the relay PRICED and co-signed against, for NAV-bearing intents (allocate / redeem / liquidate),
  // taken from the journal's oracle. The client set its acceptableNetAssetValue band from that SAME oracle pre-attest, so
  // this is the exact figure the co-sign landed on — for display ("valued at $X") and to audit it fell inside the band.
  // Absent for intents that carry no NAV.
  signedNav?: bigint
}

export interface ICompactOpts {
  // HTTP(S) base of the relay; the client POSTs intents to `${matchmakerUrl}/attest`. The relay is attest-only — there is
  // no head stream and no reads here. The block anchor and settlement are the caller's concern (read from your own RPC);
  // aggregation reads come from the journal service.
  matchmakerUrl: string
  defaultTimeoutMs?: number
  // Optional session auth: when set, the client signs a short-lived assertion (refreshed automatically) with `sign` and
  // attaches it PER-REQUEST to /attest. The relay recovers the signer as the reputation identity, keying that account's
  // admission lane by it and granting tx priority. Omit for anonymous best-effort.
  auth?: { sign: (message: string) => Promise<Hex>; ttlSec?: number }
}

// A pure relay client: attest() POSTs the intent and resolves at the relay's dispatch ACK (the HTTP response). The ack
// carries (account, chainId, nonce) — exactly the key the caller settles on (its own RPC / the journal fold). No head
// stream, no status, no reads: the relay is fire-and-ACK.
export interface ICompact {
  attest(request: IRelayRequest, timeoutMs?: number): Promise<IDispatchedFrame>
  close(): void
}

// A relay ack must carry the FULL dispatch key — chainId + nonce (the caller settles on these), txHash, account, fee —
// each well-typed (decode restores the bigints from their tagged form). THROWS naming the offending field(s) rather than
// returning a bool: a malformed body arrives ONLY on a 200 (the relay accepted + broadcast, then botched the response),
// which is a protocol/version mismatch the CLIENT should see at its callsite — NOT the matchmaker's opaque rejection (a
// non-200, still mapped to timeout()). The message also steers the caller away from a blind retry: the tx likely
// dispatched, so it must be verified on-chain by nonce, not re-sent (a re-send double-dispatches, reverting on the nonce).
function assertDispatchedFrame(f: unknown): asserts f is IDispatchedFrame {
  if (!f || typeof f !== 'object') {
    throw new CompactError('BAD_ACK', `relay ack was not an object (got ${f === null ? 'null' : typeof f})`, 'server')
  }
  const x = f as Record<string, unknown>
  const invalid: string[] = []
  if (typeof x.chainId !== 'bigint') invalid.push('chainId')
  if (typeof x.nonce !== 'bigint') invalid.push('nonce')
  if (typeof x.actualRelayFee !== 'bigint') invalid.push('actualRelayFee')
  if (typeof x.txHash !== 'string') invalid.push('txHash')
  if (typeof x.account !== 'string' || !isAddress(x.account)) invalid.push('account')
  // Optional: present only for NAV-bearing intents. Validate the type when present, never require it.
  if (x.signedNav !== undefined && typeof x.signedNav !== 'bigint') invalid.push('signedNav')
  if (invalid.length > 0) {
    throw new CompactError(
      'BAD_ACK',
      `relay ack malformed (missing/invalid: ${invalid.join(', ')}) — the intent was likely dispatched; verify on-chain by nonce rather than retrying`,
      'server'
    )
  }
}

export function createCompact(opts: ICompactOpts): ICompact {
  const { matchmakerUrl, defaultTimeoutMs = DISPATCH_TIMEOUT_MS } = opts
  const attestUrl = `${matchmakerUrl}/attest`

  const inflight = new Set<AbortController>() // in-flight attest POSTs, aborted on close()
  let disposed = false

  // Cached auth header, rebuilt a fraction before expiry. Anonymous (no opts.auth) => no header.
  let authCache: { header: string; refreshAt: number } | null = null
  let authWarned = false
  async function authHeaders(): Promise<Record<string, string>> {
    const auth = opts.auth
    if (!auth) return {}
    const nowSec = Math.floor(Date.now() / 1000)
    if (!authCache || nowSec >= authCache.refreshAt) {
      const ttlSec = Math.min(auth.ttlSec ?? AUTH_MAX_TTL_SEC, AUTH_MAX_TTL_SEC)
      try {
        const header = await buildAuthAssertion(ttlSec, auth.sign)
        // Refresh BEFORE expiry: 30s of slack, but never more than half the TTL — so a short TTL still caches between
        // calls instead of re-signing every request (a flat 30s buffer would no-op the cache for any ttlSec <= 30).
        const slackSec = Math.min(30, Math.floor(ttlSec / 2))
        authCache = { header, refreshAt: nowSec + ttlSec - slackSec }
        authWarned = false
      } catch (err) {
        // Signing failed: dispatch anonymously rather than block the request (it still lands, just without the funded
        // lane / priority). Warn ONCE per failure streak so a persistent misconfiguration is visible, not silent.
        if (!authWarned) {
          authWarned = true
          console.warn('[compact] auth signing failed; dispatching anonymously (no funded-lane priority):', err)
        }
        return {}
      }
    }
    return { [AUTH_HEADER]: authCache.header }
  }

  return {
    async attest(request: IRelayRequest, timeoutMs = defaultTimeoutMs): Promise<IDispatchedFrame> {
      if (disposed) throw new Error('compact closed')
      // No agreement on the intent, a busy relay, or any non-2xx is indistinguishable by design (the relay never says WHY
      // it rejected). The dispatch can still land until its deadline; wait it out then retry on fresh state — the on-chain
      // nonce guard makes a retry safe.
      const timeout = (): CompactError =>
        new CompactError(
          'DISPATCH_TIMEOUT',
          `${request.kind} was not acknowledged in ${timeoutMs}ms: no agreement on the intent, or a busy relay. It can still dispatch until its deadline passes; wait it out, then retry on fresh state.`,
          'server'
        )
      const controller = new AbortController()
      inflight.add(controller)
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        let res: Response
        try {
          res = await fetch(attestUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(await authHeaders()) },
            body: encode(request),
            signal: controller.signal
          })
        } catch {
          throw timeout()
        }
        if (res.status !== 200) throw timeout()
        let body: string
        try {
          body = await res.text()
        } catch {
          throw timeout() // aborted mid-body, or a truncated / errored body — keep EVERY failure opaque (fire-and-ACK)
        }
        const frame = decode(body)
        assertDispatchedFrame(frame) // 200 + bad body = relay protocol bug, not a rejection — surface it (see above)
        return frame
      } finally {
        clearTimeout(timer)
        inflight.delete(controller)
      }
    },
    close(): void {
      disposed = true
      for (const controller of inflight) controller.abort()
      inflight.clear()
    }
  }
}
