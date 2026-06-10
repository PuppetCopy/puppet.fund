import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { HUB_GATE_INTENTS } from '@puppet/contracts/intents'
import type {
  IAccountLib__AccountInitParams,
  IRedeemModule__SellIntent,
  IShareLib__ShareInitParams
} from '@puppet/contracts/types'
import { type Address, isAddressEqual, type TypedDataDefinition } from 'viem'
import { predictShareToken } from '../account/index.js'
import { CompactContractError } from '../compact/error.js'
import { CompactError } from '../compact/index.js'
import * as IntentLib from './intentLib.js'
import { HUB_DOMAIN, type IDraftContext } from './shared.js'

export interface ISellInput {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  share: IShareLib__ShareInitParams
  sharesOut: bigint
}

export interface ISellAttestContext extends IDraftContext {
  currentBlock: bigint
  signedBalance: bigint
  claimable: bigint
  shareToken: Address | null
  poolTotalStake: bigint
  queuedShares: bigint
}

export function attestSellIntent(ctx: ISellAttestContext, input: ISellInput) {
  IntentLib.verifyCommonIntent(ctx, {
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    baseTokenId: input.share.baseTokenId,
    lookupChain: HUB_CHAIN_ID,
    capAmount: 0n,
    acceptableRelayFee: input.acceptableRelayFee,
    relayFeeDenominator: ctx.signedBalance
  })
  if (input.sharesOut === 0n) throw new CompactContractError('Share__ZeroShares', [])
  if (
    ctx.shareToken === null ||
    !isAddressEqual(predictShareToken(input.share.master, input.share.baseTokenId, input.share.name), ctx.shareToken)
  ) {
    throw new CompactContractError('Share__NotCreated', [])
  }
  const stakeAdded =
    ctx.poolTotalStake === 0n ? input.sharesOut : (input.sharesOut * ctx.poolTotalStake) / ctx.queuedShares
  if (stakeAdded === 0n) throw new CompactContractError('Share__ZeroStakeAdded', [])
  // Sell auto-flushes the holder's accrued claim in the same dispatch, so the flush can
  // cover the relay fee even when the signed balance alone cannot.
  if (ctx.signedBalance + ctx.claimable < input.acceptableRelayFee) {
    throw new CompactError(
      'SELL_INSUFFICIENT_FEE_BALANCE',
      `puppet base balance ${ctx.signedBalance} plus claimable ${ctx.claimable} below sell relay fee ${input.acceptableRelayFee}; deposit a small amount first`
    )
  }

  const intent: IRedeemModule__SellIntent = {
    params: input.params,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: BigInt(ctx.chainId),
    share: input.share,
    sharesOut: input.sharesOut
  }

  const typedData: TypedDataDefinition = {
    domain: HUB_DOMAIN,
    ...HUB_GATE_INTENTS.sell,
    message: intent as unknown as Record<string, unknown>
  }
  return { intent, typedData, args: [intent] }
}
