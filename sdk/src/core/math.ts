import { PRECISION } from '../const/common.js'

export function factor(a: bigint, b: bigint): bigint {
  return a ? (a * PRECISION.floatPrecisionExp) / b : 0n
}

export function toBasisPoints(numerator: bigint, denominator: bigint) {
  if (denominator === 0n) throw new Error('toBasisPoints: zero denominator')
  return (numerator * PRECISION.basisPoints) / denominator
}

export function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b
}

export function max(a: bigint, b: bigint): bigint {
  return a > b ? a : b
}

export function abs(a: bigint): bigint {
  return a < 0n ? -a : a
}

export function delta(a: bigint, b: bigint): bigint {
  return a > b ? a - b : b - a
}
