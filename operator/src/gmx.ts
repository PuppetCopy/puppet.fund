import { CHAIN_TOKEN_MAP, GMX_REFERRAL_CODE, HUB_CHAIN_ID } from '@puppet/contracts/const'
import { ARBITRUM_MARKET_LIST, GMX_V2_CONTRACT_MAP } from '@puppet/contracts/gmx'
import type { IIAccount__Call } from '@puppet/contracts/types'
import { EMPTY_NAME, predictMasterAccount, TOKEN_ID } from '@puppet/sdk/account'
import { attestOperateIntent, fetchAccountOrThrow, type IOperateInput } from '@puppet/sdk/attestation'
import { createCompact } from '@puppet/sdk/compact'
import { DEFAULT_DEADLINE_SEC, HUB_CHAIN, HUB_CHAIN_NETWORK } from '@puppet/sdk/const'
import {
  createIndexerClient,
  getAcceptableRelayFee,
  getIndexerBlock,
  loadTokenRegistry,
  randomNonce,
  relayRouterForKind,
  tokenInfoFor
} from '@puppet/sdk/state'
import {
  type Address,
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  http,
  isAddressEqual,
  toHex,
  zeroAddress
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { type IPairedSession, pairOverBrowser } from './pair.js'

const ROUTER = GMX_V2_CONTRACT_MAP.GmxExchangeRouter.address
const ROUTER_ABI = GMX_V2_CONTRACT_MAP.GmxExchangeRouter.abi
const ORDER_VAULT = GMX_V2_CONTRACT_MAP.GmxOrderVault.address
const READER = GMX_V2_CONTRACT_MAP.GmxReaderV2.address
const READER_ABI = GMX_V2_CONTRACT_MAP.GmxReaderV2.abi
const DATA_STORE = GMX_V2_CONTRACT_MAP.GmxDatastore.address

export const GMX_ORDER_TYPE = {
  MarketSwap: 0,
  LimitSwap: 1,
  MarketIncrease: 2,
  LimitIncrease: 3,
  MarketDecrease: 4,
  LimitDecrease: 5,
  StopLossDecrease: 6,
  StopIncrease: 8
} as const

export const GMX_DECREASE_SWAP_TYPE = {
  NoSwap: 0,
  SwapPnlTokenToCollateralToken: 1,
  SwapCollateralTokenToPnlToken: 2
} as const

const INCREASE_TYPES: ReadonlySet<number> = new Set([
  GMX_ORDER_TYPE.MarketIncrease,
  GMX_ORDER_TYPE.LimitIncrease,
  GMX_ORDER_TYPE.StopIncrease
])
const DECREASE_TYPES: ReadonlySet<number> = new Set([
  GMX_ORDER_TYPE.MarketDecrease,
  GMX_ORDER_TYPE.LimitDecrease,
  GMX_ORDER_TYPE.StopLossDecrease
])

export interface IGmxConfig {
  // Connection endpoints. Optional when pairing — the site supplies them over the
  // tunnel; pass them here to override, or required when running headless.
  matchmakerUrl?: string
  indexerUrl?: string
  rpcUrl?: string
  user?: Address
  signerKey?: Hex
  name?: string
  // Pairing: the site you open the printed link on. Defaults to https://puppet.fund.
  siteUrl?: string
  pairPort?: number
}

export interface IOperateAmounts {
  amountIn: bigint
  amountOut: bigint
}

export interface IGmxOrder {
  orderType: number
  market: Address
  isLong: boolean
  sizeDeltaUsd: bigint
  collateralDelta: bigint
  executionFee: bigint
  acceptablePrice?: bigint
  triggerPrice?: bigint
  minOutputAmount?: bigint
  decreaseSwapType?: number
  swapPath?: Address[]
  autoCancel?: boolean
}

export interface IUpdateOrder {
  key: Hex
  sizeDeltaUsd: bigint
  acceptablePrice?: bigint
  triggerPrice?: bigint
  minOutputAmount?: bigint
  autoCancel?: boolean
}

// A GMX operator on a WETH account. GMX pays its keeper fee in WNT (WETH on
// Arbitrum), so the operator runs WETH-only — collateral and the fee are the same
// token and nothing else needs funding. Pass signerKey+user to run headless, or
// omit both to pair over the browser (key stays in memory). Sets up the matchmaker
// compact itself; the master must already be deployed (create + fund a WETH
// account on the site first).
export async function gmxOperator(config: IGmxConfig = {}) {
  if ((config.signerKey == null) !== (config.user == null)) {
    throw new Error('headless mode needs both signerKey and user — set both, or neither to pair over the browser')
  }
  const session: IPairedSession =
    config.signerKey && config.user
      ? { signerKey: config.signerKey, user: config.user, endpoints: {} }
      : await pairOverBrowser(config.siteUrl, config.pairPort)

  // Endpoints come from the config (override / headless) or the tunnel (pairing).
  const matchmakerUrl = config.matchmakerUrl ?? session.endpoints.matchmakerUrl
  const indexerUrl = config.indexerUrl ?? session.endpoints.indexerUrl
  const rpcUrl = config.rpcUrl ?? session.endpoints.rpcUrl
  if (!matchmakerUrl || !indexerUrl || !rpcUrl) {
    throw new Error('missing endpoint(s) — set matchmakerUrl/indexerUrl/rpcUrl, or pair with a site that supplies them')
  }

  // The session signer never leaves this scope; the venue exposes orders, not the key.
  const account = privateKeyToAccount(session.signerKey)
  const sql = createIndexerClient(indexerUrl)
  const publicClient = createPublicClient({ chain: HUB_CHAIN, transport: http(rpcUrl) })
  const tokenRegistry = await loadTokenRegistry(sql)
  const token = tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, TOKEN_ID.WETH).token
  if (!isAddressEqual(token, CHAIN_TOKEN_MAP[HUB_CHAIN_ID].WETH as Address)) {
    throw new Error('registered WETH token mismatch')
  }
  const name = config.name ? toHex(config.name, { size: 32 }) : EMPTY_NAME
  const params = { user: session.user, signer: account.address, name, baseTokenId: TOKEN_ID.WETH } as const
  const master = predictMasterAccount(params)

  const code = await publicClient.getCode({ address: master })
  if (!code || code === '0x') {
    throw new Error(`master ${master} is not deployed — create and fund a WETH account on the site, then restart`)
  }

  const compact = createCompact({ matchmakerUrl, sql })

  async function operate(callList: IIAccount__Call[], amounts: IOperateAmounts) {
    const blockNumber = await getIndexerBlock(sql, HUB_CHAIN_NETWORK)
    const row = await fetchAccountOrThrow(sql, master, HUB_CHAIN_ID)
    const gasPrice = await publicClient.getGasPrice()
    const acceptableRelayFee = await getAcceptableRelayFee(
      gasPrice,
      relayRouterForKind('operate'),
      'operate',
      token,
      publicClient
    )
    const input: IOperateInput = {
      params,
      blockNumber,
      deadline: BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC),
      acceptableRelayFee,
      nonce: randomNonce(),
      chainId: BigInt(HUB_CHAIN_ID),
      callList,
      amountIn: amounts.amountIn,
      amountOut: amounts.amountOut
    }
    const { intent, typedData } = attestOperateIntent(
      { chainId: HUB_CHAIN_ID, tokenRegistry, currentBlock: blockNumber, signedBalance: row.signedBalance },
      input
    )
    const signature = await account.signTypedData(typedData)
    return compact.attest({ kind: 'operate', input, intent, signature })
  }

  // The one order primitive: any increase/decrease variant — market, limit, stop,
  // take-profit — via orderType + triggerPrice. Opening is an increase from zero;
  // a full close is a decrease by the position's whole size. Increase-family orders
  // send collateral + the WNT fee to the OrderVault now (amountOut bounds their
  // sum); decrease-family orders send only the fee (freed collateral returns async
  // on keeper execution). Position value is tracked off-chain via the indexer, not
  // signedBalance. Anything outside this (swaps, claims) goes through operate().
  function createOrder(p: IGmxOrder) {
    if (INCREASE_TYPES.has(p.orderType)) {
      const total = p.collateralDelta + p.executionFee
      const callList: IIAccount__Call[] = [
        call(token, approve(total), 100_000n),
        call(ROUTER, sendTokens(token, p.executionFee), 150_000n),
        call(ROUTER, sendTokens(token, p.collateralDelta), 150_000n),
        call(ROUTER, encodeCreateOrder(master, token, p, 0n), 1_000_000n)
      ]
      return operate(callList, { amountIn: 0n, amountOut: total })
    }
    if (DECREASE_TYPES.has(p.orderType)) {
      const callList: IIAccount__Call[] = [
        call(token, approve(p.executionFee), 100_000n),
        call(ROUTER, sendTokens(token, p.executionFee), 150_000n),
        call(ROUTER, encodeCreateOrder(master, token, p, p.collateralDelta), 1_000_000n)
      ]
      return operate(callList, { amountIn: 0n, amountOut: p.executionFee })
    }
    throw new Error(`unsupported GMX order type ${p.orderType} for a single-base-token operator`)
  }

  return {
    master,
    signer: account.address,
    status: compact.status,
    GMX_ORDER_TYPE,
    GMX_DECREASE_SWAP_TYPE,
    markets: ARBITRUM_MARKET_LIST,
    getMarket(indexToken: Address): Address {
      const matches = ARBITRUM_MARKET_LIST.filter(
        m =>
          isAddressEqual(m.indexToken as Address, indexToken) &&
          (isAddressEqual(m.longToken as Address, token) || isAddressEqual(m.shortToken as Address, token))
      )
      if (matches.length === 0) throw new Error(`GMX market not found for index=${indexToken} collateral=${token}`)
      if (matches.length > 1) {
        throw new Error(
          `ambiguous GMX market for index=${indexToken} collateral=${token} — pass the marketToken to createOrder directly`
        )
      }
      return matches[0].marketToken as Address
    },
    getAccountState() {
      return fetchAccountOrThrow(sql, master, HUB_CHAIN_ID)
    },
    getPositions() {
      return publicClient.readContract({
        address: READER,
        abi: READER_ABI,
        functionName: 'getAccountPositions',
        args: [DATA_STORE, master, 0n, 1000n]
      })
    },
    getOrders() {
      return publicClient.readContract({
        address: READER,
        abi: READER_ABI,
        functionName: 'getAccountOrders',
        args: [DATA_STORE, master, 0n, 1000n]
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
    },
    operate,
    close() {
      compact.close()
    }
  }
}

function call(target: Address, callData: Hex, gasLimit: bigint): IIAccount__Call {
  return { target, value: 0n, gasLimit, callData }
}

function approve(amount: bigint): Hex {
  return encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [ROUTER, amount] })
}

function sendTokens(token: Address, amount: bigint): Hex {
  return encodeFunctionData({ abi: ROUTER_ABI, functionName: 'sendTokens', args: [token, ORDER_VAULT, amount] })
}

// initialCollateralDeltaAmount is the collateral removed on a decrease; on an
// increase the collateral is whatever was sent to the vault (so 0 here, GMX uses
// the recorded transfer).
function encodeCreateOrder(
  receiver: Address,
  collateralToken: Address,
  p: IGmxOrder,
  collateralDeltaAmount: bigint
): Hex {
  return encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: 'createOrder',
    args: [
      {
        addresses: {
          receiver,
          cancellationReceiver: receiver,
          callbackContract: zeroAddress,
          uiFeeReceiver: zeroAddress,
          market: p.market,
          initialCollateralToken: collateralToken,
          swapPath: p.swapPath ?? []
        },
        numbers: {
          sizeDeltaUsd: p.sizeDeltaUsd,
          initialCollateralDeltaAmount: collateralDeltaAmount,
          triggerPrice: p.triggerPrice ?? 0n,
          acceptablePrice: p.acceptablePrice ?? 0n,
          executionFee: p.executionFee,
          callbackGasLimit: 0n,
          minOutputAmount: p.minOutputAmount ?? 0n,
          validFromTime: 0n
        },
        orderType: p.orderType,
        decreasePositionSwapType: p.decreaseSwapType ?? 0,
        isLong: p.isLong,
        shouldUnwrapNativeToken: false,
        autoCancel: p.autoCancel ?? false,
        referralCode: GMX_REFERRAL_CODE,
        dataList: []
      }
    ]
  })
}
