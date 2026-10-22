import type { IIAccount__Call } from '@puppet/contracts/types'
import { type Address, encodeFunctionData, erc20Abi } from 'viem'
import type { ChainId } from '../../const/index.js'
import { acrossSpokePoolOf, buildAcrossDeposit, type IAcrossRouteFields } from '../../intent/route/acrossDeposit.js'

const APPROVE_GAS = 100_000n
const DEPOSIT_GAS = 200_000n

export interface IAcrossBridge {
  inputAmount: bigint
  destinationChainId: ChainId
  outputToken: Address
  outputAmount: bigint
  route: IAcrossRouteFields
  fillDeadline: number
}

export function acrossBridgeCalls(chainId: ChainId, account: Address, token: Address, bridge: IAcrossBridge): IIAccount__Call[] {
  const spokePool = acrossSpokePoolOf(chainId)
  return [
    { target: token, value: 0n, gasLimit: APPROVE_GAS, callData: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spokePool, bridge.inputAmount] }) },
    {
      target: spokePool,
      value: 0n,
      gasLimit: DEPOSIT_GAS,
      callData: buildAcrossDeposit({
        depositor: account,
        recipient: account,
        inputToken: token,
        outputToken: bridge.outputToken,
        inputAmount: bridge.inputAmount,
        outputAmount: bridge.outputAmount,
        destinationChainId: BigInt(bridge.destinationChainId),
        exclusiveRelayer: bridge.route.exclusiveRelayer,
        quoteTimestamp: bridge.route.quoteTimestamp,
        fillDeadline: bridge.fillDeadline,
        exclusivityParameter: bridge.route.exclusivityParameter
      })
    }
  ]
}
