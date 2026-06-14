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

export const ACROSS_SPOKE_POOL: Record<number, Address> = {
  42161: '0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A',
  8453: '0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64'
}

const ACROSS_DOMAIN_TAG = '0x1dc0de00f973c0de' as const

const asBytes32 = (addr: Address): Hex => pad(addr, { size: 32 })

export interface IAcrossDepositParams {
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

export function acrossSpokePool(chainId: number): Address {
  const pool = ACROSS_SPOKE_POOL[chainId]
  if (!pool) throw new Error(`no Across SpokePool configured for chain ${chainId}`)
  return pool
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
