import { TOKEN_META } from '@puppet/contracts/const'
import { ARBITRUM_MARKET_LIST, GMX_V2_CONTRACT_MAP } from '@puppet/contracts/gmx'
import { type Address, encodeAbiParameters, getAddress, type Hex, keccak256, type PublicClient } from 'viem'
import type {
  IGetRate,
  IGmxClaimableProvider,
  IGmxClaimableRow,
  IGmxOrderProvider,
  IGmxPositionProvider,
  IGmxPositionRow
} from '../evaluate/types.js'
import { symbolByAddress } from '../state/tokenRegistry.js'

export type { IGmxClaimableRow, IGmxOrderRow } from '../evaluate/types.js'

const READER = GMX_V2_CONTRACT_MAP.GmxReaderV2.address
const READER_ABI = GMX_V2_CONTRACT_MAP.GmxReaderV2.abi
const DATA_STORE = GMX_V2_CONTRACT_MAP.GmxDatastore.address

// GMX denominates collateral in USD; we price the collateral token against the USDC dollar-proxy market so
// collateralUsd lands in the same GMX-USD (1e30) scale as sizeInUsd.
const USD_PROXY = TOKEN_META.USDC.symbol

// GMX V2 position key = keccak256(abi.encode(account, market, collateralToken, isLong)).
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

export function makeOnchainGmxClaimableProvider(publicClient: PublicClient): IGmxClaimableProvider {
  const pairs = ARBITRUM_MARKET_LIST.flatMap(m => {
    const market = getAddress(m.marketToken)
    const tokens = [...new Set([getAddress(m.longToken), getAddress(m.shortToken)])]
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
      allowFailure: false
    })
    return pairs.flatMap((p, i): IGmxClaimableRow[] => (amounts[i] > 0n ? [{ ...p, amount: amounts[i] }] : []))
  }
}

export function makeOnchainGmxOrderProvider(publicClient: PublicClient): IGmxOrderProvider {
  return async account => {
    const infos = await publicClient.readContract({
      address: READER,
      abi: READER_ABI,
      functionName: 'getAccountOrders',
      args: [DATA_STORE, account, 0n, 1000n]
    })
    return infos.map(info => ({
      orderKey: info.orderKey,
      market: getAddress(info.order.addresses.market),
      collateralToken: getAddress(info.order.addresses.initialCollateralToken),
      isLong: info.order.flags.isLong,
      orderType: Number(info.order.numbers.orderType),
      sizeDeltaUsd: info.order.numbers.sizeDeltaUsd,
      collateralDeltaAmount: info.order.numbers.initialCollateralDeltaAmount,
      triggerPrice: info.order.numbers.triggerPrice,
      isFrozen: info.order.flags.isFrozen
    }))
  }
}

// On-chain open-position reader (GmxReaderV2.getAccountPositions over RPC), mapped to the valuation-ready row shape via
// the SAME rate getter the evaluator uses (so collateral USD and position re-marking price off one source). Each row
// prices its collateral against the USDC dollar-proxy independently; the TTL-cached singleton collapses repeated tokens
// into one fetch. collateralUsd = collateralAmount * collateral price (GMX 1e30 USD units). storedPnlUsd stays 0 because
// valueGmxPositions re-marks pnl from the live index price; storedPnlUsd is only the fallback when an index price is missing.
export function makeOnchainGmxPositionProvider(publicClient: PublicClient, getRate: IGetRate): IGmxPositionProvider {
  return async account => {
    const props = await publicClient.readContract({
      address: READER,
      abi: READER_ABI,
      functionName: 'getAccountPositions',
      args: [DATA_STORE, account, 0n, 1000n]
    })
    if (props.length === 0) return []
    return Promise.all(
      props.map(async (p): Promise<IGmxPositionRow> => {
        const market = getAddress(p.addresses.market)
        const collateralToken = getAddress(p.addresses.collateralToken)
        const collateralPrice = (await getRate(symbolByAddress(collateralToken), USD_PROXY)).token0
        return {
          positionKey: gmxPositionKey(account, market, collateralToken, p.flags.isLong),
          market,
          collateralToken,
          isLong: p.flags.isLong,
          sizeInUsd: p.numbers.sizeInUsd,
          sizeInTokens: p.numbers.sizeInTokens,
          collateralUsd: p.numbers.collateralAmount * collateralPrice,
          collateralAmount: p.numbers.collateralAmount,
          storedPnlUsd: 0n
        }
      })
    )
  }
}
