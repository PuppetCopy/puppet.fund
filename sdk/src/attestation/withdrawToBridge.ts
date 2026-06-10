import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { HUB_GATE_INTENTS } from '@puppet/contracts/intents'
import type { IAccountLib__AccountInitParams, IHubGate__WithdrawToBridgeIntent } from '@puppet/contracts/types'
import type { Address, Hex, TypedDataDefinition } from 'viem'
import { predictPuppetAccount, predictRoute } from '../account/index.js'
import { CompactContractError } from '../compact/error.js'
import { CompactError } from '../compact/index.js'
import type { ChainId } from '../const/index.js'
import { acrossSpokePool, buildAcrossDeposit } from './acrossDeposit.js'
import { verifyBridgeQuoteRatio } from './bridgeGuard.js'
import * as IntentLib from './intentLib.js'
import { HUB_DOMAIN, type IDraftContext } from './shared.js'

export interface IWithdrawToBridgeInput {
  params: IAccountLib__AccountInitParams
  tokenId: Hex
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  inputAmount: bigint
  destinationChainId: bigint
  exclusiveRelayer: Address
  quoteTimestamp: number
  exclusivityParameter: number
  outputAmount: bigint
  expires: number
  fillDeadline: number
}

export interface IWithdrawToBridgeAttestContext extends IDraftContext {
  currentBlock: bigint
  routeBalance: bigint
  expectedOutputAmount: bigint | null
}

export function attestWithdrawToBridgeIntent(ctx: IWithdrawToBridgeAttestContext, input: IWithdrawToBridgeInput) {
  if (BigInt(ctx.chainId) !== BigInt(HUB_CHAIN_ID)) {
    throw new CompactError('BAD_REQUEST', `withdrawToBridge originates on hub chain only; got ${ctx.chainId}`)
  }
  if (input.inputAmount === 0n) throw new CompactContractError('Deposit__NothingToBridge', [])
  if (input.destinationChainId === BigInt(ctx.chainId)) {
    throw new CompactContractError('Deposit__SameChainBridge', [input.destinationChainId])
  }
  const inputToken = IntentLib.verifyCommonIntent(ctx, {
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    baseTokenId: input.tokenId,
    lookupChain: ctx.chainId,
    capAmount: input.inputAmount,
    acceptableRelayFee: input.acceptableRelayFee,
    relayFeeDenominator: input.inputAmount
  })
  const outputToken = IntentLib.verifyTokenAndCap(
    ctx.tokenRegistry,
    Number(input.destinationChainId) as ChainId,
    input.tokenId,
    0n
  )

  const nowSec = Math.floor(Date.now() / 1000)
  if (input.expires <= nowSec) {
    throw new CompactError('STALE_QUOTE', `OIF order expires ${input.expires} is in the past`)
  }
  if (input.fillDeadline > input.expires) {
    throw new CompactError('BAD_REQUEST', `fillDeadline ${input.fillDeadline} exceeds expires ${input.expires}`)
  }

  if (ctx.routeBalance < input.inputAmount) {
    throw new CompactContractError('Deposit__InsufficientBalance', [ctx.routeBalance, input.inputAmount])
  }
  if (input.acceptableRelayFee >= input.inputAmount) {
    throw new CompactContractError('Deposit__RelayFeeTooHigh', [])
  }

  if (input.outputAmount === 0n) {
    throw new CompactContractError('Deposit__ZeroBridgeOutput', [])
  }
  verifyBridgeQuoteRatio(input.outputAmount, ctx.expectedOutputAmount)

  const account = predictPuppetAccount(input.params)
  const provider = acrossSpokePool(ctx.chainId)
  const providerCallData = buildAcrossDeposit({
    depositor: predictRoute(account),
    recipient: input.params.user,
    inputToken,
    outputToken,
    inputAmount: input.inputAmount - input.acceptableRelayFee,
    outputAmount: input.outputAmount,
    destinationChainId: input.destinationChainId,
    exclusiveRelayer: input.exclusiveRelayer,
    quoteTimestamp: input.quoteTimestamp,
    fillDeadline: input.fillDeadline,
    exclusivityParameter: input.exclusivityParameter
  })

  const intent: IHubGate__WithdrawToBridgeIntent = {
    params: input.params,
    tokenId: input.tokenId,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: BigInt(ctx.chainId),
    inputToken,
    outputToken,
    inputAmount: input.inputAmount,
    outputAmount: input.outputAmount,
    destinationChainId: input.destinationChainId,
    provider,
    providerCallData,
    expires: input.expires,
    fillDeadline: input.fillDeadline
  }

  const typedData: TypedDataDefinition = {
    domain: HUB_DOMAIN,
    ...HUB_GATE_INTENTS.withdrawToBridge,
    message: intent as unknown as Record<string, unknown>
  }
  return { intent, typedData, args: [intent] }
}
