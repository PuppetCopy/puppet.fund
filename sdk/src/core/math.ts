import { BASIS_POINTS, FLOAT_PRECISION, SHARE_PRECISION } from '@puppet/contracts/const'

export function safeDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) {
    return 0n
  }

  return a / b
}

export function div(a: bigint, b: bigint): bigint {
  if (b === 0n) return 0n

  return (a * BASIS_POINTS) / b
}

export function factor(a: bigint, b: bigint): bigint {
  return a ? (a * FLOAT_PRECISION) / b : 0n
}

export function applyFactor(factor: bigint, value: bigint): bigint {
  return (value * factor) / FLOAT_PRECISION
}

export function toBasisPoints(numerator: bigint, denominator: bigint) {
  if (denominator === 0n) {
    return 0n
  }

  return (numerator * BASIS_POINTS) / denominator
}

export function applyBasisPoints(value: bigint, bps: bigint): bigint {
  return (value * bps) / BASIS_POINTS
}

export function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b
}

export function max(a: bigint, b: bigint): bigint {
  return a > b ? a : b
}

export function minMax(minValue: bigint, maxValue: bigint, value: bigint): bigint {
  return value < minValue ? minValue : value > maxValue ? maxValue : value
}

export function abs(a: bigint): bigint {
  return a < 0n ? -a : a
}

export function delta(a: bigint, b: bigint): bigint {
  return a > b ? a - b : b - a
}

// Mirrors AllocateModule._calcShares exactly: the bootstrap mint is amount x
// SHARE_PRECISION (so the first share unit is worth 1e-12 base), later mints price at
// the pre-mint supply over attested NAV.
export function sharesFor(totalShareSupply: bigint, netAssetValue: bigint, amount: bigint): bigint {
  if (totalShareSupply === 0n) return amount * SHARE_PRECISION
  return (amount * totalShareSupply) / netAssetValue
}

export { SHARE_PRECISION }
