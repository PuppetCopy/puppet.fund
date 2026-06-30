import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { HUB_GATE_INTENTS } from '@puppet/contracts/intents'
import type {
  IAccountLib__AccountInitParams,
  IFundAccountLib__FundAccountInitParams,
  IRedeem__RedeemIntent
} from '@puppet/contracts/types'
import { type Address, isAddressEqual, type TypedDataDefinition } from 'viem'
import { predictPuppetAccount, predictShareToken } from '../account/index.js'
import { CompactContractError } from '../compact/error.js'
import { CompactError } from '../compact/index.js'
import { factor } from '../core/math.js'
import * as IntentLib from './intentLib.js'
import { HUB_DOMAIN, type IDraftContext, WEIGHT_RATIO_CAP } from './shared.js'

export interface IRedeemInput {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  fundParams: IFundAccountLib__FundAccountInitParams
  sharesOut: bigint
  assetsOut: bigint
  acceptableNetAssetValue: bigint
}

interface IRedeemAttestContext extends IDraftContext {
  currentBlock: bigint
  shareToken: Address | null
  liquidationRate: bigint
  totalShareSupply: bigint
  queuedShares: bigint
  poolWeight: bigint
  masterWeight: bigint
  masterEpoch: bigint
  poolEpoch: bigint
  masterWalletShares: bigint
  signedBalance: bigint
}

export function attestRedeemIntent(ctx: IRedeemAttestContext, input: IRedeemInput) {
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
  const supply = ctx.totalShareSupply
  if (supply === 0n) throw new CompactContractError('Redeem__NothingToRetire', [])

  // sharesOut > 0 embeds the master self-sell before the drain: the master's shares join
  // the queue first, so the guard, queue value and retire math all run on the enlarged pool.
  let poolShares = ctx.queuedShares
  let poolWeight = ctx.poolWeight
  let masterWeight = ctx.masterEpoch < ctx.poolEpoch ? 0n : ctx.masterWeight
  let masterWalletShares = ctx.masterWalletShares
  if (input.sharesOut > 0n) {
    if (input.sharesOut > masterWalletShares) {
      throw new CompactError(
        'REDEEM_INSUFFICIENT_SHARES',
        `master holds ${masterWalletShares} shares, cannot queue ${input.sharesOut}`
      )
    }
    if (poolWeight > poolShares * WEIGHT_RATIO_CAP) throw new CompactContractError('Share__PoolDegraded', [])
    const weightAdded = poolWeight === 0n ? input.sharesOut : (input.sharesOut * poolWeight) / poolShares
    if (weightAdded === 0n) throw new CompactContractError('Share__ZeroWeightAdded', [])
    masterWeight += weightAdded
    poolWeight += weightAdded
    poolShares += input.sharesOut
    masterWalletShares -= input.sharesOut
  }

  if (masterWeight > 0n) {
    if (2n * masterWalletShares < supply - poolShares) {
      throw new CompactContractError('Redeem__MasterSkinTooLow', [])
    }
  }

  const queueValue = (poolShares * input.acceptableNetAssetValue) / supply
  if (input.assetsOut > queueValue) throw new CompactContractError('Redeem__DrainExceedsQueue', [])
  const sharesRetired =
    input.assetsOut === queueValue ? poolShares : (input.assetsOut * supply) / input.acceptableNetAssetValue
  if (sharesRetired === 0n) throw new CompactContractError('Redeem__NothingToRetire', [])
  if (input.assetsOut <= input.acceptableRelayFee) throw new CompactContractError('Redeem__RelayFeeTooHigh', [])
  IntentLib.assertOutflowCovered(ctx, { amountIn: 0n, amountOut: input.assetsOut })

  if (poolWeight === 0n) throw new CompactContractError('Share__NoWeightToCredit', [])
  if (factor(input.assetsOut - input.acceptableRelayFee, poolWeight) === 0n) {
    throw new CompactContractError('Share__CreditTooSmall', [])
  }

  const intent: IRedeem__RedeemIntent = {
    params: input.params,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: BigInt(ctx.chainId),
    fundParams: input.fundParams,
    sharesOut: input.sharesOut,
    assetsOut: input.assetsOut,
    acceptableNetAssetValue: input.acceptableNetAssetValue
  }

  const typedData: TypedDataDefinition = {
    domain: HUB_DOMAIN,
    ...HUB_GATE_INTENTS.redeem,
    message: intent as unknown as Record<string, unknown>
  }
  return { intent, typedData, args: [intent] }
}
