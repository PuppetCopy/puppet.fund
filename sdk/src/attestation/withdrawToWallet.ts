import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { HUB_GATE_INTENTS } from '@puppet/contracts/intents'
import type { IAccountLib__AccountInitParams, IHubGate__WithdrawToWalletIntent } from '@puppet/contracts/types'
import type { Hex, TypedDataDefinition } from 'viem'
import { CompactContractError } from '../compact/error.js'
import { CompactError } from '../compact/index.js'
import * as IntentLib from './intentLib.js'
import { HUB_DOMAIN, type IDraftContext } from './shared.js'

export interface IWithdrawToWalletInput {
  params: IAccountLib__AccountInitParams
  tokenId: Hex
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  amount: bigint
}

export interface IWithdrawToWalletAttestContext extends IDraftContext {
  currentBlock: bigint
  signedBalance: bigint
}

export function attestWithdrawToWalletIntent(ctx: IWithdrawToWalletAttestContext, input: IWithdrawToWalletInput) {
  if (BigInt(ctx.chainId) !== BigInt(HUB_CHAIN_ID)) {
    throw new CompactError('BAD_REQUEST', `withdrawToWallet runs on hub chain only; got ${ctx.chainId}`)
  }
  if (input.amount === 0n) throw new CompactContractError('Deposit__NothingToWithdraw', [])
  IntentLib.verifyCommonIntent(ctx, {
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    intentChainId: input.chainId,
    baseTokenId: input.tokenId,
    lookupChain: ctx.chainId,
    capAmount: input.amount,
    acceptableRelayFee: input.acceptableRelayFee
  })

  if (ctx.signedBalance < input.amount) {
    throw new CompactContractError('Deposit__InsufficientBalance', [ctx.signedBalance, input.amount])
  }
  if (input.acceptableRelayFee >= input.amount) throw new CompactContractError('Deposit__RelayFeeTooHigh', [])

  const intent: IHubGate__WithdrawToWalletIntent = {
    params: input.params,
    tokenId: input.tokenId,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: input.chainId,
    amount: input.amount
  }

  const typedData: TypedDataDefinition = {
    domain: HUB_DOMAIN,
    ...HUB_GATE_INTENTS.withdrawToWallet,
    message: intent as unknown as Record<string, unknown>
  }
  return { intent, typedData, args: [intent] }
}
