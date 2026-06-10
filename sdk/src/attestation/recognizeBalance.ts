import { ACCOUNT_GATE_INTENTS } from '@puppet/contracts/intents'
import type { IAccountGate__RecognizeIntent, IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import type { Hex, TypedDataDefinition } from 'viem'
import { CompactContractError } from '../compact/error.js'
import { CompactError } from '../compact/index.js'
import * as IntentLib from './intentLib.js'
import { ACCOUNT_GATE_DOMAIN_MAP, type IDraftContext } from './shared.js'

export interface IRecognizeBalanceInput {
  params: IAccountLib__AccountInitParams
  tokenId: Hex
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  amount: bigint
}

export interface IRecognizeBalanceAttestContext extends IDraftContext {
  currentBlock: bigint
  signedBalance: bigint
  routeBalance: bigint
}

export function attestRecognizeBalanceIntent(ctx: IRecognizeBalanceAttestContext, input: IRecognizeBalanceInput) {
  if (input.amount === 0n) throw new CompactContractError('Deposit__NothingToRecord', [])
  IntentLib.verifyCommonIntent(ctx, {
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    intentChainId: input.chainId,
    baseTokenId: input.tokenId,
    lookupChain: ctx.chainId,
    capAmount: input.amount,
    acceptableRelayFee: input.acceptableRelayFee,
    relayFeeDenominator: ctx.signedBalance + input.amount
  })

  if (ctx.routeBalance < input.amount) {
    throw new CompactContractError('Deposit__InsufficientBalance', [ctx.routeBalance, input.amount])
  }

  const intent: IAccountGate__RecognizeIntent = {
    params: input.params,
    tokenId: input.tokenId,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: input.chainId,
    amount: input.amount
  }

  const domain = ACCOUNT_GATE_DOMAIN_MAP[ctx.chainId]
  if (!domain) throw new CompactError('BAD_REQUEST', `unsupported chain ${ctx.chainId}`)
  const typedData: TypedDataDefinition = {
    domain,
    ...ACCOUNT_GATE_INTENTS.recognize,
    message: intent as unknown as Record<string, unknown>
  }
  return { intent, typedData, args: [intent] }
}
