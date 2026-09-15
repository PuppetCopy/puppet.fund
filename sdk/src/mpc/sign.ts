import { type Hex, toHex } from 'viem'
import { decodePoint, decodeScalar, encodeScalar, Fn, G, hashScalar, ORDER, pointBytes, scalarBytes, scalarFromDigest } from './core.js'
import { type IShare, sharePoint } from './keygen.js'
import type { IPresignatureAlice, IPresignatureBob } from './presign.js'

export interface IPartialSignature {
  R: Hex
  etaSig: Hex
}

export interface IJointSignature {
  r: Hex
  s: Hex
  v: 27 | 28
  signature: Hex
}

const rOf = (R: ReturnType<typeof decodePoint>): bigint => Fn.create(R.toAffine().x)

export function signAlice(share: IShare, presignature: IPresignatureAlice, digest: Uint8Array): IPartialSignature {
  if (share.role !== 'alice') throw new Error('signAlice needs the alice share')
  const R = decodePoint(presignature.R)
  const t1 = decodeScalar(presignature.t1)
  const t2 = decodeScalar(presignature.t2)
  const sigA = Fn.add(Fn.mul(scalarFromDigest(digest), t1), Fn.mul(rOf(R), t2))
  const gamma2 = sharePoint(share).multiply(t1).subtract(G.multiply(t2))
  return { R: presignature.R, etaSig: encodeScalar(Fn.add(hashScalar('eta-sig', pointBytes(R), pointBytes(gamma2)), sigA)) }
}

export function signBob(share: IShare, presignature: IPresignatureBob, digest: Uint8Array, partial: IPartialSignature): IJointSignature {
  if (share.role !== 'bob') throw new Error('signBob needs the bob share')
  if (partial.R !== presignature.R) throw new Error('the partial signature belongs to another presignature')
  const pk = sharePoint(share)
  const R = decodePoint(presignature.R)
  const theta = decodeScalar(presignature.theta)
  const t2 = decodeScalar(presignature.t2)
  const m = scalarFromDigest(digest)
  const r = rOf(R)
  const sigB = Fn.add(Fn.mul(m, theta), Fn.mul(r, t2))
  const gamma2 = G.multiply(t2).subtract(pk.multiply(theta))
  let s = Fn.add(sigB, Fn.sub(decodeScalar(partial.etaSig), hashScalar('eta-sig', pointBytes(R), pointBytes(gamma2))))
  if (r === 0n || s === 0n) throw new Error('degenerate signature')
  const sInv = Fn.inv(s)
  const check = G.multiply(Fn.mul(m, sInv)).add(pk.multiply(Fn.mul(r, sInv)))
  if (Fn.create(check.toAffine().x) !== r) throw new Error('the joint signature did not verify; a party misbehaved')
  let v: 27 | 28 = (R.toAffine().y & 1n) === 1n ? 28 : 27
  if (s > ORDER >> 1n) {
    s = Fn.neg(s)
    v = v === 27 ? 28 : 27
  }
  return { r: encodeScalar(r), s: encodeScalar(s), v, signature: toHex(new Uint8Array([...scalarBytes(r), ...scalarBytes(s), v])) }
}
