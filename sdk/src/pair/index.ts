import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, type Hex, hexToBytes } from 'viem'

export interface IPairPayload {
  user: Hex
  bindSig: Hex
  pk: Hex
}

export interface IPairEnvelope {
  clientEphPub: Hex
  nonce: Hex
  ciphertext: Hex
}

export function generateEphKeypair(): { priv: Hex; pub: Hex } {
  const priv = secp256k1.utils.randomSecretKey()
  const pub = secp256k1.getPublicKey(priv, true)
  return { priv: bytesToHex(priv) as Hex, pub: bytesToHex(pub) as Hex }
}

export function ephFingerprint(pub: Hex): string {
  const bytes = sha256(hexToBytes(pub))
  const out: string[] = []
  for (let i = 0; i < 6; i++) out.push(bytes[i].toString(16).padStart(2, '0'))
  return out.join(':')
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(out).set(bytes)
  return out
}

async function deriveAesKey(priv: Uint8Array, pub: Uint8Array): Promise<CryptoKey> {
  const shared = secp256k1.getSharedSecret(priv, pub, true)
  const km = sha256(shared.slice(1))
  return crypto.subtle.importKey('raw', toArrayBuffer(km), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function encryptPairPayload(agentEphPub: Hex, payload: IPairPayload): Promise<IPairEnvelope> {
  const clientPriv = secp256k1.utils.randomSecretKey()
  const clientPub = secp256k1.getPublicKey(clientPriv, true)
  const aesKey = await deriveAesKey(clientPriv, hexToBytes(agentEphPub))
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(payload))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintext)
  return {
    clientEphPub: bytesToHex(clientPub) as Hex,
    nonce: bytesToHex(nonce) as Hex,
    ciphertext: bytesToHex(new Uint8Array(ct)) as Hex
  }
}

export async function decryptPairPayload(agentEphPriv: Hex, envelope: IPairEnvelope): Promise<IPairPayload> {
  const aesKey = await deriveAesKey(hexToBytes(agentEphPriv), hexToBytes(envelope.clientEphPub))
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(hexToBytes(envelope.nonce)) },
    aesKey,
    toArrayBuffer(hexToBytes(envelope.ciphertext))
  )
  return JSON.parse(new TextDecoder().decode(pt)) as IPairPayload
}
