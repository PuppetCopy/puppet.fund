import { escrowstoreAbi } from '@puppet/contracts/abi'
import { HUB_CHAIN_ID, SPOKE_CHAIN_IDS } from '@puppet/contracts/const'
import { predictUserAccount } from '@puppet/sdk/account'
import { type ChainId, deploymentAddress } from '@puppet/sdk/const'
import { fetchTokenBalance, registeredTokenAddresses } from '@puppet/sdk/state'
import { type Address, getAddress } from 'viem'
import context from '../io/context.js'
import { publicClientMap } from './wallet.js'

export interface IFundedCoordinate {
  chainId: number
  token: Address
}

export async function fundedFromStake(user: Address, fundList: readonly Address[]): Promise<IFundedCoordinate> {
  const registry = await context.getTokenRegistry()
  const parent = predictUserAccount(user)
  const chainList = [HUB_CHAIN_ID, ...SPOKE_CHAIN_IDS] as ChainId[]
  for (const chainId of chainList) {
    const client = publicClientMap[chainId]
    if (client === undefined) continue
    const store = deploymentAddress('EscrowStore', chainId)
    const tokens = registeredTokenAddresses(registry, chainId)
    const coords = fundList.flatMap(fund => tokens.map(token => ({ fund, token })))
    const held = await Promise.all(
      coords.map(async ({ fund, token }) => {
        const [escrowed, fulfilled] = await client.multicall({
          allowFailure: false,
          contracts: [
            { address: store, abi: escrowstoreAbi, functionName: 'escrowedMap', args: [parent, fund, token] },
            { address: store, abi: escrowstoreAbi, functionName: 'fulfilledMap', args: [parent, fund, token] }
          ]
        })
        return escrowed - fulfilled + (await fetchTokenBalance(client, token, fund))
      })
    )
    const at = held.findIndex(amount => amount > 0n)
    if (at >= 0) return { chainId, token: getAddress(coords[at]!.token) }
  }
  throw new Error(`${user} has nothing at stake yet: no fund of this wallet holds escrow or a balance; escrow first`)
}
