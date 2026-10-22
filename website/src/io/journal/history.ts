import { PROTOCOL } from '@puppet/contracts/const'
import type { IAccountCallEntry } from '@puppet/contracts/types'
import { ACCOUNT_CALL_MAP, decodeAccountCall, type IStoredAccountCall } from '@puppet/sdk/account'
import { type ITokenProfiles, unregisteredTokensOf } from '@puppet/sdk/client'
import { type ChainId, resolveDispatchChainId } from '@puppet/sdk/const'
import { readTokenProfiles } from '@puppet/sdk/core'
import {
  allocationRowsOf,
  isAllocateOwnerRecord,
  isAllocationRecord,
  isRedeemCloseRecord,
  isRedeemHolderRecord,
  isRedeemOwnerRecord,
  isRedeemRecord,
  isSellRecord,
  openPlanOf
} from '@puppet/sdk/fold'
import { describeOperate, type IOperateStep, resolveOperate } from '@puppet/sdk/venue'
import { type Address, getAddress, type Hex, isAddressEqual, slice } from 'viem'
import { appClientMap } from '../../wallet/wallet.js'
import { viewCall } from '../onchain/viewRead.js'
import type { IJournalEntries } from '@puppet/sdk/client'

export type IAccountAction = {
  chainId: ChainId
  account: Address
  block: bigint
  logIndex: number
  time: number
  txHash: Hex
  fee: { token: Address; amount: bigint } | null
} & (
  | { kind: 'deposit'; token: Address; amount: bigint }
  | { kind: 'revoke'; epoch: bigint }
  | { kind: 'swap'; token: Address; amount: bigint; outputToken: Address; outputAmount: bigint; destinationChainId: bigint }
  | { kind: 'withdraw'; token: Address; amount: bigint; outputToken: Address; outputAmount: bigint }
  | { kind: 'operate'; steps: IOperateStep[]; profiles: ITokenProfiles }
  | { kind: 'fundSwap'; token: Address; amount: bigint; outputToken: Address; outputAmount: bigint; destinationChainId: bigint }
  | { kind: 'escrow'; token: Address; amount: bigint; from: 'wallet' | 'account' }
  | { kind: 'fulfil'; token: Address; amount: bigint; fulfilledTotal: bigint }
  | { kind: 'returnEscrow'; token: Address; amount: bigint }
  | { kind: 'requestReturn'; token: Address; returnAt: bigint }
  | { kind: 'walletWithdraw'; token: Address; amount: bigint }
  | { kind: 'contribute'; master: Address; creditChainId: ChainId; token: Address; amount: bigint }
  | {
      kind: 'allocate'
      token: Address
      credit: { chainId: ChainId; token: Address; amount: bigint } | null
      credited: bigint
      minted: bigint
      valuation: bigint
      puppets: number
      masterBilled: bigint
      billed: bigint
    }
  | { kind: 'allocation'; master: Address; token: Address; amount: bigint; value: bigint; shares: bigint }
  | { kind: 'sell'; master: Address; shares: bigint; token: Address; paid: bigint; profitFee: bigint }
  | { kind: 'redeem'; valuation: bigint; token: Address; paid: bigint; masterPay: bigint }
  | { kind: 'settle'; master: Address; burned: bigint; token: Address; paid: bigint; profitFee: bigint }
  | { kind: 'cut'; master: Address; token: Address; amount: bigint }
  | { kind: 'refused'; master: Address; token: Address; amount: bigint }
  | { kind: 'ownerPayout'; master: Address; token: Address; amount: bigint }
  | { kind: 'closeOut'; token: Address; paid: bigint; cut: bigint }
  | { kind: 'dustReturn'; token: Address; amount: bigint }
  | { kind: 'mandate'; masters: { master: Address; expiry: bigint }[] }
  | { kind: 'unknown'; selector: Hex; reason: string }
)

const at = (entry: IStoredAccountCall): string => `${entry.blockNumber}#${entry.logIndex}`

function accountAction(
  chainId: ChainId,
  account: Address,
  entry: IStoredAccountCall,
  steps: IOperateStep[],
  profiles: ITokenProfiles,
  totals: Map<string, { total: bigint; feeTotal: bigint }>
): IAccountAction | null {
  const where = { chainId, account, block: entry.blockNumber, logIndex: entry.logIndex, time: entry.blockTimestamp, txHash: entry.transactionHash }
  let d: IAccountCallEntry
  try {
    d = decodeAccountCall(entry)
  } catch (err) {
    return { ...where, fee: null, kind: 'unknown', selector: slice(entry.executionData, 0, 4), reason: err instanceof Error ? err.message : String(err) }
  }
  const feeStep = steps.find(s => s.kind === 'fee')
  const base = {
    ...where,
    fee: 'feeToken' in d ? { token: getAddress(d.feeToken), amount: d.fee } : feeStep?.kind === 'fee' ? { token: feeStep.token, amount: feeStep.amount } : null
  }
  if (isAllocationRecord(d)) {
    const leg = entry.callList[0]
    if (leg === undefined) throw new Error(`allocation ${at(entry)} into ${d.master} carries no transfer leg`)
    const token = getAddress(leg.target)
    return { ...base, fee: { token, amount: (d.slice * d.amount) / d.value }, kind: 'allocation', master: getAddress(d.master), token, amount: d.amount, value: d.value, shares: d.shares }
  }
  if (isSellRecord(d)) {
    return { ...base, kind: 'sell', master: getAddress(d.master), shares: d.shares, token: getAddress(d.redemption.token), paid: d.payout - d.profitFee, profitFee: d.profitFee }
  }
  if (isAllocateOwnerRecord(d)) {
    const creditChainId = resolveDispatchChainId(Number(d.credit.chainId))
    const token = getAddress(d.credit.token)
    const key = `credit:${chainId}:${account}:${getAddress(d.master)}:${creditChainId}:${token}`
    const prior = totals.get(key) ?? { total: 0n, feeTotal: 0n }
    totals.set(key, { total: d.credit.total, feeTotal: d.credit.feeTotal })
    return {
      ...base,
      fee: creditChainId === chainId ? { token, amount: d.credit.feeTotal - prior.feeTotal } : null,
      kind: 'contribute',
      master: getAddress(d.master),
      creditChainId,
      token,
      amount: d.credit.total - prior.total
    }
  }
  if (isRedeemHolderRecord(d)) {
    const token = getAddress(d.redemption.token)
    if (d.refused) return { ...base, fee: null, kind: 'refused', master: getAddress(d.master), token, amount: d.payout }
    if (d.queued + d.burned === 0n) return { ...base, fee: null, kind: 'cut', master: getAddress(d.master), token, amount: d.payout }
    const net = d.payout - d.profitFee
    const fee = net < d.redemption.fee ? net : d.redemption.fee
    return { ...base, fee: { token, amount: fee }, kind: 'settle', master: getAddress(d.master), burned: d.queued + d.burned, token, paid: net - fee, profitFee: d.profitFee }
  }
  if (isRedeemOwnerRecord(d)) return { ...base, fee: null, kind: 'ownerPayout', master: getAddress(d.master), token: getAddress(d.token), amount: d.paid }
  if (isRedeemCloseRecord(d)) {
    const token = getAddress(d.redemption.token)
    if (d.redemption.owedLeft > 0n) return { ...base, fee: null, kind: 'dustReturn', token, amount: d.cut }
    const fee = d.payout < d.redemption.fee ? d.payout : d.redemption.fee
    return { ...base, fee: fee === 0n ? null : { token, amount: fee }, kind: 'closeOut', token, paid: d.payout - fee, cut: d.cut }
  }
  if (isRedeemRecord(d)) {
    const plan = openPlanOf(d)
    return { ...base, fee: null, kind: 'redeem', valuation: d.valuation, token: getAddress(d.redemption.token), paid: plan.redemption.potLeft, masterPay: plan.redemption.masterPay }
  }
  switch (d.selector) {
    case ACCOUNT_CALL_MAP.AccountModule.createAccount.selector:
    case ACCOUNT_CALL_MAP.AccountModule.createUserAccount.selector:
      return null
    case ACCOUNT_CALL_MAP.LiquidityGate.deposit.selector:
      return { ...base, kind: 'deposit', token: getAddress(d.token), amount: d.amount }
    case ACCOUNT_CALL_MAP.LiquidityGate.depositEscrow.selector:
      return { ...base, kind: 'escrow', token: d.msgValue === d.amount ? getAddress(PROTOCOL.nativeToken) : getAddress(d.token), amount: d.amount, from: 'wallet' }
    case ACCOUNT_CALL_MAP.UserAccount.revokeSessions.selector:
      return { ...base, kind: 'revoke', epoch: d.epoch }
    case ACCOUNT_CALL_MAP.HubGate.createFund.selector:
      return null
    case ACCOUNT_CALL_MAP.LiquidityGate.returnEscrow.selector: {
      const key = `returned:${chainId}:${account}:${getAddress(d.token)}`
      const prior = totals.get(key) ?? { total: 0n, feeTotal: 0n }
      totals.set(key, { total: d.returned, feeTotal: 0n })
      return { ...base, kind: 'returnEscrow', token: getAddress(d.token), amount: d.returned - prior.total }
    }
    case ACCOUNT_CALL_MAP.LiquidityGate.requestReturn.selector:
      return { ...base, kind: 'requestReturn', token: getAddress(d.token), returnAt: d.returnAt }
    case ACCOUNT_CALL_MAP.UserAccount.withdraw.selector:
      return { ...base, kind: 'walletWithdraw', token: getAddress(d.token), amount: d.amount }
    case ACCOUNT_CALL_MAP.SpokeGate.fulfil.selector: {
      const key = `fulfilled:${chainId}:${account}:${getAddress(d.token)}`
      const prior = totals.get(key) ?? { total: 0n, feeTotal: 0n }
      totals.set(key, { total: d.total, feeTotal: d.feeTotal })
      return {
        ...base,
        fee: { token: getAddress(d.token), amount: d.feeTotal - prior.feeTotal },
        kind: 'fulfil',
        token: getAddress(d.token),
        amount: d.total - prior.total,
        fulfilledTotal: d.total
      }
    }
    case ACCOUNT_CALL_MAP.LiquidityGate.retireEscrow.selector: {
      const wrap = entry.callList[0]
      const token = getAddress(d.token)
      return { ...base, kind: 'escrow', token: wrap !== undefined && isAddressEqual(wrap.target, token) && wrap.value === d.amount ? getAddress(PROTOCOL.nativeToken) : token, amount: d.amount, from: 'account' }
    }
    case ACCOUNT_CALL_MAP.Deposit.depositAcross.selector:
      return {
        ...base,
        kind: 'swap',
        token: getAddress(d.inputToken),
        amount: d.inputAmount,
        outputToken: getAddress(d.outputToken),
        outputAmount: d.outputAmount,
        destinationChainId: d.destinationChainId
      }
    case ACCOUNT_CALL_MAP.Deposit.withdraw.selector:
      return { ...base, kind: 'withdraw', token: getAddress(d.inputToken), amount: d.inputAmount, outputToken: getAddress(d.outputToken), outputAmount: d.outputAmount }
    case ACCOUNT_CALL_MAP.SpokeGate.operate.selector:
      return { ...base, kind: 'operate', steps, profiles }
    case ACCOUNT_CALL_MAP.Deposit.fundSwap.selector:
      return {
        ...base,
        kind: 'fundSwap',
        token: getAddress(d.inputToken),
        amount: d.inputAmount,
        outputToken: getAddress(d.outputToken),
        outputAmount: d.outputAmount,
        destinationChainId: d.destinationChainId
      }
    case ACCOUNT_CALL_MAP.Fund.allocateMaster.selector: {
      const creditChainId = Number(d.credit.chainId) as ChainId
      const key = `credit:${chainId}:${account}:${creditChainId}:${getAddress(d.credit.token)}`
      const prior = totals.get(key) ?? { total: 0n, feeTotal: 0n }
      if (d.credit.total > 0n) totals.set(key, { total: d.credit.total, feeTotal: d.credit.feeTotal })
      const credited = d.credit.total === 0n ? 0n : d.credit.total - prior.total
      return {
        ...base,
        kind: 'allocate',
        token: getAddress(d.token),
        credit: credited === 0n ? null : { chainId: creditChainId, token: getAddress(d.credit.token), amount: credited },
        credited: (credited * d.price.value) / d.price.amount,
        minted: d.minted,
        valuation: d.valuation,
        puppets: allocationRowsOf(entry, account).length,
        masterBilled: d.masterBilled,
        billed: d.billed
      }
    }
    case ACCOUNT_CALL_MAP.HubGate.mandate.selector:
      return { ...base, kind: 'mandate', masters: d.mandateList.map(m => ({ master: getAddress(m.master), expiry: m.expiry })) }
    default:
      return { ...base, kind: 'unknown', selector: (d as { selector: Hex }).selector, reason: 'no history row for this call yet' }
  }
}

export async function accountHistory(journals: readonly IJournalEntries[]): Promise<IAccountAction[]> {
  const listed = journals.flatMap(j => [...j.entries].flatMap(([chainId, list]) => list.map(entry => ({ chainId, account: j.account, entry }))))
  const chainIds = [...new Set(listed.map(d => d.chainId))]
  const factsByChain = new Map(
    await Promise.all(
      chainIds.map(
        async chainId =>
          [chainId, await resolveOperate(appClientMap[chainId], chainId, listed.flatMap(d => (d.chainId === chainId ? d.entry.callList : [])), undefined)] as const
      )
    )
  )
  const described = listed.map(d => ({ ...d, steps: describeOperate(d.chainId, d.account, d.entry.callList, true, d.entry.resultList, factsByChain.get(d.chainId)!) }))
  const profilesByChain = new Map(
    await Promise.all(
      chainIds.map(async chainId => {
        const tokens = [...new Set(described.filter(d => d.chainId === chainId).flatMap(d => unregisteredTokensOf(chainId, d.steps)))]
        return [chainId, await readTokenProfiles(viewCall, chainId, tokens)] as const
      })
    )
  )
  const totals = new Map<string, { total: bigint; feeTotal: bigint }>()
  return [...described]
    .sort((a, b) => a.entry.blockTimestamp - b.entry.blockTimestamp || (a.entry.blockNumber < b.entry.blockNumber ? -1 : a.entry.blockNumber > b.entry.blockNumber ? 1 : a.entry.logIndex - b.entry.logIndex))
    .flatMap(d => {
      const action = accountAction(d.chainId, d.account, d.entry, d.steps, profilesByChain.get(d.chainId)!, totals)
      if (action === null) return []
      if (action.kind === 'contribute' && journals.some(j => isAddressEqual(j.account, action.master))) return []
      return [action]
    })
    .sort((a, b) => b.time - a.time || (b.block > a.block ? 1 : b.block < a.block ? -1 : b.logIndex - a.logIndex))
}
