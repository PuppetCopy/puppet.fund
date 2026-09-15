import { PROTOCOL } from '@puppet/contracts/const'
import type { IDeposit__ScheduledCredit } from '@puppet/contracts/types'
import { type Address, getAddress, type Hex, isAddressEqual, type TypedDataDefinition } from 'viem'
import { CompactContractError, CompactError } from '../compact/error.js'
import type { ChainId } from '../const/index.js'
import { wrappedNativeAddressOf } from '../state/tokenRegistry.js'
import * as IntentLib from './intentLib.js'
import { accountDomain, type IDraftContext } from './shared.js'

export const MAX_SCHEDULE_TTL_SEC = 7n * 24n * 60n * 60n

export const SCHEDULED_CREDIT_TYPES = {
  ScheduledCredit: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
    { name: 'fee', type: 'uint256' }
  ]
} as const

export interface ICreditListContext extends IDraftContext {
  routeBalances: ReadonlyMap<Address, bigint>
}

export interface IScheduledCredit {
  account: Address
  user: Address
  claim: IDeposit__ScheduledCredit
}

export interface IDepositCredit {
  claim: IDeposit__ScheduledCredit
  signature: Hex
}

export function verifyClaimWindow(claim: IDeposit__ScheduledCredit, account: Address): void {
  const nowSec = BigInt(Math.floor(Date.now() / 1000))
  if (claim.fee === 0n) throw new CompactContractError('Intent__ZeroRelayFee', [account])
  if (claim.expiry <= nowSec) throw new CompactContractError('Schedule__Expired', [claim.expiry, nowSec])
  if (claim.expiry > nowSec + MAX_SCHEDULE_TTL_SEC) {
    throw new CompactError('CLAIM_TOO_FAR', `the credit claim expires at ${claim.expiry}, beyond the ${MAX_SCHEDULE_TTL_SEC}s the relay holds a credit for`, 'hard')
  }
}

export function verifyCreditList(ctx: ICreditListContext, creditList: readonly Address[], feeToken: Address): bigint {
  let swept = 0n
  for (let i = 0; i < creditList.length; i++) {
    const token = getAddress(creditList[i]!)
    if (i > 0 && BigInt(token) <= BigInt(creditList[i - 1]!)) throw new CompactContractError('Credit__ListNotSorted', [creditList[i - 1]!, token])
    if (getAddress(token) === feeToken) swept += ctx.routeBalances.get(token) ?? 0n
  }
  return swept
}

export function scheduledCreditTypedData(chainId: ChainId, account: Address, claim: IDeposit__ScheduledCredit): TypedDataDefinition {
  return {
    domain: accountDomain(chainId, account),
    primaryType: 'ScheduledCredit',
    types: SCHEDULED_CREDIT_TYPES,
    message: { ...claim }
  } as TypedDataDefinition
}

function verifyArrival(ctx: ICreditListContext, account: Address, claim: IDeposit__ScheduledCredit): void {
  const nowSec = BigInt(Math.floor(Date.now() / 1000))
  if (nowSec > claim.expiry) throw new CompactContractError('Schedule__Expired', [claim.expiry, nowSec])
  if (claim.fee === 0n) throw new CompactContractError('Intent__ZeroRelayFee', [account])
  const token = getAddress(claim.token)
  const wnt = wrappedNativeAddressOf(ctx.chainId)
  const atRoute = (held: Address): bigint => {
    const balance = ctx.routeBalances.get(getAddress(held))
    if (balance === undefined) {
      throw new CompactError('BALANCE_UNREAD', `the route's ${held} balance was not read on chain ${ctx.chainId}`, 'soft')
    }
    return balance
  }
  const fused = isAddressEqual(token, PROTOCOL.nativeToken) || isAddressEqual(token, wnt)
  const arrived = atRoute(token) + (fused ? atRoute(isAddressEqual(token, wnt) ? PROTOCOL.nativeToken : wnt) : 0n)
  if (arrived < claim.amount) throw new CompactContractError('Schedule__NotArrived', [token, arrived, claim.amount])
  IntentLib.verifyRegisteredTokenCap(ctx.tokenRegistry, ctx.chainId, token, claim.amount)
  IntentLib.verifyRelayFeeRatio(claim.fee, arrived)
}

export function attestScheduledCredit(ctx: ICreditListContext, input: IScheduledCredit): TypedDataDefinition {
  verifyArrival(ctx, input.account, input.claim)
  return scheduledCreditTypedData(ctx.chainId, input.account, input.claim)
}
