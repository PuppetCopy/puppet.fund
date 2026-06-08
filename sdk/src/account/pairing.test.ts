import { describe, expect, test } from 'bun:test'
import { generatePairingKeypair, openPairingPayload, sealPairingPayload } from './pairing.js'

// The pairing seal is security-critical: it's what protects the session key on the
// wire from the browser to the local operator. A leak here is a key leak.
describe('pairing seal', () => {
  test('seal/open round-trips the payload', async () => {
    const { publicKey, privateKey } = await generatePairingKeypair()
    const payload = { user: '0x1111111111111111111111111111111111111111', signerKey: '0xdeadbeef', n: 42 }
    const sealed = await sealPairingPayload(publicKey, payload)
    // Ciphertext must not contain the plaintext secret.
    expect(sealed.ct).not.toContain('deadbeef')
    const opened = await openPairingPayload<typeof payload>(privateKey, sealed)
    expect(opened).toEqual(payload)
  })

  test('a payload sealed to one key cannot be opened by a different key', async () => {
    const a = await generatePairingKeypair()
    const b = await generatePairingKeypair()
    const sealed = await sealPairingPayload(a.publicKey, { secret: 'x' })
    await expect(openPairingPayload(b.privateKey, sealed)).rejects.toThrow()
  })

  test('each seal uses a fresh ephemeral key and iv', async () => {
    const { publicKey } = await generatePairingKeypair()
    const one = await sealPairingPayload(publicKey, { v: 1 })
    const two = await sealPairingPayload(publicKey, { v: 1 })
    expect(one.epk).not.toBe(two.epk)
    expect(one.iv).not.toBe(two.iv)
  })
})
