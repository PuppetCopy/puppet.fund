import type { Address, Hex } from 'viem'

const QUOTE_PATH = '/api/swapQuote/v1/quote'
const FILL_WINDOW_SEC = 5 * 60
const EXPIRE_WINDOW_SEC = 5 * 60
const DEFAULT_SLIPPAGE = 0.005
const UINT256_MAX = 2n ** 256n - 1n

interface ILifiSwapParams {
  chainId: number
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  fromAddress: Address
  toAddress: Address
  slippage?: number
}

interface ILifiQuoteResponse {
  estimate: { toAmount: string; toAmountMin: string; approvalAddress: Address }
  transactionRequest: { to: Address; data: Hex; value?: string }
}

async function fetchLifiQuote(params: ILifiSwapParams): Promise<ILifiQuoteResponse | null> {
  const query = new URLSearchParams({
    fromChain: String(params.chainId),
    toChain: String(params.chainId),
    fromToken: params.inputToken,
    toToken: params.outputToken,
    fromAmount: params.inputAmount.toString(),
    fromAddress: params.fromAddress,
    toAddress: params.toAddress,
    slippage: String(params.slippage ?? DEFAULT_SLIPPAGE)
  })
  try {
    const res = await fetch(`${window.location.origin}${QUOTE_PATH}?${query.toString()}`)
    if (!res.ok) return null
    return (await res.json()) as ILifiQuoteResponse
  } catch {
    return null
  }
}

export async function fetchLifiSwapQuote(params: ILifiSwapParams) {
  const nowSec = Math.floor(Date.now() / 1000)
  const quote = await fetchLifiQuote(params)
  if (quote === null) {
    throw new Error('Same-chain swap quote unavailable for this route')
  }
  const provider = quote.transactionRequest.to
  if (quote.estimate.approvalAddress.toLowerCase() !== provider.toLowerCase()) {
    throw new Error('LI.FI approval target differs from the swap router')
  }
  const outputAmount = BigInt(quote.estimate.toAmountMin)
  return {
    route: { kind: 'swap' as const, provider, providerCallData: quote.transactionRequest.data },
    outputAmount,
    fillDeadline: nowSec + FILL_WINDOW_SEC,
    expires: nowSec + EXPIRE_WINDOW_SEC,
    isAmountTooLow: outputAmount === 0n,
    limits: { minDeposit: 0n, maxDeposit: UINT256_MAX }
  }
}

export type LifiSwapQuote = Awaited<ReturnType<typeof fetchLifiSwapQuote>>
