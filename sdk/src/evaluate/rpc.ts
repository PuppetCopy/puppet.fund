import { type Address, erc20Abi, type Hex, type PublicClient } from 'viem'
import { readContract } from 'viem/actions'
import { getPositionCollateralAmount, getPositionSizeInTokens, getPositionSizeInUsd } from '../gmx/datastore.js'

export function fetchLiveBaseBalance(client: PublicClient, token: Address, account: Address): Promise<bigint> {
  return readContract(client, { address: token, abi: erc20Abi, functionName: 'balanceOf', args: [account] })
}

export interface ILivePositionState {
  sizeInUsd: bigint
  sizeInTokens: bigint
  collateralAmount: bigint
}

export async function fetchLivePositionState(client: PublicClient, positionKey: Hex): Promise<ILivePositionState> {
  const [sizeInUsd, sizeInTokens, collateralAmount] = await Promise.all([
    getPositionSizeInUsd(client, positionKey),
    getPositionSizeInTokens(client, positionKey),
    getPositionCollateralAmount(client, positionKey)
  ])
  return { sizeInUsd, sizeInTokens, collateralAmount }
}
