import { MASTER_GATE_INTENTS, PUPPET_GATE_INTENTS } from '@puppet/contracts/intents'
import type {
  IAccountLib__AccountInitParams,
  IMasterGate__RecognizeIntent,
  IPuppetGate__RecognizeIntent
} from '@puppet/contracts/types'
import type { TypedDataDefinition } from 'viem'
import { CompactContractError } from '../compact/error.js'
import { CompactError } from '../compact/index.js'
import * as IntentLib from './intentLib.js'
import { type IDraftContext, MASTER_GATE_DOMAIN_MAP, PUPPET_GATE_DOMAIN_MAP } from './shared.js'

export interface IRecognizeBalanceInput {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  isMaster: boolean
  amount: bigint
  fromTransientRoute?: boolean
}

export interface IRecognizeBalanceAttestContext extends IDraftContext {
  currentBlock: bigint
  signedBalance: bigint
  routeBalance?: bigint
}

export function attestRecognizeBalanceIntent(ctx: IRecognizeBalanceAttestContext, input: IRecognizeBalanceInput) {
  if (input.amount === 0n) throw new CompactContractError('Deposit__NothingToRecord', [])
  IntentLib.verifyCommonIntent(ctx, {
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    intentChainId: input.chainId,
    baseTokenId: input.params.baseTokenId,
    lookupChain: ctx.chainId,
    capAmount: input.amount,
    acceptableRelayFee: input.acceptableRelayFee,
    relayFeeDenominator: ctx.signedBalance + input.amount
  })

  const fromTransientRoute = input.isMaster ? (input.fromTransientRoute ?? false) : false
  const sweepsRoute = !input.isMaster || fromTransientRoute
  if (sweepsRoute && ctx.routeBalance !== undefined && ctx.routeBalance < input.amount) {
    throw new CompactContractError('Deposit__InsufficientBalance', [ctx.routeBalance, input.amount])
  }

  const common = {
    params: input.params,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: input.chainId,
    amount: input.amount
  }
  const intent: IPuppetGate__RecognizeIntent | IMasterGate__RecognizeIntent = input.isMaster
    ? { ...common, fromTransientRoute }
    : common

  const domain = input.isMaster ? MASTER_GATE_DOMAIN_MAP[ctx.chainId] : PUPPET_GATE_DOMAIN_MAP[ctx.chainId]
  if (!domain) throw new CompactError('BAD_REQUEST', `unsupported chain ${ctx.chainId}`)
  const typedData: TypedDataDefinition = {
    domain,
    ...(input.isMaster ? MASTER_GATE_INTENTS.recognize : PUPPET_GATE_INTENTS.recognize),
    message: intent as unknown as Record<string, unknown>
  }
  return { intent, typedData, args: [intent] }
}
