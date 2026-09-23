import { type Hex, hexToBytes, toHex } from 'viem'
import { decodePoint, decodeScalar, encodePoint, encodeScalar, equalBytes, G, hashBytes, type ISchnorrProof, schnorrProve, schnorrVerify } from './core.js'

type IRole = 'alice' | 'bob'

export interface IShare {
  sid: Hex
  role: IRole
  sk: Hex
  pk: Hex
}

export interface IKeygenCommit {
  commitment: Hex
}

export interface IKeygenReveal {
  pk: Hex
  proof: ISchnorrProof
}

interface IKeygenAliceState {
  sid: Hex
  sk: bigint
  reveal: IKeygenReveal
}

export interface IKeygenBobState {
  sid: Hex
  sk: bigint
  commitment: Hex
}

const commitTo = (sid: Uint8Array, reveal: IKeygenReveal): Uint8Array =>
  hashBytes('keygen-commit', sid, hexToBytes(reveal.pk), hexToBytes(reveal.proof.U), hexToBytes(reveal.proof.z))

export function keygenAlice1(sid: Hex, sk: bigint): { state: IKeygenAliceState; msg: IKeygenCommit } {
  const pkA = G.multiply(sk)
  const reveal = { pk: encodePoint(pkA), proof: schnorrProve(hexToBytes(sid), 'keygen-alice', G, pkA, sk) }
  return { state: { sid, sk, reveal }, msg: { commitment: toHex(commitTo(hexToBytes(sid), reveal)) } }
}

export function keygenBob1(sid: Hex, sk: bigint, msg: IKeygenCommit): { state: IKeygenBobState; msg: IKeygenReveal } {
  const pkB = G.multiply(sk)
  return {
    state: { sid, sk, commitment: msg.commitment },
    msg: { pk: encodePoint(pkB), proof: schnorrProve(hexToBytes(sid), 'keygen-bob', G, pkB, sk) }
  }
}

export function keygenAlice2(state: IKeygenAliceState, msg: IKeygenReveal): { share: IShare; msg: IKeygenReveal } {
  const pkB = decodePoint(msg.pk)
  schnorrVerify(hexToBytes(state.sid), 'keygen-bob', G, pkB, msg.proof)
  const pk = pkB.multiply(state.sk)
  return { share: { sid: state.sid, role: 'alice', sk: encodeScalar(state.sk), pk: toHex(pk.toBytes(false)) }, msg: state.reveal }
}

export function keygenBob2(state: IKeygenBobState, msg: IKeygenReveal): IShare {
  const sid = hexToBytes(state.sid)
  if (!equalBytes(commitTo(sid, msg), hexToBytes(state.commitment))) throw new Error('alice opened a different key than she committed to')
  const pkA = decodePoint(msg.pk)
  schnorrVerify(sid, 'keygen-alice', G, pkA, msg.proof)
  return { sid: state.sid, role: 'bob', sk: encodeScalar(state.sk), pk: toHex(pkA.multiply(state.sk).toBytes(false)) }
}

export const sharePoint = (share: IShare) => decodePoint(share.pk)
export const shareScalar = (share: IShare): bigint => decodeScalar(share.sk)
