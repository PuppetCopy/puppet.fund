import { PRECISION } from '@puppet/contracts/const'
import { USD_DECIMALS } from '../const/common.js'
import { formatFixed } from './parse.js'
import type { ITokenDescription } from './types.js'

const readableAccountingNumber: Intl.NumberFormatOptions = { maximumFractionDigits: 2, minimumFractionDigits: 2 }
const readableLargeNumber: Intl.NumberFormatOptions = { maximumFractionDigits: 0 }
const readableTinyNumber: Intl.NumberFormatOptions = { maximumSignificantDigits: 2, minimumSignificantDigits: 2 }

const readableNumber = (formatOptions: Intl.NumberFormatOptions) => (ammount: number | bigint) => {
  const absAmount = Math.abs(Number(ammount))
  if (absAmount > 0 && absAmount < 1e-8) {
    return Intl.NumberFormat('en-US', { ...readableAccountingNumber, ...formatOptions }).format(0)
  }
  const digitOptions =
    absAmount >= 100 ? readableLargeNumber : absAmount >= 0.01 ? readableAccountingNumber : readableTinyNumber

  return Intl.NumberFormat('en-US', { ...digitOptions, ...formatOptions }).format(ammount)
}

export const readableUnitAmount = readableNumber({})
export const readablePercentage = (amount: bigint) => `${readableUnitAmount(formatFixed(2, amount))}%`
export const readableLeverage = (a: bigint, b: bigint) =>
  `${b ? readableUnitAmount(formatFixed(4, (a * PRECISION.basisPoints) / b)) : 0n}x`
const USD_DUST = 10n ** 28n
export const dustToZeroUsd = (amount: bigint): bigint => (amount < USD_DUST && amount > -USD_DUST ? 0n : amount)
export const readableUsd = (ammount: bigint) => readableUnitAmount(formatFixed(USD_DECIMALS, ammount))
export const readablePnl = (ammount: bigint, decimals = USD_DECIMALS) =>
  readableNumber({ signDisplay: 'exceptZero' })(formatFixed(decimals, ammount))
export const readableTokenAmount = (token: ITokenDescription | number, amount: bigint) => {
  const value = formatFixed(typeof token === 'number' ? token : token.decimals, amount)
  const absValue = Math.abs(value)
  return absValue >= 1e-8 && absValue < 1
    ? Intl.NumberFormat('en-US', readableTinyNumber).format(value)
    : readableUnitAmount(value)
}
export const readableTokenAmountLabel = (token: { decimals: number; symbol: string }, amount: bigint) =>
  `${readableTokenAmount(token.decimals, amount)} ${token.symbol}`

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
