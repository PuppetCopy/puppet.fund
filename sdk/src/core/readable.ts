import { BASIS_POINTS } from '@puppet/contracts/const'
import { curry2 } from 'aelea/stream'
import { type Address, formatUnits } from 'viem'
import { USD_DECIMALS } from '../const/common.js'
import { getTokenDescription } from '../gmx/market.js'
import { formatFixed, getTokenDenominator } from './parse.js'
import type { ITokenDescription } from './types.js'

export const readableAccountingNumber: Intl.NumberFormatOptions = { maximumFractionDigits: 2, minimumFractionDigits: 2 }
export const readableLargeNumber: Intl.NumberFormatOptions = { maximumFractionDigits: 0 }
export const readableTinyNumber: Intl.NumberFormatOptions = { maximumSignificantDigits: 2, minimumSignificantDigits: 2 }

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat/NumberFormat#options
export const readableNumber = curry2((formatOptions: Intl.NumberFormatOptions, ammount: number | bigint) => {
  const absAmount = Math.abs(Number(ammount))
  const digitOptions =
    absAmount >= 1000 ? readableLargeNumber : absAmount >= 1 ? readableAccountingNumber : readableTinyNumber

  return Intl.NumberFormat('en-US', { ...digitOptions, ...formatOptions }).format(ammount)
})

export const readableUnitAmount = readableNumber({})
export const readableAccountingAmount = readableNumber(readableAccountingNumber)
export const readableUSD = readableNumber({})
export const readablePercentage = (amount: bigint) => `${readableUnitAmount(formatFixed(2, amount))}%`
export const readableFactorPercentage = (amount: bigint) =>
  `${readableUnitAmount(formatFixed(USD_DECIMALS, amount) * 100)}%`
export const readableLeverage = (a: bigint, b: bigint) =>
  `${b ? readableUnitAmount(formatFixed(4, (a * BASIS_POINTS) / b)) : 0n}x`
export const readableUsd = (ammount: bigint) => readableUSD(formatFixed(USD_DECIMALS, ammount))
export const readableTokenUsd = (
  token: ITokenDescription | Address,
  value: bigint,
  format: Intl.NumberFormatOptions = {}
) => {
  const tokenDescription = typeof token === 'string' ? getTokenDescription(token) : token

  if (tokenDescription === null) {
    throw new Error(`Unknown token: ${token}`)
  }

  return readableNumber(format, formatFixed(USD_DECIMALS, value * getTokenDenominator(tokenDescription)))
}
export const readablePnl = (ammount: bigint, decimals = USD_DECIMALS) =>
  readableNumber({ signDisplay: 'exceptZero' })(formatFixed(decimals, ammount))
export const readableTokenAmount = (token: ITokenDescription | Address | number, amount: bigint) => {
  if (typeof token === 'number') {
    return readableUnitAmount(formatFixed(token, amount))
  }

  const tokenDescription = typeof token === 'string' ? getTokenDescription(token) : token

  if (tokenDescription === null) {
    throw new Error(`Unknown token: ${token}`)
  }

  return readableUnitAmount(formatFixed(tokenDescription.decimals, amount))
}
export const readableTokenAmountLabel = (
  token: ITokenDescription | Address | { decimals: number; symbol: string },
  amount: bigint
) => {
  if (typeof token === 'string') {
    const tokenDescription = getTokenDescription(token)
    if (tokenDescription === null) {
      throw new Error(`Unknown token: ${token}`)
    }
    return `${readableTokenAmount(tokenDescription.decimals, amount)} ${tokenDescription.symbol}`
  }

  return `${readableTokenAmount(token.decimals, amount)} ${token.symbol}`
}

// Exact (lossless) amount display: preserves every significant decimal and trims
// trailing zeros. Use for balances where the raw value is load-bearing, e.g. a
// "Max" button that must sample the exact on-chain balance — rounded displays
// create the illusion that fees were pre-subtracted.
export const readableExactTokenAmount = (token: ITokenDescription | number, amount: bigint): string => {
  const decimals = typeof token === 'number' ? token : token.decimals
  const raw = formatUnits(amount, decimals)
  return raw.includes('.') ? raw.replace(/0+$/, '').replace(/\.$/, '') : raw
}

export const readableExactTokenAmountLabel = (
  token: ITokenDescription | Address | { decimals: number; symbol: string },
  amount: bigint
): string => {
  if (typeof token === 'string') {
    const tokenDescription = getTokenDescription(token)
    if (tokenDescription === null) throw new Error(`Unknown token: ${token}`)
    return `${readableExactTokenAmount(tokenDescription.decimals, amount)} ${tokenDescription.symbol}`
  }
  return `${readableExactTokenAmount(token.decimals, amount)} ${token.symbol}`
}

const UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte', 'petabyte']
const BYTES_PER_KB = 1000

export function readableFileSize(sizeBytes: number | bigint): string {
  let size = Math.abs(Number(sizeBytes))

  let u = 0
  while (size >= BYTES_PER_KB && u < UNITS.length - 1) {
    size /= BYTES_PER_KB
    ++u
  }

  return new Intl.NumberFormat([], {
    style: 'unit',
    unit: UNITS[u],
    unitDisplay: 'short',
    maximumFractionDigits: 1
  }).format(size)
}

export function parseReadableNumber(stringNumber: string, locale?: Intl.NumberFormatOptions) {
  const thousandSeparator = Intl.NumberFormat('en-US', locale)
    .format(11111)
    .replace(/\p{Number}/gu, '')
  const decimalSeparator = Intl.NumberFormat('en-US', locale)
    .format(1.1)
    .replace(/\p{Number}/gu, '')

  const parsed = Number.parseFloat(
    stringNumber
      .replace(new RegExp(`\\${thousandSeparator}`, 'g'), '')
      .replace(new RegExp(`\\${decimalSeparator}`), '.')
  )
  return parsed
}
