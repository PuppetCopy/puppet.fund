import { type Address, decodeAbiParameters, decodeFunctionData, getAddress, type Hex, slice } from 'viem'
import { CompactError } from '../compact/index.js'
import { acrossSpokePoolOf } from './acrossDeposit.js'

// SpokePoolPeriphery.swapAndBridge(SwapAndDepositData), mirrored from across-protocol/contracts
// SpokePoolPeripheryInterface.sol. Selector 0x110560ad verified against a live /swap/approval quote (2026-07-06).
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

// Across MulticallHandler per destination chain (across-protocol/contracts deployments/<network>/Multicallhandler).
// The fused route's destination swap delivers to THIS contract with an embedded instruction program; a destination
// chain missing here fails closed.
const ACROSS_MULTICALL_HANDLER: Record<number, Address> = {
  1: '0x0F7Ae28dE1C8532170AD4ee566B5801485c13a0E',
  137: '0x0F7Ae28dE1C8532170AD4ee566B5801485c13a0E',
  143: '0xeC41F75c686e376Ab2a4F18bde263ab5822c4511',
  8453: '0x0F7Ae28dE1C8532170AD4ee566B5801485c13a0E',
  42161: '0x0F7Ae28dE1C8532170AD4ee566B5801485c13a0E'
}

// MulticallHandler's message payload: Instructions { Call[] calls; address fallbackRecipient }.
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

// MulticallHandler.drainLeftoverTokens(address token, address destination) — selector 0xef8738d3. The only handler
// self-call the destination program may contain; each one must pay out to the user.
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

export interface IAcrossSwapAndBridgeData {
  submissionFeeAmount: bigint
  bridgeInputToken: Address
  bridgeOutputToken: Address
  bridgeOutputAmount: bigint
  depositor: Address
  recipient: Address
  destinationChainId: bigint
  quoteTimestamp: number
  fillDeadline: number
  message: Hex
  swapToken: Address
  exchange: Address
  swapTokenAmount: bigint
  minExpectedInputTokenAmount: bigint
  spokePool: Address
}

const asAddress = (word: Hex): Address | null => {
  if (slice(word, 0, 12) !== '0x000000000000000000000000') return null
  return getAddress(slice(word, 12))
}

// Strict decode of periphery swapAndBridge calldata for SCREENING third-party-supplied bytes: null on any deviation
// from the exact shape (selector, tuple layout, address-width bytes32 fields), so the verifier can pin every field.
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
      quoteTimestamp: number
      fillDeadline: number
      message: Hex
    }
    swapToken: Address
    exchange: Address
    swapTokenAmount: bigint
    minExpectedInputTokenAmount: bigint
    spokePool: Address
  }
  const bridgeOutputToken = asAddress(d.depositData.outputToken)
  const recipient = asAddress(d.depositData.recipient)
  if (bridgeOutputToken === null || recipient === null) return null
  return {
    submissionFeeAmount: d.submissionFees.amount,
    bridgeInputToken: getAddress(d.depositData.inputToken),
    bridgeOutputToken,
    bridgeOutputAmount: d.depositData.outputAmount,
    depositor: getAddress(d.depositData.depositor),
    recipient,
    destinationChainId: d.depositData.destinationChainId,
    quoteTimestamp: Number(d.depositData.quoteTimestamp),
    fillDeadline: Number(d.depositData.fillDeadline),
    message: d.depositData.message,
    swapToken: getAddress(d.swapToken),
    exchange: getAddress(d.exchange),
    swapTokenAmount: d.swapTokenAmount,
    minExpectedInputTokenAmount: d.minExpectedInputTokenAmount,
    spokePool: getAddress(d.spokePool)
  }
}

export interface IAcrossSwapPin {
  originChainId: number
  user: Address
  inputToken: Address
  inputAmount: bigint
  acceptableRelayFee: bigint
  outputToken: Address
  destinationChainId: bigint
  fillDeadline: number
}

const eq = (a: Address, b: Address): boolean => getAddress(a) === getAddress(b)

// Annotated on the VARIABLE (not just the arrow) so TS's never-returning call analysis terminates the
// branch at each bare `fail(...)` statement, which noVoidTypeReturn forces over `return fail(...)`.
const fail: (reason: string) => never = reason => {
  throw new CompactError('BAD_REQUEST', `across swap route rejected: ${reason}`)
}

// Field-pins Across's fused swap-and-bridge calldata to the intent it claims to serve. Everything structurally
// decodable is pinned — refunds, deposit target, destination, amounts, delivery — so a client can only vary the
// route INTERNALS (exchange + router calldata), which carry the same user-signed trust as a local swap's opaque
// provider calldata and stay bounded by the relay's oracle value screen.
export function verifyAcrossSwapAndBridge(pin: IAcrossSwapPin, callData: Hex): void {
  const d = decodeAcrossSwapAndBridge(callData)
  if (d === null) fail('calldata does not match the swapAndBridge shape')
  if (d.submissionFeeAmount !== 0n) fail('nonzero submission fee')
  if (!eq(d.swapToken, pin.inputToken)) fail('swap token differs from the intent input')
  if (d.swapTokenAmount !== pin.inputAmount - pin.acceptableRelayFee) {
    fail('swap amount differs from the net intent amount')
  }
  if (!eq(d.spokePool, acrossSpokePoolOf(pin.originChainId))) {
    fail('deposit target is not the canonical SpokePool')
  }
  if (d.destinationChainId !== pin.destinationChainId) fail('destination chain differs from the intent')
  if (!eq(d.depositor, pin.user)) fail('deposit refunds are not credited to the user')
  if (d.fillDeadline !== pin.fillDeadline) fail('embedded fill deadline differs from the intent')

  // Direct delivery (origin swap + plain bridge): the bridged asset IS the intent output, straight to the user.
  if (d.message === '0x') {
    if (!eq(d.recipient, pin.user)) fail('delivery recipient is not the user')
    if (!eq(d.bridgeOutputToken, pin.outputToken)) fail('delivered token differs from the intent output')
    return
  }

  // Destination-swap delivery: the bridge lands at the canonical MulticallHandler, whose instruction program must
  // fall back to the user on ANY failure and may only drain to the user.
  const handler = ACROSS_MULTICALL_HANDLER[Number(pin.destinationChainId)]
  if (!handler) fail(`no known Across MulticallHandler on chain ${pin.destinationChainId}`)
  if (!eq(d.recipient, handler)) fail('destination program recipient is not the Across MulticallHandler')
  let instructions: { calls: readonly { target: Address; callData: Hex; value: bigint }[]; fallbackRecipient: Address }
  try {
    const [decoded] = decodeAbiParameters(MULTICALL_INSTRUCTIONS_ABI, d.message)
    instructions = decoded
  } catch {
    fail('destination program does not decode as MulticallHandler instructions')
  }
  if (!eq(instructions.fallbackRecipient, pin.user)) fail('destination fallback recipient is not the user')
  for (const call of instructions.calls) {
    if (call.value !== 0n) fail('destination program forwards native value')
    if (!eq(call.target, handler)) continue
    let drain: { token: Address; destination: Address }
    try {
      const decoded = decodeFunctionData({ abi: DRAIN_LEFTOVER_ABI, data: call.callData })
      drain = { token: decoded.args[0], destination: decoded.args[1] }
    } catch {
      fail('unknown handler self-call in destination program')
    }
    if (!eq(drain.destination, pin.user)) fail('destination program drains to a non-user address')
  }
}
