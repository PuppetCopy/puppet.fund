import { CHAIN_TOKEN_MAP, HUB_CHAIN_ID, TOKEN_ID } from '@puppet/contracts/const'
import { ARBITRUM_MARKET_LIST, GMX_V2_CONTRACT_MAP } from '@puppet/contracts/gmx'
import type { IIAccount__Call } from '@puppet/contracts/types'
import { calculateExecutionFee, getGasLimitsConfig, type IGasLimitsConfig } from '@puppet/sdk/gmx'
import {
  buildGmxOrderCalls,
  GMX_DECREASE_SWAP_TYPE,
  GMX_INCREASE_TYPES,
  GMX_ORDER_TYPE,
  type IGmxOrder,
  selectGmxMarket
} from '@puppet/sdk/venue'
import { type Address, encodeFunctionData, formatUnits, type Hex, isAddressEqual, parseUnits } from 'viem'
import type { IOperatorCore } from '../core.js'

export { GMX_DECREASE_SWAP_TYPE, GMX_ORDER_TYPE, type IGmxOrder } from '@puppet/sdk/venue'

const ROUTER = GMX_V2_CONTRACT_MAP.GmxExchangeRouter.address
const ROUTER_ABI = GMX_V2_CONTRACT_MAP.GmxExchangeRouter.abi
const READER = GMX_V2_CONTRACT_MAP.GmxReaderV2.address
const READER_ABI = GMX_V2_CONTRACT_MAP.GmxReaderV2.abi
const DATA_STORE = GMX_V2_CONTRACT_MAP.GmxDatastore.address

export const usd = (amount: string | number): bigint => parseUnits(String(amount), 30)
export const weth = (amount: string | number): bigint => parseUnits(String(amount), 18)
export const formatUsd = (amount: bigint): string => formatUnits(amount, 30)
export const formatWeth = (amount: bigint): string => formatUnits(amount, 18)

export const gmxPrice = (usdPerToken: string | number, indexTokenDecimals: number): bigint => {
  const decimals = 30 - indexTokenDecimals
  const value = typeof usdPerToken === 'number' ? usdPerToken.toFixed(Math.min(decimals, 8)) : usdPerToken
  return parseUnits(value, decimals)
}

export { calculateExecutionFee, getGasLimitsConfig, getPositionPnlUsd, type IGasLimitsConfig } from '@puppet/sdk/gmx'

export const GMX_BASE_TOKEN_ID = TOKEN_ID.WETH

export interface IGmxOptions {
  executionFeeBufferBps?: bigint
}

export interface IUpdateOrder {
  key: Hex
  sizeDeltaUsd: bigint
  acceptablePrice?: bigint
  triggerPrice?: bigint
  minOutputAmount?: bigint
  autoCancel?: boolean
}

export function gmxOperator(core: IOperatorCore, opts: IGmxOptions = {}) {
  if (!isAddressEqual(core.token, CHAIN_TOKEN_MAP[HUB_CHAIN_ID].WETH as Address)) {
    throw new Error('gmxOperator needs a WETH-based core — create it with baseTokenId GMX_BASE_TOKEN_ID')
  }
  const { operate, publicClient, token, master } = core

  const executionFeeBufferBps = opts.executionFeeBufferBps ?? 2_000n
  let gasLimitsConfig: IGasLimitsConfig | null = null
  async function quoteExecutionFee(orderType: number): Promise<bigint> {
    if (!gasLimitsConfig) gasLimitsConfig = await getGasLimitsConfig(publicClient)
    const gasPrice = await publicClient.getGasPrice()
    const actionGasLimit = GMX_INCREASE_TYPES.has(orderType)
      ? gasLimitsConfig.increaseOrderGasLimit
      : gasLimitsConfig.decreaseOrderGasLimit
    const fee = calculateExecutionFee(gasLimitsConfig, gasPrice, actionGasLimit)
    return (fee * (10_000n + executionFeeBufferBps)) / 10_000n
  }

  async function createOrder(p: IGmxOrder) {
    const executionFee = p.executionFee ?? (await quoteExecutionFee(p.orderType))
    const { callList, amountIn, amountOut } = buildGmxOrderCalls(p, { master, baseToken: token, executionFee })
    return operate(callList, { amountIn, amountOut })
  }

  return {
    GMX_ORDER_TYPE,
    GMX_DECREASE_SWAP_TYPE,
    markets: ARBITRUM_MARKET_LIST,
    getMarket(indexToken: Address): Address {
      return selectGmxMarket(token, indexToken)
    },
    getPositions(account: Address = master) {
      return publicClient.readContract({
        address: READER,
        abi: READER_ABI,
        functionName: 'getAccountPositions',
        args: [DATA_STORE, account, 0n, 1000n]
      })
    },
    getOrders(account: Address = master) {
      return publicClient.readContract({
        address: READER,
        abi: READER_ABI,
        functionName: 'getAccountOrders',
        args: [DATA_STORE, account, 0n, 1000n]
      })
    },
    createOrder,
    cancelOrder(key: Hex) {
      const callData = encodeFunctionData({ abi: ROUTER_ABI, functionName: 'cancelOrder', args: [key] })
      return operate([call(ROUTER, callData, 1_000_000n)], { amountIn: 0n, amountOut: 0n })
    },
    updateOrder(p: IUpdateOrder) {
      const callData = encodeFunctionData({
        abi: ROUTER_ABI,
        functionName: 'updateOrder',
        args: [
          p.key,
          p.sizeDeltaUsd,
          p.acceptablePrice ?? 0n,
          p.triggerPrice ?? 0n,
          p.minOutputAmount ?? 0n,
          0n,
          p.autoCancel ?? false
        ]
      })
      return operate([call(ROUTER, callData, 1_000_000n)], { amountIn: 0n, amountOut: 0n })
    }
  }
}

function call(target: Address, callData: Hex, gasLimit: bigint): IIAccount__Call {
  return { target, value: 0n, gasLimit, callData }
}
