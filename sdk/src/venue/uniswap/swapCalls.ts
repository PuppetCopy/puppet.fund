import type { IIAccount__Call } from '@puppet/contracts/types'
import { type Address, encodeAbiParameters, encodeFunctionData, encodePacked, erc20Abi } from 'viem'
import type { ChainId } from '../../const/index.js'
import { PERMIT2_ABI, ROUTER_ABI, UNISWAP_DEPLOYMENTS } from './contracts.js'
import type { IUniswapExit } from './exit.js'
import { MSG_SENDER, V3_SWAP } from './router.js'

const V3_SWAP_EXACT_IN = '0x00'
const APPROVE_GAS = 100_000n
const SWAP_GAS = 400_000n
const UNBOUNDED = 2 ** 48 - 1

export function uniswapSwapCalls(chainId: ChainId, token: Address, amount: bigint, exit: Pick<IUniswapExit, 'fee' | 'token'>, minOut: bigint): IIAccount__Call[] {
  const deployment = UNISWAP_DEPLOYMENTS[chainId]
  const router = deployment?.routerList.find(each => each.version === '2.1')
  if (deployment === undefined || router === undefined) throw new Error(`Uniswap trading is not pinned on chain ${chainId}, so nothing can be swapped there`)
  const path = encodePacked(['address', 'uint24', 'address'], [token, exit.fee, exit.token])
  const swap = encodeAbiParameters(V3_SWAP['2.1'], [MSG_SENDER, amount, minOut, path, true, []])
  return [
    { target: token, value: 0n, gasLimit: APPROVE_GAS, callData: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [deployment.permit2, amount] }) },
    {
      target: deployment.permit2,
      value: 0n,
      gasLimit: APPROVE_GAS,
      callData: encodeFunctionData({ abi: PERMIT2_ABI, functionName: 'approve', args: [token, router.address, amount, UNBOUNDED] })
    },
    { target: router.address, value: 0n, gasLimit: SWAP_GAS, callData: encodeFunctionData({ abi: ROUTER_ABI, functionName: 'execute', args: [V3_SWAP_EXACT_IN, [swap], BigInt(UNBOUNDED)] }) }
  ]
}
