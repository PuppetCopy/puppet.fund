import { FUND_GATE_INTENTS, PUPPET_GATE_INTENTS } from '@puppet/contracts/intents'
import type {
  IAccountLib__AccountInitParams,
  IFundAccountLib__FundAccountInitParams,
  IFundGate__RecognizeIntent,
  IPuppetGate__RecognizeIntent
} from '@puppet/contracts/types'
import type { Address, TypedDataDefinition } from 'viem'
import { CompactContractError } from '../compact/error.js'
import * as IntentLib from './intentLib.js'
import { fundGateDomain, type IDeployProof, type IDraftContext, puppetGateDomain } from './shared.js'

export interface IRecognizeBalanceInput extends IDeployProof {
  params: IAccountLib__AccountInitParams
  token: Address
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  amount: bigint
}

export interface IFundRecognizeInput extends IRecognizeBalanceInput {
  fundParams: IFundAccountLib__FundAccountInitParams
}

interface IRecognizeBalanceAttestContext extends IDraftContext {
  currentBlock: bigint
  signedBalance: bigint
  routeBalance: bigint
}

function verifyRecognize(ctx: IRecognizeBalanceAttestContext, input: IRecognizeBalanceInput): void {
  if (input.amount === 0n) throw new CompactContractError('Balance__NothingToRecord', [])
  IntentLib.verifyCommonIntent(ctx, {
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    intentChainId: input.chainId,
    baseToken: input.token,
    lookupChain: ctx.chainId,
    capAmount: input.amount,
    acceptableRelayFee: input.acceptableRelayFee,
    relayFeeDenominator: ctx.signedBalance + input.amount
  })
  if (ctx.routeBalance < input.amount) {
    throw new CompactContractError('Balance__InsufficientBalance', [ctx.routeBalance, input.amount])
  }
}

// PA recognize (PuppetGate): route → signed crediting, session-signed.
export function attestRecognizeBalanceIntent(ctx: IRecognizeBalanceAttestContext, input: IRecognizeBalanceInput) {
  verifyRecognize(ctx, input)

  const intent: IPuppetGate__RecognizeIntent = {
    params: input.params,
    token: input.token,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: input.chainId,
    amount: input.amount
  }

  const typedData: TypedDataDefinition = {
    domain: puppetGateDomain(ctx.chainId),
    ...PUPPET_GATE_INTENTS.recognize,
    message: intent as unknown as Record<string, unknown>
  }
  return { intent, typedData, args: [intent] }
}

// FA recognize (FundGate): route → signed crediting for the fund, master-signed, creates fund if missing.
export function attestFundRecognizeIntent(ctx: IRecognizeBalanceAttestContext, input: IFundRecognizeInput) {
  verifyRecognize(ctx, input)

  const intent: IFundGate__RecognizeIntent = {
    params: input.params,
    fundParams: input.fundParams,
    token: input.token,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: input.chainId,
    amount: input.amount
  }

  const typedData: TypedDataDefinition = {
    domain: fundGateDomain(ctx.chainId),
    ...FUND_GATE_INTENTS.recognize,
    message: intent as unknown as Record<string, unknown>
  }
  return { intent, typedData, args: [intent] }
}
