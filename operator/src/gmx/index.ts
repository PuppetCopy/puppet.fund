import { ARBITRUM_MARKET_LIST, GMX_V2_CONTRACT_MAP } from '@puppet/contracts/gmx'
import type { IIAccount__Call } from '@puppet/contracts/types'
import { calculateExecutionFee, getGasLimitsConfig, getPositionPnlUsd, } from '@puppet/sdk/gmx'
import { providerToken, registeredTokenAddresses, symbolOf } from '@puppet/sdk/state'
import {
  assertOperateSignable,
  buildGmxOrderCalls,
  GMX_DECREASE_SWAP_TYPE,
  GMX_DECREASE_TYPES,
  GMX_INCREASE_TYPES,
  GMX_ROUTER,
  GMX_ROUTER_ABI,
  GMX_V2_CHAIN_ID,
  type IGmxOrder,
  screenOperate,
  selectGmxMarket
} from '@puppet/sdk/venue'
import { type Address, encodeFunctionData, formatUnits, getAddress, type Hex, isAddressEqual, parseUnits } from 'viem'
import type { IConnector } from '../connector.js'
import { createOperator, type IOperatorConfig } from '../operator.js'

export { calculateExecutionFee, getGasLimitsConfig, getPositionPnlUsd, type IGasLimitsConfig } from '@puppet/sdk/gmx'
export { GMX_DECREASE_SWAP_TYPE, GMX_ORDER_TYPE, GMX_V2_CHAIN_ID, type IGmxOrder } from '@puppet/sdk/venue'

const READER = GMX_V2_CONTRACT_MAP.GmxReaderV2.address
const READER_ABI = GMX_V2_CONTRACT_MAP.GmxReaderV2.abi
const DATA_STORE = GMX_V2_CONTRACT_MAP.GmxDatastore.address
const EXECUTION_FEE_BUFFER_BPS = 2_000n

export const usd = (amount: string | number): bigint => parseUnits(String(amount), 30)
export const formatUsd = (amount: bigint): string => formatUnits(amount, 30)

export const gmxPrice = (usdPerToken: string | number, indexTokenDecimals: number): bigint => {
  const decimals = 30 - indexTokenDecimals
  const value = typeof usdPerToken === 'number' ? usdPerToken.toFixed(Math.min(decimals, 8)) : usdPerToken
  return parseUnits(value, decimals)
}

export const acceptablePrice = (
  spotUsd: number,
  isLong: boolean,
  isIncrease: boolean,
  slippageBps: number,
  indexTokenDecimals = 18
): bigint =>
  gmxPrice(spotUsd * (isIncrease === isLong ? 1 + slippageBps / 10_000 : 1 - slippageBps / 10_000), indexTokenDecimals)

export interface IGmxPositionView {
  addresses: { market: Address; collateralToken: Address }
  numbers: { sizeInUsd: bigint; sizeInTokens: bigint; collateralAmount: bigint }
  flags: { isLong: boolean }
}

export function dominantPosition<T extends IGmxPositionView>(positions: readonly T[], market: Address): T | null {
  let best: T | null = null
  for (const p of positions) {
    if (!isAddressEqual(p.addresses.market, market) || p.numbers.sizeInUsd === 0n) continue
    if (!best || p.numbers.sizeInUsd > best.numbers.sizeInUsd) best = p
  }
  return best
}

export interface IGmxPositionMetrics {
  isLong: boolean
  sizeUsd: bigint
  collateralUsd: bigint
  marginUsd: bigint
  leverage: number
  effLeverage: number
}

export function positionMetrics(
  p: IGmxPositionView,
  markPrice: bigint,
  longToken: Address,
  shortTokenDecimals = 6
): IGmxPositionMetrics {
  const sizeUsd = p.numbers.sizeInUsd
  const collateralUsd = isAddressEqual(p.addresses.collateralToken, longToken)
    ? p.numbers.collateralAmount * markPrice
    : p.numbers.collateralAmount * 10n ** BigInt(30 - shortTokenDecimals)
  const marginUsd = collateralUsd + getPositionPnlUsd(p.flags.isLong, sizeUsd, p.numbers.sizeInTokens, markPrice)
  return {
    isLong: p.flags.isLong,
    sizeUsd,
    collateralUsd,
    marginUsd,
    leverage: collateralUsd > 0n ? Number(sizeUsd) / Number(collateralUsd) : Number.POSITIVE_INFINITY,
    effLeverage: marginUsd > 0n ? Number(sizeUsd) / Number(marginUsd) : Number.POSITIVE_INFINITY
  }
}

export interface IUpdateOrder {
  key: Hex
  sizeDeltaUsd: bigint
  acceptablePrice: bigint
  triggerPrice: bigint
  minOutputAmount: bigint
  validFromTime: bigint
  autoCancel: boolean
}

export type IGmxOperatorConfig = Omit<IOperatorConfig, 'chainId'>

export async function gmxOperator(connector: IConnector, config: IGmxOperatorConfig) {
  const operator = await createOperator(connector, { ...config, chainId: GMX_V2_CHAIN_ID })
  const { publicClient, account } = operator
  const registeredTokens = registeredTokenAddresses(connector.tokenRegistry, GMX_V2_CHAIN_ID)
  const collateral = getAddress(config.token)
  const marketBase = providerToken(collateral, GMX_V2_CHAIN_ID)

  function operate(callList: IIAccount__Call[], open = false) {
    assertOperateSignable(screenOperate({ chainId: GMX_V2_CHAIN_ID, callList, account, releaseTargets: [], baseTokens: registeredTokens, registeredTokens }))
    return operator.operate(callList, open)
  }

  async function quoteExecutionFee(order: IGmxOrder): Promise<bigint> {
    const [gasLimitsConfig, gasPrice] = await Promise.all([
      getGasLimitsConfig(publicClient),
      publicClient.getGasPrice()
    ])
    const decreaseSwaps =
      GMX_DECREASE_TYPES.has(order.orderType) &&
      (order.decreaseSwapType ?? GMX_DECREASE_SWAP_TYPE.SwapPnlTokenToCollateralToken) !== GMX_DECREASE_SWAP_TYPE.NoSwap
        ? 1n
        : 0n
    const swaps = BigInt(order.swapPath?.length ?? 0) + decreaseSwaps
    const actionGasLimit =
      (GMX_INCREASE_TYPES.has(order.orderType)
        ? gasLimitsConfig.increaseOrderGasLimit
        : gasLimitsConfig.decreaseOrderGasLimit) +
      gasLimitsConfig.singleSwapGasLimit * swaps
    const fee = calculateExecutionFee(gasLimitsConfig, gasPrice, actionGasLimit)
    return (fee * (10_000n + EXECUTION_FEE_BUFFER_BPS)) / 10_000n
  }

  async function createOrder(p: IGmxOrder, open = false) {
    const executionFee = p.executionFee ?? (await quoteExecutionFee(p))
    const { callList, outflows } = buildGmxOrderCalls(p, { master: account, baseToken: collateral, executionFee })
    await Promise.all(
      outflows.map(async o => {
        const outToken = getAddress(o.token)
        const balance = await operator.readBalance(outToken)
        if (o.amountOut > balance) {
          throw new Error(
            `insufficient ${symbolOf(GMX_V2_CHAIN_ID, outToken)}: the trading body holds ${balance}, order needs ${o.amountOut}; credit more or size down`
          )
        }
      })
    )
    return operate(callList, open)
  }

  return {
    operator,
    markets: ARBITRUM_MARKET_LIST,
    getMarket(indexToken: Address): Address {
      return selectGmxMarket(marketBase, indexToken)
    },
    getPositions(target: Address = account) {
      return publicClient.readContract({
        address: READER,
        abi: READER_ABI,
        functionName: 'getAccountPositions',
        args: [DATA_STORE, target, 0n, 1000n]
      })
    },
    getOrders(target: Address = account) {
      return publicClient.readContract({
        address: READER,
        abi: READER_ABI,
        functionName: 'getAccountOrders',
        args: [DATA_STORE, target, 0n, 1000n]
      })
    },
    createOrder,
    cancelOrder(key: Hex) {
      const callData = encodeFunctionData({ abi: GMX_ROUTER_ABI, functionName: 'cancelOrder', args: [key] })
      return operate([{ target: GMX_ROUTER, value: 0n, gasLimit: 1_000_000n, callData }])
    },
    updateOrder(p: IUpdateOrder) {
      const callData = encodeFunctionData({
        abi: GMX_ROUTER_ABI,
        functionName: 'updateOrder',
        args: [p.key, p.sizeDeltaUsd, p.acceptablePrice, p.triggerPrice, p.minOutputAmount, p.validFromTime, p.autoCancel]
      })
      return operate([{ target: GMX_ROUTER, value: 0n, gasLimit: 1_000_000n, callData }])
    }
  }
}
