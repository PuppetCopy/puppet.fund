import { HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import type { IRedeem__SellIntent } from '@puppet/contracts/types'
import { type Address, isAddressEqual, type TypedDataDefinition } from 'viem'
import { predictUserAccount } from '../account/createAccount.js'
import { CompactContractError, CompactError } from '../compact/error.js'
import { planSell } from '../pool/index.js'
import * as IntentLib from './intentLib.js'
import { type IDraftContext, type IHeaderContext, intentTypedData, verifyFundShare, verifyHeader } from './shared.js'
import type { IFundState, IHolderState } from './terms.js'

interface ISellAttestContext extends IDraftContext, IHeaderContext {
  master: Address
  fund: IFundState | null
  holder: IHolderState
  feeBalance: bigint
}

export function attestSellIntent(ctx: ISellAttestContext, intent: IRedeem__SellIntent): TypedDataDefinition {
  if (ctx.chainId !== HUB_CHAIN_ID) throw new CompactError('BAD_REQUEST', 'sells settle on the hub chain only', 'hard')
  if (!isAddressEqual(predictUserAccount(intent.header.user), intent.header.account)) {
    throw new CompactContractError('Account__HeaderMismatch', [intent.header.account])
  }
  verifyHeader(ctx, intent.header)
  IntentLib.verifyOracleFed(ctx.chainId, intent.header.feeToken)
  verifyFundShare(ctx.fund, ctx.master, intent.shareToken)
  const plan = planSell({
    redemption: ctx.fund.redemption,
    holding: ctx.holder.holding,
    balance: ctx.holder.balance,
    shares: intent.shares,
    performanceFee: ctx.fund.performanceFee,
    protocolFeeShare: PROTOCOL.protocolFeeShare
  })
  const paid = isAddressEqual(intent.header.feeToken, ctx.fund.redemption.token) ? plan.payout - plan.profitFee : 0n
  if (ctx.feeBalance + paid < intent.header.fee) {
    throw new CompactError(
      'FEE_UNFUNDED',
      `the sell pays a relay fee of ${intent.header.fee} in ${intent.header.feeToken}, but ${intent.header.account} holds ${ctx.feeBalance} and its settlement brings ${paid} more`,
      'hard'
    )
  }
  return intentTypedData('sell', ctx.chainId, intent)
}
