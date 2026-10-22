import { CHAIN_NETWORK_MAP } from '@puppet/contracts/const'
import { type Address, getAddress, isAddressEqual, maxUint256, type PublicClient, zeroAddress } from 'viem'
import { CHAIN_TOKEN_MAP } from '../../const/network.js'
import type { IVenueMarket } from '../types.js'
import { GMX_V2_CONTRACT_MAP } from './contractMap.js'

const GMX_NETWORK = 'arbitrum' as const
type IGmxChainId = {
  [K in keyof typeof CHAIN_NETWORK_MAP]: (typeof CHAIN_NETWORK_MAP)[K] extends typeof GMX_NETWORK ? K : never
}[keyof typeof CHAIN_NETWORK_MAP]
export const GMX_V2_CHAIN_ID = Number(
  Object.entries(CHAIN_NETWORK_MAP).find(([, network]) => network === GMX_NETWORK)![0]
) as IGmxChainId
export const GMX_WNT = CHAIN_TOKEN_MAP[GMX_V2_CHAIN_ID].WETH as Address

const READER = GMX_V2_CONTRACT_MAP.GmxReaderV2
const DATA_STORE = GMX_V2_CONTRACT_MAP.GmxDatastore.address

const marketByToken = new Map<Address, IVenueMarket>()

const remember = (props: { marketToken: Address; indexToken: Address; longToken: Address; shortToken: Address }): void => {
  if (isAddressEqual(props.marketToken, zeroAddress)) return
  marketByToken.set(getAddress(props.marketToken), { indexToken: getAddress(props.indexToken), longToken: getAddress(props.longToken), shortToken: getAddress(props.shortToken) })
}

const knownOf = (markets: readonly Address[]): Map<Address, IVenueMarket> =>
  new Map(
    markets.flatMap(market => {
      const known = marketByToken.get(getAddress(market))
      return known === undefined ? [] : [[getAddress(market), known] as const]
    })
  )

export async function readGmxMarkets(client: PublicClient, markets: readonly Address[], blockNumber: bigint | undefined): Promise<Map<Address, IVenueMarket>> {
  const unread = [...new Set(markets.map(market => getAddress(market)))].filter(market => !marketByToken.has(market))
  if (unread.length > 0) {
    const props = await client.multicall({
      allowFailure: false,
      blockNumber,
      contracts: unread.map(market => ({ address: READER.address, abi: READER.abi, functionName: 'getMarket' as const, args: [DATA_STORE, market] as const }))
    })
    props.forEach(remember)
  }
  return knownOf(markets)
}

export async function readAllGmxMarkets(client: PublicClient, blockNumber: bigint | undefined): Promise<Map<Address, IVenueMarket>> {
  const props = await client.readContract({ address: READER.address, abi: READER.abi, functionName: 'getMarkets', args: [DATA_STORE, 0n, maxUint256], blockNumber })
  props.forEach(remember)
  return knownOf(props.map(p => p.marketToken))
}
