import { type Address, type Hex, recoverMessageAddress } from 'viem'

// Relay session authentication. A client proves control of an address by signing a short-lived assertion with
// its session key; the relay recovers that address and uses it as the REPUTATION identity — the key its
// admission/rate ledger buckets by, and the basis for tx priority. Stateless: a freshness window only, no
// session table. v1 establishes identity, nothing more; reputation weighting (funded account / PuppetAccount /
// stake) layers on top by resolving the recovered address downstream.
export const AUTH_HEADER = 'x-puppet-auth'
// An assertion is honored for at most this long. TLS protects it on the wire; a leaked one can at worst borrow
// the identity's lane briefly and never authorizes an intent (intents carry their own signature).
export const AUTH_MAX_TTL_SEC = 300

export type IAuthAssertion = { issuedAt: number; expiresAt: number; signature: Hex }

// Canonical message the session key signs. MUST be byte-identical on both sides; the purpose line
// domain-separates it from every other signature the key produces.
export function authMessage(issuedAt: number, expiresAt: number): string {
  return `puppet-relay-auth\nissued:${issuedAt}\nexpires:${expiresAt}`
}

// Client: build a base64 header value. `sign` is the session key's message signer (e.g. account.signMessage).
export async function buildAuthAssertion(ttlSec: number, sign: (message: string) => Promise<Hex>): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000)
  const expiresAt = issuedAt + Math.min(ttlSec, AUTH_MAX_TTL_SEC)
  const signature = await sign(authMessage(issuedAt, expiresAt))
  return btoa(JSON.stringify({ issuedAt, expiresAt, signature } satisfies IAuthAssertion))
}

// Server: verify a header, returning the authenticated identity address or null. Never throws.
export async function verifyAuthAssertion(header: string | null | undefined, nowSec: number): Promise<Address | null> {
  if (!header) return null
  let assertion: IAuthAssertion
  try {
    assertion = JSON.parse(atob(header))
  } catch {
    return null
  }
  const { issuedAt, expiresAt, signature } = assertion
  if (typeof issuedAt !== 'number' || typeof expiresAt !== 'number' || typeof signature !== 'string') return null
  // Fresh: not expired, not future-dated (small skew), window never longer than the cap.
  if (expiresAt <= nowSec || issuedAt > nowSec + 5 || expiresAt - issuedAt > AUTH_MAX_TTL_SEC) return null
  try {
    return await recoverMessageAddress({ message: authMessage(issuedAt, expiresAt), signature })
  } catch {
    return null
  }
}
