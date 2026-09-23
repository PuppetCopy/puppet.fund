import { ACCOUNT_CALL_MAP, decodeAccountCall } from '@puppet/sdk/account'
import type { ChainId } from '@puppet/sdk/const'
import { isAllocationRecord, isClaimFeeRecord, isClaimRecord, isSellFeeRecord, isSellRecord, receiptRecords } from '@puppet/sdk/fold'
import { describeOperate, type IOperateStep } from '@puppet/sdk/venue'
import { type Address, getAddress, type Hex } from 'viem'
import type { IStoredAccountCall } from './callStore.js'
import type { IJournalEntries } from './localFold.js'

export type IAccountAction = {
  chainId: ChainId
  account: Address
  block: bigint
  logIndex: number
  time: number
  txHash: Hex
  fee: { token: Address; amount: bigint } | null
} & (
  | { kind: 'genesis'; parent: Address | null }
  | { kind: 'deposit'; token: Address; amount: bigint }
  | { kind: 'selfWithdraw'; token: Address; amount: bigint }
  | { kind: 'withdrawRequest'; requestedAt: bigint }
  | { kind: 'revoke'; epoch: bigint }
  | { kind: 'swap'; token: Address; amount: bigint; outputToken: Address; outputAmount: bigint; destinationChainId: bigint }
  | { kind: 'withdraw'; token: Address; amount: bigint; outputToken: Address; outputAmount: bigint }
  | { kind: 'operate'; steps: IOperateStep[] }
  | { kind: 'fundSwap'; token: Address; amount: bigint; outputToken: Address; outputAmount: bigint; destinationChainId: bigint }
  | { kind: 'createFund'; share: Address; symbol: Hex; pixels: Hex }
  | { kind: 'escrow'; master: Address; token: Address; amount: bigint }
  | { kind: 'fulfil'; token: Address; amount: bigint; fulfilledTotal: bigint }
  | { kind: 'refund'; master: Address; token: Address; amount: bigint }
  | { kind: 'allocate'; credit: { chainId: ChainId; token: Address; amount: bigint } | null; credited: bigint; minted: bigint; value: bigint; backers: number; masterSlice: bigint; billed: bigint }
  | { kind: 'allocation'; master: Address; stake: bigint; units: bigint }
  | { kind: 'sell'; master: Address; units: bigint; basis: bigint; payout: bigint; payoutFee: bigint }
  | { kind: 'sellFee'; puppet: Address; payoutFee: bigint }
  | { kind: 'redeem'; retire: bigint; drained: bigint; value: bigint; cash: bigint; payout: bigint }
  | { kind: 'claim'; master: Address; payout: bigint; payoutFee: bigint }
  | { kind: 'claimFee'; holder: Address; payoutFee: bigint }
  | { kind: 'mandate'; masters: { master: Address; expiry: bigint }[] }
)

const at = (entry: IStoredAccountCall): string => `${entry.blockNumber}#${entry.logIndex}`

export function accountAction(chainId: ChainId, account: Address, entry: IStoredAccountCall): IAccountAction {
  const steps = describeOperate(chainId, entry.callList, true, entry.resultList)
  const d = decodeAccountCall(entry)
  const feeStep = steps.find(s => s.kind === 'fee')
  const base = {
    chainId,
    account,
    block: entry.blockNumber,
    logIndex: entry.logIndex,
    time: entry.blockTimestamp,
    txHash: entry.transactionHash,
    fee: 'feeToken' in d ? { token: getAddress(d.feeToken), amount: d.fee } : feeStep?.kind === 'fee' ? { token: feeStep.token, amount: feeStep.amount } : null
  }
  if (isAllocationRecord(d)) return { ...base, kind: 'allocation', master: getAddress(d.master), stake: d.stake, units: d.units }
  if (isSellRecord(d)) {
    return { ...base, kind: 'sell', master: getAddress(d.master), units: d.units, basis: d.basis, payout: d.payout, payoutFee: d.payoutFee }
  }
  if (isSellFeeRecord(d)) return { ...base, kind: 'sellFee', puppet: getAddress(d.puppet), payoutFee: d.payoutFee }
  if (isClaimRecord(d)) return { ...base, kind: 'claim', master: getAddress(d.master), payout: d.payout, payoutFee: d.fee }
  if (isClaimFeeRecord(d)) return { ...base, kind: 'claimFee', holder: getAddress(d.holder), payoutFee: d.fee }
  switch (d.selector) {
    case ACCOUNT_CALL_MAP.AccountModule.createAccount.selector:
      return { ...base, kind: 'genesis', parent: getAddress(d.parent) }
    case ACCOUNT_CALL_MAP.AccountModule.createUserAccount.selector:
      return { ...base, kind: 'genesis', parent: null }
    case ACCOUNT_CALL_MAP.Deposit.deposit.selector:
      return { ...base, kind: 'deposit', token: getAddress(d.token), amount: d.amount }
    case ACCOUNT_CALL_MAP.UserAccount.withdraw.selector:
      return { ...base, kind: 'selfWithdraw', token: getAddress(d.token), amount: d.amount }
    case ACCOUNT_CALL_MAP.UserAccount.revokeSessions.selector:
      return { ...base, kind: 'revoke', epoch: d.epoch }
    case ACCOUNT_CALL_MAP.HubGate.createFund.selector:
      return { ...base, kind: 'createFund', share: getAddress(d.clone), symbol: d.symbol, pixels: d.pixels }
    case ACCOUNT_CALL_MAP.UserAccount.requestWithdraw.selector:
      return { ...base, kind: 'withdrawRequest', requestedAt: d.requestedAt }
    case ACCOUNT_CALL_MAP.Deposit.depositEscrow.selector:
    case ACCOUNT_CALL_MAP.LiquidityGate.escrow.selector:
      return { ...base, kind: 'escrow', master: getAddress(d.master), token: getAddress(d.token), amount: d.amount }
    case ACCOUNT_CALL_MAP.LiquidityGate.refund.selector:
      return { ...base, kind: 'refund', master: getAddress(d.master), token: getAddress(d.token), amount: d.amount }
    case ACCOUNT_CALL_MAP.SpokeGate.fulfil.selector:
      return { ...base, kind: 'fulfil', token: getAddress(d.token), amount: d.amount, fulfilledTotal: d.fulfilledTotal }
    case ACCOUNT_CALL_MAP.Deposit.depositAcross.selector:
      return {
        ...base,
        kind: 'swap',
        token: getAddress(d.input),
        amount: d.inputAmount,
        outputToken: getAddress(d.outputToken),
        outputAmount: d.outputAmount,
        destinationChainId: d.destinationChainId
      }
    case ACCOUNT_CALL_MAP.Deposit.withdraw.selector:
      return { ...base, kind: 'withdraw', token: getAddress(d.inputToken), amount: d.inputAmount, outputToken: getAddress(d.outputToken), outputAmount: d.outputAmount }
    case ACCOUNT_CALL_MAP.SpokeGate.operate.selector:
      return { ...base, kind: 'operate', steps }
    case ACCOUNT_CALL_MAP.Deposit.fundSwap.selector:
      return {
        ...base,
        kind: 'fundSwap',
        token: getAddress(d.input),
        amount: d.inputAmount,
        outputToken: getAddress(d.outputToken),
        outputAmount: d.outputAmount,
        destinationChainId: d.destinationChainId
      }
    case ACCOUNT_CALL_MAP.Fund.allocateMaster.selector:
      return {
        ...base,
        kind: 'allocate',
        credit: d.credit.amount === 0n ? null : { chainId: Number(d.credit.chainId) as ChainId, token: getAddress(d.credit.token), amount: d.credit.amount },
        credited: d.credit.value,
        minted: d.minted,
        value: d.valuation.value,
        backers: receiptRecords(entry).filter(r => isAllocationRecord(r.record)).length,
        masterSlice: d.masterSlice,
        billed: d.billed
      }
    case ACCOUNT_CALL_MAP.Fund.redeem.selector:
      return {
        ...base,
        kind: 'redeem',
        retire: d.retire,
        drained: d.drained,
        value: d.valuation.value,
        cash: d.cash,
        payout: d.payout
      }
    case ACCOUNT_CALL_MAP.HubGate.mandate.selector:
      return { ...base, kind: 'mandate', masters: d.mandateList.map(m => ({ master: getAddress(m.master), expiry: m.expiry })) }
    default:
      throw new Error(`entry ${at(entry)} on chain ${chainId} carries selector ${(d as { selector: Hex }).selector}, which the history does not know`)
  }
}

export function accountHistory(journals: readonly IJournalEntries[]): IAccountAction[] {
  const out: IAccountAction[] = []
  for (const j of journals) for (const [chainId, list] of j.entries) for (const entry of list) out.push(accountAction(chainId, j.account, entry))
  return out.sort((a, b) => b.time - a.time || (b.block > a.block ? 1 : b.block < a.block ? -1 : b.logIndex - a.logIndex))
}
