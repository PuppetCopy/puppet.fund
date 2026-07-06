import type { Address, Hex } from 'viem'
import { providerToken } from './swapCommon.js'

const QUOTE_PATH = '/api/swap/lifi/v1/quote'
// A LI.FI route may be cross-chain (it bridges, like Across), so the fill window must cover the bridge-fill latency:
// keep it >= the client's BRIDGE_FILL_TIMEOUT_MS (15m) and in line with the Across path (30m fill / 60m expire). The
// deadline FIELDS are seconds (fillDeadline goes on-chain as the Across SpokePool uint32, and swapGuard requires
// fillDeadline <= expires), so the windows are kept in ms and converted once at the field below.
const FILL_WINDOW_SEC = 30 * 60
const EXPIRE_WINDOW_SEC = 60 * 60
const DEFAULT_SLIPPAGE = 0.005
const UINT256_MAX = 2n ** 256n - 1n

interface ILifiSwapParams {
  chainId: number
  toChainId?: number
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  fromAddress: Address
  toAddress: Address
  slippage?: number
  signal?: AbortSignal
}

export const quoteAbortSignal = (external: AbortSignal | undefined, timeoutMs: number): AbortSignal =>
  external ? AbortSignal.any([external, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)

interface ILifiQuoteResponse {
  toolDetails?: { name?: string }
  estimate: { toAmount: string; toAmountMin: string; approvalAddress?: Address; executionDuration?: number }
  transactionRequest: { to: Address; data: Hex; value?: string }
}

async function fetchLifiQuote(params: ILifiSwapParams): Promise<ILifiQuoteResponse> {
  const toChain = params.toChainId ?? params.chainId
  const query = new URLSearchParams({
    fromChain: String(params.chainId),
    toChain: String(toChain),
    fromToken: providerToken(params.inputToken, params.chainId),
    toToken: providerToken(params.outputToken, toChain),
    fromAmount: params.inputAmount.toString(),
    fromAddress: params.fromAddress,
    toAddress: params.toAddress,
    slippage: String(params.slippage ?? DEFAULT_SLIPPAGE)
  })
  const attempt = () =>
    fetch(`${window.location.origin}${QUOTE_PATH}?${query.toString()}`, { signal: quoteAbortSignal(params.signal, 10_000) })
  // One retry absorbs transient rejections (timeout, connection blip); a rejection here
  // is a transport failure, not a route verdict, and the message says so.
  const res = await attempt()
    .catch(attempt)
    .catch(() => {
      throw new Error('Swap quote request failed, check your connection and retry')
    })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    if (typeof body?.message === 'string') throw new Error(`LI.FI: ${body.message}`)
    if (res.status >= 500 || res.status === 429) {
      throw new Error('Swap provider temporarily unavailable, please retry')
    }
    throw new Error('Swap quote unavailable for this route')
  }
  return (await res.json()) as ILifiQuoteResponse
}

export async function fetchLifiSwapQuote(params: ILifiSwapParams) {
  const now = Date.now() / 1000
  const quote = await fetchLifiQuote(params)
  const provider = quote.transactionRequest.to
  // approvalAddress is absent for routes needing no ERC20 approval (native input); only enforce the approve-target ===
  // router guard when LI.FI returns one (mirrors the Across swap path's null-safe approval check).
  const approvalAddress = quote.estimate.approvalAddress
  if (approvalAddress && approvalAddress.toLowerCase() !== provider.toLowerCase()) {
    throw new Error('LI.FI approval target differs from the swap router')
  }
  // The fund/route is funded in WETH and the gate calls the swap provider with value:0 (it never forwards native ETH),
  // so a quote whose tx needs native msg.value is structurally un-executable — it would sign a doomed intent that
  // reverts on-chain with `balance=0, required=<value>`. Fail closed at quote time; fetchSwapQuote then drops this via
  // allSettled and an executable route (the Across bridge, or a value:0 quote) wins.
  const txValue = BigInt(quote.transactionRequest.value ?? 0)
  if (txValue !== 0n) {
    throw new Error('LI.FI route requires native ETH value; not executable from a WETH-funded route')
  }
  const outputAmount = BigInt(quote.estimate.toAmountMin)
  return {
    provider: 'LI.FI' as const,
    route: { kind: 'swap' as const, provider, providerCallData: quote.transactionRequest.data },
    txValue,
    tool: quote.toolDetails?.name ?? 'LI.FI',
    outputAmount,
    etaSec: quote.estimate.executionDuration,
    fillDeadline: now + FILL_WINDOW_SEC,
    expires: now + EXPIRE_WINDOW_SEC,
    isAmountTooLow: outputAmount === 0n,
    limits: { minDeposit: 0n, maxDeposit: UINT256_MAX }
  }
}

export type LifiSwapQuote = Awaited<ReturnType<typeof fetchLifiSwapQuote>>
