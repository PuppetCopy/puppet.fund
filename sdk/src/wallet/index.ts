// ── Puppet Wallet wire protocol ──────────────────────────────────────────────
// The single shared contract between the four runtimes that exchange messages:
//   site page  ⇄  content script  ⇄  extension background  ⇄  dApp inpage provider
// Dependency-free on purpose, so every context (incl. the page-injected inpage script)
// can import it cheaply. Everything that crosses a postMessage / runtime boundary is
// defined HERE — payload and response shapes included — so the two ends cannot drift.

export const PUPPET_EXTENSION_RDNS = 'fund.puppet'

// Bump on any breaking change to the messages/payloads below. Echoed in the
// GET_CONNECTIONS response so the site can detect a stale extension (independently
// deployed) and prompt an update instead of failing opaquely. GET_CONNECTIONS itself
// is the stable negotiation anchor — never rename its string.
export const WALLET_PROTOCOL_VERSION = 1

// Request/response RPCs (site → extension, awaited reply).
export const WALLET_MESSAGE = {
  GET_CONNECTIONS: 'PUPPET_GET_CONNECTIONS',
  // Hands the extension the session (user + in-memory signer key). Re-arms after an MV3
  // worker recycle; when it also carries `approveOrigin`, it GRANTS that dApp origin
  // access to the fund (the user's Approve). The fund derives from (user, signer).
  HANDOFF_SESSION: 'PUPPET_HANDOFF_SESSION',
  REJECT_CONNECT: 'PUPPET_REJECT_CONNECT',
  CLEAR_ALL: 'PUPPET_CLEAR_ALL'
} as const

// One-way broadcast event names (extension → tabs, no reply).
export const WALLET_EVENT = {
  // EIP-1193 standard event — dApps listen for this exact name; never rename.
  ACCOUNTS_CHANGED: 'accountsChanged',
  // Internal: the extension asks an open puppet tab to re-hand the in-memory session key
  // (it never stores the key). The site answers with HANDOFF_SESSION.
  SESSION_REQUEST: 'sessionRequest'
} as const
export type WalletEventName = (typeof WALLET_EVENT)[keyof typeof WALLET_EVENT]

// postMessage routing tags (which leg of the bridge a frame is on).
export const WALLET_TARGET = {
  EXTENSION: 'puppet-extension',
  WEBSITE: 'puppet-website',
  WEBSITE_EVENT: 'puppet-website-event',
  CONTENT: 'puppet-content',
  INPAGE: 'puppet-inpage'
} as const

// ── request payloads (everything is JSON strings over the wire; the handler validates) ──

export interface IHandoffSessionRequest {
  user: string
  signerKey: string
  // Present only on an explicit Approve — grants this dApp origin access to the fund.
  approveOrigin?: string
}

export interface IRejectConnectRequest {
  origin: string
}

// GET_CONNECTIONS and CLEAR_ALL carry no payload.

// ── responses ──

export interface IConnectionsResponse {
  version: number
  fund: string | null
  origins: string[]
}

export interface IHandoffSessionResponse {
  fund: string | null
}

// ── broadcast event frame ──

export interface IWalletEventFrame {
  type: 'event'
  event: WalletEventName
  args: unknown[]
}
