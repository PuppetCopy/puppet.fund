import type { Address } from 'viem'
import { type AcrossBridgeQuote, type AcrossSwapQuote, fetchAcrossBridgeQuote, fetchAcrossSwapQuote } from './across.js'
import { fetchLifiSwapQuote, type LifiSwapQuote } from './lifiSwap.js'

export type ISwapQuote = AcrossBridgeQuote | AcrossSwapQuote | LifiSwapQuote
export type ISwapProvider = ISwapQuote['provider']

export async function fetchSwapQuote(p: {
  originChainId: number
  destinationChainId: number
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  route: Address
  // The input asset differs from the output asset. Across does cross-chain swaps via /swap/approval and same-asset
  // bridges via /suggested-fees, but NOT same-chain swaps. So cross-token cross-chain races Across's swap endpoint,
  // same-asset cross-chain races its bridge endpoint, and same-chain stays LI.FI-only (the originChainId guard).
  crossToken?: boolean
}): Promise<ISwapQuote> {
  const { originChainId, destinationChainId, inputToken, outputToken, inputAmount, route } = p
  const tokens = { inputToken, outputToken, inputAmount }

  const attempts: Promise<ISwapQuote>[] = [
    fetchLifiSwapQuote({ chainId: originChainId, toChainId: destinationChainId, ...tokens, fromAddress: route, toAddress: route })
  ]
  if (originChainId !== destinationChainId) {
    attempts.push(
      p.crossToken
        ? fetchAcrossSwapQuote({ originChainId, destinationChainId, ...tokens, depositor: route, recipient: route })
        : fetchAcrossBridgeQuote({ originChainId, destinationChainId, ...tokens, recipient: route })
    )
  }

  const settled = await Promise.allSettled(attempts)
  const quotes = settled.flatMap(s => (s.status === 'fulfilled' ? [s.value] : []))
  if (quotes.length === 0) {
    const failure = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected')
    throw failure?.reason ?? new Error('Swap quote unavailable for this route')
  }
  return quotes.reduce((best, q) => (q.outputAmount > best.outputAmount ? q : best))
}
