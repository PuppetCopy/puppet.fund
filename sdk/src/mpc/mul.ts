import { concatBytes } from '@noble/curves/utils.js'
import { randomBytes } from '@noble/hashes/utils.js'
import { type Hex, hexToBytes } from 'viem'
import { decodeScalar, encodeScalar, Fn, hashBytes, hashScalar, u32 } from './core.js'
import type { IOtReceiverState, IOtSenderPads } from './ot.js'

const KAPPA = 256
const STAT = 128
const ENCODED_BITS = KAPPA + 2 * STAT
export const MUL_LENGTH = KAPPA + ENCODED_BITS

const gadget: bigint[] = [
  ...Array.from({ length: KAPPA }, (_, i) => 1n << BigInt(i)),
  ...Array.from({ length: ENCODED_BITS }, (_, j) => hashScalar('gadget', u32(j)))
]

export function encodeInput(beta: bigint): Uint8Array {
  const bits = new Uint8Array(MUL_LENGTH)
  const gamma = randomBytes(ENCODED_BITS / 8)
  let dot = 0n
  for (let j = 0; j < ENCODED_BITS; j++) {
    const bit = (gamma[j >> 3]! >> (j & 7)) & 1
    bits[KAPPA + j] = bit
    if (bit === 1) dot = Fn.add(dot, gadget[KAPPA + j]!)
  }
  let rest = Fn.sub(beta, dot)
  for (let i = 0; i < KAPPA; i++) {
    bits[i] = Number(rest & 1n)
    rest >>= 1n
  }
  return bits
}

export function gadgetDot(bits: Uint8Array): bigint {
  let sum = 0n
  for (let j = 0; j < MUL_LENGTH; j++) if (bits[j] === 1) sum = Fn.add(sum, gadget[j]!)
  return sum
}

const padScalar = (rho: Uint8Array, k: number): bigint => hashScalar('cot-pad', rho, u32(k))

export interface ICorrelation {
  tau: Hex[]
  tauHat: Hex[]
}

interface IMulSenderShares {
  tA: bigint[]
  tAHat: bigint[]
}

export function cotSender(pads: IOtSenderPads, offset: number, alpha: bigint, alphaHat: bigint): { shares: IMulSenderShares; correlation: ICorrelation } {
  const tA: bigint[] = []
  const tAHat: bigint[] = []
  const tau: Hex[] = []
  const tauHat: Hex[] = []
  for (let j = 0; j < MUL_LENGTH; j++) {
    const rho0 = pads.rho0[offset + j]!
    const rho1 = pads.rho1[offset + j]!
    const p00 = padScalar(rho0, 0)
    const p01 = padScalar(rho0, 1)
    tA.push(Fn.neg(p00))
    tAHat.push(Fn.neg(p01))
    tau.push(encodeScalar(Fn.add(Fn.sub(p00, padScalar(rho1, 0)), alpha)))
    tauHat.push(encodeScalar(Fn.add(Fn.sub(p01, padScalar(rho1, 1)), alphaHat)))
  }
  return { shares: { tA, tAHat }, correlation: { tau, tauHat } }
}

interface IMulReceiverShares {
  tB: bigint[]
  tBHat: bigint[]
}

export function cotReceiver(state: IOtReceiverState, offset: number, correlation: ICorrelation): IMulReceiverShares {
  if (correlation.tau.length !== MUL_LENGTH || correlation.tauHat.length !== MUL_LENGTH) throw new Error('correlation length mismatch')
  const tB: bigint[] = []
  const tBHat: bigint[] = []
  for (let j = 0; j < MUL_LENGTH; j++) {
    const rho = state.rho[offset + j]!
    const p0 = padScalar(rho, 0)
    const p1 = padScalar(rho, 1)
    if (state.choices[offset + j] === 1) {
      tB.push(Fn.add(p0, decodeScalar(correlation.tau[j]!)))
      tBHat.push(Fn.add(p1, decodeScalar(correlation.tauHat[j]!)))
    } else {
      tB.push(p0)
      tBHat.push(p1)
    }
  }
  return { tB, tBHat }
}

export interface IMulCheck {
  r: Hex[]
  u: Hex
}

export function mulChallenge(transcript: Uint8Array, index: number): [bigint, bigint] {
  return [hashScalar('mul-chi', transcript, u32(index), u32(0)), hashScalar('mul-chi', transcript, u32(index), u32(1))]
}

export function mulCheckSender([chi, chiHat]: [bigint, bigint], shares: IMulSenderShares, alpha: bigint, alphaHat: bigint): IMulCheck {
  return {
    r: shares.tA.map((t, j) => encodeScalar(Fn.add(Fn.mul(chi, t), Fn.mul(chiHat, shares.tAHat[j]!)))),
    u: encodeScalar(Fn.add(Fn.mul(chi, alpha), Fn.mul(chiHat, alphaHat)))
  }
}

export function mulCheckReceiver([chi, chiHat]: [bigint, bigint], state: IOtReceiverState, offset: number, shares: IMulReceiverShares, check: IMulCheck): void {
  if (check.r.length !== MUL_LENGTH) throw new Error('check length mismatch')
  const u = decodeScalar(check.u)
  for (let j = 0; j < MUL_LENGTH; j++) {
    const lhs = Fn.add(Fn.mul(chi, shares.tB[j]!), Fn.mul(chiHat, shares.tBHat[j]!))
    const rhs = Fn.sub(state.choices[offset + j] === 1 ? u : 0n, decodeScalar(check.r[j]!))
    if (lhs !== rhs) throw new Error(`the sender used inconsistent multiplication inputs at ${offset + j}`)
  }
}

export const mulShare = (t: bigint[]): bigint => t.reduce((sum, tj, j) => Fn.add(sum, Fn.mul(gadget[j]!, tj)), 0n)

export const hexListBytes = (list: readonly Hex[]): Uint8Array => hashBytes('list', concatBytes(...list.map(h => hexToBytes(h))))
