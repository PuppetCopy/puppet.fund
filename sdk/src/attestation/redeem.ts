import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { HUB_GATE_INTENTS } from '@puppet/contracts/intents'
import type {
  IAccountLib__AccountInitParams,
  IRedeem__RedeemIntent,
  IShareLib__ShareInitParams
} from '@puppet/contracts/types'
import { type Address, isAddressEqual, type TypedDataDefinition } from 'viem'
import { predictPuppetAccount, predictShareToken } from '../account/index.js'
import { CompactContractError } from '../compact/error.js'
import * as IntentLib from './intentLib.js'
import { HUB_DOMAIN, type IDraftContext } from './shared.js'

export interface IRedeemInput {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  share: IShareLib__ShareInitParams
  sharesOut: bigint
  acceptableNetAssetValue: bigint
  totalShareSupply: bigint
  acceptableShares: bigint
}

export interface IRedeemAttestContext extends IDraftContext {
  currentBlock: bigint
  shareToken: Address | null
  totalShareSupply: bigint
  queuedShares: bigint
  signedBalance: bigint
  poolTotalStake: bigint
}

export function attestRedeemIntent(ctx: IRedeemAttestContext, input: IRedeemInput) {
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
  if (ctx.totalShareSupply !== input.totalShareSupply) {
    throw new CompactContractError('Redeem__SupplyMismatch', [ctx.totalShareSupply, input.totalShareSupply])
  }

  // sharesOut > 0 embeds a master self-sell before the drain: the master's shares join
  // the pool first, so both the retire ceiling and the pool stake include them.
  let poolShares = ctx.queuedShares
  let poolTotalStake = ctx.poolTotalStake
  if (input.sharesOut > 0n) {
    const stakeAdded = poolTotalStake === 0n ? input.sharesOut : (input.sharesOut * poolTotalStake) / poolShares
    if (stakeAdded === 0n) throw new CompactContractError('Share__ZeroStakeAdded', [])
    poolShares += input.sharesOut
    poolTotalStake += stakeAdded
  }

  // Mirrors the retire-all path: the full pool retires when the store holds the entire
  // supply, otherwise one share always remains.
  const maxRetirable = poolShares === ctx.totalShareSupply ? poolShares : poolShares >= 2n ? poolShares - 1n : 0n
  const sharesRetired = input.acceptableShares < maxRetirable ? input.acceptableShares : maxRetirable
  const drainedBase =
    ctx.totalShareSupply === 0n ? 0n : (sharesRetired * input.acceptableNetAssetValue) / ctx.totalShareSupply
  if (sharesRetired === 0n) throw new CompactContractError('Redeem__NothingToRetire', [])
  if (drainedBase <= input.acceptableRelayFee) throw new CompactContractError('Redeem__RelayFeeTooHigh', [])
  IntentLib.assertOutflowCovered(ctx, { amountIn: 0n, amountOut: drainedBase })
  if (poolTotalStake === 0n) throw new CompactContractError('Share__NoStakeToCredit', [])

  const intent: IRedeem__RedeemIntent = {
    params: input.params,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: BigInt(ctx.chainId),
    share: input.share,
    sharesOut: input.sharesOut,
    acceptableNetAssetValue: input.acceptableNetAssetValue,
    totalShareSupply: input.totalShareSupply,
    acceptableShares: input.acceptableShares
  }

  const typedData: TypedDataDefinition = {
    domain: HUB_DOMAIN,
    ...HUB_GATE_INTENTS.redeem,
    message: intent as unknown as Record<string, unknown>
  }
  return { intent, typedData, args: [intent] }
}
