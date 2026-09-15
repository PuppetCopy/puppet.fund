import { SWAP_PROVIDER } from '@puppet/contracts/const'
import { type Address, type Client, concat, decodeFunctionData, encodeFunctionData, getAddress, type Hex, pad, size, slice } from 'viem'
import { readContract } from 'viem/actions'
import { CompactError } from '../compact/index.js'
import type { ChainId } from '../const/index.js'
import { providerToken } from '../state/tokenRegistry.js'

export interface IAcrossTiming {
  quoteBuffer: number
  fillBuffer: number
  fillMargin: number
}

const SPOKE_BUFFER_ABI = [
  { type: 'function', name: 'depositQuoteTimeBuffer', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint32' }] },
  { type: 'function', name: 'fillDeadlineBuffer', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint32' }] }
] as const

export interface IAcrossBuffers {
  quoteBuffer: number
  fillBuffer: number
}

export async function readAcrossBuffers(client: Client, chainId: ChainId): Promise<IAcrossBuffers> {
  const address = acrossSpokePoolOf(chainId)
  const [quoteBuffer, fillBuffer] = await Promise.all([
    readContract(client, { address, abi: SPOKE_BUFFER_ABI, functionName: 'depositQuoteTimeBuffer' }),
    readContract(client, { address, abi: SPOKE_BUFFER_ABI, functionName: 'fillDeadlineBuffer' })
  ])
  return { quoteBuffer: Number(quoteBuffer), fillBuffer: Number(fillBuffer) }
}

export function acrossFillDeadline(timing: IAcrossTiming): number {
  const now = Math.floor(Date.now() / 1000)
  if (timing.fillBuffer < timing.fillMargin) {
    throw new CompactError(
      'ROUTE_UNAVAILABLE',
      `across fillDeadlineBuffer ${timing.fillBuffer}s is shorter than the ${timing.fillMargin}s this intent stays mineable; no fill deadline can be quoted that survives the intent's own lifetime`,
      'hard'
    )
  }
  return now + timing.fillBuffer
}

export function acrossQuoteExpiry(timing: IAcrossTiming, quoteTimestamp: number): number {
  return quoteTimestamp + timing.quoteBuffer
}

export function verifyAcrossTiming(timing: IAcrossTiming, quoteTimestamp: number, fillDeadline: number): void {
  const now = Math.floor(Date.now() / 1000)
  if (quoteTimestamp > now) {
    throw new CompactError(
      'BAD_REQUEST',
      `across quoteTimestamp ${quoteTimestamp} is ahead of ${now}; the SpokePool would revert InvalidQuoteTimestamp`,
      'hard'
    )
  }
  if (quoteTimestamp < now - timing.quoteBuffer) {
    throw new CompactError(
      'BAD_REQUEST',
      `across quoteTimestamp ${quoteTimestamp} expired at ${quoteTimestamp + timing.quoteBuffer}; the SpokePool would revert InvalidQuoteTimestamp. Re-quote the route.`,
      'soft'
    )
  }
  if (fillDeadline > now + timing.fillBuffer) {
    throw new CompactError(
      'BAD_REQUEST',
      `across fillDeadline ${fillDeadline} exceeds the SpokePool ceiling ${now + timing.fillBuffer}; the SpokePool would revert InvalidFillDeadline`,
      'hard'
    )
  }
  if (fillDeadline < now + timing.fillMargin) {
    throw new CompactError(
      'BAD_REQUEST',
      `across fillDeadline ${fillDeadline} leaves less than ${timing.fillMargin}s of fill window, but this intent stays mineable until ${now + timing.fillMargin}; the deposit would land unfillable and refund on origin instead of bridging. Re-quote the route.`,
      'soft'
    )
  }
}

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

export const ACROSS_PERIPHERY: Address = (() => {
  const [periphery, ...rest] = [...new Set(Object.values(SWAP_PROVIDER).map(p => p.acrossPeriphery))]
  if (!periphery || rest.length > 0) throw new Error('acrossPeriphery must be a single deterministic address across all chains')
  return periphery
})()

export function acrossSpokePoolOf(chainId: number): Address {
  const spokePool = (SWAP_PROVIDER[chainId as keyof typeof SWAP_PROVIDER] as { acrossSpokePool?: Address } | undefined)
    ?.acrossSpokePool
  if (!spokePool) throw new Error(`no Across SpokePool configured for chain ${chainId}`)
  return spokePool
}

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

export const ACROSS_DEPOSIT_BYTES = BigInt(
  4 + 32 * (ACROSS_DEPOSIT_ABI[0].inputs.length + 1) + size(ACROSS_DOMAIN_TAG)
)

export interface IAcrossRouteFields {
  exclusiveRelayer: Address
  quoteTimestamp: number
  exclusivityParameter: number
}

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

const SUGGESTED_FEES_PATH = '/api/swap/across/suggested-fees'
const UNSUPPORTED_LANE = /Unsupported token address/i
const unsupportedLane = new Set<string>()

export const acrossLaneKey = (
  chainId: ChainId,
  inputToken: Address,
  destinationChainId: bigint,
  outputToken: Address
): string => `${chainId}:${getAddress(inputToken)}>${destinationChainId}:${getAddress(outputToken)}`
const QUOTE_TIMEOUT_MS = 10_000

interface IAcrossSuggestedFees {
  timestamp: string
  exclusiveRelayer: Address
  exclusivityDeadline: number
  isAmountTooLow: boolean
  outputAmount: string
  estimatedFillTimeSec?: number
  limits: { minDeposit: string; maxDeposit: string }
}

export async function acrossJson<T>(endpoint: string, path: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${endpoint}${path}?${new URLSearchParams(params).toString()}`, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(QUOTE_TIMEOUT_MS)]) : AbortSignal.timeout(QUOTE_TIMEOUT_MS)
  }).catch((err: unknown) => {
    throw new CompactError('ROUTE_UNAVAILABLE', `Across quote request failed: ${err instanceof Error ? err.message : String(err)}`)
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    throw new CompactError('ROUTE_UNAVAILABLE', `Across: ${typeof body?.message === 'string' ? body.message : `quote unavailable (HTTP ${res.status})`}`)
  }
  return (await res.json()) as T
}

export async function quoteAcrossDeposit(
  endpoint: string,
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
  route: { kind: 'across' } & IAcrossRouteFields
  outputAmount: bigint
  expectedOutputAmount: bigint
  fillDeadline: number
  etaSec: number | undefined
  limits: { minDeposit: bigint; maxDeposit: bigint }
  isAmountTooLow: boolean
}> {
  const lane = acrossLaneKey(bounds.chainId, bounds.inputToken, bounds.destinationChainId, bounds.outputToken)
  if (unsupportedLane.has(lane)) {
    throw new CompactError('ROUTE_UNAVAILABLE', `Across has no lane for ${lane}`)
  }
  const data = await acrossJson<IAcrossSuggestedFees>(
    endpoint,
    SUGGESTED_FEES_PATH,
    {
      amount: bounds.inputAmount.toString(),
      inputToken: providerToken(bounds.inputToken, bounds.chainId),
      outputToken: providerToken(bounds.outputToken, Number(bounds.destinationChainId)),
      originChainId: String(bounds.chainId),
      destinationChainId: String(bounds.destinationChainId),
      recipient
    },
    signal
  ).catch((err: unknown) => {
    if (err instanceof Error && UNSUPPORTED_LANE.test(err.message)) unsupportedLane.add(lane)
    throw err
  })
  const outputAmount = BigInt(data.outputAmount)
  return {
    route: {
      kind: 'across',
      exclusiveRelayer: getAddress(data.exclusiveRelayer),
      quoteTimestamp: Number(data.timestamp),
      exclusivityParameter: data.exclusivityDeadline
    },
    outputAmount,
    expectedOutputAmount: outputAmount,
    fillDeadline: acrossFillDeadline(bounds.timing),
    etaSec: data.estimatedFillTimeSec,
    limits: { minDeposit: BigInt(data.limits.minDeposit), maxDeposit: BigInt(data.limits.maxDeposit) },
    isAmountTooLow: data.isAmountTooLow || outputAmount === 0n
  }
}
