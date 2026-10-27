import { PROTOCOL } from '@puppet/contracts/const'
import type { IAccountCall__Deposit_depositAcross, IAccountCall__Deposit_fundSwap, IAccountCall__SpokeGate_operate } from '@puppet/contracts/types'
import { type Address, getAddress, isAddressEqual } from 'viem'
import { ACCOUNT_CALL_MAP, decodeAccountCall, type IStoredAccountCall } from '../account/index.js'
import type { ChainId } from '../const/index.js'
import type { IFlowRow } from '../schema/index.js'
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

export interface IFundCosts {
  relayFee: bigint
  routeCost: bigint
  pending: number
  unvalued: number
}

export function fundCostsOf(
  calls: ReadonlyMap<ChainId, readonly Pick<IStoredAccountCall, 'source' | 'executionData' | 'blockNumber' | 'blockTimestamp' | 'logIndex'>[]>,
  flows: readonly IFlowRow[],
  since: number,
  until: number
): IFundCosts {
  const costs: IFundCosts = { relayFee: 0n, routeCost: 0n, pending: 0, unvalued: 0 }
  for (const [chainId, list] of calls) {
    for (const call of list) {
      if (call.blockTimestamp < since || call.blockTimestamp >= until) continue
      const record = decodeAccountCall(call)
      const routed = record.selector === ACCOUNT_CALL_MAP.Deposit.fundSwap.selector || record.selector === ACCOUNT_CALL_MAP.Deposit.depositAcross.selector
      if (!routed && record.selector !== ACCOUNT_CALL_MAP.SpokeGate.operate.selector) continue
      const { feeToken, fee } = record as IAccountCall__SpokeGate_operate | IAccountCall__Deposit_fundSwap | IAccountCall__Deposit_depositAcross
      const rows = flows.filter(row => Number(row.chainId) === chainId && row.block === Number(call.blockNumber) && row.logIndex === call.logIndex)
      if ((rows.length === 0 && (routed || fee > 0n)) || rows.some(row => row.pending)) {
        costs.pending += 1
        continue
      }
      const valued = rows.flatMap(row => (row.value === undefined ? [] : [{ ...row, value: row.value }]))
      const feeRow = valued.find(row => isAddressEqual(row.token, feeToken))
      if (valued.length < rows.length || (feeRow === undefined && fee > 0n)) {
        costs.unvalued += 1
        continue
      }
      const feeValue = feeRow === undefined ? 0n : (fee * feeRow.value) / feeRow.amount
      costs.relayFee += feeValue
      if (!routed) continue
      const { destinationChainId, outputToken } = record as IAccountCall__Deposit_fundSwap | IAccountCall__Deposit_depositAcross
      if (record.selector === ACCOUNT_CALL_MAP.Deposit.fundSwap.selector && destinationChainId === BigInt(chainId) && isAddressEqual(outputToken, PROTOCOL.nativeToken)) {
        costs.unvalued += 1
        continue
      }
      costs.routeCost -= valued.reduce((total, row) => total + row.value, 0n) + feeValue
    }
  }
  return costs
}
