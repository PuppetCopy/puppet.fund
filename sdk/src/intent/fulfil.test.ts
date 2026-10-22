import { describe, expect, test } from 'bun:test'
import { CompactContractError, CompactError } from '../compact/error.js'
import { verifyFulfil } from './fulfil.js'

const escrow = { escrowed: 1_000n, released: 200n, returned: 100n }
const released = { total: 200n, feeTotal: 5n }

const refusal = (run: () => unknown): string => {
  try {
    run()
  } catch (err) {
    if (err instanceof CompactContractError || err instanceof CompactError) return err.code
    throw err
  }
  throw new Error('the release was admitted')
}

describe('verifyFulfil mirrors SpokeGate.fulfil and EscrowStore.release', () => {
  test('a release moves the total above what this body already holds, less the fee above what it already paid', () => {
    expect(verifyFulfil(escrow, released, { total: 600n, feeTotal: 25n })).toEqual({ amount: 400n, fee: 20n })
  })

  test('the total must grow past what this body already received', () => {
    expect(refusal(() => verifyFulfil(escrow, released, { total: 200n, feeTotal: 5n }))).toBe('Escrow__InvalidFulfil')
  })

  test('the fee total cannot fall below what earlier releases paid', () => {
    expect(refusal(() => verifyFulfil(escrow, released, { total: 300n, feeTotal: 4n }))).toBe('BAD_REQUEST')
  })

  test('a release takes only escrow no round released and no return took back', () => {
    expect(verifyFulfil(escrow, released, { total: 900n, feeTotal: 5n }).amount).toBe(700n)
    expect(refusal(() => verifyFulfil(escrow, released, { total: 901n, feeTotal: 5n }))).toBe('Balance__InsufficientBalance')
  })

  test('the fee stays within the relay fee cap of what it releases', () => {
    expect(verifyFulfil(escrow, released, { total: 300n, feeTotal: 15n }).fee).toBe(10n)
    expect(refusal(() => verifyFulfil(escrow, released, { total: 300n, feeTotal: 16n }))).toBe('Intent__RelayFeeRatioExceeded')
  })
})
