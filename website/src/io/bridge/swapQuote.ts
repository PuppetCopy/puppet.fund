import { CHAIN_META, CHAIN_TOKEN_MAP, HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import { symbolByAddress, tokenMetaByAddress } from '@puppet/sdk/state'
import type { Address } from 'viem'
import { getAddress, isAddressEqual } from 'viem'
import { type AcrossBridgeQuote, fetchAcrossBridgeQuote } from './across.js'
import type { AcrossWithdrawSwapQuote } from './acrossSwap.js'
import { fetchLifiSwapQuote, type LifiSwapQuote } from './lifiSwap.js'

// Quotes whose route executes as ONE signed swap intent. The composed quote is a planned TWO-LEG delivery (same-asset
// bridge, then a hub-local swap signed by the session at execution time) and is deliberately outside this type: the
// runner's single-intent paths (fundSwap re-quote) must never receive it.
export type IExecutableSwapQuote = AcrossBridgeQuote | LifiSwapQuote

export interface IComposedQuote {
  provider: 'Composed'
  tool: string
  route: { kind: 'composed' }
  // Leg 1: SAME-ASSET bridge origin -> hub (needs no destination call, so lanes that are structurally unavailable
  // for cross-asset delivery still serve it). Executes as an ordinary swap intent on the origin chain.
  bridge: AcrossBridgeQuote
  // Leg 2 identity + Save-time estimate: the hub-side token the bridge delivers, swapped locally to the base. The
  // executable quote is re-fetched at execution, sized from the LIVE route balance, and floor-checked against
  // outputAmount below.
  hubToken: Address
  // The bridge leg's ACTUAL input amount and the asset it moves, both denominated in the BRIDGED token — deposit
  // composed bridges the input as-is (= inputToken/inputAmount), fund composed bridges the swapped intermediate (a
  // stablecoin) so its amount/units differ from the request input. Limit checks (min/max deposit) must read THESE, not
  // req.inputAmount, or a native input's raw amount is compared against a 6-decimal stablecoin cap.
  bridgeInput: bigint
  bridgeAsset: Address
  txValue: 0n
  outputAmount: bigint
  etaSec?: number
  fillDeadline: number
  expires: number
  isAmountTooLow: boolean
  limits: { minDeposit: bigint; maxDeposit: bigint }
}

// The fused withdraw swap-and-bridge joins the QUOTE union only — never IExecutableSwapQuote: it delivers to the
// user's wallet, so no fund-side single-intent path may ever receive it.
export type ISwapQuote = IExecutableSwapQuote | IComposedQuote | AcrossWithdrawSwapQuote
export type ISwapProvider = ISwapQuote['provider']

// Routes a fund-side SWAP INTENT may carry: 'composed' is a plan (not a route) and 'acrossSwap' delivers to the
// user's wallet, so both are excluded — value from these intents must land back in the account system.
export const isExecutableSwapRoute = (route: ISwapQuote['route']): route is IExecutableSwapQuote['route'] =>
  route.kind === 'swap' || route.kind === 'across'

export interface ISwapRequest {
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
}

export interface ISwapAttempt {
  provider: ISwapProvider
  quote: Promise<ISwapQuote>
}

// Every route source raced for a request, each as its own in-flight promise, so the caller can surface routes AS they
// resolve (aggregator UX) instead of blocking on the slowest. fetchSwapQuote folds these into the single best.
export function swapQuoteAttempts(p: ISwapRequest, signal?: AbortSignal): ISwapAttempt[] {
  const { originChainId, destinationChainId, inputToken, outputToken, inputAmount, route } = p
  const tokens = { inputToken, outputToken, inputAmount }

  // Only routes the co-signer will sign: attestation refuses any cross-chain 'swap'-kind (its delivery recipient is
  // client-built and unpinnable), so LI.FI serves LOCAL swaps only, and cross-chain delivery is the same-asset Across
  // bridge (kind 'across', recipient REBUILT = route at attest). Direct cross-chain cross-asset (LI.FI swap-and-bridge,
  // Across /swap) is dropped here — cross-asset deposits get it via the composed route instead; other surfaces don't
  // offer a route the relay would reject.
  if (originChainId === destinationChainId) {
    return [
      {
        provider: 'LI.FI',
        quote: fetchLifiSwapQuote({
          chainId: originChainId,
          toChainId: destinationChainId,
          ...tokens,
          fromAddress: route,
          toAddress: route,
          signal
        })
      }
    ]
  }
  if (p.crossToken) return []
  return [
    {
      provider: 'Across',
      quote: fetchAcrossBridgeQuote({ originChainId, destinationChainId, ...tokens, recipient: route }, signal)
    }
  ]
}

// The planned two-leg route: bridge the input AS-IS to its hub-side twin, then swap to the base locally on the hub.
// Raced alongside the fused provider routes for cross-asset deposits; wins when its net output is better or when no
// fused route exists (e.g. LI.FI has same-asset lanes to the hub but no destination-call support).
export async function fetchComposedSwapQuote(p: ISwapRequest, signal?: AbortSignal): Promise<IComposedQuote> {
  const hubTokens = CHAIN_TOKEN_MAP[p.destinationChainId as keyof typeof CHAIN_TOKEN_MAP] as
    | Record<string, Address>
    | undefined
  // The hub twin resolves by TOKEN KEY (WETH -> hub WETH), never the priced symbol — the priced symbol collapses the
  // WETH family onto the 'ETH' key, which the hub map doesn't even carry (its gas coin is MON), killing every
  // ETH-family cross-asset deposit. A native input keys its ORIGIN chain's wrapped twin.
  const inputKey = isAddressEqual(getAddress(p.inputToken), getAddress(PROTOCOL.nativeToken))
    ? CHAIN_META[p.originChainId as keyof typeof CHAIN_META].wnt
    : tokenMetaByAddress.get(getAddress(p.inputToken))?.tokenKey
  const hubToken = inputKey ? hubTokens?.[inputKey] : undefined
  if (!hubToken || getAddress(hubToken) === getAddress(p.outputToken)) {
    throw new Error(`no same-asset hub lane for ${inputKey ?? p.inputToken}`)
  }
  const bridgeLeg = { ...p, outputToken: getAddress(hubToken), crossToken: false }
  // Leg 1 is the Across bridge ONLY (kind 'across'): the co-signer rebuilds its calldata with recipient=route, so the
  // bridged funds cannot leave the account. A LI.FI same-asset leg would be a cross-chain 'swap'-kind whose recipient
  // attestation refuses to sign, so it is not raced here.
  const bridge = await fetchAcrossBridgeQuote(
    {
      originChainId: bridgeLeg.originChainId,
      destinationChainId: bridgeLeg.destinationChainId,
      inputToken: bridgeLeg.inputToken,
      outputToken: bridgeLeg.outputToken,
      inputAmount: bridgeLeg.inputAmount,
      recipient: bridgeLeg.route
    },
    signal
  )
  const hubSwap = await fetchLifiSwapQuote({
    chainId: p.destinationChainId,
    inputToken: getAddress(hubToken),
    outputToken: p.outputToken,
    inputAmount: bridge.outputAmount,
    fromAddress: p.route,
    toAddress: p.route,
    signal
  })
  return {
    provider: 'Composed',
    tool: `Across + ${hubSwap.tool}`,
    route: { kind: 'composed' },
    bridge,
    hubToken: getAddress(hubToken),
    bridgeInput: p.inputAmount,
    bridgeAsset: getAddress(p.inputToken),
    txValue: 0n,
    outputAmount: hubSwap.outputAmount,
    etaSec: bridge.etaSec,
    fillDeadline: bridge.fillDeadline,
    expires: Math.min(bridge.expires, hubSwap.expires),
    isAmountTooLow: bridge.isAmountTooLow || hubSwap.isAmountTooLow,
    limits: bridge.limits
  }
}

// One composed cross-token CROSS-CHAIN FUND route through a chosen bridge asset X: swap the input to X locally on the
// origin (skipped when the input already IS X), bridge that SAME asset X to the fund's route on the destination
// (recipient pinned by the Across builder), then swap X to the output locally on the destination (skipped when X already
// IS the output). Every leg is individually signable — two local LI.FI swaps and a same-asset 'across' bridge — so it
// closes the cross-token-cross-chain gap the direct 'swap'-kind rejection opened without ever pinning an external
// recipient. `hubToken` carries X so the runner executes the SAME intermediate the quote priced.
async function buildComposedFundRoute(
  p: ISwapRequest,
  xOrigin: Address,
  xDest: Address,
  destOutput: Address | null,
  signal?: AbortSignal
): Promise<IComposedQuote> {
  const tools: string[] = []
  const inputIsX = symbolByAddress(p.inputToken) === symbolByAddress(xOrigin)
  let bridgeInput = p.inputAmount
  if (!inputIsX) {
    const origin = await fetchLifiSwapQuote({
      chainId: p.originChainId,
      inputToken: p.inputToken,
      outputToken: xOrigin,
      inputAmount: p.inputAmount,
      fromAddress: p.route,
      toAddress: p.route,
      signal
    })
    bridgeInput = origin.outputAmount
    tools.push(origin.tool)
  }
  const bridge = await fetchAcrossBridgeQuote(
    {
      originChainId: p.originChainId,
      destinationChainId: p.destinationChainId,
      inputToken: xOrigin,
      outputToken: xDest,
      inputAmount: bridgeInput,
      recipient: p.route
    },
    signal
  )
  tools.push('Across')
  const dest = destOutput
    ? await fetchLifiSwapQuote({
        chainId: p.destinationChainId,
        inputToken: xDest,
        outputToken: destOutput,
        inputAmount: bridge.outputAmount,
        fromAddress: p.route,
        toAddress: p.route,
        signal
      })
    : null
  if (dest) tools.push(dest.tool)
  const expiries = [bridge.expires, ...(dest ? [dest.expires] : [])]
  return {
    provider: 'Composed',
    tool: tools.join(' + '),
    route: { kind: 'composed' },
    bridge,
    hubToken: xOrigin,
    bridgeInput,
    bridgeAsset: xOrigin,
    txValue: 0n,
    outputAmount: dest ? dest.outputAmount : bridge.outputAmount,
    etaSec: bridge.etaSec,
    fillDeadline: bridge.fillDeadline,
    expires: Math.min(...expiries),
    isAmountTooLow: bridge.isAmountTooLow || (dest?.isAmountTooLow ?? false),
    limits: bridge.limits
  }
}

export async function fetchComposedFundSwapQuote(p: ISwapRequest, signal?: AbortSignal): Promise<IComposedQuote> {
  const originTokens = CHAIN_TOKEN_MAP[p.originChainId as keyof typeof CHAIN_TOKEN_MAP] as
    | Record<string, Address>
    | undefined
  const destTokens = CHAIN_TOKEN_MAP[p.destinationChainId as keyof typeof CHAIN_TOKEN_MAP] as
    | Record<string, Address>
    | undefined
  // A NATIVE output can't cross a bridge (the marker is codeless): it rides as the destination's wrapped twin
  // (token KEY, e.g. WETH) and the runner converts in a final local leg — a 1:1 unwrap when the twin bridged, so
  // no dest-leg quote is needed and the bridged amount IS the native estimate.
  const outNative = isAddressEqual(getAddress(p.outputToken), getAddress(PROTOCOL.nativeToken))
  const wntKey = CHAIN_META[p.destinationChainId as keyof typeof CHAIN_META].wnt
  // Prefer the 2-leg shape: bridge the OUTPUT asset itself (X = its origin twin), so no destination swap is needed. This
  // wins whenever Across supports that asset from the origin. The twin resolves by TOKEN KEY, never the priced symbol:
  // the priced symbol collapses the WETH family onto the 'ETH' key = the native MARKER, which cannot be an X.
  const outKey = outNative
    ? wntKey
    : (tokenMetaByAddress.get(getAddress(p.outputToken))?.tokenKey ?? symbolByAddress(p.outputToken))
  const outputTwin = originTokens?.[outKey]
  const twinDest = outNative ? (destTokens?.[wntKey] as Address | undefined) : p.outputToken
  if (
    outputTwin &&
    !isAddressEqual(getAddress(outputTwin), getAddress(PROTOCOL.nativeToken)) &&
    twinDest &&
    symbolByAddress(outputTwin) !== symbolByAddress(p.inputToken)
  ) {
    try {
      return await buildComposedFundRoute(p, getAddress(outputTwin), getAddress(twinDest), null, signal)
    } catch {
      // The output asset is not Across-bridgeable from the origin (e.g. WETH from Monad): fall through to the stablecoin
      // intermediate, which every supported chain bridges.
    }
  }
  const usdcOrigin = originTokens?.USDC
  const usdcDest = destTokens?.USDC
  if (!usdcOrigin || !usdcDest) {
    throw new Error(`no bridgeable intermediate to reach the requested output on chain ${p.destinationChainId}`)
  }
  return buildComposedFundRoute(p, getAddress(usdcOrigin), getAddress(usdcDest), p.outputToken, signal)
}

// Fund-swap surfaces race the composed swap-then-bridge route for cross-token cross-chain (only there: the fund-swap
// runner owns the two-leg execution). Same-chain and same-asset cross-chain keep the fused set.
export function fundSwapQuoteAttempts(p: ISwapRequest, signal?: AbortSignal): ISwapAttempt[] {
  const attempts = swapQuoteAttempts(p, signal)
  if (p.crossToken && p.originChainId !== p.destinationChainId) {
    attempts.push({ provider: 'Composed', quote: fetchComposedFundSwapQuote(p, signal) })
  }
  return attempts
}

// Deposit surfaces race the composed two-leg route alongside the fused providers (only there: the deposit runner
// owns the leg-2 execution; single-intent surfaces keep the executable set).
export function depositSwapQuoteAttempts(p: ISwapRequest, signal?: AbortSignal): ISwapAttempt[] {
  const attempts = swapQuoteAttempts(p, signal)
  if (p.crossToken && p.originChainId !== p.destinationChainId && p.destinationChainId === HUB_CHAIN_ID) {
    attempts.push({ provider: 'Composed', quote: fetchComposedSwapQuote(p, signal) })
  }
  return attempts
}

export async function fetchSwapQuote(p: ISwapRequest): Promise<IExecutableSwapQuote> {
  const settled = await Promise.allSettled(swapQuoteAttempts(p).map(a => a.quote))
  const quotes = settled.flatMap(s => (s.status === 'fulfilled' ? [s.value as IExecutableSwapQuote] : []))
  if (quotes.length === 0) {
    const failure = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected')
    throw failure?.reason ?? new Error('Swap quote unavailable for this route')
  }
  return quotes.reduce((best, q) => (q.outputAmount > best.outputAmount ? q : best))
}
