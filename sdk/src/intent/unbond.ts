import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { IHubGate__UnbondIntent } from '@puppet/contracts/types'
import { type Address, isAddressEqual, type TypedDataDefinition } from 'viem'
import { CompactContractError, CompactError } from '../compact/error.js'
import * as IntentLib from './intentLib.js'
import { type IDraftContext, type IHeaderContext, intentTypedData, verifyHeader } from './shared.js'

export interface IUnbondAttestContext extends IDraftContext, IHeaderContext {
  bondToken: Address
  bonded: bigint
  matchable: bigint
  feeTokenBalance: bigint
}

export function attestUnbondIntent(ctx: IUnbondAttestContext, intent: IHubGate__UnbondIntent): TypedDataDefinition {
  if (ctx.chainId !== HUB_CHAIN_ID) throw new CompactError('BAD_REQUEST', 'bonds release on the hub chain only', 'hard')
  verifyHeader(ctx, intent.header)
  IntentLib.verifyRegisteredTokenCap(ctx.tokenRegistry, ctx.chainId, intent.header.feeToken, intent.header.fee)
  if (intent.amount === 0n) throw new CompactContractError('Balance__ZeroAmount', [])
  if (intent.amount > ctx.bonded) throw new CompactContractError('Bond__InsufficientBalance', [intent.header.account, ctx.bonded, intent.amount])
  if (intent.amount > ctx.matchable) {
    throw new CompactError('BOND_BACKED', `${intent.amount} exceeds the ${ctx.matchable} that is not backing an open cycle`, 'hard')
  }
  const released = isAddressEqual(intent.header.feeToken, ctx.bondToken) ? intent.amount : 0n
  IntentLib.verifyRelayFeeRatio(intent.header.fee, ctx.feeTokenBalance + released)
  return intentTypedData('unbond', ctx.chainId, intent)
}
