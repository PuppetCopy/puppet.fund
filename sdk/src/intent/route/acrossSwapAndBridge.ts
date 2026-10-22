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
import { CompactError } from '../../compact/index.js'
import type { ChainId } from '../../const/index.js'
import { SWAP_PROVIDER } from '../../const/network.js'
import { providerToken, symbolOf, wrappedNativeAddressOf } from '../../state/tokenRegistry.js'
import { ACROSS_DEPOSIT_ABI, ACROSS_PERIPHERY, acrossJson, acrossSpokePoolOf, type IAcrossTiming, verifyAcrossTiming } from './acrossDeposit.js'

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

const DEPOSIT_NATIVE_ABI = [
  {
    type: 'function',
    name: 'depositNative',
    stateMutability: 'payable',
    outputs: [],
    inputs: [
      { name: 'spokePool', type: 'address' },
      { name: 'depositor', type: 'address' },
      { name: 'recipient', type: 'bytes32' },
      { name: 'inputToken', type: 'address' },
      { name: 'inputAmount', type: 'uint256' },
      { name: 'outputToken', type: 'bytes32' },
      { name: 'outputAmount', type: 'uint256' },
      { name: 'destinationChainId', type: 'uint256' },
      { name: 'exclusiveRelayer', type: 'bytes32' },
      { name: 'quoteTimestamp', type: 'uint32' },
      { name: 'fillDeadline', type: 'uint32' },
      { name: 'exclusivityParameter', type: 'uint32' },
      { name: 'message', type: 'bytes' }
    ]
  }
] as const

const ACROSS_MULTICALL_HANDLER: Record<number, Address> = {
  1: '0x0F7Ae28dE1C8532170AD4ee566B5801485c13a0E',
  10: '0x0F7Ae28dE1C8532170AD4ee566B5801485c13a0E',
  137: '0x0F7Ae28dE1C8532170AD4ee566B5801485c13a0E',
  4663: '0xa8aD2e87E2043711d8BeC77e8BC3E2683C0ab6BD',
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

const EMIT_DATA_SELECTOR = '0xd836083e'

const ZERO_EX_ALLOWANCE_HOLDER: Address = '0x0000000000001fF3684f28c67538d4D072C22734'

interface IAcrossSwapAndBridgeData {
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
  origin:
    | { kind: 'swap'; submissionFeeAmount: bigint; swapToken: Address; exchange: Address; swapTokenAmount: bigint; minExpectedInputTokenAmount: bigint; spokePool: Address }
    | { kind: 'deposit'; inputAmount: bigint }
    | { kind: 'depositNative'; spokePool: Address; inputAmount: bigint }
}

const asAddress = (word: Hex): Address | null => {
  if (slice(word, 0, 12) !== '0x000000000000000000000000') return null
  return getAddress(slice(word, 12))
}

export function decodeAcrossSwapAndBridge(callData: Hex): IAcrossSwapAndBridgeData | null {
  let decoded: ReturnType<
    typeof decodeFunctionData<readonly [...typeof SWAP_AND_BRIDGE_ABI, ...typeof ACROSS_DEPOSIT_ABI, ...typeof DEPOSIT_NATIVE_ABI]>
  >
  try {
    decoded = decodeFunctionData({ abi: [...SWAP_AND_BRIDGE_ABI, ...ACROSS_DEPOSIT_ABI, ...DEPOSIT_NATIVE_ABI], data: callData })
  } catch {
    return null
  }
  if (decoded.functionName === 'depositNative') {
    const [spokePool, depositor, recipient, inputToken, inputAmount, outputToken, outputAmount, destinationChainId, exclusiveRelayer, quoteTimestamp, fillDeadline, exclusivityParameter, message] =
      decoded.args
    const recipientAddress = asAddress(recipient)
    const bridgeOutputToken = asAddress(outputToken)
    if (recipientAddress === null || bridgeOutputToken === null) return null
    return {
      bridgeInputToken: inputToken,
      bridgeOutputToken,
      bridgeOutputAmount: outputAmount,
      depositor,
      recipient: recipientAddress,
      destinationChainId,
      exclusiveRelayer: asAddress(exclusiveRelayer) ?? zeroAddress,
      exclusivityParameter: Number(exclusivityParameter),
      quoteTimestamp: Number(quoteTimestamp),
      fillDeadline: Number(fillDeadline),
      message,
      origin: { kind: 'depositNative', spokePool, inputAmount }
    }
  }
  if (decoded.functionName === 'deposit') {
    const [depositor, recipient, inputToken, outputToken, inputAmount, outputAmount, destinationChainId, exclusiveRelayer, quoteTimestamp, fillDeadline, exclusivityParameter, message] =
      decoded.args
    const depositorAddress = asAddress(depositor)
    const recipientAddress = asAddress(recipient)
    const bridgeInputToken = asAddress(inputToken)
    const bridgeOutputToken = asAddress(outputToken)
    if (depositorAddress === null || recipientAddress === null || bridgeInputToken === null || bridgeOutputToken === null) return null
    return {
      bridgeInputToken,
      bridgeOutputToken,
      bridgeOutputAmount: outputAmount,
      depositor: depositorAddress,
      recipient: recipientAddress,
      destinationChainId,
      exclusiveRelayer: asAddress(exclusiveRelayer) ?? zeroAddress,
      exclusivityParameter: Number(exclusivityParameter),
      quoteTimestamp: Number(quoteTimestamp),
      fillDeadline: Number(fillDeadline),
      message,
      origin: { kind: 'deposit', inputAmount }
    }
  }
  if (decoded.functionName !== 'swapAndBridge') return null
  const data: unknown = decoded.args[0]
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
    origin: {
      kind: 'swap',
      submissionFeeAmount: d.submissionFees.amount,
      swapToken: d.swapToken,
      exchange: d.exchange,
      swapTokenAmount: d.swapTokenAmount,
      minExpectedInputTokenAmount: d.minExpectedInputTokenAmount,
      spokePool: d.spokePool
    }
  }
}

interface IAcrossSwapPin {
  originChainId: number
  depositor: Address
  recipient: Address
  inputToken: Address
  inputAmount: bigint
  outputToken: Address
  outputAmount: bigint
  destinationChainId: bigint
  timing: IAcrossTiming
  mineableUntil: bigint
}


const fail: (reason: string) => never = reason => {
  throw new CompactError('BAD_REQUEST', `across swap route rejected: ${reason}`)
}

export function verifyAcrossSwapAndBridge(pin: IAcrossSwapPin, callData: Hex): void {
  const d = decodeAcrossSwapAndBridge(callData)
  if (d === null) fail('calldata matches none of the swapAndBridge, depositNative or SpokePool deposit shapes')
  const origin = d.origin
  if (origin.kind === 'swap') {
    if (origin.submissionFeeAmount !== 0n) fail('nonzero submission fee')
    if (!isAddressEqual(origin.swapToken, providerToken(pin.inputToken, pin.originChainId))) {
      fail('swap token differs from the intent input')
    }
    if (origin.swapTokenAmount !== pin.inputAmount) fail('swap amount differs from the amount approved to the route')
    if (!isAddressEqual(origin.spokePool, acrossSpokePoolOf(pin.originChainId))) {
      fail('deposit target is not the canonical SpokePool')
    }
    const routers = [ZERO_EX_ALLOWANCE_HOLDER, SWAP_PROVIDER[pin.originChainId as keyof typeof SWAP_PROVIDER].lifiDiamond]
    if (!routers.some(router => isAddressEqual(router, origin.exchange))) {
      fail(`origin swap runs through ${origin.exchange}, which is not a declared router on chain ${pin.originChainId} (${routers.join(', ')})`)
    }
    if (origin.minExpectedInputTokenAmount < d.bridgeOutputAmount) {
      fail(`origin swap floor ${origin.minExpectedInputTokenAmount} is below the bridged ${d.bridgeOutputAmount}; the swap leg would carry no enforceable floor`)
    }
  } else {
    if (origin.kind === 'depositNative') {
      if (!isAddressEqual(pin.inputToken, PROTOCOL.nativeToken)) fail('a native deposit spends an input that is not native')
      if (!isAddressEqual(origin.spokePool, acrossSpokePoolOf(pin.originChainId))) fail('deposit target is not the canonical SpokePool')
    }
    if (!isAddressEqual(d.bridgeInputToken, providerToken(pin.inputToken, pin.originChainId))) fail('deposit token differs from the intent input')
    if (origin.inputAmount !== pin.inputAmount) fail('deposit amount differs from the amount approved to the route')
  }
  if (d.destinationChainId !== pin.destinationChainId) fail('destination chain differs from the intent')
  if (!isAddressEqual(d.depositor, pin.depositor)) fail('deposit refunds are not credited to the intended depositor')
  verifyAcrossTiming(pin.timing, d.quoteTimestamp, d.fillDeadline, pin.mineableUntil)
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
  if (!isAddressEqual(d.bridgeOutputToken, providerToken(pin.outputToken, Number(pin.destinationChainId)))) {
    fail('bridged token differs from the intent output')
  }
  if (d.bridgeOutputAmount < pin.outputAmount) {
    fail(`bridge delivers ${d.bridgeOutputAmount} below the signed output ${pin.outputAmount}`)
  }

  if (d.message === '0x') {
    if (!isAddressEqual(d.recipient, pin.recipient)) fail('delivery recipient is not the intended recipient')
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

const SWAP_APPROVAL_PATH = '/swap/approval'

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
    inputToken: isAddressEqual(bounds.inputToken, PROTOCOL.nativeToken) ? zeroAddress : bounds.inputToken,
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
  const decoded = decodeAcrossSwapAndBridge(swapTx.data)
  if (decoded === null) {
    throw new CompactError('ROUTE_UNAVAILABLE', 'Across swap calldata matches none of the screened swapAndBridge, depositNative or SpokePool deposit shapes')
  }
  const target = decoded.origin.kind === 'deposit' ? acrossSpokePoolOf(bounds.chainId) : ACROSS_PERIPHERY
  if (!swapTx.to || !isAddressEqual(swapTx.to, target)) {
    throw new CompactError(
      'ROUTE_UNAVAILABLE',
      `Across quoted ${decoded.origin.kind} calldata for ${swapTx.to} but we pin ${target} for it; executing their calldata at our address reverts. If Across rotated it, repin it in SWAP_PROVIDER (sdk/src/const/network.ts).`,
      'server'
    )
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
      timing: bounds.timing,
      mineableUntil: BigInt(Math.floor(Date.now() / 1000)) + PROTOCOL.maxIntentTtlSec
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
