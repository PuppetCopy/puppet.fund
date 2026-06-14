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
import { CompactError } from '../compact/index.js'
import { factor } from '../core/math.js'
import * as IntentLib from './intentLib.js'
import { HUB_DOMAIN, type IDraftContext, STAKE_RATIO_CAP } from './shared.js'

export interface IRedeemInput {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  share: IShareLib__ShareInitParams
  sharesOut: bigint
  assetsOut: bigint
  acceptableNetAssetValue: bigint
}

export interface IRedeemAttestContext extends IDraftContext {
  currentBlock: bigint
  shareToken: Address | null
  closeRate: bigint
  totalShareSupply: bigint
  queuedShares: bigint
  poolTotalStake: bigint
  masterStake: bigint
  masterWalletShares: bigint
  signedBalance: bigint
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
  const supply = ctx.totalShareSupply
  if (supply === 0n) throw new CompactContractError('Redeem__NothingToRetire', [])

  // sharesOut > 0 embeds the master self-sell before the drain: the master's shares join
  // the queue first, so the guard, queue value and retire math all run on the enlarged pool.
  let poolShares = ctx.queuedShares
  let poolTotalStake = ctx.poolTotalStake
  let masterStake = ctx.masterStake
  let masterWalletShares = ctx.masterWalletShares
  if (input.sharesOut > 0n) {
    if (input.sharesOut > masterWalletShares) {
      throw new CompactError(
        'REDEEM_INSUFFICIENT_SHARES',
        `master holds ${masterWalletShares} shares, cannot queue ${input.sharesOut}`
      )
    }
    if (poolTotalStake > poolShares * STAKE_RATIO_CAP) throw new CompactContractError('Share__PoolDegraded', [])
    const stakeAdded = poolTotalStake === 0n ? input.sharesOut : (input.sharesOut * poolTotalStake) / poolShares
    if (stakeAdded === 0n) throw new CompactContractError('Share__ZeroStakeAdded', [])
    masterStake += stakeAdded
    poolTotalStake += stakeAdded
    poolShares += input.sharesOut
    masterWalletShares -= input.sharesOut
  }

  // The skin-in-the-game guard: the master's share of the queue may not exceed his share
  // of the fund, so he can never exit ahead of his investors.
  if (masterStake > 0n) {
    if (masterWalletShares * poolTotalStake + masterStake * poolShares < masterStake * supply) {
      throw new CompactContractError('Redeem__MasterFractionDecreased', [])
    }
  }

  const queueValue = (poolShares * input.acceptableNetAssetValue) / supply
  if (input.assetsOut > queueValue) throw new CompactContractError('Redeem__DrainExceedsQueue', [])
  const sharesRetired =
    input.assetsOut === queueValue ? poolShares : (input.assetsOut * supply) / input.acceptableNetAssetValue
  if (sharesRetired === 0n) throw new CompactContractError('Redeem__NothingToRetire', [])
  if (input.assetsOut <= input.acceptableRelayFee) throw new CompactContractError('Redeem__RelayFeeTooHigh', [])
  IntentLib.assertOutflowCovered(ctx, { amountIn: 0n, amountOut: input.assetsOut })

  if (poolTotalStake === 0n) throw new CompactContractError('Share__NoStakeToCredit', [])
  if (factor(input.assetsOut - input.acceptableRelayFee, poolTotalStake) === 0n) {
    throw new CompactContractError('Share__CreditTooSmall', [])
  }

  const intent: IRedeem__RedeemIntent = {
    params: input.params,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: BigInt(ctx.chainId),
    share: input.share,
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
