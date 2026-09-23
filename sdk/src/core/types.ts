import type { Address } from 'viem'

export interface IMarketDescription {
  marketToken: Address
  indexToken: Address
  longToken: Address
  shortToken: Address
}

export interface ITokenDescription {
  name: string
  symbol: string
  baseSymbol?: string
  isFiat?: boolean
  decimals: number
  address: Address
}
