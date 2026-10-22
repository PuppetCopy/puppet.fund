import { describe, expect, test } from 'bun:test'
import { escrowstoreAbi, fundaccountAbi, fundstoreAbi, hubgateAbi, mandatestoreAbi, sharetokenAbi, useraccountAbi } from '@puppet/contracts/abi'
import { HUB_CANONICAL_TOKEN, HUB_CHAIN_ID, PROTOCOL, VIRTUAL_SHARES } from '@puppet/contracts/const'
import { ACCOUNT_CALL_MAP, accountCallEvent } from '@puppet/contracts/events'
import type { IFund__Price, IFundStore__Credit, IFundStore__Holding, IFundStore__Redemption } from '@puppet/contracts/types'
import {
  type AbiParameter,
  type Address,
  decodeAbiParameters,
  decodeEventLog,
  decodeFunctionData,
  decodeFunctionResult,
  erc20Abi,
  getAddress,
  type Hex,
  isAddressEqual,
  toFunctionSelector
} from 'viem'
import { mandateDigest } from '../intent/shared.js'
import { payoutLineOf, planAllocate, planCohort, planRedeem, planSell, valuationOf } from './index.js'

const HARNESS_PROTOCOL_FEE_SHARE = 1000n

type ICall = {
  gate: 'HubGate'
  action: 'createFund' | 'allocate' | 'redeem' | 'redeemCohort' | 'sell'
  callData: Hex
  reads: { target: Address; data: Hex; output: Hex }[]
  records: { topics: Hex[]; data: Hex }[]
}

const PARITY = (await Bun.file(new URL(import.meta.resolve('@puppet/contracts/parity.json'))).json()) as ICall[]

const READ_ABI = [...sharetokenAbi, ...fundstoreAbi, ...escrowstoreAbi, ...fundaccountAbi, ...mandatestoreAbi, ...useraccountAbi, ...erc20Abi]
const READ_SELECTORS = new Set(READ_ABI.flatMap(item => (item.type === 'function' ? [toFunctionSelector(item)] : [])))

const readsOf = (call: ICall) =>
  call.reads
    .filter(read => READ_SELECTORS.has(read.data.slice(0, 10) as Hex))
    .map(read => {
      const { functionName, args } = decodeFunctionData({ abi: READ_ABI, data: read.data })
      return {
        target: getAddress(read.target),
        functionName: functionName as string,
        args: (args ?? []) as readonly unknown[],
        value: read.output === '0x' ? null : (decodeFunctionResult({ abi: READ_ABI, functionName, data: read.output } as never) as unknown)
      }
    })

type IRead = ReturnType<typeof readsOf>[number]

const readOf = (call: ICall, functionName: string, match: (read: IRead) => boolean): IRead | undefined =>
  readsOf(call).find(read => read.functionName === functionName && match(read))

function need<T>(call: ICall, functionName: string, match: (read: IRead) => boolean): T {
  const read = readOf(call, functionName, match)
  if (read === undefined) throw new Error(`${call.action} never read ${functionName} the way this replay expects`)
  return read.value as T
}

const recordsOf = (call: ICall) =>
  call.records.map(record => {
    const { args } = decodeEventLog({ abi: [accountCallEvent], data: record.data, topics: record.topics as [Hex, ...Hex[]] })
    return {
      account: getAddress(args.account),
      executionData: args.executionData,
      blockTimestamp: args.blockTimestamp,
      callList: args.callList,
      balanceList: args.balanceList
    }
  })

function rowOf(call: ICall, account: Address, entry: { selector: string; size: number | null }) {
  return recordsOf(call).find(
    row =>
      isAddressEqual(row.account, account) &&
      row.executionData.slice(0, 10) === entry.selector &&
      (entry.size === null || (row.executionData.length - 2) / 2 === entry.size)
  )
}

function recordOf(
  call: ICall,
  account: Address,
  entry: { selector: string; size: number | null; args: readonly AbiParameter[] }
): Record<string, unknown> | undefined {
  const record = rowOf(call, account, entry)
  if (record === undefined) return undefined
  const values = decodeAbiParameters([{ type: 'bytes4', name: 'selector' }, ...entry.args], record.executionData)
  return Object.fromEntries(entry.args.map((arg, i) => [arg.name, values[i + 1]]))
}

const isArg = (index: number, value: Address | bigint | boolean) => (read: IRead) =>
  typeof value === 'string' ? isAddressEqual(read.args[index] as Address, value) : read.args[index] === value

const recordsAt = (call: ICall, entry: { selector: string; size: number | null; args: readonly AbiParameter[] }) =>
  recordsOf(call)
    .filter(row => row.executionData.slice(0, 10) === entry.selector && (row.executionData.length - 2) / 2 === entry.size)
    .map(row => {
      const values = decodeAbiParameters([{ type: 'bytes4', name: 'selector' }, ...entry.args], row.executionData)
      return { account: row.account, fields: Object.fromEntries(entry.args.map((arg, i) => [arg.name, values[i + 1]])) }
    })

const ofHolder = (master: Address, holder: Address) => (read: IRead) => isArg(0, master)(read) && isArg(1, holder)(read)

function replayCohort(call: ICall, master: Address, shareToken: Address, redemption: IFundStore__Redemption, holderList: readonly Address[]): void {
  const recorded = recordsAt(call, ACCOUNT_CALL_MAP.Redeem.redeemCohortHolder)
  const plan = planCohort({
    master,
    redemption,
    performanceFee: need<bigint>(call, 'performanceFee', read => isAddressEqual(read.target, shareToken)),
    protocolFeeShare: HARNESS_PROTOCOL_FEE_SHARE,
    holders: holderList.map(holder => ({
      holder,
      get holding() {
        return need<IFundStore__Holding>(call, 'getHolding', ofHolder(master, holder))
      },
      get balance() {
        return need<bigint>(call, 'balanceOf', read => isAddressEqual(read.target, shareToken) && isArg(0, holder)(read))
      },
      refused: recorded.find(row => isAddressEqual(row.account, holder))?.fields.refused === true
    }))
  })
  expect(recorded.length).toBe(plan.settled.length)
  plan.settled.forEach((settled, i) => {
    const row = recorded[i]!
    expect(isAddressEqual(row.account, settled.holder)).toBe(true)
    expect(isAddressEqual(row.fields.master as Address, master)).toBe(true)
    expect(row.fields.queued as bigint).toBe(settled.queued)
    expect(row.fields.burned as bigint).toBe(settled.burned)
    expect(row.fields.payout as bigint).toBe(settled.payout)
    expect(row.fields.profitFee as bigint).toBe(settled.profitFee)
    expect(row.fields.protocolCut as bigint).toBe(settled.protocolCut)
    expect(row.fields.refused as boolean).toBe(settled.refused)
    expect(row.fields.redemption as IFundStore__Redemption).toEqual(settled.redemption)
  })
  const closed = recordOf(call, master, ACCOUNT_CALL_MAP.Redeem.redeemCohortMaster)
  if (!plan.closeOut && plan.cut === 0n) {
    expect(closed).toBeUndefined()
    return
  }
  if (closed === undefined) throw new Error(`${call.action} closes out or cuts claims in ${master} in the mirror but the contract recorded nothing`)
  expect(closed.payout as bigint).toBe(plan.masterPayout)
  expect(closed.cut as bigint).toBe(plan.cut)
  expect(closed.redemption as IFundStore__Redemption).toEqual(plan.redemption)
  const fee = plan.masterPayout < redemption.fee ? plan.masterPayout : redemption.fee
  if (plan.masterPayout <= fee) return
  const owner = recordOf(call, need<Address>(call, 'parent', read => isAddressEqual(read.target, master)), ACCOUNT_CALL_MAP.Redeem.redeemCohortOwner)
  if (owner === undefined) throw new Error(`${call.action} pays the owner of ${master} its close-out in the mirror but the contract recorded no owner payout`)
  expect(isAddressEqual(owner.master as Address, master)).toBe(true)
  expect(isAddressEqual(owner.token as Address, redemption.token)).toBe(true)
  expect(owner.paid as bigint).toBe(plan.masterPayout - fee)
}

function replayAllocate(call: ICall): void {
  const decoded = decodeFunctionData({ abi: hubgateAbi, data: call.callData })
  const intent = decoded.functionName === 'createFund' ? decoded.args[4] : decoded.functionName === 'allocate' ? decoded.args[0] : null
  if (intent === null) throw new Error(`${call.action} calls ${decoded.functionName}, not an allocation`)
  const master = intent.header.account
  const onShare = (read: IRead) => isAddressEqual(read.target, intent.shareToken)
  const masterRow = rowOf(call, master, ACCOUNT_CALL_MAP.Fund.allocateMaster)
  if (masterRow === undefined) throw new Error(`${call.action} left no master record`)
  const now = masterRow.blockTimestamp
  const owner = need<Address>(call, 'parent', read => isAddressEqual(read.target, master))
  const supply = need<bigint>(call, 'totalSupply', onShare)
  const priorHoldings = new Map(
    intent.allocationList.map(row => [row.puppet, readOf(call, 'getHolding', ofHolder(master, row.puppet))?.value as IFundStore__Holding | undefined])
  )

  const plan = planAllocate({
    now,
    owner,
    supply,
    redemption: need<IFundStore__Redemption>(call, 'getRedemption', isArg(0, master)),
    masterShares: need<bigint>(call, 'balanceOf', read => onShare(read) && isArg(0, master)(read)),
    value: valuationOf(intent.valuation),
    fee: intent.header.fee,
    price: intent.price,
    credit: intent.credit,
    credited:
      intent.credit.total === 0n
        ? null
        : intent.credit.chainId === BigInt(HUB_CHAIN_ID)
          ? {
              total: need<bigint>(call, 'fulfilledMap', read => isArg(0, owner)(read) && isArg(1, master)(read)),
              feeTotal: need<bigint>(call, 'feePaidMap', read => isArg(0, owner)(read) && isArg(1, master)(read))
            }
          : need<IFundStore__Credit>(call, 'getCredit', read => isArg(0, master)(read)),
    rowList: intent.allocationList.map(row => {
      const registered = readOf(call, 'mandateMap', isArg(0, row.puppet))?.value as Hex | undefined
      const epoch = readOf(call, 'epoch', read => isAddressEqual(read.target, row.puppet))?.value as bigint | undefined
      const balance = readOf(call, 'balanceOf', read => isAddressEqual(read.target, intent.token) && isArg(0, row.puppet)(read))?.value as bigint | undefined
      const held = readOf(call, 'balanceOf', read => onShare(read) && isArg(0, row.puppet)(read))?.value as bigint | undefined
      return {
        puppet: row.puppet,
        amount: row.amount,
        skin: row.mandate.skin,
        rate: row.mandate.allocationRate,
        exitCap: row.mandate.exitCap,
        cooldownPeriod: row.mandate.cooldownPeriod,
        balance: balance ?? 2n ** 128n,
        held: held ?? 0n,
        cost: priorHoldings.get(row.puppet)?.cost ?? 0n,
        allocatedAt: BigInt(priorHoldings.get(row.puppet)?.allocatedAt ?? 0),
        mandated: registered === undefined || (epoch !== undefined && registered === mandateDigest(row.mandate, epoch) && row.mandate.expiry > now)
      }
    })
  })

  const recorded = recordOf(call, master, ACCOUNT_CALL_MAP.Fund.allocateMaster)!
  expect(recorded.valuation as bigint).toBe(valuationOf(intent.valuation))
  expect(recorded.supply as bigint).toBe(supply + VIRTUAL_SHARES)
  expect(recorded.token as Address).toBe(intent.token)
  expect(plan.slice).toBe(recorded.slice as bigint)
  expect(plan.billed).toBe(recorded.billed as bigint)
  expect(plan.masterBilled).toBe(recorded.masterBilled as bigint)
  expect(plan.minted).toBe(recorded.minted as bigint)
  expect(plan.masterShares).toBe(masterRow.balanceList.find(b => isAddressEqual(b.token, intent.shareToken))!.amount)
  const signed = recordOf(call, owner, ACCOUNT_CALL_MAP.Fund.allocateOwner)
  if (intent.credit.total > 0n) {
    if (signed === undefined) throw new Error(`${call.action} credits the fund but its owner recorded no credit`)
    expect(isAddressEqual(signed.master as Address, master)).toBe(true)
    expect(signed.credit).toEqual(intent.credit)
  } else {
    expect(signed).toBeUndefined()
  }

  intent.allocationList.forEach((row, i) => {
    const planned = plan.rowList[i]
    const puppet = recordOf(call, row.puppet, ACCOUNT_CALL_MAP.Fund.allocatePuppet)
    if (planned === null) {
      expect(puppet).toBeUndefined()
      return
    }
    if (puppet === undefined) throw new Error(`${call.action} minted for ${row.puppet} in the mirror but the contract recorded nothing`)
    const prior = priorHoldings.get(row.puppet)
    if (prior === undefined) throw new Error(`${call.action} minted for ${row.puppet} without reading its holding`)
    expect(planned!.value).toBe(puppet.value as bigint)
    expect(plan.slice).toBe(puppet.slice as bigint)
    expect(planned!.shares).toBe(puppet.shares as bigint)
    expect(puppet.holding as IFundStore__Holding).toEqual({ ...prior, allocatedAt: Number(now), cost: planned!.cost })
  })
}

function replayRedeem(call: ICall): void {
  const decoded = decodeFunctionData({ abi: hubgateAbi, data: call.callData })
  if (decoded.functionName !== 'redeem') throw new Error(`${call.action} calls ${decoded.functionName}, not redeem`)
  const [intent, , holderList] = decoded.args
  const master = intent.header.account
  const onShare = (read: IRead) => isAddressEqual(read.target, intent.shareToken)
  const recorded = recordOf(call, master, ACCOUNT_CALL_MAP.Redeem.redeem)
  const masterRow = rowOf(call, master, ACCOUNT_CALL_MAP.Redeem.redeem)
  if (recorded === undefined || masterRow === undefined) throw new Error('redeem left no master record')
  const token = getAddress(intent.token)
  const wrappable = masterRow.balanceList.some(b => isAddressEqual(b.token, PROTOCOL.nativeToken)) || isAddressEqual(token, HUB_CANONICAL_TOKEN.WETH)
  const wrapLegs = masterRow.callList.reduce((total, leg) => total + leg.value, 0n)
  const nativeAfter = masterRow.balanceList.find(b => isAddressEqual(b.token, PROTOCOL.nativeToken))
  if (wrappable && nativeAfter === undefined) throw new Error('a WETH redeem recorded no native balance for the master')
  const native = wrappable && nativeAfter !== undefined ? nativeAfter.amount + wrapLegs : 0n
  const held = need<bigint>(call, 'balanceOf', read => isAddressEqual(read.target, token) && isArg(0, master)(read))
  const line = payoutLineOf(intent.valuation.assetList, token)
  const plan = planRedeem({
    supply: need<bigint>(call, 'totalSupply', onShare),
    masterBalance: need<bigint>(call, 'balanceOf', read => onShare(read) && isArg(0, master)(read)),
    redemption: need<IFundStore__Redemption>(call, 'getRedemption', isArg(0, master)),
    fraction: intent.fraction,
    join: intent.join,
    valuation: valuationOf(intent.valuation),
    token: wrappable ? HUB_CANONICAL_TOKEN.WETH : token,
    price: line === null ? null : { amount: line.amount, value: line.value },
    held,
    native,
    fee: intent.header.fee
  })
  expect(recorded.valuation as bigint).toBe(valuationOf(intent.valuation))
  expect(recorded.join as bigint).toBe(intent.join)
  expect(recorded.active as bigint).toBe(plan.active)
  expect(recorded.masterShares as bigint).toBe(plan.masterShares)
  expect(recorded.cash as bigint).toBe(held + native)
  expect(recorded.rate as IFund__Price).toEqual(plan.rate)
  expect(isAddressEqual((recorded.redemption as IFundStore__Redemption).token, token)).toBe(true)
  expect({ ...(recorded.redemption as IFundStore__Redemption), token }).toEqual({ ...plan.redemption, token })
  expect(wrapLegs).toBe(plan.wrap)
  replayCohort(call, master, intent.shareToken, { ...plan.redemption, token }, holderList)
}

function replayRedeemCohort(call: ICall): void {
  const decoded = decodeFunctionData({ abi: hubgateAbi, data: call.callData })
  if (decoded.functionName !== 'redeemCohort') throw new Error(`${call.action} calls ${decoded.functionName}, not redeemCohort`)
  const [shareToken, holderList] = decoded.args
  const master = need<Address>(call, 'master', read => isAddressEqual(read.target, shareToken))
  replayCohort(call, master, shareToken, need<IFundStore__Redemption>(call, 'getRedemption', isArg(0, master)), holderList)
}

function replaySell(call: ICall): void {
  const decoded = decodeFunctionData({ abi: hubgateAbi, data: call.callData })
  if (decoded.functionName !== 'sell') throw new Error(`${call.action} calls ${decoded.functionName}, not sell`)
  const [intent] = decoded.args
  const puppet = intent.header.account
  const onShare = (read: IRead) => isAddressEqual(read.target, intent.shareToken)
  const master = need<Address>(call, 'master', onShare)
  const planned = planSell({
    redemption: need<IFundStore__Redemption>(call, 'getRedemption', isArg(0, master)),
    holding: need<IFundStore__Holding>(call, 'getHolding', ofHolder(master, puppet)),
    balance: need<bigint>(call, 'balanceOf', read => onShare(read) && isArg(0, puppet)(read)),
    shares: intent.shares,
    performanceFee: (readOf(call, 'performanceFee', onShare)?.value as bigint | undefined) ?? 0n,
    protocolFeeShare: HARNESS_PROTOCOL_FEE_SHARE
  })
  const recorded = recordOf(call, puppet, ACCOUNT_CALL_MAP.Redeem.sell)
  const puppetRow = rowOf(call, puppet, ACCOUNT_CALL_MAP.Redeem.sell)
  if (recorded === undefined || puppetRow === undefined) throw new Error('sell left no puppet record')
  expect(isAddressEqual(recorded.master as Address, master)).toBe(true)
  expect(recorded.shares as bigint).toBe(intent.shares)
  expect(recorded.queued as bigint).toBe(planned.queued)
  expect(recorded.burned as bigint).toBe(planned.burned)
  expect(recorded.payout as bigint).toBe(planned.payout)
  expect(recorded.profitFee as bigint).toBe(planned.profitFee)
  expect(recorded.protocolCut as bigint).toBe(planned.protocolCut)
  expect(recorded.holding as IFundStore__Holding).toEqual(planned.holding)
  expect(recorded.redemption as IFundStore__Redemption).toEqual(planned.redemption)
  expect(recorded.fee as bigint).toBe(intent.header.fee)
  expect(puppetRow.balanceList.find(b => isAddressEqual(b.token, intent.shareToken))!.amount).toBe(planned.balance)
}

const REPLAY: Record<ICall['action'], (call: ICall) => void> = {
  createFund: replayAllocate,
  allocate: replayAllocate,
  redeem: replayRedeem,
  redeemCohort: replayRedeemCohort,
  sell: replaySell
}

describe('the fund math mirror reproduces what the contracts recorded', () => {
  for (const [i, call] of PARITY.entries()) test(`${i} ${call.action}`, () => REPLAY[call.action](call))
})
