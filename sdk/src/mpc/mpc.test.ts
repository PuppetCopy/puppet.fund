import { describe, expect, test } from 'bun:test'
import { keccak256, recoverAddress, toHex } from 'viem'
import { publicKeyToAddress } from 'viem/utils'
import { Fn, randomScalar } from './core.js'
import {
  keygenAlice1,
  keygenAlice2,
  keygenBob1,
  keygenBob2,
  presignAlice1,
  presignAlice2,
  presignAlice3,
  presignBob1,
  presignBob2,
  presignBob3,
  signAlice,
  signBob
} from './index.js'
import { encodeInput, gadgetDot } from './mul.js'

const timed = <T>(label: string, fn: () => T): T => {
  const t0 = performance.now()
  const out = fn()
  console.log(`${label}: ${(performance.now() - t0).toFixed(0)} ms`)
  return out
}

const digestBytes = (hex: `0x${string}`): Uint8Array => new Uint8Array(Buffer.from(hex.slice(2), 'hex'))

function keygen(sid: `0x${string}`) {
  const a1 = keygenAlice1(sid, randomScalar())
  const b1 = keygenBob1(sid, randomScalar(), a1.msg)
  const a2 = keygenAlice2(a1.state, b1.msg)
  const bob = keygenBob2(b1.state, a2.msg)
  return { alice: a2.share, bob }
}

function presign(alice: ReturnType<typeof keygen>['alice'], bob: ReturnType<typeof keygen>['bob']) {
  const a1 = presignAlice1(alice)
  const b1 = presignBob1(bob, a1.msg)
  const a2 = presignAlice2(a1.state, b1.msg)
  const b2 = presignBob2(b1.state, a2.msg)
  const a3 = presignAlice3(a2.state, b2.msg)
  return { alice: a3.presignature, bob: presignBob3(b2.state, a3.msg), m5: a3.msg, b2 }
}

describe('two-party ecdsa', () => {
  test('the gadget encoding is a sharing of the input', () => {
    const beta = randomScalar()
    expect(gadgetDot(encodeInput(beta))).toBe(beta)
    expect(gadgetDot(encodeInput(0n))).toBe(0n)
    expect(gadgetDot(encodeInput(Fn.ORDER - 1n))).toBe(Fn.ORDER - 1n)
  })

  test('keygen, presign and sign recover the joint address', async () => {
    const sid = keccak256(toHex('body:0x01'))
    const { alice, bob } = timed('keygen', () => keygen(sid))
    expect(alice.pk).toBe(bob.pk)
    const address = publicKeyToAddress(alice.pk)

    const pre = timed('presign', () => presign(alice, bob))
    expect(pre.alice.R).toBe(pre.bob.R)

    const digest = keccak256(toHex('puppet genesis'))
    const sig = timed('sign (online)', () => signBob(bob, pre.bob, digestBytes(digest), signAlice(alice, pre.alice, digestBytes(digest))))
    expect(await recoverAddress({ hash: digest, signature: sig.signature })).toBe(address)

    const second = presign(alice, bob)
    expect(second.alice.R).not.toBe(pre.alice.R)
    const digest2 = keccak256(toHex('polymarket order'))
    const sig2 = signBob(bob, second.bob, digestBytes(digest2), signAlice(alice, second.alice, digestBytes(digest2)))
    expect(await recoverAddress({ hash: digest2, signature: sig2.signature })).toBe(address)
  })

  test('a sender who mixes multiplication inputs is caught before anything is revealed', () => {
    const { alice, bob } = keygen(keccak256(toHex('body:0x02')))
    const a1 = presignAlice1(alice)
    const b1 = presignBob1(bob, a1.msg)
    const a2 = presignAlice2(a1.state, b1.msg)
    const b2 = presignBob2(b1.state, a2.msg)
    const a3 = presignAlice3(a2.state, b2.msg)
    const forged = structuredClone(a3.msg)
    forged.correlation[0].tau[7] = forged.correlation[0].tau[8]!
    expect(() => presignBob3(b2.state, forged)).toThrow(/inconsistent multiplication inputs/)
  })

  test('a wrong signature share is rejected by bob', () => {
    const { alice, bob } = keygen(keccak256(toHex('body:0x03')))
    const pre = presign(alice, bob)
    const digest = digestBytes(keccak256(toHex('order')))
    const wrong = { R: pre.alice.R, etaSig: signAlice(alice, pre.alice, digestBytes(keccak256(toHex('other')))).etaSig }
    expect(() => signBob(bob, pre.bob, digest, wrong)).toThrow(/did not verify/)
    const foreign = presign(alice, bob)
    expect(() => signBob(bob, pre.bob, digest, signAlice(alice, foreign.alice, digest))).toThrow(/another presignature/)
  })
})
