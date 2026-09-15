import { PROTOCOL } from '@puppet/contracts/const'
import type { IIAccount__Call } from '@puppet/contracts/types'
import { type Address, getAddress, type Hex, isAddressEqual, keccak256, size, toHex, zeroAddress } from 'viem'
import type { ChainId } from '../const/index.js'
import { wrappedNativeAddressOf } from '../state/tokenRegistry.js'

const ERC20_TRANSFER = '0xa9059cbb'
const ERC20_APPROVE = '0x095ea7b3'
const ERC20_TWO_ARG_SIZE = 68

export const TRANSFER_TOPIC: Hex = keccak256(toHex('Transfer(address,address,uint256)'))
export const WNT_DEPOSIT_TOPIC: Hex = keccak256(toHex('Deposit(address,uint256)'))
export const WNT_WITHDRAWAL_TOPIC: Hex = keccak256(toHex('Withdrawal(address,uint256)'))

export interface IReceiptLog {
  address: Address
  topics: readonly Hex[]
  data: Hex
  logIndex: number
}

const topicAddress = (topic: Hex): Address => getAddress(`0x${topic.slice(26)}`)
const argAmount = (data: Hex, index: number): bigint => BigInt(`0x${data.slice(10 + index * 64, 10 + (index + 1) * 64)}`)

export function tokenLegOf(callList: readonly IIAccount__Call[]): Address | undefined {
  const leg = callList.find(c => {
    const selector = c.callData.slice(0, 10)
    return (selector === ERC20_TRANSFER || selector === ERC20_APPROVE) && size(c.callData) === ERC20_TWO_ARG_SIZE
  })
  return leg ? leg.target : undefined
}

export function transferLegAmount(call: IIAccount__Call): { to: Address; amount: bigint } | null {
  if (call.callData.slice(0, 10) !== ERC20_TRANSFER || size(call.callData) !== ERC20_TWO_ARG_SIZE) return null
  return { to: getAddress(`0x${call.callData.slice(34, 74)}`), amount: argAmount(call.callData, 1) }
}

export function entryDeltas(
  account: Address,
  entry: { chainId: number; callList: readonly IIAccount__Call[]; logs: readonly IReceiptLog[]; value: bigint }
): Map<Address, bigint> {
  const wnt = wrappedNativeAddressOf(entry.chainId as ChainId)
  const deltas = new Map<Address, bigint>()
  const add = (token: Address, delta: bigint): void => {
    deltas.set(token, (deltas.get(token) ?? 0n) + delta)
  }
  if (entry.value > 0n) add(PROTOCOL.nativeToken, entry.value)
  for (const log of entry.logs) {
    const topic = log.topics[0]
    if (topic === TRANSFER_TOPIC && log.topics.length === 3 && size(log.data) === 32) {
      const from = topicAddress(log.topics[1]!)
      const to = topicAddress(log.topics[2]!)
      const amount = BigInt(log.data)
      if (isAddressEqual(from, account)) add(getAddress(log.address), -amount)
      if (isAddressEqual(to, account)) add(getAddress(log.address), amount)
      if (isAddressEqual(from, account) && to === zeroAddress && isAddressEqual(log.address, wnt)) add(PROTOCOL.nativeToken, amount)
    } else if (topic === WNT_DEPOSIT_TOPIC && log.topics.length === 2 && size(log.data) === 32) {
      if (isAddressEqual(topicAddress(log.topics[1]!), account)) add(getAddress(log.address), BigInt(log.data))
    } else if (topic === WNT_WITHDRAWAL_TOPIC && log.topics.length === 2 && size(log.data) === 32) {
      if (isAddressEqual(topicAddress(log.topics[1]!), account)) {
        add(getAddress(log.address), -BigInt(log.data))
        add(PROTOCOL.nativeToken, BigInt(log.data))
      }
    }
  }
  for (const c of entry.callList) {
    if (c.value > 0n) add(PROTOCOL.nativeToken, -c.value)
  }
  return deltas
}

export function callDeltas(entry: { callList: readonly IIAccount__Call[]; value: bigint }): Map<Address, bigint> {
  const deltas = new Map<Address, bigint>()
  const add = (token: Address, delta: bigint): void => {
    deltas.set(token, (deltas.get(token) ?? 0n) + delta)
  }
  if (entry.value > 0n) add(PROTOCOL.nativeToken, entry.value)
  for (const [i, call] of entry.callList.entries()) {
    if (call.value > 0n) add(PROTOCOL.nativeToken, -call.value)
    const leg = transferLegAmount(call)
    if (leg !== null) {
      add(getAddress(call.target), -leg.amount)
      continue
    }
    if (call.callData.slice(0, 10) !== ERC20_APPROVE || size(call.callData) !== ERC20_TWO_ARG_SIZE) continue
    const spender = getAddress(`0x${call.callData.slice(34, 74)}`)
    if (entry.callList.some((next, n) => n > i && isAddressEqual(next.target, spender))) {
      add(getAddress(call.target), -argAmount(call.callData, 1))
    }
  }
  return deltas
}

export const ENTRY_DELTAS_SOURCE: string = [topicAddress, argAmount, tokenLegOf, transferLegAmount, entryDeltas, callDeltas]
  .map(f => f.toString())
  .join('\n')
  .concat(`\n${TRANSFER_TOPIC}${WNT_DEPOSIT_TOPIC}${WNT_WITHDRAWAL_TOPIC}${ERC20_TRANSFER}${ERC20_APPROVE}${ERC20_TWO_ARG_SIZE}`)
