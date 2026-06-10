import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { HUB_GATE_INTENTS } from '@puppet/contracts/intents'
import type { IRedeemModule__FulfillIntent } from '@puppet/contracts/types'
import type { Address, Hex, TypedDataDefinition } from 'viem'
import { CompactContractError } from '../compact/error.js'
import * as IntentLib from './intentLib.js'
import { HUB_DOMAIN, type IDraftContext } from './shared.js'

export interface IFulfillInput {
  master: Address
  baseTokenId: Hex
  name: Hex
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  acceptableNetAssetValue: bigint
  totalShareSupply: bigint
  acceptableShares: bigint
}

export interface IFulfillAttestContext extends IDraftContext {
  currentBlock: bigint
  totalShareSupply: bigint
  queuedShares: bigint
  signedBalance: bigint
  poolTotalStake: bigint
}

export function attestFulfillIntent(ctx: IFulfillAttestContext, input: IFulfillInput) {
  IntentLib.verifyCommonIntent(ctx, {
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    baseTokenId: input.baseTokenId,
    lookupChain: HUB_CHAIN_ID,
    capAmount: 0n,
    acceptableRelayFee: input.acceptableRelayFee,
    relayFeeDenominator: input.acceptableNetAssetValue
  })

  if (input.acceptableNetAssetValue === 0n) throw new CompactContractError('Fulfill__ZeroAcceptableNav', [])

  if (ctx.totalShareSupply !== input.totalShareSupply) {
    throw new CompactContractError('Fulfill__SupplyMismatch', [ctx.totalShareSupply, input.totalShareSupply])
  }

  const maxRetirable = ctx.queuedShares >= 2n ? ctx.queuedShares - 1n : 0n
  const sharesRetired = input.acceptableShares < maxRetirable ? input.acceptableShares : maxRetirable
  const drainedBase =
    ctx.totalShareSupply === 0n ? 0n : (sharesRetired * input.acceptableNetAssetValue) / ctx.totalShareSupply
  if (sharesRetired === 0n) throw new CompactContractError('Fulfill__NothingToRetire', [])
  if (drainedBase <= input.acceptableRelayFee) throw new CompactContractError('Fulfill__RelayFeeTooHigh', [])
  IntentLib.assertOutflowCovered(ctx, { amountIn: 0n, amountOut: drainedBase })
  if (ctx.poolTotalStake === 0n) throw new CompactContractError('Share__NoStakeToCredit', [])

  const intent: IRedeemModule__FulfillIntent = {
    master: input.master,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: BigInt(ctx.chainId),
    baseTokenId: input.baseTokenId,
    name: input.name,
    acceptableNetAssetValue: input.acceptableNetAssetValue,
    totalShareSupply: input.totalShareSupply,
    acceptableShares: input.acceptableShares
  }

  const typedData: TypedDataDefinition = {
    domain: HUB_DOMAIN,
    ...HUB_GATE_INTENTS.fulfill,
    message: intent as unknown as Record<string, unknown>
  }
  return { intent, typedData, args: [intent] }
}
