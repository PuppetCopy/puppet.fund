import { type Hex, hexToBytes } from 'viem'
import {
  decodePoint,
  decodeScalar,
  encodePoint,
  encodeScalar,
  Fn,
  G,
  hashBytes,
  hashScalar,
  type IPoint,
  type ISchnorrProof,
  pointBytes,
  randomScalar,
  schnorrProve,
  schnorrVerify
} from './core.js'
import { type IShare, shareScalar } from './keygen.js'
import {
  cotReceiver,
  cotSender,
  encodeInput,
  hexListBytes,
  type ICorrelation,
  type IMulCheck,
  MUL_LENGTH,
  mulChallenge,
  mulCheckReceiver,
  mulCheckSender,
  mulShare
} from './mul.js'
import {
  type IOtOpening,
  type IOtReceiverState,
  type IOtSenderKey,
  type IOtSenderKeyMessage,
  type IOtSenderPads,
  otReceiverAcceptKey,
  otReceiverChoose,
  otReceiverRespond,
  otReceiverVerify,
  otSenderKey,
  otSenderOpen,
  otSenderPads
} from './ot.js'

export interface IPresignMessage1 {
  key: IOtSenderKeyMessage
}
export interface IPresignMessage2 {
  DB: Hex
  A: Hex[]
}
export interface IPresignMessage3 {
  xi: Hex[]
}
export interface IPresignMessage4 {
  response: Hex[]
}
export interface IPresignMessage5 {
  open: IOtOpening
  correlation: [ICorrelation, ICorrelation]
  check: [IMulCheck, IMulCheck]
  RPrime: Hex
  proof: ISchnorrProof
  etaPhi: Hex
}

export interface IPresignatureAlice {
  R: Hex
  t1: Hex
  t2: Hex
}
export interface IPresignatureBob {
  R: Hex
  theta: Hex
  t2: Hex
}

const sidOf = (share: IShare): Uint8Array => hexToBytes(share.sid)

const transcriptOf = (sid: Uint8Array, B: IPoint, m2: IPresignMessage2, m3: IPresignMessage3, m4: IPresignMessage4, open: IOtOpening, correlation: [ICorrelation, ICorrelation]): Uint8Array =>
  hashBytes(
    'mul-transcript',
    sid,
    pointBytes(B),
    hexToBytes(m2.DB),
    hexListBytes(m2.A),
    hexListBytes(m3.xi),
    hexListBytes(m4.response),
    hexListBytes(open.h0),
    hexListBytes(open.h1),
    hexListBytes(correlation[0].tau),
    hexListBytes(correlation[0].tauHat),
    hexListBytes(correlation[1].tau),
    hexListBytes(correlation[1].tauHat)
  )

interface IPresignAlice1 {
  share: IShare
  key: IOtSenderKey
}

export function presignAlice1(share: IShare): { state: IPresignAlice1; msg: IPresignMessage1 } {
  if (share.role !== 'alice') throw new Error('presignAlice1 needs the alice share')
  const { key, msg } = otSenderKey(sidOf(share))
  return { state: { share, key }, msg: { key: msg } }
}

export interface IPresignBob1 {
  share: IShare
  B: IPoint
  kB: bigint
  ot: IOtReceiverState
  m2: IPresignMessage2
}

export function presignBob1(share: IShare, m1: IPresignMessage1): { state: IPresignBob1; msg: IPresignMessage2 } {
  if (share.role !== 'bob') throw new Error('presignBob1 needs the bob share')
  const sid = sidOf(share)
  const B = otReceiverAcceptKey(sid, m1.key)
  const kB = randomScalar()
  const kBInv = Fn.inv(kB)
  const choices = new Uint8Array(2 * MUL_LENGTH)
  choices.set(encodeInput(kBInv), 0)
  choices.set(encodeInput(Fn.mul(shareScalar(share), kBInv)), MUL_LENGTH)
  const { state, A } = otReceiverChoose(sid, B, choices)
  const m2 = { DB: encodePoint(G.multiply(kB)), A }
  return { state: { share, B, kB, ot: state, m2 }, msg: m2 }
}

interface IPresignAlice2 extends IPresignAlice1 {
  m2: IPresignMessage2
  m3: IPresignMessage3
  pads: IOtSenderPads
  kA: bigint
  RPrime: IPoint
  R: IPoint
  phi: bigint
  alpha: [bigint, bigint]
  alphaHat: [bigint, bigint]
}

export function presignAlice2(state: IPresignAlice1, m2: IPresignMessage2): { state: IPresignAlice2; msg: IPresignMessage3 } {
  if (m2.A.length !== 2 * MUL_LENGTH) throw new Error(`expected ${2 * MUL_LENGTH} OT choices, got ${m2.A.length}`)
  const sid = sidOf(state.share)
  const DB = decodePoint(m2.DB)
  const kAPrime = randomScalar()
  const RPrime = DB.multiply(kAPrime)
  const kA = Fn.add(hashScalar('nonce', sid, pointBytes(RPrime)), kAPrime)
  if (kA === 0n) throw new Error('degenerate nonce')
  const R = DB.multiply(kA)
  const phi = randomScalar()
  const kAInv = Fn.inv(kA)
  const { pads, xi } = otSenderPads(sid, state.key, m2.A)
  const m3 = { xi }
  return {
    state: {
      ...state,
      m2,
      m3,
      pads,
      kA,
      RPrime,
      R,
      phi,
      alpha: [Fn.add(phi, kAInv), Fn.mul(shareScalar(state.share), kAInv)],
      alphaHat: [randomScalar(), randomScalar()]
    },
    msg: m3
  }
}

export interface IPresignBob2 extends IPresignBob1 {
  m3: IPresignMessage3
  m4: IPresignMessage4
}

export function presignBob2(state: IPresignBob1, m3: IPresignMessage3): { state: IPresignBob2; msg: IPresignMessage4 } {
  const m4 = { response: otReceiverRespond(state.ot, m3.xi) }
  return { state: { ...state, m3, m4 }, msg: m4 }
}

export function presignAlice3(state: IPresignAlice2, m4: IPresignMessage4): { presignature: IPresignatureAlice; msg: IPresignMessage5 } {
  const sid = sidOf(state.share)
  const open = otSenderOpen(state.pads, m4.response)
  const mul0 = cotSender(state.pads, 0, state.alpha[0], state.alphaHat[0])
  const mul1 = cotSender(state.pads, MUL_LENGTH, state.alpha[1], state.alphaHat[1])
  const correlation: [ICorrelation, ICorrelation] = [mul0.correlation, mul1.correlation]
  const transcript = transcriptOf(sid, state.key.B, state.m2, state.m3, m4, open, correlation)
  const check: [IMulCheck, IMulCheck] = [
    mulCheckSender(mulChallenge(transcript, 0), mul0.shares, state.alpha[0], state.alphaHat[0]),
    mulCheckSender(mulChallenge(transcript, 1), mul1.shares, state.alpha[1], state.alphaHat[1])
  ]
  const t1 = mulShare(mul0.shares.tA)
  const t2 = mulShare(mul1.shares.tA)
  const gamma1 = G.add(G.multiply(Fn.mul(state.phi, state.kA))).subtract(state.R.multiply(t1))
  const etaPhi = Fn.add(hashScalar('eta-phi', sid, pointBytes(gamma1)), state.phi)
  const DB = decodePoint(state.m2.DB)
  return {
    presignature: { R: encodePoint(state.R), t1: encodeScalar(t1), t2: encodeScalar(t2) },
    msg: {
      open,
      correlation,
      check,
      RPrime: encodePoint(state.RPrime),
      proof: schnorrProve(sid, 'nonce', DB, state.R, state.kA),
      etaPhi: encodeScalar(etaPhi)
    }
  }
}

export function presignBob3(state: IPresignBob2, m5: IPresignMessage5): IPresignatureBob {
  const sid = sidOf(state.share)
  otReceiverVerify(state.ot, state.m3.xi, m5.open)
  const mul0 = cotReceiver(state.ot, 0, m5.correlation[0])
  const mul1 = cotReceiver(state.ot, MUL_LENGTH, m5.correlation[1])
  const transcript = transcriptOf(sid, state.B, state.m2, state.m3, state.m4, m5.open, m5.correlation)
  mulCheckReceiver(mulChallenge(transcript, 0), state.ot, 0, mul0, m5.check[0])
  mulCheckReceiver(mulChallenge(transcript, 1), state.ot, MUL_LENGTH, mul1, m5.check[1])
  const t1 = mulShare(mul0.tB)
  const t2 = mulShare(mul1.tB)
  const DB = G.multiply(state.kB)
  const RPrime = decodePoint(m5.RPrime)
  const R = DB.multiply(hashScalar('nonce', sid, pointBytes(RPrime))).add(RPrime)
  schnorrVerify(sid, 'nonce', DB, R, m5.proof)
  const phi = Fn.sub(decodeScalar(m5.etaPhi), hashScalar('eta-phi', sid, pointBytes(R.multiply(t1))))
  const theta = Fn.sub(t1, Fn.mul(phi, Fn.inv(state.kB)))
  return { R: encodePoint(R), theta: encodeScalar(theta), t2: encodeScalar(t2) }
}

