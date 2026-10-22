import { PROTOCOL } from '@puppet/contracts/const'
import type { IAccountCall__SpokeGate_operate } from '@puppet/contracts/types'
import { type Address, getAddress, isAddressEqual } from 'viem'
import { ACCOUNT_CALL_MAP, decodeAccountCall, type IStoredAccountCall } from '../account/index.js'
import type { ChainId } from '../const/index.js'
import { wrappedNativeAddressOf } from '../state/tokenRegistry.js'
import { operateExchange } from '../venue/screen.js'

export interface IHoldingCost {
  bought: bigint
  held: bigint
  paid: bigint
  fee: bigint
  exact: boolean
}

export function holdingCostOf(
  chainId: ChainId,
  account: Address,
  token: Address,
  calls: readonly Pick<IStoredAccountCall, 'source' | 'executionData' | 'callList' | 'balanceList' | 'transactionHash'>[]
): IHoldingCost | string | null {
  const asset = getAddress(token)
  const wrapped = wrappedNativeAddressOf(chainId)
  const inEth = (spent: Address): boolean => isAddressEqual(spent, PROTOCOL.nativeToken) || isAddressEqual(spent, wrapped)
  const cost: IHoldingCost = { bought: 0n, held: 0n, paid: 0n, fee: 0n, exact: true }
  for (const call of calls) {
    const record = decodeAccountCall(call)
    if (record.selector !== ACCOUNT_CALL_MAP.SpokeGate.operate.selector) continue
    const exchange = operateExchange(chainId, account, call.callList)
    const listed = call.balanceList.find(balance => isAddressEqual(balance.token, asset))?.amount
    const sold = exchange.spent.get(asset)
    if (sold !== undefined) {
      cost.held = listed ?? (cost.held > sold ? cost.held - sold : 0n)
      continue
    }
    if (!exchange.received.has(asset)) continue
    if (listed === undefined) throw new Error(`tx ${call.transactionHash} acquires ${asset} on chain ${chainId} without recording its balance`)
    if (listed <= cost.held) return `the balance fell without a recorded sale before the buy in tx ${call.transactionHash}`
    const also = [...exchange.received.keys()].filter(other => !isAddressEqual(other, asset) && !exchange.spent.has(other))
    if (also.length > 0) return `the buy in tx ${call.transactionHash} also acquired ${also.join(', ')}`
    const { feeToken, fee } = record as IAccountCall__SpokeGate_operate
    const paidIn = [...exchange.spent.keys(), getAddress(feeToken)].find(spent => !inEth(spent))
    if (paidIn !== undefined) return `the buy in tx ${call.transactionHash} paid in ${paidIn}, not ETH`
    cost.paid += [...exchange.spent.values()].reduce((total, amount) => total + amount, 0n)
    cost.fee += fee
    cost.exact = cost.exact && ![...exchange.received.keys()].some(received => exchange.spent.has(received))
    cost.bought += listed - cost.held
    cost.held = listed
  }
  return cost.bought === 0n ? null : cost
}
