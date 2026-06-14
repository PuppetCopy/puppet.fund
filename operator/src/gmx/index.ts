import { TOKEN_ID } from '@puppet/contracts/const'
import { ARBITRUM_MARKET_LIST, GMX_V2_CONTRACT_MAP } from '@puppet/contracts/gmx'
import type { IIAccount__Call } from '@puppet/contracts/types'
import { symbolForBaseTokenId } from '@puppet/sdk/account'
import { calculateExecutionFee, getGasLimitsConfig, getPositionPnlUsd, type IGasLimitsConfig } from '@puppet/sdk/gmx'
import {
  buildGmxOrderCalls,
  GMX_DECREASE_SWAP_TYPE,
  GMX_INCREASE_TYPES,
  GMX_ORDER_TYPE,
  type IGmxOrder,
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
  parseUnits,
  zeroAddress
} from 'viem'
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
  const { operate, publicClient, token, fund } = core

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
    const { callList, outflows } = buildGmxOrderCalls(p, { master: fund, baseToken: token, executionFee })
    // Each outflow is a SIGNED leg: amountOut leaves the fund (collateral and/or the native
    // execution fee), amountIn = surplus (base GMX paid back since the last order — freed
    // collateral, fee refunds) rides along so the spendable balance converges to the live
    // balance on every order. Native legs read the account ETH balance, ERC-20 legs balanceOf.
    const transferList = await Promise.all(
      outflows.map(async o => {
        const outToken = getAddress(o.token)
        const tokenId = core.tokenIdFor(outToken)
        const isNative = isAddressEqual(outToken, zeroAddress)
        const [balance, signed] = await Promise.all([
          isNative
            ? publicClient.getBalance({ address: fund })
            : publicClient.readContract({ address: outToken, abi: erc20Abi, functionName: 'balanceOf', args: [fund] }),
          core.readSignedBalance(tokenId)
        ])
        if (o.amountOut > balance) {
          const sym = symbolForBaseTokenId(tokenId) ?? outToken
          throw new Error(
            `insufficient ${sym}: fund holds ${balance}, order needs ${o.amountOut} — allocate more on the site or size down`
          )
        }
        return { tokenId, token: outToken, amountIn: balance > signed ? balance - signed : 0n, amountOut: o.amountOut }
      })
    )
    return operate(callList, transferList)
  }

  return {
    GMX_ORDER_TYPE,
    GMX_DECREASE_SWAP_TYPE,
    markets: ARBITRUM_MARKET_LIST,
    getMarket(indexToken: Address): Address {
      return selectGmxMarket(token, indexToken)
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
      return operate([call(ROUTER, callData, 1_000_000n)])
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
      return operate([call(ROUTER, callData, 1_000_000n)])
    }
  }
}

function call(target: Address, callData: Hex, gasLimit: bigint): IIAccount__Call {
  return { target, value: 0n, gasLimit, callData }
}
