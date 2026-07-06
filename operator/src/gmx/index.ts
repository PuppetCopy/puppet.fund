import { PROTOCOL } from '@puppet/contracts/const'
import { ARBITRUM_MARKET_LIST, GMX_V2_CONTRACT_MAP } from '@puppet/contracts/gmx'
import type { IIAccount__Call, IIAccount__SignTransfer } from '@puppet/contracts/types'
import { calculateExecutionFee, getGasLimitsConfig, getPositionPnlUsd, type IGasLimitsConfig } from '@puppet/sdk/gmx'
import { NATIVE_PRECISION, registeredTokenAddresses, symbolByAddress, tokenInfoFor } from '@puppet/sdk/state'
import {
  assertOperateSignable,
  buildGmxOrderCalls,
  GMX_DECREASE_SWAP_TYPE,
  GMX_DECREASE_TYPES,
  GMX_INCREASE_TYPES,
  GMX_ORDER_TYPE,
  GMX_V2_CHAIN_ID,
  GMX_WNT,
  type IGmxOrder,
  screenGmxOperate,
  selectGmxMarket
} from '@puppet/sdk/venue'
import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  getAddress,
  type Hex,
  isAddressEqual,
  parseUnits
} from 'viem'
import type { IConnector } from '../connector.js'
import { createOperator } from '../operator.js'

export { calculateExecutionFee, getGasLimitsConfig, getPositionPnlUsd, type IGasLimitsConfig } from '@puppet/sdk/gmx'
export { GMX_DECREASE_SWAP_TYPE, GMX_ORDER_TYPE, GMX_V2_CHAIN_ID, type IGmxOrder } from '@puppet/sdk/venue'

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

export const GMX_BASE_TOKEN = GMX_WNT

export const gmxTokenPerNativeToken = async (feeToken: Address): Promise<bigint> => {
  if (isAddressEqual(getAddress(feeToken), GMX_BASE_TOKEN)) return NATIVE_PRECISION
  throw new Error(`gmx operator prices relay fees in WETH only, not ${feeToken}`)
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

export interface IGmxOptions {
  rpcUrl?: string
  executionFeeBufferBps?: bigint
}

export interface IUpdateOrder {
  key: Hex
  sizeDeltaUsd: bigint
  acceptablePrice?: bigint
  triggerPrice?: bigint
  minOutputAmount?: bigint
  validFromTime?: bigint
  autoCancel?: boolean
}

export async function gmxOperator(connector: IConnector, opts: IGmxOptions = {}) {
  const operator = await createOperator(connector, {
    chainId: GMX_V2_CHAIN_ID,
    rpcUrl: opts.rpcUrl,
    getTokenPerNativeToken: gmxTokenPerNativeToken
  })
  const { publicClient } = operator
  const { baseToken, fund, tokenRegistry } = connector
  const registeredTokens = registeredTokenAddresses(tokenRegistry, GMX_V2_CHAIN_ID)
  const marketBase = isAddressEqual(baseToken, PROTOCOL.nativeToken) ? GMX_WNT : baseToken

  function operate(
    callList: IIAccount__Call[],
    transferList: IIAccount__SignTransfer[] = [{ token: PROTOCOL.nativeToken, amountIn: 0n, amountOut: 0n }]
  ) {
    const baseTokens = transferList.map(l => tokenInfoFor(tokenRegistry, GMX_V2_CHAIN_ID, getAddress(l.token)).token)
    assertOperateSignable(screenGmxOperate({ callList, account: fund, baseTokens, registeredTokens }))
    return operator.operate(callList, transferList)
  }

  const executionFeeBufferBps = opts.executionFeeBufferBps ?? 2_000n
  let gasLimitsConfig: IGasLimitsConfig | null = null
  async function quoteExecutionFee(order: IGmxOrder): Promise<bigint> {
    if (!gasLimitsConfig) gasLimitsConfig = await getGasLimitsConfig(publicClient)
    const gasPrice = await publicClient.getGasPrice()
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
    return (fee * (10_000n + executionFeeBufferBps)) / 10_000n
  }

  async function createOrder(p: IGmxOrder) {
    const executionFee = p.executionFee ?? (await quoteExecutionFee(p))
    const { callList, outflows } = buildGmxOrderCalls(p, { master: fund, baseToken, executionFee })
    const transferList = await Promise.all(
      outflows.map(async o => {
        const outToken = getAddress(o.token)
        const isNative = isAddressEqual(outToken, PROTOCOL.nativeToken)
        const [balance, signed] = await Promise.all([
          isNative
            ? publicClient.getBalance({ address: fund })
            : publicClient.readContract({ address: outToken, abi: erc20Abi, functionName: 'balanceOf', args: [fund] }),
          operator.readSignedBalance(outToken)
        ])
        if (o.amountOut > balance) {
          const sym = symbolByAddress(outToken)
          throw new Error(
            `insufficient ${sym}: fund holds ${balance}, order needs ${o.amountOut}, allocate more on the site or size down`
          )
        }
        return { token: outToken, amountIn: balance > signed ? balance - signed : 0n, amountOut: o.amountOut }
      })
    )
    return operate(callList, transferList)
  }

  return {
    operator,
    GMX_ORDER_TYPE,
    GMX_DECREASE_SWAP_TYPE,
    markets: ARBITRUM_MARKET_LIST,
    getMarket(indexToken: Address): Address {
      return selectGmxMarket(marketBase, indexToken)
    },
    getPositions(account: Address = fund) {
      return publicClient.readContract({
        address: READER,
        abi: READER_ABI,
        functionName: 'getAccountPositions',
        args: [DATA_STORE, account, 0n, 1000n]
      })
    },
    getOrders(account: Address = fund) {
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
      return operate([{ target: ROUTER, value: 0n, gasLimit: 1_000_000n, callData }])
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
          p.validFromTime ?? 0n,
          p.autoCancel ?? false
        ]
      })
      return operate([{ target: ROUTER, value: 0n, gasLimit: 1_000_000n, callData }])
    }
  }
}
