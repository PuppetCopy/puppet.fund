import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { IFund__SellIntent } from '@puppet/contracts/types'
import { getAddress, isAddressEqual, type TypedDataDefinition } from 'viem'
import { CompactContractError, CompactError } from '../compact/error.js'
import { bondTokenOf } from '../state/tokenRegistry.js'
import * as IntentLib from './intentLib.js'
import { type IDraftContext, type IHeaderContext, intentTypedData, verifyHeader } from './shared.js'

interface ISellAttestContext extends IDraftContext, IHeaderContext {
  units: bigint
  feeBalance: bigint
  payoutDue: bigint
}

export function attestSellIntent(ctx: ISellAttestContext, intent: IFund__SellIntent): TypedDataDefinition {
  if (ctx.chainId !== HUB_CHAIN_ID) throw new CompactError('BAD_REQUEST', 'sells settle on the hub chain only', 'hard')
  const puppet = getAddress(intent.header.account)
  verifyHeader(ctx, intent.header)
  IntentLib.verifyRegisteredTokenCap(ctx.tokenRegistry, ctx.chainId, intent.header.feeToken, intent.header.fee)
  if (isAddressEqual(puppet, intent.master)) throw new CompactContractError('Fund__MasterCannotSell', [puppet])
  if (intent.units === 0n) throw new CompactContractError('Balance__ZeroAmount', [])
  if (ctx.units < intent.units) throw new CompactContractError('Fund__InsufficientUnits', [ctx.units, intent.units])
  const feeToken = getAddress(intent.header.feeToken)
  const cover = ctx.feeBalance + (isAddressEqual(feeToken, bondTokenOf(ctx.chainId)) ? ctx.payoutDue : 0n)
  if (cover < intent.header.fee) throw new CompactContractError('Balance__InsufficientBalance', [cover, intent.header.fee])
  return intentTypedData('sell', ctx.chainId, intent)
}
