import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { HUB_GATE_INTENTS } from '@puppet/contracts/intents'
import type { IAccountLib__AccountInitParams, IRedeemModule__ClaimIntent } from '@puppet/contracts/types'
import type { TypedDataDefinition } from 'viem'
import { CompactContractError } from '../compact/error.js'
import * as IntentLib from './intentLib.js'
import { HUB_DOMAIN, type IDraftContext } from './shared.js'

export interface IClaimInput {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  masterParams: IAccountLib__AccountInitParams
  amount: bigint
}

export interface IClaimAttestContext extends IDraftContext {
  currentBlock: bigint
  claimable?: bigint
}

export function attestClaimIntent(ctx: IClaimAttestContext, input: IClaimInput) {
  IntentLib.verifyCommonIntent(ctx, {
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    baseTokenId: input.masterParams.baseTokenId,
    lookupChain: HUB_CHAIN_ID,
    capAmount: 0n,
    acceptableRelayFee: input.acceptableRelayFee,
    relayFeeDenominator: input.amount
  })
  if (input.amount === 0n) throw new CompactContractError('Share__Empty', [])
  if (input.acceptableRelayFee >= input.amount) throw new CompactContractError('Share__RelayFeeTooHigh', [])
  if (ctx.claimable !== undefined && input.amount > ctx.claimable) {
    throw new CompactContractError('Share__InsufficientClaimable', [])
  }

  const intent: IRedeemModule__ClaimIntent = {
    params: input.params,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: BigInt(ctx.chainId),
    masterParams: input.masterParams,
    amount: input.amount
  }

  const typedData: TypedDataDefinition = {
    domain: HUB_DOMAIN,
    ...HUB_GATE_INTENTS.claim,
    message: intent as unknown as Record<string, unknown>
  }
  return { intent, typedData, args: [intent] }
}
