import { PROTOCOL } from '@puppet/contracts/const'
import { type Address, isAddressEqual } from 'viem'
import { CompactError } from '../../compact/index.js'
import type { ChainId } from '../../const/index.js'
import { SWAP_PROVIDER } from '../../const/network.js'
import { providerToken, tokenKeyOf, wrappedNativeAddressOf } from '../../state/tokenRegistry.js'
import type { IAcrossTiming } from './acrossDeposit.js'
import { quoteAcrossDeposit } from './acrossDeposit.js'
import { quoteAcrossSwapAndBridge } from './acrossSwapAndBridge.js'
import { quoteKyberSwap } from './kyberSwap.js'
import { quoteRelaySwap } from './relaySwap.js'
import { quoteLifiSwap } from './lifiSwap.js'
import { type ISwapRoute, wrapCallData } from './swap.js'

interface IRouteBoundsRequest {
  chainId: ChainId
  destinationChainId: bigint
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
}

export interface IRoutePlan extends IRouteBoundsRequest {
  outputAmount: bigint
  expectedOutputAmount: bigint
  tool: string
  etaSec: number | undefined
  limits: { minDeposit: bigint; maxDeposit: bigint } | null
  isAmountTooLow: boolean
  route: ISwapRoute
  fillDeadline: number
}

export interface IRouteCandidate {
  id: string
  plan: Promise<IRoutePlan>
}

interface IRouteEndpoints {
  lifi: string
  kyber: string
  across: string
  relay: string
}

const keyOf = (token: Address, chainId: ChainId): string => tokenKeyOf(chainId, providerToken(token, chainId))

const pinnedProvider = (chainId: ChainId, name: string): Address | undefined =>
  (SWAP_PROVIDER[chainId as keyof typeof SWAP_PROVIDER] as Record<string, Address> | undefined)?.[name]

export function quoteSwapRoutes(
  endpoints: IRouteEndpoints,
  depositor: Address,
  recipient: Address,
  bounds: IRouteBoundsRequest,
  timing: () => Promise<IAcrossTiming>,
  signal?: AbortSignal
): IRouteCandidate[] {
  const isLocal = bounds.destinationChainId === BigInt(bounds.chainId)
  const lane = (leg: Omit<IRoutePlan, keyof IRouteBoundsRequest>): IRoutePlan => ({ ...bounds, ...leg })

  if (isLocal) {
    const wrap = isAddressEqual(depositor, recipient) ? wrapCallData(bounds.chainId, bounds.inputToken, bounds.outputToken, bounds.inputAmount) : null
    if (wrap !== null) {
      return [
        {
          id: 'wrap',
          plan: Promise.resolve(
            lane({
              route: { kind: 'swap', provider: wrappedNativeAddressOf(bounds.chainId), providerCallData: wrap },
              outputAmount: bounds.inputAmount,
              expectedOutputAmount: bounds.inputAmount,
              tool: isAddressEqual(bounds.inputToken, PROTOCOL.nativeToken) ? 'Wrap' : 'Unwrap',
              etaSec: 0,
              fillDeadline: 0,
              limits: null,
              isAmountTooLow: false
            })
          )
        }
      ]
    }
    const local: IRouteCandidate[] = []
    const lifi = pinnedProvider(bounds.chainId, 'lifiDiamond')
    if (lifi !== undefined) {
      local.push({
        id: 'lifi',
        plan: quoteLifiSwap(endpoints.lifi, lifi, depositor, recipient, bounds, signal).then(q =>
          lane({ ...q, fillDeadline: 0, limits: null, isAmountTooLow: q.outputAmount === 0n })
        )
      })
    }
    const kyber = pinnedProvider(bounds.chainId, 'kyberswap')
    if (kyber !== undefined) {
      local.push({
        id: 'kyber',
        plan: quoteKyberSwap(endpoints.kyber, kyber, depositor, recipient, bounds, signal).then(q =>
          lane({ ...q, fillDeadline: 0, limits: null, isAmountTooLow: q.outputAmount === 0n })
        )
      })
    }
    const relay = pinnedProvider(bounds.chainId, 'relayApprovalProxy')
    if (relay !== undefined) {
      local.push({
        id: 'relay',
        plan: quoteRelaySwap(endpoints.relay, relay, depositor, recipient, bounds, signal).then(q =>
          lane({ ...q, fillDeadline: 0, limits: null, isAmountTooLow: q.outputAmount === 0n })
        )
      })
    }
    return local
  }

  const candidates: IRouteCandidate[] = []
  if (
    keyOf(bounds.inputToken, bounds.chainId) === keyOf(bounds.outputToken, Number(bounds.destinationChainId) as ChainId) &&
    !isAddressEqual(bounds.outputToken, wrappedNativeAddressOf(Number(bounds.destinationChainId) as ChainId))
  ) {
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
      .then(t => quoteAcrossSwapAndBridge(endpoints.across, depositor, recipient, { ...bounds, timing: t }, signal))
      .then(q => lane({ ...q, tool: 'Across', limits: null, isAmountTooLow: q.outputAmount === 0n }))
  })
  return candidates
}

export async function bestRoutePlan(candidates: IRouteCandidate[]): Promise<IRoutePlan> {
  const results = await Promise.allSettled(candidates.map(c => c.plan))
  const plans = results.flatMap(s => (s.status === 'fulfilled' ? [s.value] : []))
  if (plans.length === 0) {
    const reasons = results.flatMap(s =>
      s.status === 'rejected' ? [s.reason instanceof CompactError ? s.reason.detail : s.reason instanceof Error ? s.reason.message : String(s.reason)] : []
    )
    throw new CompactError('ROUTE_UNAVAILABLE', reasons.length === 0 ? 'no route is available for this shape' : `no route right now: ${[...new Set(reasons)].join(' · ')}`)
  }
  return plans.reduce((best, p) => (p.outputAmount > best.outputAmount ? p : best))
}
