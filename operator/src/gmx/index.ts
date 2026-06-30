import { CHAIN_NETWORK_MAP, CHAIN_TOKEN_MAP, PROTOCOL } from '@puppet/contracts/const'
import { ARBITRUM_MARKET_LIST, GMX_V2_CONTRACT_MAP } from '@puppet/contracts/gmx'
import type { IIAccount__Call, IIAccount__SignTransfer } from '@puppet/contracts/types'
import {
  NATIVE_PRECISION,
  registeredTokenAddresses,
  staticTokenRegistry,
  symbolByAddress,
  tokenInfoFor
} from '@puppet/sdk/state'
import { calculateExecutionFee, getGasLimitsConfig, getPositionPnlUsd, type IGasLimitsConfig } from '@puppet/sdk/gmx'
import {
  assertOperateSignable,
  buildGmxOrderCalls,
  GMX_DECREASE_SWAP_TYPE,
  GMX_INCREASE_TYPES,
  GMX_ORDER_TYPE,
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
import type { IOperatorCore } from '../core.js'

// GMX V2 lives on Arbitrum; resolve the chain id off the network slug so it tracks const.toml.
const GMX_NETWORK = 'arbitrum' as const
type IGmxChainId = {
  [K in keyof typeof CHAIN_NETWORK_MAP]: (typeof CHAIN_NETWORK_MAP)[K] extends typeof GMX_NETWORK ? K : never
}[keyof typeof CHAIN_NETWORK_MAP]
export const GMX_V2_CHAIN_ID = Number(
  Object.entries(CHAIN_NETWORK_MAP).find(([, network]) => network === GMX_NETWORK)![0]
) as IGmxChainId

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

export const GMX_BASE_TOKEN = getAddress(CHAIN_TOKEN_MAP[GMX_V2_CHAIN_ID].WETH)

// GMX funds settle in WETH (the venue's wrapped native, ~1:1 with the gas token). Pass this as the
// operator's `getTokenPerNativeToken` so the WETH relay-fee leg auto-prices; the chain-agnostic core
// only auto-prices the bare native token.
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
  const { publicClient, token, fund } = core
  const screenRegistry = staticTokenRegistry()
  const registeredTokens = registeredTokenAddresses(screenRegistry, GMX_V2_CHAIN_ID)

  // Advisory client screen: confine every dispatched call to the GMX perimeter with the fund as the
  // sole beneficiary before it leaves the machine. The matchmaker re-screens and the gate enforces,
  // so this only buys an early, readable rejection — the venue owns it, the generic core does not.
  function operate(
    callList: IIAccount__Call[],
    transferList: IIAccount__SignTransfer[] = [{ token, amountIn: 0n, amountOut: 0n }]
  ) {
    const baseTokens = transferList.map(l => tokenInfoFor(screenRegistry, GMX_V2_CHAIN_ID, getAddress(l.token)).token)
    assertOperateSignable(screenGmxOperate({ callList, account: fund, baseTokens, registeredTokens }))
    return core.operate(callList, transferList)
  }

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
        const isNative = isAddressEqual(outToken, PROTOCOL.nativeToken)
        const [balance, signed] = await Promise.all([
          isNative
            ? publicClient.getBalance({ address: fund })
            : publicClient.readContract({ address: outToken, abi: erc20Abi, functionName: 'balanceOf', args: [fund] }),
          core.readSignedBalance(outToken)
        ])
        if (o.amountOut > balance) {
          const sym = symbolByAddress(outToken)
          throw new Error(
            `insufficient ${sym}: fund holds ${balance}, order needs ${o.amountOut} — allocate more on the site or size down`
          )
        }
        return { token: outToken, amountIn: balance > signed ? balance - signed : 0n, amountOut: o.amountOut }
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
