import { PROTOCOL } from '@puppet/contracts/const'
import {
  type Address,
  decodeAbiParameters,
  decodeFunctionData,
  getAddress,
  type Hex,isAddressEqual, 
  slice,
  zeroAddress
 } from 'viem'
import { CompactError } from '../compact/index.js'
import type { ChainId } from '../const/index.js'
import { providerToken, symbolOf, wrappedNativeAddressOf } from '../state/tokenRegistry.js'
import { ACROSS_PERIPHERY, acrossJson, acrossSpokePoolOf, type IAcrossTiming, verifyAcrossTiming } from './acrossDeposit.js'

const SWAP_AND_BRIDGE_ABI = [
  {
    type: 'function',
    name: 'swapAndBridge',
    stateMutability: 'payable',
    outputs: [],
    inputs: [
      {
        name: 'swapAndDepositData',
        type: 'tuple',
        components: [
          {
            name: 'submissionFees',
            type: 'tuple',
            components: [
              { name: 'amount', type: 'uint256' },
              { name: 'recipient', type: 'address' }
            ]
          },
          {
            name: 'depositData',
            type: 'tuple',
            components: [
              { name: 'inputToken', type: 'address' },
              { name: 'outputToken', type: 'bytes32' },
              { name: 'outputAmount', type: 'uint256' },
              { name: 'depositor', type: 'address' },
              { name: 'recipient', type: 'bytes32' },
              { name: 'destinationChainId', type: 'uint256' },
              { name: 'exclusiveRelayer', type: 'bytes32' },
              { name: 'quoteTimestamp', type: 'uint32' },
              { name: 'fillDeadline', type: 'uint32' },
              { name: 'exclusivityParameter', type: 'uint32' },
              { name: 'message', type: 'bytes' }
            ]
          },
          { name: 'swapToken', type: 'address' },
          { name: 'exchange', type: 'address' },
          { name: 'transferType', type: 'uint8' },
          { name: 'swapTokenAmount', type: 'uint256' },
          { name: 'minExpectedInputTokenAmount', type: 'uint256' },
          { name: 'routerCalldata', type: 'bytes' },
          { name: 'enableProportionalAdjustment', type: 'bool' },
          { name: 'spokePool', type: 'address' },
          { name: 'nonce', type: 'uint256' }
        ]
      }
    ]
  }
] as const

const ACROSS_MULTICALL_HANDLER: Record<number, Address> = {
  1: '0x0F7Ae28dE1C8532170AD4ee566B5801485c13a0E',
  137: '0x0F7Ae28dE1C8532170AD4ee566B5801485c13a0E',
  143: '0xeC41F75c686e376Ab2a4F18bde263ab5822c4511',
  8453: '0x0F7Ae28dE1C8532170AD4ee566B5801485c13a0E',
  42161: '0x0F7Ae28dE1C8532170AD4ee566B5801485c13a0E'
}

const MULTICALL_INSTRUCTIONS_ABI = [
  {
    name: 'instructions',
    type: 'tuple',
    components: [
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'target', type: 'address' },
          { name: 'callData', type: 'bytes' },
          { name: 'value', type: 'uint256' }
        ]
      },
      { name: 'fallbackRecipient', type: 'address' }
    ]
  }
] as const

const DRAIN_LEFTOVER_ABI = [
  {
    type: 'function',
    name: 'drainLeftoverTokens',
    stateMutability: 'nonpayable',
    outputs: [],
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'destination', type: 'address' }
    ]
  }
] as const

const MAKE_CALL_WITH_BALANCE_ABI = [
  {
    type: 'function',
    name: 'makeCallWithBalance',
    stateMutability: 'nonpayable',
    outputs: [],
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'callData', type: 'bytes' },
      { name: 'value', type: 'uint256' },
      {
        name: 'replacement',
        type: 'tuple[]',
        components: [
          { name: 'token', type: 'address' },
          { name: 'offset', type: 'uint256' }
        ]
      }
    ]
  }
] as const

const WNT_WITHDRAW_SELECTOR = '0x2e1a7d4d'
const EMIT_DATA_SELECTOR = '0xd836083e'

export interface IAcrossSwapAndBridgeData {
  submissionFeeAmount: bigint
  bridgeInputToken: Address
  bridgeOutputToken: Address
  bridgeOutputAmount: bigint
  depositor: Address
  recipient: Address
  destinationChainId: bigint
  exclusiveRelayer: Address
  exclusivityParameter: number
  quoteTimestamp: number
  fillDeadline: number
  message: Hex
  swapToken: Address
  exchange: Address
  swapTokenAmount: bigint
  minExpectedInputTokenAmount: bigint
  routerCalldata: Hex
  spokePool: Address
}

const asAddress = (word: Hex): Address | null => {
  if (slice(word, 0, 12) !== '0x000000000000000000000000') return null
  return getAddress(slice(word, 12))
}

export function decodeAcrossSwapAndBridge(callData: Hex): IAcrossSwapAndBridgeData | null {
  let data: unknown
  try {
    const decoded = decodeFunctionData({ abi: SWAP_AND_BRIDGE_ABI, data: callData })
    if (decoded.functionName !== 'swapAndBridge') return null
    data = decoded.args[0]
  } catch {
    return null
  }
  const d = data as {
    submissionFees: { amount: bigint; recipient: Address }
    depositData: {
      inputToken: Address
      outputToken: Hex
      outputAmount: bigint
      depositor: Address
      recipient: Hex
      destinationChainId: bigint
      exclusiveRelayer: Hex
      exclusivityParameter: number
      quoteTimestamp: number
      fillDeadline: number
      message: Hex
    }
    swapToken: Address
    exchange: Address
    swapTokenAmount: bigint
    minExpectedInputTokenAmount: bigint
    routerCalldata: Hex
    spokePool: Address
  }
  const bridgeOutputToken = asAddress(d.depositData.outputToken)
  const recipient = asAddress(d.depositData.recipient)
  if (bridgeOutputToken === null || recipient === null) return null
  return {
    submissionFeeAmount: d.submissionFees.amount,
    bridgeInputToken: d.depositData.inputToken,
    bridgeOutputToken,
    bridgeOutputAmount: d.depositData.outputAmount,
    depositor: d.depositData.depositor,
    recipient,
    destinationChainId: d.depositData.destinationChainId,
    exclusiveRelayer: asAddress(d.depositData.exclusiveRelayer) ?? zeroAddress,
    exclusivityParameter: Number(d.depositData.exclusivityParameter),
    quoteTimestamp: Number(d.depositData.quoteTimestamp),
    fillDeadline: Number(d.depositData.fillDeadline),
    message: d.depositData.message,
    swapToken: d.swapToken,
    exchange: d.exchange,
    swapTokenAmount: d.swapTokenAmount,
    minExpectedInputTokenAmount: d.minExpectedInputTokenAmount,
    routerCalldata: d.routerCalldata,
    spokePool: d.spokePool
  }
}

export interface IAcrossSwapPin {
  originChainId: number
  depositor: Address
  recipient: Address
  inputToken: Address
  inputAmount: bigint
  outputToken: Address
  outputAmount: bigint
  destinationChainId: bigint
  timing: IAcrossTiming
}


const fail: (reason: string) => never = reason => {
  throw new CompactError('BAD_REQUEST', `across swap route rejected: ${reason}`)
}

export function verifyAcrossSwapAndBridge(pin: IAcrossSwapPin, callData: Hex): void {
  const d = decodeAcrossSwapAndBridge(callData)
  if (d === null) fail('calldata does not match the swapAndBridge shape')
  if (d.submissionFeeAmount !== 0n) fail('nonzero submission fee')
  if (!isAddressEqual(d.swapToken, providerToken(pin.inputToken, pin.originChainId))) {
    fail('swap token differs from the intent input')
  }
  if (d.swapTokenAmount !== pin.inputAmount) fail('swap amount differs from the amount approved to the route')
  if (!isAddressEqual(d.spokePool, acrossSpokePoolOf(pin.originChainId))) {
    fail('deposit target is not the canonical SpokePool')
  }
  if (d.destinationChainId !== pin.destinationChainId) fail('destination chain differs from the intent')
  if (!isAddressEqual(d.depositor, pin.depositor)) fail('deposit refunds are not credited to the funding account')
  verifyAcrossTiming(pin.timing, d.quoteTimestamp, d.fillDeadline)
  if (isAddressEqual(d.exclusiveRelayer, pin.depositor) || isAddressEqual(d.exclusiveRelayer, pin.recipient)) {
    fail(
      `bridge leg names ${d.exclusiveRelayer} as exclusive filler, which is a party to this intent; the signer cannot be the guaranteed counterparty to their own bridge`
    )
  }

  if (
    symbolOf(pin.originChainId as ChainId, d.bridgeInputToken) !==
    symbolOf(Number(pin.destinationChainId) as ChainId, d.bridgeOutputToken)
  ) {
    fail(
      `origin leg bridges ${d.bridgeInputToken} but the intent delivers ${d.bridgeOutputToken}; Across bridges like-for-like, so the origin floor is not comparable to the delivered amount`
    )
  }
  if (d.minExpectedInputTokenAmount < d.bridgeOutputAmount) {
    fail(
      `origin swap floor ${d.minExpectedInputTokenAmount} is below the bridged ${d.bridgeOutputAmount}; the swap leg would carry no enforceable floor`
    )
  }


  if (d.message === '0x') {
    if (!isAddressEqual(d.recipient, pin.recipient)) fail('delivery recipient is not the intended recipient')
    if (!isAddressEqual(d.bridgeOutputToken, pin.outputToken)) fail('delivered token differs from the intent output')
    if (d.bridgeOutputAmount < pin.outputAmount) {
      fail(`bridge delivers ${d.bridgeOutputAmount} below the signed output ${pin.outputAmount}`)
    }
    return
  }

  const handler = ACROSS_MULTICALL_HANDLER[Number(pin.destinationChainId)]
  if (!handler) fail(`no known Across MulticallHandler on chain ${pin.destinationChainId}`)
  if (!isAddressEqual(d.recipient, handler)) {
    fail(
      `destination program recipient ${d.recipient} is not the Across MulticallHandler ${handler} we pin for chain ${pin.destinationChainId}; if Across rotated the handler, that pin is hardcoded in acrossSwapAndBridge.ts and must be updated`
    )
  }
  const outIsNative = isAddressEqual(pin.outputToken, PROTOCOL.nativeToken)
  const wnt = wrappedNativeAddressOf(Number(pin.destinationChainId) as ChainId)
  const finalAsset = outIsNative ? zeroAddress : pin.outputToken
  const bridgeIsFinal = outIsNative ? isAddressEqual(d.bridgeOutputToken, wnt) : isAddressEqual(d.bridgeOutputToken, pin.outputToken)
  if (bridgeIsFinal && d.bridgeOutputAmount < pin.outputAmount) {
    fail(`bridge delivers ${d.bridgeOutputAmount} below the signed output ${pin.outputAmount}`)
  }
  let instructions: { calls: readonly { target: Address; callData: Hex; value: bigint }[]; fallbackRecipient: Address }
  try {
    const [decoded] = decodeAbiParameters(MULTICALL_INSTRUCTIONS_ABI, d.message)
    instructions = decoded
  } catch {
    fail('destination program does not decode as MulticallHandler instructions')
  }
  if (!isAddressEqual(instructions.fallbackRecipient, pin.recipient) && !isAddressEqual(instructions.fallbackRecipient, zeroAddress)) {
    fail('destination fallback recipient is neither the user nor unset (unset = failed fills revert and refund the depositor on origin)')
  }
  const callTargets = new Set(instructions.calls.map(c => c.target))
  let deliversFinalAsset = false
  for (const call of instructions.calls) {
    if (call.value !== 0n) fail('destination program forwards native value')
    if (call.callData.length < 10) fail('destination program call carries no selector')
    const selector = slice(call.callData, 0, 4)
    if (selector === EMIT_DATA_SELECTOR) continue

    let screened: Hex = call.callData
    if (isAddressEqual(call.target, handler)) {
      let drain: { token: Address; destination: Address } | null = null
      try {
        const decoded = decodeFunctionData({ abi: DRAIN_LEFTOVER_ABI, data: call.callData })
        drain = { token: decoded.args[0], destination: decoded.args[1] }
      } catch {
        drain = null
      }
      if (drain !== null) {
        if (!isAddressEqual(drain.destination, pin.recipient)) fail('destination program drains to a non-recipient address')
        if (isAddressEqual(drain.token, finalAsset)) deliversFinalAsset = true
        continue
      }
      let inner: { target: Address; callData: Hex; value: bigint }
      try {
        const decoded = decodeFunctionData({ abi: MAKE_CALL_WITH_BALANCE_ABI, data: call.callData })
        inner = { target: decoded.args[0], callData: decoded.args[1], value: decoded.args[2] }
      } catch {
        fail('unknown handler self-call in destination program')
      }
      if (inner.value !== 0n) fail('destination program forwards native value through the handler')
      if (!callTargets.has(inner.target) && !isAddressEqual(inner.target, wnt)) {
        fail(`destination program routes balance into ${inner.target}, which the program never otherwise invokes`)
      }
      if (inner.callData.length < 10) fail('destination program balance call carries no selector')
      screened = inner.callData
    }

    const screenedSelector = slice(screened, 0, 4)
    if (screenedSelector === '0xa9059cbb' || screenedSelector === '0x23b872dd') {
      fail('destination program moves tokens directly')
    }
    if (screenedSelector === '0x095ea7b3' || screenedSelector === '0x39509351') {
      let spender: Address
      try {
        spender = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], slice(screened, 4))[0]
      } catch {
        fail('destination program approval does not decode')
      }
      if (!callTargets.has(spender)) fail('destination program approves a spender it never invokes')
    }
  }
  if (!deliversFinalAsset) {
    fail(
      `destination program never drains ${outIsNative ? 'native' : finalAsset} to ${pin.recipient}; the delivered asset would be unbound`
    )
  }
}

const SWAP_APPROVAL_PATH = '/api/swap/across/swap/approval'

interface IAcrossSwapApproval {
  minOutputAmount?: string
  expectedOutputAmount?: string
  expectedFillTime?: number
  swapTx?: { to: Address; data: Hex; value?: string }
}

export async function quoteAcrossSwapAndBridge(
  endpoint: string,
  depositor: Address,
  recipient: Address,
  bounds: {
    chainId: ChainId
    destinationChainId: bigint
    inputToken: Address
    outputToken: Address
    inputAmount: bigint
    timing: IAcrossTiming
  },
  signal?: AbortSignal
): Promise<{
  route: { kind: 'acrossSwap'; providerCallData: Hex }
  outputAmount: bigint
  expectedOutputAmount: bigint
  fillDeadline: number
  etaSec: number | undefined
}> {
  const quoteParams = {
    tradeType: 'exactInput',
    amount: bounds.inputAmount.toString(),
    inputToken: providerToken(bounds.inputToken, bounds.chainId),
    outputToken: isAddressEqual(bounds.outputToken, PROTOCOL.nativeToken)
      ? zeroAddress
      : providerToken(bounds.outputToken, Number(bounds.destinationChainId)),
    originChainId: String(bounds.chainId),
    destinationChainId: String(bounds.destinationChainId),
    depositor,
    recipient
  }
  const data = await acrossJson<IAcrossSwapApproval>(
    endpoint,
    SWAP_APPROVAL_PATH,
    { ...quoteParams, slippage: 'auto' },
    signal
  )
  const swapTx = data.swapTx
  if (!swapTx?.data || swapTx.data === '0x') {
    throw new CompactError('ROUTE_UNAVAILABLE', 'Across swap quote returned no executable transaction')
  }
  if (!swapTx.to || !isAddressEqual(swapTx.to, ACROSS_PERIPHERY)) {
    if (swapTx.to && isAddressEqual(swapTx.to, acrossSpokePoolOf(bounds.chainId))) {
      throw new CompactError(
        'ROUTE_UNAVAILABLE',
        `Across routed this pair straight through the SpokePool instead of the swap periphery, a shape this path does not screen; the input is already the bridge asset, so quote it as a plain across route`
      )
    }
    throw new CompactError(
      'ROUTE_UNAVAILABLE',
      `Across quoted calldata for ${swapTx.to} but we pin periphery ${ACROSS_PERIPHERY}; executing their calldata at our address reverts. If Across rotated the periphery, repin acrossPeriphery in const.toml, regenerate, and whitelist the new address with setSwapProvider.`,
      'server'
    )
  }
  const decoded = decodeAcrossSwapAndBridge(swapTx.data)
  if (decoded === null) {
    throw new CompactError('ROUTE_UNAVAILABLE', 'Across swap calldata does not match the screened swapAndBridge shape')
  }
  if (data.minOutputAmount === undefined) {
    throw new CompactError('ROUTE_UNAVAILABLE', 'Across swap quote carries no minimum output amount')
  }
  if (data.expectedOutputAmount === undefined) {
    throw new CompactError('ROUTE_UNAVAILABLE', 'Across swap quote carries no expected output amount')
  }
  const outputAmount = BigInt(data.minOutputAmount)
  verifyAcrossSwapAndBridge(
    {
      originChainId: bounds.chainId,
      depositor,
      recipient,
      inputToken: bounds.inputToken,
      inputAmount: bounds.inputAmount,
      outputToken: bounds.outputToken,
      outputAmount,
      destinationChainId: bounds.destinationChainId,
      timing: bounds.timing
    },
    swapTx.data
  )
  return {
    route: { kind: 'acrossSwap', providerCallData: swapTx.data },
    outputAmount,
    expectedOutputAmount: BigInt(data.expectedOutputAmount),
    fillDeadline: decoded.fillDeadline,
    etaSec: data.expectedFillTime
  }
}
