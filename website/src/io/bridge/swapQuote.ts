import type { ChainId } from '@puppet/sdk/const'
import { type IRouteCandidate, quoteSwapRoutes } from '@puppet/sdk/intent'
import type { Address } from 'viem'
import context from '../context.js'

const ENDPOINTS = { lifi: '', across: '' }

export interface ISwapRequest {
  originChainId: ChainId
  destinationChainId: ChainId
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  account: Address
  recipient: Address
}

const boundsOf = (p: ISwapRequest) => ({
  chainId: p.originChainId,
  destinationChainId: BigInt(p.destinationChainId),
  inputToken: p.inputToken,
  outputToken: p.outputToken,
  inputAmount: p.inputAmount
})

export const swapRouteCandidates = (p: ISwapRequest, maxLegs: number, signal?: AbortSignal): IRouteCandidate[] =>
  quoteSwapRoutes(
    ENDPOINTS,
    p.account,
    p.recipient,
    boundsOf(p),
    () => context.getAcrossTiming(p.originChainId),
    maxLegs,
    signal
  )
