import { CHAIN_ACROSS_MAP } from '@puppet/contracts/const'
import { type Address, getAddress, isAddressEqual } from 'viem'
import { CompactError } from '../compact/index.js'

const ACROSS_API_BASE = 'https://app.across.to/api'
const QUOTE_OUTPUT_TOLERANCE_BPS = 10n
const QUOTE_FETCH_TIMEOUT_MS = 5_000

export interface IAcrossQuoteRequest {
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  recipient: Address
  destinationChainId: number
}

export interface IAcrossQuote {
  outputAmount: bigint
  exclusiveRelayer: Address
  quoteTimestamp: number
  fillDeadline: number
  exclusivityDeadline: number
  spokePoolAddress: Address
  isAmountTooLow: boolean
}

interface IAcrossSuggestedFeesResponse {
  outputAmount?: string
  exclusiveRelayer?: string
  timestamp?: string
  fillDeadline?: string
  exclusivityDeadline?: string
  spokePoolAddress?: string
  isAmountTooLow?: boolean
}

export async function fetchAcrossQuote(req: IAcrossQuoteRequest, originChainId: number): Promise<IAcrossQuote> {
  const query = new URLSearchParams({
    inputToken: req.inputToken,
    outputToken: req.outputToken,
    originChainId: String(originChainId),
    destinationChainId: String(req.destinationChainId),
    amount: req.inputAmount.toString(),
    recipient: req.recipient
  })

  let res: Response
  try {
    res = await fetch(`${ACROSS_API_BASE}/suggested-fees?${query.toString()}`, {
      signal: AbortSignal.timeout(QUOTE_FETCH_TIMEOUT_MS)
    })
  } catch (e) {
    throw new CompactError('QUOTE_FETCH_FAILED', e instanceof Error ? e.message : String(e), 'server')
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '<no body>')
    throw new CompactError('QUOTE_FETCH_FAILED', `Across quote ${res.status}: ${body.slice(0, 200)}`, 'server')
  }

  const json = (await res.json().catch(() => null)) as IAcrossSuggestedFeesResponse | null
  if (
    !json ||
    typeof json.outputAmount !== 'string' ||
    typeof json.exclusiveRelayer !== 'string' ||
    typeof json.timestamp !== 'string' ||
    typeof json.fillDeadline !== 'string' ||
    typeof json.exclusivityDeadline !== 'string' ||
    typeof json.spokePoolAddress !== 'string'
  ) {
    throw new CompactError('QUOTE_INVALID_RESPONSE', `unexpected Across response: ${JSON.stringify(json)}`, 'server')
  }

  const spokePoolAddress = getAddress(json.spokePoolAddress)
  const pinned = CHAIN_ACROSS_MAP[originChainId as keyof typeof CHAIN_ACROSS_MAP]?.SpokePool
  if (pinned && !isAddressEqual(spokePoolAddress, pinned as Address)) {
    throw new CompactError(
      'QUOTE_INVALID_RESPONSE',
      `Across SpokePool drift on chain ${originChainId}: api ${spokePoolAddress} != pinned ${pinned}`,
      'server'
    )
  }

  return {
    outputAmount: BigInt(json.outputAmount),
    exclusiveRelayer: getAddress(json.exclusiveRelayer),
    quoteTimestamp: Number(json.timestamp),
    fillDeadline: Number(json.fillDeadline),
    exclusivityDeadline: Number(json.exclusivityDeadline),
    spokePoolAddress,
    isAmountTooLow: json.isAmountTooLow === true
  }
}

export interface IQuoteCheck extends IAcrossQuoteRequest {
  outputAmount: bigint
  fillDeadline: number
}

export async function revalidateAcrossQuote(deposit: IQuoteCheck, originChainId: number): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000)
  if (deposit.fillDeadline <= nowSec) {
    throw new CompactError('DEADLINE_PASSED', `Across fillDeadline ${deposit.fillDeadline} is in the past`)
  }

  const fresh = await fetchAcrossQuote(deposit, originChainId)
  const diff =
    fresh.outputAmount > deposit.outputAmount
      ? fresh.outputAmount - deposit.outputAmount
      : deposit.outputAmount - fresh.outputAmount
  const allowed = (fresh.outputAmount * QUOTE_OUTPUT_TOLERANCE_BPS) / 10_000n
  if (diff > allowed) {
    throw new CompactError(
      'QUOTE_DRIFT',
      `Across outputAmount drift ${diff} > tolerance ${allowed} (signed ${deposit.outputAmount}, fresh ${fresh.outputAmount})`
    )
  }
}
