import { describe, expect, test } from 'bun:test'
import { escrowstoreAbi, fundstoreAbi, hubgateAbi, shareAbi } from '@puppet/contracts/abi'
import { PROTOCOL } from '@puppet/contracts/const'
import { ACCOUNT_CALL_MAP, accountCallEvent } from '@puppet/contracts/events'
import { PARITY } from '@puppet/contracts/parity'
import type { IFundStore__Holding, IFundStore__Position, IFundStore__Queue } from '@puppet/contracts/types'
import {
  type AbiFunction,
  type AbiParameter,
  type Address,
  decodeAbiParameters,
  decodeEventLog,
  decodeFunctionData,
  decodeFunctionResult,
  getAddress,
  type Hex,
  isAddressEqual,
  toFunctionSelector
} from 'viem'
import { enqueue, planAllocate, planDrain, settlePosition } from './index.js'

type ICall = (typeof PARITY)[number]

const READ_ABI = [...shareAbi, ...fundstoreAbi, ...escrowstoreAbi]
const READ_SELECTORS = new Set(
  READ_ABI.filter((item): item is AbiFunction => item.type === 'function').map(item => toFunctionSelector(item))
)

const readsOf = (call: ICall) =>
  call.reads
    .filter(read => READ_SELECTORS.has(read.data.slice(0, 10) as Hex))
    .map(read => {
      const { functionName, args } = decodeFunctionData({ abi: READ_ABI, data: read.data })
      return {
        target: getAddress(read.target),
        functionName: functionName as string,
        args: (args ?? []) as readonly unknown[],
        value: decodeFunctionResult({ abi: READ_ABI, functionName, data: read.output } as never) as unknown
      }
    })

type IRead = ReturnType<typeof readsOf>[number]

function readOf(call: ICall, functionName: string, match: (read: IRead) => boolean): IRead | undefined {
  return readsOf(call).find(read => read.functionName === functionName && match(read))
}

function need<T>(call: ICall, functionName: string, match: (read: IRead) => boolean): T {
  const read = readOf(call, functionName, match)
  if (read === undefined) throw new Error(`${call.action} never read ${functionName} the way this replay expects`)
  return read.value as T
}

const recordsOf = (call: ICall) =>
  call.records.map(record => {
    const { args } = decodeEventLog({ abi: [accountCallEvent], data: record.data, topics: record.topics as [Hex, ...Hex[]] })
    return { account: getAddress(args.account), selector: args.executionData.slice(0, 10), executionData: args.executionData }
  })

function recordOf(call: ICall, account: Address, entry: { selector: string; args: readonly AbiParameter[] }): Record<string, unknown> | undefined {
  const record = recordsOf(call).find(row => isAddressEqual(row.account, account) && row.selector === entry.selector)
  if (record === undefined) return undefined
  const values = decodeAbiParameters([{ type: 'bytes4', name: 'selector' }, ...entry.args], record.executionData)
  return Object.fromEntries(entry.args.map((arg, i) => [arg.name, values[i + 1]]))
}

const isArg = (index: number, address: Address) => (read: IRead) => isAddressEqual(read.args[index] as Address, address)
const notArg = (index: number, address: Address) => (read: IRead) => !isAddressEqual(read.args[index] as Address, address)

function replayAllocate(call: ICall): void {
  const { args } = decodeFunctionData({ abi: hubgateAbi, data: call.callData })
  const intent = (call.action === 'createFund' ? args![6] : args![0]) as {
    header: { account: Address; fee: bigint }
    share: Address
    valuation: { value: bigint }
    credit: { chainId: bigint; token: Address; amount: bigint; value: bigint }
    allocationList: readonly { puppet: Address; stake: bigint; mandate: { skin: bigint; allocationRate: bigint } }[]
  }
  const master = intent.header.account
  const onShare = (read: IRead) => isAddressEqual(read.target, intent.share)
  const before = intent.allocationList.map(row => ({
    holding: need<IFundStore__Holding>(call, 'getHolding', isArg(1, row.puppet)),
    balance: need<bigint>(call, 'balanceOf', read => !onShare(read) && isArg(0, row.puppet)(read))
  }))

  const plan = planAllocate({
    skin: need<bigint>(call, 'skinMap', isArg(0, master)),
    supply: need<bigint>(call, 'totalSupply', onShare),
    queued: need<bigint>(call, 'balanceOf', read => onShare(read) && notArg(0, master)(read)),
    masterUnits: need<bigint>(call, 'balanceOf', read => onShare(read) && isArg(0, master)(read)),
    value: intent.valuation.value,
    fee: intent.header.fee,
    credit: intent.credit,
    rowList: intent.allocationList.map((row, i) => ({
      stake: row.stake,
      skin: row.mandate.skin,
      rate: row.mandate.allocationRate,
      balance: before[i]!.balance,
      basis: before[i]!.holding.basis
    }))
  })

  const recorded = recordOf(call, master, ACCOUNT_CALL_MAP.Fund.allocateMaster)
  if (recorded === undefined) throw new Error(`${call.action} left no master record`)
  expect(plan.masterSlice).toBe(recorded.masterSlice as bigint)
  expect(plan.billed).toBe(recorded.billed as bigint)
  expect(plan.minted).toBe(recorded.minted as bigint)
  expect(plan.skin).toBe(recorded.skin as bigint)
  expect(plan.masterUnits).toBe(recorded.masterUnits as bigint)

  intent.allocationList.forEach((row, i) => {
    const planned = plan.rowList[i]
    const puppet = recordOf(call, row.puppet, ACCOUNT_CALL_MAP.Fund.allocatePuppet)
    if (planned === null) {
      expect(puppet).toBeUndefined()
      return
    }
    if (puppet === undefined) throw new Error(`${call.action} minted for ${row.puppet} in the mirror but the contract recorded nothing`)
    expect(planned!.slice).toBe(puppet.slice as bigint)
    expect(planned!.units).toBe(puppet.units as bigint)
    expect(before[i]!.holding.basis + row.stake).toBe((puppet.holding as IFundStore__Holding).basis)
  })
}

function settledOf(call: ICall, share: Address, master: Address, holder: Address) {
  const queue = need<IFundStore__Queue>(call, 'getQueue', isArg(0, master))
  const position = need<IFundStore__Position>(call, 'getPosition', isArg(1, holder))
  const queued = need<bigint>(call, 'balanceOf', read => isAddressEqual(read.target, share) && notArg(0, holder)(read) && notArg(0, master)(read))
  const closedAccrued = readOf(call, 'closedAccruedMap', isArg(0, master))?.value as bigint | undefined
  const performanceFee = readOf(call, 'performanceFee', read => isAddressEqual(read.target, share))?.value as bigint | undefined
  return {
    queue,
    position,
    queued,
    settled: settlePosition(queue, position, queued, closedAccrued, performanceFee === undefined ? PROTOCOL.performanceFee : performanceFee)
  }
}

function replaySell(call: ICall): void {
  const { args } = decodeFunctionData({ abi: hubgateAbi, data: call.callData })
  const intent = args![0] as { header: { account: Address }; share: Address; master: Address; units: bigint }
  const puppet = intent.header.account
  const held = need<bigint>(call, 'balanceOf', read => isAddressEqual(read.target, intent.share) && isArg(0, puppet)(read))
  const holding = need<IFundStore__Holding>(call, 'getHolding', isArg(1, puppet))
  const { queue, queued, settled } = settledOf(call, intent.share, intent.master, puppet)
  const added = enqueue(queue, queued, intent.units)
  const moved = (holding.basis * intent.units) / held

  const recorded = recordOf(call, puppet, ACCOUNT_CALL_MAP.Fund.sellPuppet)
  const masterRecord = recordOf(call, intent.master, ACCOUNT_CALL_MAP.Fund.sellMaster)
  if (recorded === undefined || masterRecord === undefined) throw new Error('sell left no puppet or master record')
  const position = recorded.position as IFundStore__Position
  expect(settled.payout).toBe(recorded.payout as bigint)
  expect(settled.fee).toBe(recorded.payoutFee as bigint)
  expect(moved).toBe(recorded.basis as bigint)
  expect(holding.basis - moved).toBe((recorded.holding as IFundStore__Holding).basis)
  expect(queue.weight + added).toBe((masterRecord.queue as IFundStore__Queue).weight)
  expect(settled.position.weight + added).toBe(position.weight)
  expect(settled.position.basis + moved).toBe(position.basis)
  expect(((settled.position.weight + added) * (queued + intent.units)) / (queue.weight + added)).toBe(position.units)
  expect(settled.position.cursor).toBe(position.cursor)
}

function replayRedeem(call: ICall): void {
  const { args } = decodeFunctionData({ abi: hubgateAbi, data: call.callData })
  const intent = args![0] as { header: { account: Address }; share: Address; valuation: { value: bigint }; retire: bigint; drain: bigint }
  const master = intent.header.account
  const onShare = (read: IRead) => isAddressEqual(read.target, intent.share)
  const bond = readOf(call, 'balanceOf', read => !onShare(read) && isArg(0, master)(read))
  if (bond === undefined) throw new Error('redeem never read the fund cash')

  const plan = planDrain({
    token: bond.target,
    skin: intent.retire > 0n ? need<bigint>(call, 'skinMap', isArg(0, master)) : intent.retire,
    queue: need<IFundStore__Queue>(call, 'getQueue', isArg(0, master)),
    supply: need<bigint>(call, 'totalSupply', onShare),
    queued: need<bigint>(call, 'balanceOf', read => onShare(read) && notArg(0, master)(read)),
    masterUnits: need<bigint>(call, 'balanceOf', read => onShare(read) && isArg(0, master)(read)),
    value: intent.valuation.value,
    retire: intent.retire,
    drain: intent.drain,
    funded: bond.value as bigint
  })

  const recorded = recordOf(call, master, ACCOUNT_CALL_MAP.Fund.redeem)
  if (recorded === undefined) throw new Error('redeem left no master record')
  expect(plan.drained).toBe(recorded.drained as bigint)
  expect(plan.cash).toBe(recorded.cash as bigint)
  expect(plan.payout).toBe(recorded.payout as bigint)
  expect(plan.queue).toEqual(recorded.drainedQueue as IFundStore__Queue)
}

function replayClaim(call: ICall): void {
  const { args } = decodeFunctionData({ abi: hubgateAbi, data: call.callData })
  const [master, share, holder] = args as readonly [Address, Address, Address]
  const { settled } = settledOf(call, share, master, holder)
  const recorded = recordOf(call, holder, ACCOUNT_CALL_MAP.Fund.claimHolder)
  if (recorded === undefined) throw new Error('claim left no holder record')
  expect(settled.payout).toBe(recorded.payout as bigint)
  expect(settled.fee).toBe(recorded.fee as bigint)
  expect(settled.position).toEqual(recorded.position as IFundStore__Position)
}

const REPLAY: Record<ICall['action'], (call: ICall) => void> = {
  createFund: replayAllocate,
  allocate: replayAllocate,
  sell: replaySell,
  redeem: replayRedeem,
  claim: replayClaim
}

describe('the fund math mirror reproduces what the contracts recorded', () => {
  for (const [i, call] of PARITY.entries()) test(`${i} ${call.action}`, () => REPLAY[call.action](call))
})
