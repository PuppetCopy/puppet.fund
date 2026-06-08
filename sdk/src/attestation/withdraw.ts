import { PUPPET_GATE_INTENTS } from '@puppet/contracts/intents'
import type { IAccountLib__AccountInitParams, IPuppetGate__WithdrawIntent } from '@puppet/contracts/types'
import type { TypedDataDefinition } from 'viem'
import { CompactContractError } from '../compact/error.js'
import { CompactError } from '../compact/index.js'
import * as IntentLib from './intentLib.js'
import { PUPPET_GATE_DOMAIN_MAP, type IDraftContext } from './shared.js'

export interface IWithdrawInput {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  amount: bigint
}

export interface IWithdrawAttestContext extends IDraftContext {
  currentBlock: bigint
  signedBalance: bigint
}

export function attestWithdrawIntent(ctx: IWithdrawAttestContext, input: IWithdrawInput) {
  if (input.amount === 0n) throw new CompactContractError('Deposit__NothingToWithdraw', [])
  IntentLib.verifyCommonIntent(ctx, {
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    intentChainId: input.chainId,
    baseTokenId: input.params.baseTokenId,
    lookupChain: ctx.chainId,
    capAmount: input.amount,
    acceptableRelayFee: input.acceptableRelayFee
  })

  if (ctx.signedBalance < input.amount) {
    throw new CompactContractError('Deposit__InsufficientBalance', [ctx.signedBalance, input.amount])
  }
  // CoreGate.walletWithdraw: actualRelayFee >= amount → Deposit__RelayFeeTooHigh (acceptableRelayFee is the conservative bound)
  if (input.acceptableRelayFee >= input.amount) throw new CompactContractError('Deposit__RelayFeeTooHigh', [])

  const intent: IPuppetGate__WithdrawIntent = {
    params: input.params,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: input.chainId,
    amount: input.amount
  }

  const domain = PUPPET_GATE_DOMAIN_MAP[ctx.chainId]
  if (!domain) throw new CompactError('BAD_REQUEST', `unsupported chain ${ctx.chainId}`)
  const typedData: TypedDataDefinition = {
    domain,
    ...PUPPET_GATE_INTENTS.walletWithdraw,
    message: intent as unknown as Record<string, unknown>
  }
  return { intent, typedData, args: [intent] }
}
