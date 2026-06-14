import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { HUB_GATE_INTENTS } from '@puppet/contracts/intents'
import type {
  IAccountLib__AccountInitParams,
  IRedeem__LiquidateIntent,
  IShareLib__ShareInitParams
} from '@puppet/contracts/types'
import { type Address, isAddressEqual, type TypedDataDefinition } from 'viem'
import { predictPuppetAccount, predictShareToken } from '../account/index.js'
import { CompactContractError } from '../compact/error.js'
import { factor } from '../core/math.js'
import * as IntentLib from './intentLib.js'
import { HUB_DOMAIN, type IDraftContext } from './shared.js'

export interface ILiquidateInput {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  share: IShareLib__ShareInitParams
  acceptableNetAssetValue: bigint
}

export interface ILiquidateAttestContext extends IDraftContext {
  currentBlock: bigint
  shareToken: Address | null
  closeRate: bigint
  totalShareSupply: bigint
  queuedShares: bigint
  poolTotalStake: bigint
  signedBalance: bigint
}

export function attestLiquidateIntent(ctx: ILiquidateAttestContext, input: ILiquidateInput) {
  IntentLib.verifyCommonIntent(ctx, {
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    baseTokenId: input.share.baseTokenId,
    lookupChain: HUB_CHAIN_ID,
    capAmount: 0n,
    acceptableRelayFee: input.acceptableRelayFee,
    relayFeeDenominator: input.acceptableNetAssetValue
  })

  if (input.acceptableNetAssetValue === 0n) throw new CompactContractError('Redeem__ZeroAcceptableNav', [])
  if (ctx.closeRate !== 0n) throw new CompactContractError('Share__FundClosed', [])

  const master = predictPuppetAccount(input.params)
  if (!isAddressEqual(master, input.share.master)) {
    throw new CompactContractError('Share__MasterMismatch', [master, input.share.master])
  }
  if (
    ctx.shareToken === null ||
    !isAddressEqual(predictShareToken(input.share.master, input.share.baseTokenId, input.share.name), ctx.shareToken)
  ) {
    throw new CompactContractError('Share__NotCreated', [])
  }
  if (ctx.totalShareSupply === 0n) throw new CompactContractError('Redeem__NothingToRetire', [])
  if (input.acceptableNetAssetValue <= input.acceptableRelayFee) {
    throw new CompactContractError('Redeem__RelayFeeTooHigh', [])
  }
  const netDrained = input.acceptableNetAssetValue - input.acceptableRelayFee
  if (factor(netDrained, ctx.totalShareSupply) === 0n) {
    throw new CompactContractError('Share__CreditTooSmall', [])
  }
  if (ctx.queuedShares > 0n) {
    const queueSlice = (ctx.queuedShares * netDrained) / ctx.totalShareSupply
    if (queueSlice > 0n && factor(queueSlice, ctx.poolTotalStake) === 0n) {
      throw new CompactContractError('Share__CreditTooSmall', [])
    }
  }
  IntentLib.assertOutflowCovered(ctx, { amountIn: 0n, amountOut: input.acceptableNetAssetValue })

  const intent: IRedeem__LiquidateIntent = {
    params: input.params,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: BigInt(ctx.chainId),
    share: input.share,
    acceptableNetAssetValue: input.acceptableNetAssetValue
  }

  const typedData: TypedDataDefinition = {
    domain: HUB_DOMAIN,
    ...HUB_GATE_INTENTS.liquidate,
    message: intent as unknown as Record<string, unknown>
  }
  return { intent, typedData, args: [intent] }
}
