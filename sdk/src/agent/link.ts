import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import type { Address } from 'viem'

export type IAgentReply =
  | { type: 'done'; id: number; chainId: number; block: string; txHash: string; fees: { chainId: number; token: Address; amount: string }[] }
  | { type: 'signed'; id: number; signature: string }
  | { type: 'submitted'; id: number }
  | { type: 'failed'; id: number; code: string; detail: string }

export type IAppFrame = { type: 'linked'; user: Address; account: Address; manual: string } | IAgentReply | { type: 'close'; reason: string }

export const AGENT_HANDSHAKE_MS = 10_000
export const AGENT_NONCE = /^[0-9a-fA-F]{32,128}$/

export const randomHex = (byteLength: number): string => bytesToHex(crypto.getRandomValues(new Uint8Array(byteLength)))

export const linkProof = (secret: string, side: 'app' | 'agent', nonce: string): string => bytesToHex(hmac(sha256, utf8ToBytes(secret), utf8ToBytes(`puppet-${side}:${nonce}`)))

export function sameHex(a: string, b: string): boolean {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0)
  return diff === 0
}
