import { ARBITRUM_MARKET_LIST, ARBITRUM_TOKEN_LIST } from '@puppet/contracts/gmx'
import type { Address } from 'viem'
import { getAddress } from 'viem'
import { ADDRESS_ZERO } from '../const/common.js'
import type { IMarketDescription, ITokenDescription } from '../core/types.js'
import { getMappedValue, groupList } from '../core/utils.js'

const SUPPLEMENTAL_ARBITRUM_TOKENS: readonly ITokenDescription[] = [
  { symbol: 'GMX', name: 'GMX', decimals: 18, address: getAddress('0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a') }
]

export const TOKEN_ADDRESS_DESCRIPTION_MAP = {
  ...groupList(ARBITRUM_TOKEN_LIST, 'address'),
  ...groupList(SUPPLEMENTAL_ARBITRUM_TOKENS, 'address')
}
export const MARKET_ADDRESS_DESCRIPTION_MAP = groupList(ARBITRUM_MARKET_LIST, 'marketToken')

const NATIVE_DESCRIPTION: ITokenDescription = {
  name: 'Ethereum',
  symbol: 'ETH',
  decimals: 18,
  address: ADDRESS_ZERO
}

export function getTokenDescription(token: Address): ITokenDescription {
  const normalizedToken = getAddress(token)
  if (normalizedToken === ADDRESS_ZERO) return NATIVE_DESCRIPTION
  return getMappedValue(TOKEN_ADDRESS_DESCRIPTION_MAP, normalizedToken)
}

export function getMarketDescription(market: Address): IMarketDescription {
  const normalizedMarket = getAddress(market)
  return getMappedValue(
    MARKET_ADDRESS_DESCRIPTION_MAP,
    normalizedMarket as keyof typeof MARKET_ADDRESS_DESCRIPTION_MAP
  ) as IMarketDescription
}

export function getMarketDescriptionByToken(tokenAddress: Address): IMarketDescription[] {
  const normalizedAddress = getAddress(tokenAddress)
  return ARBITRUM_MARKET_LIST.filter(market => {
    const indexToken = market.indexToken ? getAddress(market.indexToken) : null
    const longToken = getAddress(market.longToken)
    const shortToken = getAddress(market.shortToken)
    return normalizedAddress === indexToken || normalizedAddress === longToken || normalizedAddress === shortToken
  })
}
