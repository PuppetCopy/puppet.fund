import { TOKEN_META } from '@puppet/contracts/const'
import { type Address, encodeAbiParameters, type Hex, keccak256, type PublicClient } from 'viem'
import { usdPriceFromRate } from '../../evaluate/precision.js'
import type { IGetRate } from '../../evaluate/types.js'
import { symbolOf } from '../../state/tokenRegistry.js'
import { GMX_V2_CONTRACT_MAP } from './contractMap.js'
import { GMX_V2_CHAIN_ID } from './market.js'
import { ARBITRUM_MARKET_LIST } from './marketList.js'
import type { IGmxClaimableProvider, IGmxClaimableRow, IGmxOrderProvider, IGmxPositionProvider, IGmxPositionRow } from './rows.js'

export type { IGmxClaimableRow, IGmxOrderRow } from './rows.js'

const READER = GMX_V2_CONTRACT_MAP.GmxReaderV2.address
const READER_ABI = GMX_V2_CONTRACT_MAP.GmxReaderV2.abi
const DATA_STORE = GMX_V2_CONTRACT_MAP.GmxDatastore.address

const USD_PROXY = TOKEN_META.USDC.symbol

const gmxPositionKey = (account: Address, market: Address, collateralToken: Address, isLong: boolean): Hex =>
  keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'bool' }],
      [account, market, collateralToken, isLong]
    )
  )

const GET_UINT_ABI = [
  {
    inputs: [{ name: 'key', type: 'bytes32' }],
    name: 'getUint',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  }
] as const

const CLAIMABLE_FUNDING_AMOUNT = keccak256(encodeAbiParameters([{ type: 'string' }], ['CLAIMABLE_FUNDING_AMOUNT']))

const claimableFundingKey = (market: Address, token: Address, account: Address): Hex =>
  keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'address' }, { type: 'address' }, { type: 'address' }],
      [CLAIMABLE_FUNDING_AMOUNT, market, token, account]
    )
  )

export function makeOnchainGmxClaimableProvider(publicClient: PublicClient, blockNumber?: bigint): IGmxClaimableProvider {
  const pairs = ARBITRUM_MARKET_LIST.flatMap(m => {
    const market = m.marketToken
    const tokens = [...new Set([m.longToken, m.shortToken])]
    return tokens.map(token => ({ market, token }))
  })
  return async account => {
    const amounts = await publicClient.multicall({
      contracts: pairs.map(p => ({
        address: DATA_STORE,
        abi: GET_UINT_ABI,
        functionName: 'getUint' as const,
        args: [claimableFundingKey(p.market, p.token, account)] as const
      })),
      allowFailure: false,
      blockNumber
    })
    return pairs.flatMap((p, i): IGmxClaimableRow[] => (amounts[i] > 0n ? [{ ...p, amount: amounts[i] }] : []))
  }
}

export function makeOnchainGmxOrderProvider(publicClient: PublicClient, blockNumber?: bigint): IGmxOrderProvider {
  return async account => {
    const infos = await publicClient.readContract({
      address: READER,
      abi: READER_ABI,
      functionName: 'getAccountOrders',
      args: [DATA_STORE, account, 0n, 1000n],
      blockNumber
    })
    return infos.map(info => ({
      orderKey: info.orderKey,
      market: info.order.addresses.market,
      collateralToken: info.order.addresses.initialCollateralToken,
      isLong: info.order.flags.isLong,
      orderType: Number(info.order.numbers.orderType),
      sizeDeltaUsd: info.order.numbers.sizeDeltaUsd,
      collateralDeltaAmount: info.order.numbers.initialCollateralDeltaAmount,
      triggerPrice: info.order.numbers.triggerPrice,
      isFrozen: info.order.flags.isFrozen
    }))
  }
}

export function makeOnchainGmxPositionProvider(
  publicClient: PublicClient,
  getRate: IGetRate,
  blockNumber?: bigint
): IGmxPositionProvider {
  return async account => {
    const props = await publicClient.readContract({
      address: READER,
      abi: READER_ABI,
      functionName: 'getAccountPositions',
      args: [DATA_STORE, account, 0n, 1000n],
      blockNumber
    })
    if (props.length === 0) return []
    return Promise.all(
      props.map(async (p): Promise<IGmxPositionRow> => {
        const market = p.addresses.market
        const collateralToken = p.addresses.collateralToken
        const collateralPrice = usdPriceFromRate(
          await getRate(symbolOf(GMX_V2_CHAIN_ID, collateralToken), USD_PROXY),
          TOKEN_META.USDC.decimals
        )
        return {
          positionKey: gmxPositionKey(account, market, collateralToken, p.flags.isLong),
          market,
          collateralToken,
          isLong: p.flags.isLong,
          sizeInUsd: p.numbers.sizeInUsd,
          sizeInTokens: p.numbers.sizeInTokens,
          collateralUsd: p.numbers.collateralAmount * collateralPrice,
          collateralAmount: p.numbers.collateralAmount,
          storedPnlUsd: 0n,
          increasedAtTime: Number(p.numbers.increasedAtTime)
        }
      })
    )
  }
}
