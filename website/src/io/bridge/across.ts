import type { Address } from 'viem'

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
  limits: { minDeposit: string; maxDeposit: string }
}

export async function fetchAcrossBridgeQuote(params: IAcrossBridgeQuoteParams) {
  const nowSec = Math.floor(Date.now() / 1000)
  const query = new URLSearchParams({
    amount: params.inputAmount.toString(),
    inputToken: params.inputToken,
    outputToken: params.outputToken,
    originChainId: String(params.originChainId),
    destinationChainId: String(params.destinationChainId),
    recipient: params.recipient
  })
  const res = await fetch(`${window.location.origin}${SUGGESTED_FEES_PATH}?${query.toString()}`, {
    signal: AbortSignal.timeout(10_000)
  }).catch(() => {
    throw new Error('Across quote unavailable for this route')
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(typeof body?.message === 'string' ? body.message : 'Across quote unavailable for this route')
  }
  const data = (await res.json().catch(() => {
    throw new Error('Across quote unavailable for this route')
  })) as IAcrossSuggestedFees
  const outputAmount = BigInt(data.outputAmount)
  return {
    route: {
      kind: 'across' as const,
      exclusiveRelayer: data.exclusiveRelayer,
      quoteTimestamp: Number(data.timestamp),
      exclusivityParameter: data.exclusivityDeadline
    },
    outputAmount,
    fillDeadline: nowSec + FILL_WINDOW_SEC,
    expires: nowSec + EXPIRE_WINDOW_SEC,
    isAmountTooLow: data.isAmountTooLow || outputAmount === 0n,
    limits: { minDeposit: BigInt(data.limits.minDeposit), maxDeposit: BigInt(data.limits.maxDeposit) }
  }
}

export type AcrossBridgeQuote = Awaited<ReturnType<typeof fetchAcrossBridgeQuote>>
