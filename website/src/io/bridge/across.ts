import type { Address } from 'viem'

const ACROSS_API_BASE = '/api/bridgeQuote'

interface AcrossSuggestedFees {
  outputAmount: string
  timestamp: string
  fillDeadline: string
  exclusiveRelayer: Address
  exclusivityDeadline: string
  isAmountTooLow: boolean
  limits: { minDeposit: string; maxDeposit: string }
}

interface AcrossLimitsResponse {
  minDeposit: string
  maxDeposit: string
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    let message = body
    try {
      const parsed: unknown = JSON.parse(body)
      if (parsed && typeof parsed === 'object' && 'message' in parsed && typeof parsed.message === 'string') {
        message = parsed.message
      }
    } catch {}
    throw new Error(message || `Across request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

export async function fetchAcrossQuote(params: {
  originChainId: number
  destinationChainId: number
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  recipient: Address
}) {
  const qs = new URLSearchParams({
    originChainId: String(params.originChainId),
    destinationChainId: String(params.destinationChainId),
    inputToken: params.inputToken,
    outputToken: params.outputToken,
    amount: params.inputAmount.toString(),
    recipient: params.recipient
  })
  const data = await getJson<AcrossSuggestedFees>(`${ACROSS_API_BASE}/suggested-fees?${qs}`)
  return {
    exclusiveRelayer: data.exclusiveRelayer,
    quoteTimestamp: Number(data.timestamp),
    fillDeadline: Number(data.fillDeadline),
    exclusivityDeadline: Number(data.exclusivityDeadline),
    outputAmount: BigInt(data.outputAmount),
    isAmountTooLow: data.isAmountTooLow,
    limits: { minDeposit: BigInt(data.limits.minDeposit), maxDeposit: BigInt(data.limits.maxDeposit) }
  }
}

export async function fetchAcrossLimits(params: {
  originChainId: number
  destinationChainId: number
  inputToken: Address
  outputToken: Address
}) {
  const qs = new URLSearchParams({
    originChainId: String(params.originChainId),
    destinationChainId: String(params.destinationChainId),
    inputToken: params.inputToken,
    outputToken: params.outputToken
  })
  const data = await getJson<AcrossLimitsResponse>(`${ACROSS_API_BASE}/limits?${qs}`)
  return { minDeposit: BigInt(data.minDeposit), maxDeposit: BigInt(data.maxDeposit) }
}

export type AcrossQuote = Awaited<ReturnType<typeof fetchAcrossQuote>>
export type AcrossLimits = Awaited<ReturnType<typeof fetchAcrossLimits>>
