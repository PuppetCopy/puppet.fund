import { SWAP_PROVIDER } from '@puppet/contracts/const'
import { type Address, concat, decodeFunctionData, encodeFunctionData, getAddress, type Hex, pad, slice } from 'viem'

const ACROSS_DEPOSIT_ABI = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'payable',
    outputs: [],
    inputs: [
      { name: 'depositor', type: 'bytes32' },
      { name: 'recipient', type: 'bytes32' },
      { name: 'inputToken', type: 'bytes32' },
      { name: 'outputToken', type: 'bytes32' },
      { name: 'inputAmount', type: 'uint256' },
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

// The Across entry point is DETERMINISTIC: the SAME acrossPeriphery address on every chain (const.toml SWAP_PROVIDER —
// the same table the deploy seeds Register.providerAllowed from, so the off-chain screen and the on-chain allowlist
// cannot drift). No per-chain map: one constant screens every chain. Asserted uniform so a stray per-chain value can't
// silently break the deterministic assumption. NOTE: the deposit BODY below is still the SpokePool deposit shape;
// migrating it to Periphery.deposit (depositor=recipient=fund) is the pending piece flagged in const.toml before
// cross-chain bridging is live on the new universe.
export const ACROSS_PERIPHERY: Address = (() => {
  const [periphery, ...rest] = [...new Set(Object.values(SWAP_PROVIDER).map(p => getAddress(p.acrossPeriphery)))]
  if (!periphery || rest.length > 0) throw new Error('acrossPeriphery must be a single deterministic address across all chains')
  return periphery
})()

const ACROSS_DOMAIN_TAG = '0x1dc0de00f973c0de' as const

const asBytes32 = (addr: Address): Hex => pad(addr, { size: 32 })

interface IAcrossDepositParams {
  depositor: Address
  recipient: Address
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  outputAmount: bigint
  destinationChainId: bigint
  exclusiveRelayer: Address
  quoteTimestamp: number
  fillDeadline: number
  exclusivityParameter: number
}

export function buildAcrossDeposit(params: IAcrossDepositParams): Hex {
  const body = encodeFunctionData({
    abi: ACROSS_DEPOSIT_ABI,
    functionName: 'deposit',
    args: [
      asBytes32(params.depositor),
      asBytes32(params.recipient),
      asBytes32(params.inputToken),
      asBytes32(params.outputToken),
      params.inputAmount,
      params.outputAmount,
      params.destinationChainId,
      asBytes32(params.exclusiveRelayer),
      params.quoteTimestamp,
      params.fillDeadline,
      params.exclusivityParameter,
      '0x'
    ]
  })
  return concat([body, ACROSS_DOMAIN_TAG])
}

export interface IAcrossRouteFields {
  exclusiveRelayer: Address
  quoteTimestamp: number
  exclusivityParameter: number
}

export interface IRouteAcrossDepositParams {
  depositor: Address
  recipient: Address
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  outputAmount: bigint
  destinationChainId: bigint
  fillDeadline: number
  route: IAcrossRouteFields
}

export function buildRouteAcrossDeposit(params: IRouteAcrossDepositParams): {
  provider: Address
  providerCallData: Hex
} {
  const provider = ACROSS_PERIPHERY
  const providerCallData = buildAcrossDeposit({
    depositor: params.depositor,
    recipient: params.recipient,
    inputToken: params.inputToken,
    outputToken: params.outputToken,
    inputAmount: params.inputAmount,
    outputAmount: params.outputAmount,
    destinationChainId: params.destinationChainId,
    exclusiveRelayer: params.route.exclusiveRelayer,
    quoteTimestamp: params.route.quoteTimestamp,
    fillDeadline: params.fillDeadline,
    exclusivityParameter: params.route.exclusivityParameter
  })
  return { provider, providerCallData }
}

// Strict inverse of buildAcrossDeposit, for SCREENING third-party-supplied calldata:
// null on any deviation from the exact shape the builder produces (domain tag, function,
// empty message, address-width bytes32 fields), so a screen can pin every field.
export function decodeAcrossDeposit(callData: Hex): IAcrossDepositParams | null {
  const tag = ACROSS_DOMAIN_TAG.slice(2)
  if (!callData.toLowerCase().endsWith(tag)) return null
  const body = callData.slice(0, callData.length - tag.length) as Hex
  let args: readonly unknown[]
  try {
    const decoded = decodeFunctionData({ abi: ACROSS_DEPOSIT_ABI, data: body })
    if (decoded.functionName !== 'deposit') return null
    args = decoded.args
  } catch {
    return null
  }
  const asAddress = (value: unknown): Address | null => {
    const word = value as Hex
    if (slice(word, 0, 12) !== '0x000000000000000000000000') return null
    return getAddress(slice(word, 12))
  }
  const depositor = asAddress(args[0])
  const recipient = asAddress(args[1])
  const inputToken = asAddress(args[2])
  const outputToken = asAddress(args[3])
  const exclusiveRelayer = asAddress(args[7])
  if (!depositor || !recipient || !inputToken || !outputToken || !exclusiveRelayer) return null
  if (args[11] !== '0x') return null
  return {
    depositor,
    recipient,
    inputToken,
    outputToken,
    inputAmount: args[4] as bigint,
    outputAmount: args[5] as bigint,
    destinationChainId: args[6] as bigint,
    exclusiveRelayer,
    quoteTimestamp: Number(args[8]),
    fillDeadline: Number(args[9]),
    exclusivityParameter: Number(args[10])
  }
}
