import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { HUB_GATE_INTENTS } from '@puppet/contracts/intents'
import type { IAccountLib__AccountInitParams, IRedeemModule__FulfillIntent } from '@puppet/contracts/types'
import type { TypedDataDefinition } from 'viem'
import { CompactContractError } from '../compact/error.js'
import * as IntentLib from './intentLib.js'
import { HUB_DOMAIN, type IDraftContext } from './shared.js'

export interface IFulfillInput {
  params: IAccountLib__AccountInitParams
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
}

export function attestFulfillIntent(ctx: IFulfillAttestContext, input: IFulfillInput) {
  // HubGate.fulfill → IntentLib.verifyTimeBounds
  IntentLib.verifyTimeBounds(input.blockNumber, input.deadline, ctx.currentBlock)
  // HubGate.fulfill → IntentLib.verifyTokenAndCap(baseTokenId, address(0), 0)
  IntentLib.verifyTokenAndCap(ctx.tokenRegistry, HUB_CHAIN_ID, input.params.baseTokenId, 0n)
  // HubGate.fulfill → IntentLib.verifyRelayFeeRatio(actualRelayFee, master.signedBalance, maxBps)
  IntentLib.verifyRelayFee(input.acceptableRelayFee, ctx.signedBalance)

  // RedeemModule.fulfill body, in source order
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

  const intent: IRedeemModule__FulfillIntent = {
    params: input.params,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: BigInt(ctx.chainId),
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
