import { PROTOCOL } from '@puppet/contracts/const'
import type { ICoreGate__OperateIntent } from '@puppet/contracts/types'
import { type Address, decodeAbiParameters, getAddress, isAddressEqual, size, slice, type TypedDataDefinition } from 'viem'
import { backingCap, listsToken, verifySkin } from '../backing/index.js'
import { CompactContractError, CompactError } from '../compact/error.js'
import { tokenInfoFor } from '../state/tokenRegistry.js'
import { GMX_TOKEN_SPENDER } from '../venue/gmx/contracts.js'
import { operateOutflows } from '../venue/screen.js'
import { type ICreditListContext, verifyCreditList } from './credit.js'
import * as IntentLib from './intentLib.js'
import { backingListHash, type IHeaderContext, intentTypedData, mandateDigest, verifyHeader, verifyMandateRow } from './shared.js'
import { type IOperateTermsContext, operateTermsOf } from './terms.js'

const APPROVE = '0x095ea7b3'
const INCREASE_ALLOWANCE = '0x39509351'
const PERMIT = '0xd505accf'
const DAI_PERMIT = '0x8fcbaf0c'

export interface IOperateAttestContext extends ICreditListContext, IHeaderContext, IOperateTermsContext {
  feeTokenBalance: bigint
}

export function attestOperateIntent(ctx: IOperateAttestContext, intent: ICoreGate__OperateIntent): TypedDataDefinition {
  const master = intent.header.account
  verifyHeader(ctx, intent.header)
  IntentLib.verifyRegisteredTokenCap(ctx.tokenRegistry, ctx.chainId, intent.header.feeToken, intent.header.fee)
  const swept = intent.creditList.length > 0 ? verifyCreditList(ctx, intent.creditList, getAddress(intent.header.feeToken)) : 0n
  verifyStandingAllowance(intent.callList)

  const rows = intent.backingList
  if (BigInt(rows.length) > PROTOCOL.maxCohortSize) {
    throw new CompactContractError('Operate__BackingListTooLong', [BigInt(rows.length), PROTOCOL.maxCohortSize])
  }
  if (!isAddressEqual(ctx.master, master)) throw new CompactError('BAD_REQUEST', `the terms were composed for ${ctx.master}, not ${master}`, 'hard')
  if (ctx.book !== undefined && !isAddressEqual(ctx.book.master, master)) {
    throw new CompactError('BAD_REQUEST', `book ${ctx.book.id} belongs to ${ctx.book.master}, not ${master}`, 'hard')
  }
  if (intent.cycle !== ctx.cycle) {
    throw new CompactError('CYCLE_MISMATCH', `intent carries cycle ${intent.cycle}; the book is at cycle ${ctx.cycle}`, 'hard')
  }
  IntentLib.verifyRegisteredTokenCap(ctx.tokenRegistry, ctx.chainId, intent.token, 0n)
  const tokenId = tokenInfoFor(ctx.tokenRegistry, ctx.chainId, intent.token).tokenId
  const expected = operateTermsOf(ctx, tokenId, intent.skin)
  if (intent.value !== expected.value) {
    throw new CompactError('MARK_MISMATCH', `intent carries value ${intent.value}; the attestor values the book at ${expected.value}`, 'hard')
  }
  if (intent.collateral !== expected.collateral) {
    throw new CompactError('COLLATERAL_MISMATCH', `intent attests ${intent.collateral} collateral; the valued deposits say ${expected.collateral}`, 'hard')
  }
  if (intent.backed !== expected.backed) {
    throw new CompactError('BACKED_MISMATCH', `intent attests ${intent.backed} backed; the chronicle holds ${expected.backed}`, 'hard')
  }
  if (backingListHash(rows) !== backingListHash(expected.backingList)) {
    throw new CompactError('COHORT_MISMATCH', 'the backing rows differ from the cohort the attestor composes; compose again on fresh state', 'hard')
  }

  const bookCycle = ctx.book === undefined ? 0n : ctx.book.cycle
  const opening = intent.cycle > bookCycle
  const stakeOf = new Map(opening ? [] : ctx.backers.map(b => [getAddress(b.puppet), b.stake] as const))
  let next = expected.backed
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    const puppet = getAddress(row.puppet)
    if (i > 0 && BigInt(puppet) <= BigInt(rows[i - 1]!.puppet)) throw new CompactContractError('Operate__BackingListNotSorted', [rows[i - 1]!.puppet, puppet])
    if (isAddressEqual(puppet, master)) throw new CompactContractError('Gate__MasterAsPuppet', [master])
    if (!isAddressEqual(row.mandate.master, master)) throw new CompactContractError('Mandate__Mismatch', [puppet, mandateDigest(puppet, row.mandate)])
    verifyMandateRow(ctx.mandates.get(puppet), puppet, row.mandate)
    if (row.mandate.expiry < BigInt(ctx.nowSec)) throw new CompactContractError('Mandate__Expired', [row.mandate.expiry])
    if (!listsToken(row.mandate, tokenId)) throw new CompactContractError('Mandate__TokenNotListed', [puppet, intent.token])
    const matchable = ctx.matchable.get(puppet)
    if (matchable === undefined) throw new CompactError('BALANCE_UNREAD', `${puppet}'s matchable bond was not read`, 'soft')
    if (row.matchable !== matchable) throw new CompactError('BALANCE_MISMATCH', `${puppet} lists matchable ${row.matchable} but the pool holds ${matchable}`, 'hard')
    const cap = backingCap(row.mandate, intent.collateral, matchable)
    if (row.stake === 0n || row.stake > cap) throw new CompactContractError('Operate__BackingExceedsCap', [puppet, row.stake, cap])
    const committedAt = ctx.backers.find(b => isAddressEqual(b.puppet, puppet))?.committedAt ?? 0
    if (committedAt + Number(row.mandate.cooldownPeriod) > ctx.nowSec) {
      throw new CompactError('COOLDOWN', `${puppet} committed at ${committedAt}; the mandate allows the next commit at ${committedAt + Number(row.mandate.cooldownPeriod)}`, 'soft')
    }
    if (stakeOf.get(puppet) !== undefined && opening) throw new CompactError('BAD_REQUEST', `${puppet} carries a stake into an opening cycle`, 'hard')
    next += row.stake
  }
  verifySkin(next, intent.collateral, intent.skin)

  IntentLib.verifyRelayFeeRatio(intent.header.fee, ctx.feeTokenBalance)
  const feeToken = getAddress(intent.header.feeToken)
  const feeTokenOutflow = operateOutflows(intent.callList).reduce(
    (total, outflow) => (isAddressEqual(outflow.token, feeToken) ? total + outflow.amount : total),
    0n
  )
  const payable = ctx.feeTokenBalance + swept - feeTokenOutflow
  if (payable < intent.header.fee) throw new CompactContractError('Balance__InsufficientBalance', [payable, intent.header.fee])

  return intentTypedData('operate', ctx.chainId, intent)
}

function verifyStandingAllowance(callList: ICoreGate__OperateIntent['callList']): void {
  for (let i = 0; i < callList.length; i++) {
    const grant = callList[i]!.callData
    if (size(grant) < 68) continue
    const selector = slice(grant, 0, 4)
    let spender: Address
    if (selector === APPROVE || selector === INCREASE_ALLOWANCE) {
      const [to, amount] = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], slice(grant, 4, 68))
      if (amount === 0n) continue
      spender = to
    } else if (selector === PERMIT || selector === DAI_PERMIT) {
      spender = decodeAbiParameters([{ type: 'address' }, { type: 'address' }], slice(grant, 4, 68))[1]
    } else {
      continue
    }
    if (isAddressEqual(spender, GMX_TOKEN_SPENDER)) continue
    const token = callList[i]!.target
    let reset = false
    for (let j = i + 1; j < callList.length; j++) {
      if (!isAddressEqual(callList[j]!.target, token)) continue
      const later = callList[j]!.callData
      if (size(later) < 68 || slice(later, 0, 4) !== APPROVE) continue
      const [target, clears] = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], slice(later, 4, 68))
      if (isAddressEqual(target, spender) && clears === 0n) {
        reset = true
        break
      }
    }
    if (!reset) throw new CompactError('STANDING_ALLOWANCE', `${token} keeps an allowance for ${spender} after the call list; reset it to zero in the same operate`, 'hard')
  }
}
