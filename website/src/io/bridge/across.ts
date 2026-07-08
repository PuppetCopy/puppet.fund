import type { Address } from 'viem'
import { quoteAbortSignal } from './lifiSwap.js'
import { providerToken } from './swapCommon.js'

const SUGGESTED_FEES_PATH = '/api/swap/across/suggested-fees'
const FILL_WINDOW_SEC = 30 * 60
const EXPIRE_WINDOW_SEC = 60 * 60

interface IAcrossBridgeQuoteParams {
  originChainId: number
  destinationChainId: number
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  recipient: Address
}

interface IAcrossSuggestedFees {
  timestamp: string
  exclusiveRelayer: Address
  exclusivityDeadline: number
  isAmountTooLow: boolean
  outputAmount: string
  estimatedFillTimeSec?: number
  limits: { minDeposit: string; maxDeposit: string }
}

export async function fetchAcrossJson<T>(
  path: string,
  params: Record<string, string>,
  errorLabel: string,
  signal?: AbortSignal
): Promise<T> {
  const res = await fetch(`${window.location.origin}${path}?${new URLSearchParams(params).toString()}`, {
    signal: quoteAbortSignal(signal, 10_000)
  }).catch(() => {
    throw new Error(errorLabel)
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(typeof body?.message === 'string' ? body.message : errorLabel)
  }
  return (await res.json().catch(() => {
    throw new Error(errorLabel)
  })) as T
}

export async function fetchAcrossBridgeQuote(params: IAcrossBridgeQuoteParams, signal?: AbortSignal) {
  const nowSec = Math.floor(Date.now() / 1000)
  const data = await fetchAcrossJson<IAcrossSuggestedFees>(
    SUGGESTED_FEES_PATH,
    {
      amount: params.inputAmount.toString(),
      inputToken: providerToken(params.inputToken, params.originChainId),
      outputToken: providerToken(params.outputToken, params.destinationChainId),
      originChainId: String(params.originChainId),
      destinationChainId: String(params.destinationChainId),
      recipient: params.recipient
    },
    'Across quote unavailable for this route',
    signal
  )
  const outputAmount = BigInt(data.outputAmount)
  return {
    provider: 'Across' as const,
    route: {
      kind: 'across' as const,
      exclusiveRelayer: data.exclusiveRelayer,
      quoteTimestamp: Number(data.timestamp),
      exclusivityParameter: data.exclusivityDeadline
    },
    outputAmount,
    etaSec: data.estimatedFillTimeSec,
    fillDeadline: nowSec + FILL_WINDOW_SEC,
    expires: nowSec + EXPIRE_WINDOW_SEC,
    isAmountTooLow: data.isAmountTooLow || outputAmount === 0n,
    limits: { minDeposit: BigInt(data.limits.minDeposit), maxDeposit: BigInt(data.limits.maxDeposit) }
  }
}

export type AcrossBridgeQuote = Awaited<ReturnType<typeof fetchAcrossBridgeQuote>>
// Cross-chain CROSS-ASSET fund-side routes do NOT use Across's fused /swap endpoint: its calldata delivers through a
// MulticallHandler whose delivery program cannot be bound back to the ACCOUNT. Cross-asset cross-chain fund flows go
// through the COMPOSED route instead — a local swap to a bridgeable asset + this same-asset bridge (recipient rebuilt
// = route at attest) + an optional local swap on the destination. The one exception is WITHDRAW: wallet delivery
// cannot compose (no session control after payout), so it uses the fused endpoint under the field-pinned 'acrossSwap'
// screening (./acrossSwap.ts + sdk attestation/acrossSwapAndBridge.ts), where the pin target IS the user's wallet.
