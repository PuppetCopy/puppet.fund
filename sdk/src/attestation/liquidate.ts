import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { HUB_GATE_INTENTS } from '@puppet/contracts/intents'
import type {
  IAccountLib__AccountInitParams,
  IFundAccountLib__FundAccountInitParams,
  IRedeem__LiquidateIntent
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
  fundParams: IFundAccountLib__FundAccountInitParams
  acceptableNetAssetValue: bigint
}

interface ILiquidateAttestContext extends IDraftContext {
  currentBlock: bigint
  shareToken: Address | null
  liquidationRate: bigint
  totalShareSupply: bigint
  queuedShares: bigint
  poolWeight: bigint
  signedBalance: bigint
}

export function attestLiquidateIntent(ctx: ILiquidateAttestContext, input: ILiquidateInput) {
  IntentLib.verifyCommonIntent(ctx, {
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    baseToken: input.fundParams.baseToken,
    lookupChain: HUB_CHAIN_ID,
    capAmount: 0n,
    acceptableRelayFee: input.acceptableRelayFee,
    relayFeeDenominator: input.acceptableNetAssetValue
  })

  if (input.acceptableNetAssetValue === 0n) throw new CompactContractError('Redeem__ZeroAcceptableNav', [])
  if (ctx.liquidationRate !== 0n) throw new CompactContractError('Share__FundLiquidated', [])

  const master = predictPuppetAccount(input.params)
  if (!isAddressEqual(master, input.fundParams.master)) {
    throw new CompactContractError('Share__MasterMismatch', [master, input.fundParams.master])
  }
  if (ctx.shareToken === null || !isAddressEqual(predictShareToken(input.fundParams), ctx.shareToken)) {
    throw new CompactContractError('Share__NotCreated', [])
  }
  if (ctx.totalShareSupply === 0n) throw new CompactContractError('Redeem__NothingToRetire', [])
  if (input.acceptableNetAssetValue <= input.acceptableRelayFee) {
    throw new CompactContractError('Redeem__RelayFeeTooHigh', [])
  }
  const netDrained = input.acceptableNetAssetValue - input.acceptableRelayFee
  if (factor(netDrained, ctx.totalShareSupply) === 0n) {
    throw new CompactContractError('Redeem__LiquidationRateTooSmall', [])
  }
  if (ctx.queuedShares > 0n) {
    const queueSlice = (ctx.queuedShares * netDrained) / ctx.totalShareSupply
    if (queueSlice > 0n && factor(queueSlice, ctx.poolWeight) === 0n) {
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
    fundParams: input.fundParams,
    acceptableNetAssetValue: input.acceptableNetAssetValue
  }

  const typedData: TypedDataDefinition = {
    domain: HUB_DOMAIN,
    ...HUB_GATE_INTENTS.liquidate,
    message: intent as unknown as Record<string, unknown>
  }
  return { intent, typedData, args: [intent] }
}
