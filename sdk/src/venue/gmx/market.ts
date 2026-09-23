import { CHAIN_NETWORK_MAP } from '@puppet/contracts/const'
import type { Address } from 'viem'
import { getAddress } from 'viem'
import { ADDRESS_ZERO } from '../../const/common.js'
import { getTokenDescription } from '../../core/token.js'
import type { IMarketDescription, ITokenDescription } from '../../core/types.js'
import { getMappedValue, groupList } from '../../core/utils.js'
import { ARBITRUM_MARKET_LIST } from './marketList.js'
import { ARBITRUM_TOKEN_LIST } from './tokenList.js'

const GMX_NETWORK = 'arbitrum' as const
type IGmxChainId = {
  [K in keyof typeof CHAIN_NETWORK_MAP]: (typeof CHAIN_NETWORK_MAP)[K] extends typeof GMX_NETWORK ? K : never
}[keyof typeof CHAIN_NETWORK_MAP]
export const GMX_V2_CHAIN_ID = Number(
  Object.entries(CHAIN_NETWORK_MAP).find(([, network]) => network === GMX_NETWORK)![0]
) as IGmxChainId

const SUPPLEMENTAL_ARBITRUM_TOKENS: readonly ITokenDescription[] = [
  { symbol: 'GMX', name: 'GMX', decimals: 18, address: '0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a' }
]

const TOKEN_ADDRESS_DESCRIPTION_MAP = {
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

export function getGmxTokenDescription(token: Address): ITokenDescription {
  const normalizedToken = getAddress(token)
  if (normalizedToken === ADDRESS_ZERO) return NATIVE_DESCRIPTION
  if (normalizedToken in TOKEN_ADDRESS_DESCRIPTION_MAP) {
    return TOKEN_ADDRESS_DESCRIPTION_MAP[normalizedToken as keyof typeof TOKEN_ADDRESS_DESCRIPTION_MAP]
  }
  return getTokenDescription(GMX_V2_CHAIN_ID, normalizedToken)
}

export function getMarketDescription(market: Address): IMarketDescription {
  const normalizedMarket = getAddress(market)
  return getMappedValue(
    MARKET_ADDRESS_DESCRIPTION_MAP,
    normalizedMarket as keyof typeof MARKET_ADDRESS_DESCRIPTION_MAP
  ) as IMarketDescription
}
