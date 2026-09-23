import type { Address, Hex } from 'viem'
import { decode, encode } from '../compact/frame.js'
import type { IShare } from '../mpc/keygen.js'
import type { ITokenRegistry } from '../state/index.js'

const CURVE = { name: 'ECDH', namedCurve: 'P-256' } as const

export interface ISealedPayload {
  epk: string
  iv: string
  ct: string
}

export interface IPairedGrant {
  chainId: number
  signer: Address
  grant: Hex
  issuedAt: bigint
  expiry: bigint
  epoch: bigint
}

export interface IPairedSession {
  share: IShare
  signerKey: Hex
  grants: IPairedGrant[]
  user: Address
  account: Address
  matchmakerUrl: string
  oracleUrl: string
  relayer: Address
  tokenRegistry?: ITokenRegistry[]
}

interface IPairingKeypair {
  publicKey: string
  privateKey: CryptoKey
}

export async function generatePairingKeypair(): Promise<IPairingKeypair> {
  const pair = await crypto.subtle.generateKey(CURVE, false, ['deriveKey'])
  const raw = await crypto.subtle.exportKey('raw', pair.publicKey)
  return { publicKey: b64urlEncode(new Uint8Array(raw)), privateKey: pair.privateKey }
}

export async function sealPairingPayload(agentPublicKey: string, payload: unknown): Promise<ISealedPayload> {
  const agentPub = await crypto.subtle.importKey('raw', b64urlDecode(agentPublicKey) as BufferSource, CURVE, false, [])
  const eph = await crypto.subtle.generateKey(CURVE, false, ['deriveKey'])
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: agentPub },
    eph.privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  )
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new TextEncoder().encode(encode(payload))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, aesKey, data as BufferSource)
  const ephRaw = await crypto.subtle.exportKey('raw', eph.publicKey)
  return { epk: b64urlEncode(new Uint8Array(ephRaw)), iv: b64urlEncode(iv), ct: b64urlEncode(new Uint8Array(ct)) }
}

export async function openPairingPayload<T>(privateKey: CryptoKey, sealed: ISealedPayload): Promise<T> {
  const ephPub = await crypto.subtle.importKey('raw', b64urlDecode(sealed.epk) as BufferSource, CURVE, false, [])
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: ephPub },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  )
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64urlDecode(sealed.iv) as BufferSource },
    aesKey,
    b64urlDecode(sealed.ct) as BufferSource
  )
  return decode(new TextDecoder().decode(pt)) as T
}

function b64urlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(value: string): Uint8Array {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}
