import type { ChainId } from '@puppet/sdk/const'
import { type IRouteCandidate, quoteAcrossDeposit, quoteSwapRoutes } from '@puppet/sdk/intent'
import type { Address } from 'viem'
import { ENDPOINTS } from '../../app/endpoints.js'
import context from '../context.js'

export const SWAP_ENDPOINTS = {
  lifi: `${ENDPOINTS.swap}/lifi`,
  kyber: `${ENDPOINTS.swap}/kyber`,
  across: `${ENDPOINTS.swap}/across`,
  relay: `${ENDPOINTS.swap}/relay`
}

export interface ISwapRequest {
  originChainId: ChainId
  destinationChainId: ChainId
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  depositor: Address
  recipient: Address
}

export const swapRouteCandidates = (p: ISwapRequest, plainBridge: boolean, signal?: AbortSignal): IRouteCandidate[] => {
  const bounds = {
    chainId: p.originChainId,
    destinationChainId: BigInt(p.destinationChainId),
    inputToken: p.inputToken,
    outputToken: p.outputToken,
    inputAmount: p.inputAmount
  }
  if (plainBridge) {
    return [
      {
        id: 'across',
        plan: context
          .getAcrossTiming(p.originChainId)
          .then(timing => quoteAcrossDeposit(SWAP_ENDPOINTS.across, p.recipient, { ...bounds, timing }, signal))
          .then(q => ({ ...bounds, ...q, tool: 'Across' }))
      }
    ]
  }
  return quoteSwapRoutes(SWAP_ENDPOINTS, p.depositor, p.recipient, bounds, () => context.getAcrossTiming(p.originChainId), signal)
}
