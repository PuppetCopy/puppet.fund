import type { Address } from 'viem'
import { type AcrossBridgeQuote, fetchAcrossBridgeQuote } from './across.js'
import { fetchLifiSwapQuote, type LifiSwapQuote } from './lifiSwap.js'

export type ISwapProvider = 'Across' | 'LI.FI'
export type ISwapQuote = (AcrossBridgeQuote | LifiSwapQuote) & { provider: ISwapProvider }

// One generic swap: input token on any chain to output token at the route on the
// destination chain, cross-chain only as an internal detail. Eligible providers are
// quoted in parallel and the best output wins; the on-chain side is provider-agnostic
// (PassthroughRoute executes whatever provider call the winning quote encodes).
export async function fetchSwapQuote(p: {
  originChainId: number
  destinationChainId: number
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  route: Address
}): Promise<ISwapQuote> {
  const attempts: Promise<ISwapQuote>[] = [
    fetchLifiSwapQuote({
      chainId: p.originChainId,
      toChainId: p.destinationChainId,
      inputToken: p.inputToken,
      outputToken: p.outputToken,
      inputAmount: p.inputAmount,
      fromAddress: p.route,
      toAddress: p.route
    }).then(quote => ({ ...quote, provider: 'LI.FI' as const }))
  ]
  if (p.originChainId !== p.destinationChainId) {
    attempts.push(
      fetchAcrossBridgeQuote({
        originChainId: p.originChainId,
        destinationChainId: p.destinationChainId,
        inputToken: p.inputToken,
        outputToken: p.outputToken,
        inputAmount: p.inputAmount,
        recipient: p.route
      }).then(quote => ({ ...quote, provider: 'Across' as const }))
    )
  }
  const settled = await Promise.allSettled(attempts)
  const quotes = settled
    .filter((s): s is PromiseFulfilledResult<ISwapQuote> => s.status === 'fulfilled')
    .map(s => s.value)
  if (quotes.length === 0) {
    const failure = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected')
    throw failure?.reason ?? new Error('Swap quote unavailable for this route')
  }
  return quotes.reduce((best, quote) => (quote.outputAmount > best.outputAmount ? quote : best))
}
