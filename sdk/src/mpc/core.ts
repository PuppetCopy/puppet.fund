import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToNumberBE, concatBytes, numberToBytesBE } from '@noble/curves/utils.js'
import { sha256, sha512 } from '@noble/hashes/sha2.js'
import { randomBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { type Hex, hexToBytes, toHex } from 'viem'

export const Point = secp256k1.Point
export type IPoint = typeof Point.BASE
export const Fn = Point.Fn
export const G = Point.BASE
export const ORDER = Fn.ORDER

const tag = (label: string): Uint8Array => utf8ToBytes(`puppet-mpc/${label}`)

export const u32 = (n: number): Uint8Array => numberToBytesBE(BigInt(n), 4)
export const scalarBytes = (x: bigint): Uint8Array => Fn.toBytes(x)
export const pointBytes = (p: IPoint): Uint8Array => p.toBytes(true)

export function hashBytes(label: string, ...parts: Uint8Array[]): Uint8Array {
  return sha256(concatBytes(tag(label), ...parts))
}

export function hashScalar(label: string, ...parts: Uint8Array[]): bigint {
  return Fn.create(bytesToNumberBE(sha512(concatBytes(tag(label), ...parts))))
}

export function randomScalar(): bigint {
  for (;;) {
    const x = Fn.create(bytesToNumberBE(randomBytes(48)))
    if (x !== 0n) return x
  }
}

export function scalarFromDigest(digest: Uint8Array): bigint {
  if (digest.length !== 32) throw new Error(`a digest is 32 bytes, got ${digest.length}`)
  return Fn.create(bytesToNumberBE(digest))
}

export const xor = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  if (a.length !== b.length) throw new Error('xor of unequal lengths')
  const out = new Uint8Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = a[i]! ^ b[i]!
  return out
}

export const equalBytes = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

export const encodeScalar = (x: bigint): Hex => toHex(scalarBytes(x))
export const decodeScalar = (hex: Hex): bigint => {
  const bytes = hexToBytes(hex)
  if (bytes.length !== 32) throw new Error(`a scalar is 32 bytes, got ${bytes.length}`)
  const x = bytesToNumberBE(bytes)
  if (x >= ORDER) throw new Error('scalar out of range')
  return x
}
export const encodePoint = (p: IPoint): Hex => toHex(pointBytes(p))
export const decodePoint = (hex: Hex): IPoint => {
  const p = Point.fromBytes(hexToBytes(hex))
  p.assertValidity()
  if (p.equals(Point.ZERO)) throw new Error('point at infinity')
  return p
}
export const encodeBytes = (b: Uint8Array): Hex => toHex(b)
export const decodeBytes = (hex: Hex, length: number): Uint8Array => {
  const bytes = hexToBytes(hex)
  if (bytes.length !== length) throw new Error(`expected ${length} bytes, got ${bytes.length}`)
  return bytes
}

export interface ISchnorrProof {
  U: Hex
  z: Hex
}

export function schnorrProve(sid: Uint8Array, label: string, base: IPoint, statement: IPoint, witness: bigint): ISchnorrProof {
  const u = randomScalar()
  const U = base.multiply(u)
  const c = hashScalar('schnorr', sid, tag(label), pointBytes(base), pointBytes(statement), pointBytes(U))
  return { U: encodePoint(U), z: encodeScalar(Fn.add(u, Fn.mul(c, witness))) }
}

export function schnorrVerify(sid: Uint8Array, label: string, base: IPoint, statement: IPoint, proof: ISchnorrProof): void {
  const U = decodePoint(proof.U)
  const z = decodeScalar(proof.z)
  const c = hashScalar('schnorr', sid, tag(label), pointBytes(base), pointBytes(statement), pointBytes(U))
  if (!base.multiply(z).equals(U.add(statement.multiply(c)))) throw new Error(`invalid proof of knowledge for ${label}`)
}
