import { type Address, type Client, concat, encodeFunctionData, getAddress, type Hex, pad, size } from 'viem'
import { readContract } from 'viem/actions'
import { PROTOCOL } from '@puppet/contracts/const'
import { CompactError } from '../../compact/index.js'
import type { ChainId } from '../../const/index.js'
import { SWAP_PROVIDER } from '../../const/network.js'
import { providerToken } from '../../state/tokenRegistry.js'

export interface IAcrossTiming {
  quoteBuffer: number
  fillBuffer: number
}

const MIN_FILL_WINDOW_SEC = 120
const FILL_DEADLINE_SKEW_SEC = 300

const SPOKE_BUFFER_ABI = [
  { type: 'function', name: 'depositQuoteTimeBuffer', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint32' }] },
  { type: 'function', name: 'fillDeadlineBuffer', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint32' }] }
] as const

export async function readAcrossBuffers(client: Client, chainId: ChainId): Promise<IAcrossTiming> {
  const address = acrossSpokePoolOf(chainId)
  const [quoteBuffer, fillBuffer] = await Promise.all([
    readContract(client, { address, abi: SPOKE_BUFFER_ABI, functionName: 'depositQuoteTimeBuffer' }),
    readContract(client, { address, abi: SPOKE_BUFFER_ABI, functionName: 'fillDeadlineBuffer' })
  ])
  return { quoteBuffer: Number(quoteBuffer), fillBuffer: Number(fillBuffer) }
}

function acrossFillDeadline(timing: IAcrossTiming): number {
  const now = Math.floor(Date.now() / 1000)
  if (timing.fillBuffer < Number(PROTOCOL.maxIntentTtlSec) + MIN_FILL_WINDOW_SEC + FILL_DEADLINE_SKEW_SEC) {
    throw new CompactError(
      'ROUTE_UNAVAILABLE',
      `across fillDeadlineBuffer ${timing.fillBuffer}s is shorter than the ${PROTOCOL.maxIntentTtlSec}s an intent stays mineable plus ${MIN_FILL_WINDOW_SEC}s to fill and ${FILL_DEADLINE_SKEW_SEC}s of clock skew; no fill deadline can be quoted that survives the intent's own lifetime`,
      'hard'
    )
  }
  return now + timing.fillBuffer - FILL_DEADLINE_SKEW_SEC
}

export function acrossQuoteExpiry(timing: IAcrossTiming, quoteTimestamp: number): number {
  return quoteTimestamp + timing.quoteBuffer
}

export function verifyAcrossTiming(timing: IAcrossTiming, quoteTimestamp: number, fillDeadline: number, mineableUntil: bigint): void {
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
  if (BigInt(fillDeadline) < mineableUntil + BigInt(MIN_FILL_WINDOW_SEC)) {
    throw new CompactError(
      'BAD_REQUEST',
      `across fillDeadline ${fillDeadline} leaves less than ${MIN_FILL_WINDOW_SEC}s of fill window after ${mineableUntil}, until when this intent stays mineable; the deposit could land unfillable and refund on origin instead of bridging. Re-quote the route.`,
      'soft'
    )
  }
}

export const ACROSS_DEPOSIT_ABI = [
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

const SUGGESTED_FEES_PATH = '/suggested-fees'
const UNSUPPORTED_LANE = /Unsupported token address/i
const unsupportedLane = new Set<string>()

const acrossLaneKey = (
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
