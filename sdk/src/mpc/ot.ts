import type { Hex } from 'viem'
import {
  decodeBytes,
  decodePoint,
  encodeBytes,
  encodePoint,
  equalBytes,
  G,
  hashBytes,
  type IPoint,
  type ISchnorrProof,
  pointBytes,
  randomScalar,
  schnorrProve,
  schnorrVerify,
  u32,
  xor
} from './core.js'

export interface IOtSenderKey {
  b: bigint
  B: IPoint
  T: IPoint
}

export interface IOtSenderKeyMessage {
  B: Hex
  proof: ISchnorrProof
}

export function otSenderKey(sid: Uint8Array): { key: IOtSenderKey; msg: IOtSenderKeyMessage } {
  const b = randomScalar()
  const B = G.multiply(b)
  return { key: { b, B, T: B.multiply(b) }, msg: { B: encodePoint(B), proof: schnorrProve(sid, 'ot-sender-key', G, B, b) } }
}

export function otReceiverAcceptKey(sid: Uint8Array, msg: IOtSenderKeyMessage): IPoint {
  const B = decodePoint(msg.B)
  schnorrVerify(sid, 'ot-sender-key', G, B, msg.proof)
  return B.precompute(8)
}

const pad = (sid: Uint8Array, j: number, shared: IPoint): Uint8Array => hashBytes('ot-pad', sid, u32(j), pointBytes(shared))
const opening = (rho: Uint8Array): Uint8Array => hashBytes('ot-open', rho)
const challenge = (rho: Uint8Array): Uint8Array => hashBytes('ot-challenge', opening(rho))

export interface IOtReceiverState {
  choices: Uint8Array
  rho: Uint8Array[]
}

export function otReceiverChoose(sid: Uint8Array, B: IPoint, choices: Uint8Array): { state: IOtReceiverState; A: Hex[] } {
  const rho: Uint8Array[] = []
  const A: Hex[] = []
  for (let j = 0; j < choices.length; j++) {
    const a = randomScalar()
    const Aj = choices[j] === 1 ? G.multiply(a).add(B) : G.multiply(a)
    rho.push(pad(sid, j, B.multiply(a)))
    A.push(encodePoint(Aj))
  }
  return { state: { choices, rho }, A }
}

export interface IOtSenderPads {
  rho0: Uint8Array[]
  rho1: Uint8Array[]
}

export function otSenderPads(sid: Uint8Array, key: IOtSenderKey, A: Hex[]): { pads: IOtSenderPads; xi: Hex[] } {
  const rho0: Uint8Array[] = []
  const rho1: Uint8Array[] = []
  const xi: Hex[] = []
  for (let j = 0; j < A.length; j++) {
    const bA = decodePoint(A[j]!).multiply(key.b)
    const r0 = pad(sid, j, bA)
    const r1 = pad(sid, j, bA.subtract(key.T))
    rho0.push(r0)
    rho1.push(r1)
    xi.push(encodeBytes(xor(challenge(r0), challenge(r1))))
  }
  return { pads: { rho0, rho1 }, xi }
}

export function otReceiverRespond(state: IOtReceiverState, xi: Hex[]): Hex[] {
  if (xi.length !== state.choices.length) throw new Error('challenge count mismatch')
  return state.rho.map((rho, j) => {
    const c = challenge(rho)
    return encodeBytes(state.choices[j] === 1 ? xor(c, decodeBytes(xi[j]!, 32)) : c)
  })
}

export interface IOtOpening {
  h0: Hex[]
  h1: Hex[]
}

export function otSenderOpen(pads: IOtSenderPads, response: Hex[]): IOtOpening {
  if (response.length !== pads.rho0.length) throw new Error('response count mismatch')
  const h0: Hex[] = []
  const h1: Hex[] = []
  for (let j = 0; j < response.length; j++) {
    if (!equalBytes(decodeBytes(response[j]!, 32), challenge(pads.rho0[j]!))) throw new Error(`receiver failed the OT challenge at ${j}`)
    h0.push(encodeBytes(opening(pads.rho0[j]!)))
    h1.push(encodeBytes(opening(pads.rho1[j]!)))
  }
  return { h0, h1 }
}

export function otReceiverVerify(state: IOtReceiverState, xi: Hex[], open: IOtOpening): void {
  if (open.h0.length !== state.choices.length || open.h1.length !== state.choices.length) throw new Error('opening count mismatch')
  for (let j = 0; j < state.choices.length; j++) {
    const h0 = decodeBytes(open.h0[j]!, 32)
    const h1 = decodeBytes(open.h1[j]!, 32)
    if (!equalBytes(state.choices[j] === 1 ? h1 : h0, opening(state.rho[j]!))) throw new Error(`sender opened a different pad at ${j}`)
    if (!equalBytes(decodeBytes(xi[j]!, 32), xor(hashBytes('ot-challenge', h0), hashBytes('ot-challenge', h1)))) {
      throw new Error(`sender challenge inconsistent with its openings at ${j}`)
    }
  }
}

