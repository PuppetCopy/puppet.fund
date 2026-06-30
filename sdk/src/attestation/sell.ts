import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { HUB_GATE_INTENTS } from '@puppet/contracts/intents'
import type {
  IAccountLib__AccountInitParams,
  IFundAccountLib__FundAccountInitParams,
  IRedeem__SellIntent
} from '@puppet/contracts/types'
import { type Address, isAddressEqual, type TypedDataDefinition } from 'viem'
import { predictPuppetAccount, predictShareToken } from '../account/index.js'
import { CompactContractError } from '../compact/error.js'
import { CompactError } from '../compact/index.js'
import * as IntentLib from './intentLib.js'
import { HUB_DOMAIN, type IDraftContext, WEIGHT_RATIO_CAP } from './shared.js'

export interface ISellInput {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  fundParams: IFundAccountLib__FundAccountInitParams
  sharesOut: bigint
}

interface ISellAttestContext extends IDraftContext {
  currentBlock: bigint
  signedBalance: bigint
  claimable: bigint
  shareToken: Address | null
  liquidationRate: bigint
  poolWeight: bigint
  queuedShares: bigint
}

export function attestSellIntent(ctx: ISellAttestContext, input: ISellInput) {
  IntentLib.verifyCommonIntent(ctx, {
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    baseToken: input.fundParams.baseToken,
    lookupChain: HUB_CHAIN_ID,
    capAmount: 0n,
    acceptableRelayFee: input.acceptableRelayFee,
    relayFeeDenominator: ctx.signedBalance + ctx.claimable
  })
  if (input.sharesOut === 0n) throw new CompactContractError('Share__ZeroShares', [])
  if (isAddressEqual(predictPuppetAccount(input.params), input.fundParams.master)) {
    throw new CompactContractError('Share__MasterCannotSell', [])
  }
  if (ctx.liquidationRate !== 0n) throw new CompactContractError('Share__FundLiquidated', [])
  if (ctx.shareToken === null || !isAddressEqual(predictShareToken(input.fundParams), ctx.shareToken)) {
    throw new CompactContractError('Share__NotCreated', [])
  }
  if (ctx.poolWeight > ctx.queuedShares * WEIGHT_RATIO_CAP) {
    throw new CompactContractError('Share__PoolDegraded', [])
  }
  const weightAdded =
    ctx.poolWeight === 0n ? input.sharesOut : (input.sharesOut * ctx.poolWeight) / ctx.queuedShares
  if (weightAdded === 0n) throw new CompactContractError('Share__ZeroWeightAdded', [])
  // Sell auto-flushes the holder's accrued claim in the same dispatch, so the flush can
  // cover the relay fee even when the signed balance alone cannot.
  if (ctx.signedBalance + ctx.claimable < input.acceptableRelayFee) {
    throw new CompactError(
      'SELL_INSUFFICIENT_FEE_BALANCE',
      `puppet base balance ${ctx.signedBalance} plus claimable ${ctx.claimable} below sell relay fee ${input.acceptableRelayFee}; deposit a small amount first`
    )
  }

  const intent: IRedeem__SellIntent = {
    params: input.params,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: BigInt(ctx.chainId),
    fundParams: input.fundParams,
    sharesOut: input.sharesOut
  }

  const typedData: TypedDataDefinition = {
    domain: HUB_DOMAIN,
    ...HUB_GATE_INTENTS.sell,
    message: intent as unknown as Record<string, unknown>
  }
  return { intent, typedData, args: [intent] }
}
