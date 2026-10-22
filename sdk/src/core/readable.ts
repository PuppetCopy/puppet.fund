import { PRECISION, USD_DECIMALS } from '../const/common.js'
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
    absAmount >= 100 ? readableLargeNumber : absAmount >= 0.01 || absAmount === 0 ? readableAccountingNumber : readableTinyNumber

  return Intl.NumberFormat('en-US', { ...digitOptions, ...formatOptions }).format(ammount)
}

export const readableKey = (key: string): string =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, first => first.toUpperCase())
    .trim()

export const readableContractName = (source: string, key: string): string => {
  const spelled = readableKey(key)
  return spelled.toLowerCase().startsWith(`${source.toLowerCase()} `) ? `${source}${spelled.slice(source.length)}` : `${source} ${spelled}`
}

export const readableUnitAmount = readableNumber({})
export const readablePercentage = (amount: bigint) => `${readableUnitAmount(formatFixed(2, amount))}%`
export const readableLeverage = (a: bigint, b: bigint) =>
  `${b ? readableUnitAmount(formatFixed(4, (a * PRECISION.basisPoints) / b)) : 0n}x`
const USD_DUST = 10n ** 28n
export const dustToZeroUsd = (amount: bigint): bigint => (amount < USD_DUST && amount > -USD_DUST ? 0n : amount)
export const readableUsd = (ammount: bigint) => readableUnitAmount(formatFixed(USD_DECIMALS, ammount))
export const readableTokenAmount = (token: ITokenDescription | number, amount: bigint) => {
  const value = formatFixed(typeof token === 'number' ? token : token.decimals, amount)
  const absValue = Math.abs(value)
  return absValue >= 1e-8 && absValue < 1
    ? Intl.NumberFormat('en-US', readableTinyNumber).format(value)
    : readableUnitAmount(value)
}
export const readableTokenAmountLabel = (token: { decimals: number; symbol: string }, amount: bigint) =>
  `${readableTokenAmount(token.decimals, amount)} ${token.symbol}`
