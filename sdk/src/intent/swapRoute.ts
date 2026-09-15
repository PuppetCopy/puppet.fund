import { CHAIN_TOKEN_MAP } from '@puppet/contracts/const'
import type { Address, } from 'viem'
import type { ChainId } from '../const/index.js'
import { providerToken, symbolOf, tokenKeyOf } from '../state/tokenRegistry.js'
import type { IAcrossTiming } from './acrossDeposit.js'
import { quoteAcrossDeposit } from './acrossDeposit.js'
import { quoteAcrossSwapAndBridge } from './acrossSwapAndBridge.js'
import { quoteLifiSwap } from './lifiSwap.js'
import type { ISwapRoute } from './swap.js'

export interface IRouteBoundsRequest {
  chainId: ChainId
  destinationChainId: bigint
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
}

export interface IRouteLane {
  chainId: ChainId
  destinationChainId: bigint
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  outputAmount: bigint
  expectedOutputAmount: bigint
  tool: string
  etaSec: number | undefined
  limits: { minDeposit: bigint; maxDeposit: bigint } | null
  isAmountTooLow: boolean
}

export interface ISignedLeg extends IRouteLane {
  route: ISwapRoute
  fillDeadline: number
}

export type IRoutePlan = readonly [ISignedLeg, ...IRouteLane[]]

export const deliveredLeg = (plan: IRoutePlan): IRouteLane => plan[plan.length - 1]!

export interface IRouteCandidate {
  id: string
  plan: Promise<IRoutePlan>
}

export interface IRouteEndpoints {
  lifi: string
  across: string
}

const tokenOn = (chainId: number, key: string): Address | null => {
  const table = CHAIN_TOKEN_MAP[chainId as keyof typeof CHAIN_TOKEN_MAP] as Record<string, Address> | undefined
  const found = table?.[key]
  return found ?? null
}

const keyOf = (token: Address, chainId: ChainId): string => tokenKeyOf(chainId, providerToken(token, chainId))

async function quoteComposedRoute(
  endpoints: IRouteEndpoints,
  account: Address,
  recipient: Address,
  bounds: IRouteBoundsRequest,
  timing: IAcrossTiming,
  preferredKey: string | null,
  signal?: AbortSignal
): Promise<IRoutePlan> {
  const destChain = Number(bounds.destinationChainId) as ChainId
  const inputOnDest = tokenOn(destChain, keyOf(bounds.inputToken, bounds.chainId))

  if (inputOnDest && !isSameAsset(inputOnDest, destChain, bounds.outputToken, destChain)) {
    const bridge = await quoteAcrossDeposit(
      endpoints.across,
      recipient,
      { ...bounds, outputToken: inputOnDest, timing },
      signal
    )
    const destSwap = await quoteLifiSwap(
      endpoints.lifi,
      recipient,
      recipient,
      {
        chainId: destChain,
        inputToken: inputOnDest,
        outputToken: bounds.outputToken,
        inputAmount: bridge.outputAmount
      },
      signal
    )
    return [
      { ...bounds, outputToken: inputOnDest, ...bridge, tool: 'Across' },
      {
        chainId: destChain,
        destinationChainId: bounds.destinationChainId,
        inputToken: inputOnDest,
        outputToken: bounds.outputToken,
        inputAmount: bridge.outputAmount,
        outputAmount: destSwap.outputAmount,
        expectedOutputAmount: destSwap.expectedOutputAmount,
        tool: destSwap.tool,
        etaSec: destSwap.etaSec,
        limits: null,
        isAmountTooLow: destSwap.outputAmount === 0n
      }
    ]
  }

  const bridgeKey = preferredKey ?? 'USDC'
  const originMid = tokenOn(bounds.chainId, bridgeKey)
  const destMid = tokenOn(destChain, bridgeKey)
  if (!originMid || !destMid) {
    throw new Error(`no bridgeable intermediate reaches ${bounds.outputToken} on chain ${destChain}`)
  }
  const inputIsMid = isSameAsset(bounds.inputToken, bounds.chainId, originMid, bounds.chainId)
  if (inputIsMid && isSameAsset(destMid, destChain, bounds.outputToken, destChain)) {
    throw new Error(`composing over ${bridgeKey} repeats the direct bridge the across candidate already quotes`)
  }
  const originSwap = inputIsMid
    ? null
    : await quoteLifiSwap(
        endpoints.lifi,
        account,
        account,
        { chainId: bounds.chainId, inputToken: bounds.inputToken, outputToken: originMid, inputAmount: bounds.inputAmount },
        signal
      )
  const bridge = await quoteAcrossDeposit(
    endpoints.across,
    recipient,
    {
      ...bounds,
      inputToken: originMid,
      outputToken: destMid,
      inputAmount: originSwap?.outputAmount ?? bounds.inputAmount,
      timing
    },
    signal
  )
  const tail: IRouteLane[] = [
    {
      chainId: bounds.chainId,
      destinationChainId: bounds.destinationChainId,
      inputToken: originMid,
      outputToken: destMid,
      inputAmount: originSwap?.outputAmount ?? bounds.inputAmount,
      outputAmount: bridge.outputAmount,
      expectedOutputAmount: bridge.expectedOutputAmount,
      tool: 'Across',
      etaSec: bridge.etaSec,
      limits: bridge.limits,
      isAmountTooLow: bridge.isAmountTooLow
    }
  ]
  if (!isSameAsset(destMid, destChain, bounds.outputToken, destChain)) {
    const destSwap = await quoteLifiSwap(
      endpoints.lifi,
      recipient,
      recipient,
      {
        chainId: destChain,
        inputToken: destMid,
        outputToken: bounds.outputToken,
        inputAmount: bridge.outputAmount
      },
      signal
    )
    tail.push({
      chainId: destChain,
      destinationChainId: bounds.destinationChainId,
      inputToken: destMid,
      outputToken: bounds.outputToken,
      inputAmount: bridge.outputAmount,
      outputAmount: destSwap.outputAmount,
      expectedOutputAmount: destSwap.expectedOutputAmount,
      tool: destSwap.tool,
      etaSec: destSwap.etaSec,
      limits: null,
      isAmountTooLow: destSwap.outputAmount === 0n
    })
  }
  if (originSwap === null) {
    const [bridgeLane, ...rest] = tail
    return [{ ...bridgeLane!, route: bridge.route, fillDeadline: bridge.fillDeadline }, ...rest]
  }
  return [
    {
      ...bounds,
      outputToken: originMid,
      ...originSwap,
      fillDeadline: 0,
      limits: null,
      isAmountTooLow: originSwap.outputAmount === 0n
    },
    ...tail
  ]
}

const isSameAsset = (a: Address, aChain: ChainId, b: Address, bChain: ChainId): boolean =>
  symbolOf(aChain, providerToken(a, aChain)) === symbolOf(bChain, providerToken(b, bChain))

const destChainOf = (bounds: IRouteBoundsRequest): ChainId => Number(bounds.destinationChainId) as ChainId

export function quoteSwapRoutes(
  endpoints: IRouteEndpoints,
  account: Address,
  recipient: Address,
  bounds: IRouteBoundsRequest,
  timing: () => Promise<IAcrossTiming>,
  maxLegs: number,
  signal?: AbortSignal
): IRouteCandidate[] {
  const isLocal = bounds.destinationChainId === BigInt(bounds.chainId)
  const sameAsset = isSameAsset(bounds.inputToken, bounds.chainId, bounds.outputToken, destChainOf(bounds))
  const lane = (leg: Omit<ISignedLeg, keyof IRouteBoundsRequest>): IRoutePlan => [{ ...bounds, ...leg }]

  if (isLocal) {
    return [
      {
        id: 'lifi',
        plan: quoteLifiSwap(endpoints.lifi, account, recipient, bounds, signal).then(q =>
          lane({ ...q, fillDeadline: 0, limits: null, isAmountTooLow: q.outputAmount === 0n })
        )
      }
    ]
  }

  const candidates: IRouteCandidate[] = []
  if (sameAsset) {
    candidates.push({
      id: 'across',
      plan: timing()
        .then(t => quoteAcrossDeposit(endpoints.across, recipient, { ...bounds, timing: t }, signal))
        .then(q => lane({ ...q, tool: 'Across' }))
    })
  }
  candidates.push({
    id: 'acrossSwap',
    plan: timing()
      .then(t => quoteAcrossSwapAndBridge(endpoints.across, account, recipient, { ...bounds, timing: t }, signal))
      .then(q => lane({ ...q, tool: 'Across', limits: null, isAmountTooLow: q.outputAmount === 0n }))
  })
  if (maxLegs > 1) {
    const twinKey = keyOf(bounds.outputToken, destChainOf(bounds))
    const preferred = twinKey !== 'USDC' && tokenOn(bounds.chainId, twinKey) ? twinKey : null
    candidates.push({
      id: 'composed',
      plan: timing().then(t =>
        quoteComposedRoute(endpoints, account, recipient, bounds, t, preferred, signal).catch(err => {
          if (preferred === null) throw err
          return quoteComposedRoute(endpoints, account, recipient, bounds, t, 'USDC', signal)
        })
      )
    })
  }
  return candidates
}

export async function bestRoutePlan(candidates: IRouteCandidate[]): Promise<IRoutePlan> {
  const results = await Promise.allSettled(candidates.map(c => c.plan))
  const plans = results.flatMap(s => (s.status === 'fulfilled' ? [s.value] : []))
  if (plans.length === 0) {
    const rejected = results.find((s): s is PromiseRejectedResult => s.status === 'rejected')
    throw rejected?.reason ?? new Error('no route is available for this shape')
  }
  return plans.reduce((best, p) => (deliveredLeg(p).outputAmount > deliveredLeg(best).outputAmount ? p : best))
}
