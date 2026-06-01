import { BASIS_POINTS } from '@puppet/contracts/const'
import { formatUnits, parseUnits } from 'viem'
import type { ITokenDescription } from './types.js'

export const VALID_FRACTIONAL_NUMBER_REGEXP = /^-?(0|[1-9]\d*)(\.\d+)?$/

// Constant to pull zeros from for multipliers
let zeros = '0'
while (zeros.length < 256) {
  zeros += zeros
}

export function formatFixed(decimals: number, value: bigint): number {
  return Number(formatUnits(value, decimals))
}

export function parseFixed(decimals: number, input: string | number) {
  return parseUnits(String(input), decimals)
}

export function parseBps(a: number | string): bigint {
  return parseFixed(4, a)
}

export function getDenominator(decimals: number) {
  return 10n ** BigInt(decimals)
}

export function expandDecimals(n: bigint, decimals: number) {
  return n * getDenominator(decimals)
}

export function getTokenDenominator(tokenDEsc: ITokenDescription) {
  return getDenominator(tokenDEsc.decimals)
}

export function formatDiv(a: bigint, b: bigint): number {
  return formatFixed(4, (a * BASIS_POINTS) / b)
}
