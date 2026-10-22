import { describe, expect, test } from 'bun:test'
import { PROTOCOL } from '@puppet/contracts/const'
import type { IIAccount__Call } from '@puppet/contracts/types'
import { type Address, encodeFunctionData, erc20Abi, getAddress, type Hex, maxUint256, parseAbi, zeroAddress } from 'viem'
import { screenDappTypedData } from '../dapp.js'
import { screenOperate } from '../screen.js'
import type { IScreenContext } from '../types.js'
import { GMX_ORDER_TYPE, GMX_ORDER_VAULT, GMX_REFERRAL_CODE, GMX_ROUTER, GMX_ROUTER_ABI, GMX_TOKEN_SPENDER, GMX_V2_CHAIN_ID, GMX_WNT } from './contracts.js'
import { buildGmxOrderCalls } from './orders.js'
import { gmxVenue } from './screen.js'

const account = getAddress('0x1111111111111111111111111111111111111111')
const USDC = getAddress('0xaf88d065e77c8cC2239327C5EDb3A432268e5831')
const ETH_MARKET = getAddress('0x70d95587d40A2caf56bd97485aB3Eec10Bee6336')
const ORDER_KEY: Hex = `0x${'11'.repeat(32)}`
const FEE = 10n ** 15n
const COLLATERAL = 10_000n * 10n ** 6n

const ctx: IScreenContext = {
  chainId: GMX_V2_CHAIN_ID,
  account,
  registeredTokens: [USDC, GMX_WNT, PROTOCOL.nativeToken],
  facts: { markets: new Map([[ETH_MARKET, { indexToken: GMX_WNT, longToken: GMX_WNT, shortToken: USDC }]]), tokens: new Map(), owners: new Map() }
}

const createOrder = (
  orderType: number,
  collateral: Address,
  extra: { market?: Address; swapPath?: Address[]; dataList?: Hex[]; shouldUnwrapNativeToken?: boolean } = {}
): Hex =>
  encodeFunctionData({
    abi: GMX_ROUTER_ABI,
    functionName: 'createOrder',
    args: [
      {
        addresses: {
          receiver: account,
          cancellationReceiver: account,
          callbackContract: zeroAddress,
          uiFeeReceiver: zeroAddress,
          market: extra.market ?? ETH_MARKET,
          initialCollateralToken: collateral,
          swapPath: extra.swapPath ?? []
        },
        numbers: {
          sizeDeltaUsd: 10n ** 33n,
          initialCollateralDeltaAmount: 0n,
          triggerPrice: 0n,
          acceptablePrice: 0n,
          executionFee: FEE,
          callbackGasLimit: 0n,
          minOutputAmount: 0n,
          validFromTime: 0n
        },
        orderType,
        decreasePositionSwapType: 0,
        isLong: true,
        shouldUnwrapNativeToken: extra.shouldUnwrapNativeToken ?? false,
        autoCancel: false,
        referralCode: GMX_REFERRAL_CODE,
        dataList: extra.dataList ?? []
      }
    ]
  })

const sendTokens = (token: Address, amount: bigint): Hex =>
  encodeFunctionData({ abi: GMX_ROUTER_ABI, functionName: 'sendTokens', args: [token, GMX_ORDER_VAULT, amount] })
const sendWnt = (amount: bigint): Hex => encodeFunctionData({ abi: GMX_ROUTER_ABI, functionName: 'sendWnt', args: [GMX_ORDER_VAULT, amount] })
const cancelOrder = (): Hex => encodeFunctionData({ abi: GMX_ROUTER_ABI, functionName: 'cancelOrder', args: [ORDER_KEY] })
const claimFundingFees = (receiver: Address): Hex =>
  encodeFunctionData({ abi: GMX_ROUTER_ABI, functionName: 'claimFundingFees', args: [[ETH_MARKET], [USDC], receiver] })
const updateOrder = (): Hex =>
  encodeFunctionData({ abi: GMX_ROUTER_ABI, functionName: 'updateOrder', args: [ORDER_KEY, 10n ** 33n, 0n, 1n, 0n, 0n, false] })

const router = (legs: Hex[], value = 0n): IIAccount__Call => ({
  target: GMX_ROUTER,
  value,
  gasLimit: 0n,
  callData: encodeFunctionData({ abi: GMX_ROUTER_ABI, functionName: 'multicall', args: [legs] })
})
const approveRouter = (token: Address, amount: bigint): IIAccount__Call => ({
  target: token,
  value: 0n,
  gasLimit: 0n,
  callData: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [GMX_TOKEN_SPENDER, amount] })
})

const codes = (call: IIAccount__Call): string[] => gmxVenue.screen(ctx, call).map(r => r.code)
const screenList = (callList: IIAccount__Call[]) => screenOperate({ ...ctx, callList })

describe('GMX router transfers pair with the order that records them', () => {
  test("GMX's own shape [sendWnt, sendTokens, createOrder] passes", () => {
    expect(codes(router([sendWnt(FEE), sendTokens(USDC, COLLATERAL), createOrder(GMX_ORDER_TYPE.MarketIncrease, USDC)], FEE))).toEqual([])
  })

  test('native collateral carried by sendWnt passes', () => {
    const total = 10n ** 18n + FEE
    expect(codes(router([sendWnt(total), createOrder(GMX_ORDER_TYPE.MarketIncrease, GMX_WNT, { shouldUnwrapNativeToken: true })], total))).toEqual([])
  })

  test('a swap records its input token', () => {
    const swap = createOrder(GMX_ORDER_TYPE.MarketSwap, USDC, { market: zeroAddress, swapPath: [ETH_MARKET] })
    expect(codes(router([sendWnt(FEE), sendTokens(USDC, COLLATERAL), swap], FEE))).toEqual([])
  })

  test('a decrease records its execution fee', () => {
    expect(codes(router([sendWnt(FEE), createOrder(GMX_ORDER_TYPE.MarketDecrease, USDC)], FEE))).toEqual([])
  })

  test("GMX's batch shape [creates, fee top-up + updateOrder, cancelOrder] passes", () => {
    const legs = [sendWnt(FEE), createOrder(GMX_ORDER_TYPE.LimitDecrease, USDC), sendWnt(FEE), updateOrder(), cancelOrder()]
    expect(codes(router(legs, 2n * FEE))).toEqual([])
  })

  test('a transfer an earlier decrease leaves unrecorded is recorded by a later increase', () => {
    const legs = [
      sendWnt(FEE),
      sendTokens(USDC, COLLATERAL),
      createOrder(GMX_ORDER_TYPE.MarketDecrease, USDC),
      sendWnt(FEE),
      createOrder(GMX_ORDER_TYPE.MarketIncrease, USDC)
    ]
    expect(codes(router(legs, 2n * FEE))).toEqual([])
  })

  test('a claim between a transfer and its order passes, since claims pay out of the market, not the OrderVault', () => {
    const legs = [sendWnt(FEE), sendTokens(USDC, COLLATERAL), claimFundingFees(account), createOrder(GMX_ORDER_TYPE.MarketIncrease, USDC)]
    expect(codes(router(legs, FEE))).toEqual([])
  })

  test('a claim to another receiver is refused', () => {
    expect(codes(router([claimFundingFees(getAddress('0x2222222222222222222222222222222222222222'))]))).toEqual(['CLAIM_BAD_RECEIVER'])
  })

  test('an earlier increase does not record a transfer sent after it and left to a decrease', () => {
    const legs = [
      sendWnt(FEE),
      sendTokens(USDC, COLLATERAL),
      createOrder(GMX_ORDER_TYPE.MarketIncrease, USDC),
      sendWnt(FEE),
      sendTokens(USDC, COLLATERAL),
      createOrder(GMX_ORDER_TYPE.MarketDecrease, USDC)
    ]
    expect(codes(router(legs, 2n * FEE))).toEqual(['TRANSFER_UNRECORDED'])
  })

  test('sendWnt pending across a cancel is refused', () => {
    expect(codes(router([sendWnt(FEE), cancelOrder(), createOrder(GMX_ORDER_TYPE.MarketDecrease, USDC)], FEE))).toEqual(['TRANSFER_UNRECORDED'])
  })

  test('sendTokens with no order is refused', () => {
    expect(codes(router([sendTokens(USDC, COLLATERAL)]))).toEqual(['TRANSFER_UNRECORDED'])
  })

  test('a bare sendTokens outside a multicall is refused', () => {
    const call = { target: GMX_ROUTER, value: 0n, gasLimit: 0n, callData: sendTokens(USDC, COLLATERAL) }
    expect(codes(call)).toEqual(['TRANSFER_UNRECORDED'])
  })

  test('sendWnt with no order is refused', () => {
    expect(codes(router([sendWnt(10n ** 18n)], 10n ** 18n))).toEqual(['TRANSFER_UNRECORDED'])
  })

  test('sendTokens consumed only by a decrease is refused', () => {
    expect(codes(router([sendWnt(FEE), sendTokens(USDC, COLLATERAL), createOrder(GMX_ORDER_TYPE.MarketDecrease, USDC)], FEE))).toEqual([
      'TRANSFER_UNRECORDED'
    ])
  })

  test('sendTokens after the last order is refused', () => {
    expect(codes(router([sendWnt(FEE), createOrder(GMX_ORDER_TYPE.MarketIncrease, USDC), sendTokens(USDC, COLLATERAL)], FEE))).toEqual([
      'TRANSFER_UNRECORDED'
    ])
  })

  test('sendWnt after the last order is refused', () => {
    expect(codes(router([sendWnt(FEE), createOrder(GMX_ORDER_TYPE.MarketDecrease, USDC), sendWnt(FEE)], 2n * FEE))).toEqual(['TRANSFER_UNRECORDED'])
  })

  test('sendTokens of a token the following order does not take as collateral is refused', () => {
    expect(codes(router([sendWnt(FEE), sendTokens(USDC, COLLATERAL), createOrder(GMX_ORDER_TYPE.MarketIncrease, GMX_WNT)], FEE))).toEqual([
      'TRANSFER_UNRECORDED'
    ])
  })

  test('a cancel between a transfer and its order is refused', () => {
    const legs = [sendWnt(FEE), sendTokens(USDC, COLLATERAL), cancelOrder(), createOrder(GMX_ORDER_TYPE.MarketIncrease, USDC)]
    expect(codes(router(legs, FEE))).toEqual(['TRANSFER_UNRECORDED'])
  })

  test('the stranding operate from the audit is refused end to end', () => {
    const result = screenList([approveRouter(USDC, COLLATERAL), router([sendTokens(USDC, COLLATERAL)])])
    expect(result?.ok).toBe(false)
    expect(result?.reasons.map(r => r.code)).toEqual(['TRANSFER_UNRECORDED'])
  })
})

describe("the operator's own order calls pass the screen", () => {
  const cases: [string, Address, number, bigint][] = [
    ['USDC increase', USDC, GMX_ORDER_TYPE.MarketIncrease, COLLATERAL],
    ['USDC decrease', USDC, GMX_ORDER_TYPE.MarketDecrease, COLLATERAL],
    ['native increase', PROTOCOL.nativeToken as Address, GMX_ORDER_TYPE.MarketIncrease, 10n ** 18n],
    ['native decrease', PROTOCOL.nativeToken as Address, GMX_ORDER_TYPE.MarketDecrease, 10n ** 18n],
    ['WETH increase', GMX_WNT, GMX_ORDER_TYPE.MarketIncrease, 10n ** 18n],
    ['WETH decrease', GMX_WNT, GMX_ORDER_TYPE.MarketDecrease, 10n ** 18n]
  ]
  for (const [name, baseToken, orderType, collateralDelta] of cases) {
    test(name, () => {
      const { callList } = buildGmxOrderCalls(
        { orderType, market: ETH_MARKET, isLong: true, sizeDeltaUsd: 10n ** 33n, collateralDelta },
        { master: account, baseToken, executionFee: FEE }
      )
      expect(screenList(callList)).toEqual({ ok: true, reasons: [] })
    })
  }
})

describe('createOrder fields', () => {
  test('a non-empty dataList is refused', () => {
    const order = createOrder(GMX_ORDER_TYPE.MarketIncrease, USDC, { dataList: [`0x${'ab'.repeat(32)}`] })
    expect(codes(router([sendWnt(FEE), sendTokens(USDC, COLLATERAL), order], FEE))).toEqual(['DATALIST_FORBIDDEN'])
  })
})

describe('GMX typed data', () => {
  const permit = (spender: Address) => ({
    domain: { name: 'USD Coin', version: '2', chainId: GMX_V2_CHAIN_ID, verifyingContract: USDC },
    primaryType: 'Permit',
    message: { owner: account, spender, value: maxUint256, nonce: 0n, deadline: maxUint256 }
  })

  test('a token permit is refused whatever its spender', () => {
    for (const spender of [GMX_TOKEN_SPENDER, getAddress('0x2222222222222222222222222222222222222222')]) {
      expect(screenDappTypedData(account, permit(spender)).map(r => r.code)).toEqual(['DAPP_DOMAIN_NOT_ADMITTED'])
    }
  })

  test('RemoveSubaccount is refused: the main account signs it and its relay params may carry external calls', () => {
    const removal = {
      domain: { name: 'GmxBaseGelatoRelayRouter', version: '1', chainId: GMX_V2_CHAIN_ID, verifyingContract: getAddress('0xfD0596f708d9D950E0eF7b5d191e5F8e55b8a67f') },
      primaryType: 'RemoveSubaccount',
      message: {}
    }
    expect(screenDappTypedData(account, removal).map(r => r.code)).toEqual(['DAPP_ACTION_NOT_ADMITTED'])
  })
})

describe('allowance grants other than approve never reach the attestation', () => {
  const allowanceAbi = parseAbi([
    'function increaseAllowance(address spender, uint256 amount)',
    'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
    'function permit(address holder, address spender, uint256 nonce, uint256 expiry, bool allowed, uint8 v, bytes32 r, bytes32 s)'
  ])
  const grants: [string, Hex][] = [
    ['increaseAllowance', encodeFunctionData({ abi: allowanceAbi, functionName: 'increaseAllowance', args: [GMX_TOKEN_SPENDER, maxUint256] })],
    [
      'EIP-2612 permit',
      encodeFunctionData({
        abi: allowanceAbi,
        functionName: 'permit',
        args: [account, GMX_TOKEN_SPENDER, maxUint256, maxUint256, 27, `0x${'00'.repeat(32)}`, `0x${'00'.repeat(32)}`]
      })
    ],
    [
      'DAI permit',
      encodeFunctionData({
        abi: allowanceAbi,
        functionName: 'permit',
        args: [account, GMX_TOKEN_SPENDER, 0n, maxUint256, true, 27, `0x${'00'.repeat(32)}`, `0x${'00'.repeat(32)}`]
      })
    ]
  ]
  for (const [name, callData] of grants) {
    test(`${name} on a registered token is refused`, () => {
      expect(screenList([{ target: USDC, value: 0n, gasLimit: 0n, callData }])?.ok).toBe(false)
    })
  }
})
