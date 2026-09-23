import type { ChainId } from '@puppet/sdk/const'
import { type IRouteCandidate, quoteSwapRoutes } from '@puppet/sdk/intent'
import type { Address } from 'viem'
import context from '../context.js'

const ENDPOINTS = { lifi: '', kyber: '', across: '' }

export interface ISwapRequest {
  originChainId: ChainId
  destinationChainId: ChainId
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  depositor: Address
  recipient: Address
}

export const swapRouteCandidates = (p: ISwapRequest, maxLegs: number, signal?: AbortSignal): IRouteCandidate[] =>
  quoteSwapRoutes(
    ENDPOINTS,
    p.depositor,
    p.recipient,
    {
      chainId: p.originChainId,
      destinationChainId: BigInt(p.destinationChainId),
      inputToken: p.inputToken,
      outputToken: p.outputToken,
      inputAmount: p.inputAmount
    },
    () => context.getAcrossTiming(p.originChainId),
    maxLegs,
    signal
  )
