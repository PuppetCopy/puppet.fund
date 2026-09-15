import { ACCOUNT_CALL_MAP, decodeAccountCall } from '@puppet/sdk/account'
import type { ChainId } from '@puppet/sdk/const'
import { bookIdOf, isBackingRecord, isGainRecord, isLossRecord, markIdOf, receiptRecords } from '@puppet/sdk/fold'
import type { IMarkRow } from '@puppet/sdk/schema'
import { describeOperate, type IOperateStep } from '@puppet/sdk/venue'
import { type Address, getAddress, type Hex } from 'viem'
import type { IStoredAccountCall } from './callStore.js'

export type IAccountAction = {
  chainId: ChainId
  account: Address
  block: bigint
  logIndex: number
  time: number
  txHash: Hex
  fee: { token: Address; amount: bigint } | null
} & (
  | { kind: 'genesis'; signer: Address }
  | { kind: 'deposit'; token: Address; amount: bigint; bond: bigint }
  | { kind: 'swap'; token: Address; amount: bigint; outputToken: Address; outputAmount: bigint; destinationChainId: bigint }
  | { kind: 'withdraw'; token: Address; amount: bigint; outputToken: Address; outputAmount: bigint }
  | { kind: 'credit'; creditList: { token: Address; amount: bigint }[] }
  | {
      kind: 'operate'
      cycle: bigint
      token: Address
      value: bigint
      collateral: bigint
      skin: bigint
      backed: bigint
      backers: number
      steps: IOperateStep[]
      mark: IMarkRow | null
    }
  | { kind: 'backing'; master: Address; cycle: bigint; stake: bigint }
  | { kind: 'settle'; cycle: bigint; token: Address; value: bigint; backers: number }
  | { kind: 'gain'; master: Address; cycle: bigint; token: Address; owed: bigint; net: bigint }
  | { kind: 'draw'; spokeChainId: bigint; cycle: bigint; backers: number }
  | { kind: 'loss'; master: Address; spokeChainId: bigint; cycle: bigint; owed: bigint; drawn: bigint }
  | { kind: 'mandate'; bond: bigint; masters: { master: Address; expiry: bigint }[] }
  | { kind: 'unbond'; amount: bigint }
  | { kind: 'forcedWithdrawal'; token: Address; amount: bigint; to: Address }
)

export interface IAccountJournal {
  account: Address
  entries: ReadonlyMap<ChainId, readonly IStoredAccountCall[]>
}

const at = (entry: IStoredAccountCall): string => `${entry.blockNumber}#${entry.logIndex}`

const isMasterOperate = (entry: IStoredAccountCall): boolean => {
  const d = decodeAccountCall(entry)
  return d.selector === ACCOUNT_CALL_MAP.CoreGate.operateMaster.selector && !isBackingRecord(d)
}

export function accountAction(chainId: ChainId, account: Address, entry: IStoredAccountCall, marks: ReadonlyMap<string, IMarkRow>): IAccountAction {
  const steps = describeOperate(chainId, entry.callList, entry.resultList)
  const feeStep = steps.find(s => s.kind === 'fee')
  const base = {
    chainId,
    account,
    block: entry.blockNumber,
    logIndex: entry.logIndex,
    time: entry.blockTimestamp,
    txHash: entry.transactionHash,
    fee: feeStep?.kind === 'fee' ? { token: feeStep.token, amount: feeStep.amount } : null
  }
  const d = decodeAccountCall(entry)
  switch (d.selector) {
    case ACCOUNT_CALL_MAP.AccountModule.createAccount.selector:
      return { ...base, kind: 'genesis', signer: getAddress(d.signer) }
    case ACCOUNT_CALL_MAP.AccountModule.forcedWithdrawal.selector:
      return { ...base, kind: 'forcedWithdrawal', token: getAddress(d.token), amount: d.amount, to: getAddress(d.to) }
    case ACCOUNT_CALL_MAP.CoreGate.deposit.selector:
      return { ...base, kind: 'deposit', token: getAddress(d.token), amount: d.amount, bond: 0n }
    case ACCOUNT_CALL_MAP.HubGate.deposit.selector:
      return { ...base, kind: 'deposit', token: getAddress(d.token), amount: d.amount, bond: d.bond }
    case ACCOUNT_CALL_MAP.Deposit.depositAcross.selector:
      return {
        ...base,
        kind: 'swap',
        token: getAddress(d.input),
        amount: d.inputAmount,
        outputToken: getAddress(d.outputToken),
        outputAmount: d.outputFloor,
        destinationChainId: d.destinationChainId
      }
    case ACCOUNT_CALL_MAP.CoreGate.withdraw.selector:
      return { ...base, kind: 'withdraw', token: getAddress(d.inputToken), amount: d.inputAmount, outputToken: getAddress(d.outputToken), outputAmount: d.outputAmount }
    case ACCOUNT_CALL_MAP.Deposit.settleCredit.selector:
      return { ...base, kind: 'credit', creditList: [{ token: getAddress(d.token), amount: d.arrived }] }
    case ACCOUNT_CALL_MAP.CoreGate.operateMaster.selector: {
      if (isBackingRecord(d)) {
        return { ...base, kind: 'backing', master: getAddress(d.master), cycle: d.cycle, stake: d.stake }
      }
      const mark = marks.get(markIdOf(bookIdOf(chainId, account), Number(entry.blockNumber), entry.logIndex))
      return {
        ...base,
        kind: 'operate',
        cycle: d.cycle,
        token: getAddress(d.token),
        value: d.value,
        collateral: d.collateral,
        skin: d.skin,
        backed: d.backed,
        backers: receiptRecords(entry).filter(r => isBackingRecord(r.record)).length,
        steps,
        mark: mark === undefined ? null : mark
      }
    }
    case ACCOUNT_CALL_MAP.CoreGate.settleMaster.selector: {
      if (isGainRecord(d)) {
        return { ...base, kind: 'gain', master: getAddress(d.master), cycle: d.cycle, token: getAddress(d.token), owed: d.amount, net: d.amount2 }
      }
      return {
        ...base,
        kind: 'settle',
        cycle: d.cycle,
        token: getAddress(d.token),
        value: d.value,
        backers: new Set(receiptRecords(entry).filter(r => isGainRecord(r.record)).map(r => r.account)).size
      }
    }
    case ACCOUNT_CALL_MAP.HubGate.drawMaster.selector: {
      if (isLossRecord(d)) {
        return { ...base, kind: 'loss', master: getAddress(d.master), spokeChainId: d.spokeChainId, cycle: d.cycle, owed: d.amount, drawn: d.loss }
      }
      return {
        ...base,
        kind: 'draw',
        spokeChainId: d.spokeChainId,
        cycle: d.cycle,
        backers: new Set(receiptRecords(entry).filter(r => isLossRecord(r.record)).map(r => r.account)).size
      }
    }
    case ACCOUNT_CALL_MAP.HubGate.mandate.selector:
      return { ...base, kind: 'mandate', bond: d.bond, masters: d.mandateList.map(m => ({ master: getAddress(m.master), expiry: m.expiry })) }
    case ACCOUNT_CALL_MAP.HubGate.unbond.selector:
      return { ...base, kind: 'unbond', amount: d.amount }
    default:
      throw new Error(`entry ${at(entry)} on chain ${chainId} carries selector ${(d as { selector: Hex }).selector}, which the history does not know`)
  }
}

export async function accountHistory(
  journals: readonly IAccountJournal[],
  readMarks: (ids: readonly string[]) => Promise<IMarkRow[]>
): Promise<IAccountAction[]> {
  const markIds: string[] = []
  for (const j of journals) {
    for (const [chainId, list] of j.entries) {
      for (const entry of list) {
        if (isMasterOperate(entry)) markIds.push(markIdOf(bookIdOf(chainId, j.account), Number(entry.blockNumber), entry.logIndex))
      }
    }
  }
  const marks = new Map((await readMarks(markIds)).map(m => [m.id, m]))
  const out: IAccountAction[] = []
  for (const j of journals) for (const [chainId, list] of j.entries) for (const entry of list) out.push(accountAction(chainId, j.account, entry, marks))
  return out.sort((a, b) => b.time - a.time || (b.block > a.block ? 1 : b.block < a.block ? -1 : b.logIndex - a.logIndex))
}
