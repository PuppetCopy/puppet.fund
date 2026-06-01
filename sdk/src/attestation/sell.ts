import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { HUB_GATE_INTENTS } from '@puppet/contracts/intents'
import type { IAccountLib__AccountInitParams, IRedeemModule__SellIntent } from '@puppet/contracts/types'
import type { TypedDataDefinition } from 'viem'
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
  masterParams: IAccountLib__AccountInitParams
  sharesOut: bigint
}

export interface ISellAttestContext extends IDraftContext {
  currentBlock: bigint
  signedBalance: bigint
  poolTotalStake: bigint
  queuedShares: bigint
}

export function attestSellIntent(ctx: ISellAttestContext, input: ISellInput) {
  IntentLib.verifyTimeBounds(input.blockNumber, input.deadline, ctx.currentBlock)
  IntentLib.verifyTokenAndCap(ctx.tokenRegistry, HUB_CHAIN_ID, input.masterParams.baseTokenId, 0n)
  if (input.sharesOut === 0n) throw new CompactContractError('Share__ZeroShares', [])
  const stakeAdded =
    ctx.poolTotalStake === 0n ? input.sharesOut : (input.sharesOut * ctx.poolTotalStake) / ctx.queuedShares
  if (stakeAdded === 0n) throw new CompactContractError('Share__ZeroStakeAdded', [])
  if (ctx.signedBalance < input.acceptableRelayFee) {
    throw new CompactError(
      'SELL_INSUFFICIENT_FEE_BALANCE',
      `puppet base balance ${ctx.signedBalance} below sell relay fee ${input.acceptableRelayFee}; deposit a small amount first`
    )
  }
  IntentLib.verifyRelayFee(input.acceptableRelayFee, ctx.signedBalance)

  const intent: IRedeemModule__SellIntent = {
    params: input.params,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: BigInt(ctx.chainId),
    masterParams: input.masterParams,
    sharesOut: input.sharesOut
  }

  const typedData: TypedDataDefinition = {
    domain: HUB_DOMAIN,
    ...HUB_GATE_INTENTS.sell,
    message: intent as unknown as Record<string, unknown>
  }
  return { intent, typedData, args: [intent] }
}
