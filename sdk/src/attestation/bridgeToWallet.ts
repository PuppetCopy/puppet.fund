import { HUB_CHAIN_ID, MAX_QUOTE_AGE_SEC } from '@puppet/contracts/const'
import { HUB_GATE_INTENTS } from '@puppet/contracts/intents'
import type { IAccountLib__AccountInitParams, IHubGate__BridgeToWalletIntent } from '@puppet/contracts/types'
import type { Address, TypedDataDefinition } from 'viem'
import { CompactContractError } from '../compact/error.js'
import { CompactError } from '../compact/index.js'
import type { ChainId } from '../const/index.js'
import * as IntentLib from './intentLib.js'
import { HUB_DOMAIN, type IDraftContext } from './shared.js'

export interface IBridgeToWalletInput {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  inputAmount: bigint
  destinationChainId: bigint
  exclusiveRelayer: Address
  quoteTimestamp: number
  fillDeadline: number
  exclusivityDeadline: number
  outputAmount: bigint
}

export interface IBridgeToWalletAttestContext extends IDraftContext {
  currentBlock: bigint
  signedBalance: bigint
}

export function attestBridgeToWalletIntent(ctx: IBridgeToWalletAttestContext, input: IBridgeToWalletInput) {
  if (BigInt(ctx.chainId) !== BigInt(HUB_CHAIN_ID)) {
    throw new CompactError('BAD_REQUEST', `bridgeToWallet originates on hub chain only; got ${ctx.chainId}`)
  }
  // HubGate.bridgeToWallet leading guards (before verifyTimeBounds)
  if (input.inputAmount === 0n) throw new CompactContractError('Deposit__NothingToBridge', [])
  if (input.destinationChainId === BigInt(ctx.chainId)) {
    throw new CompactContractError('Deposit__SameChainBridge', [input.destinationChainId])
  }
  IntentLib.verifyTimeBounds(input.blockNumber, input.deadline, ctx.currentBlock)
  const inputToken = IntentLib.verifyTokenAndCap(
    ctx.tokenRegistry,
    ctx.chainId,
    input.params.baseTokenId,
    input.inputAmount
  )
  const outputToken = IntentLib.verifyTokenAndCap(
    ctx.tokenRegistry,
    Number(input.destinationChainId) as ChainId,
    input.params.baseTokenId,
    0n
  )
  IntentLib.verifyRelayFee(input.acceptableRelayFee, input.inputAmount)

  const quoteAge = BigInt(Math.floor(Date.now() / 1000)) - BigInt(input.quoteTimestamp)
  if (quoteAge > MAX_QUOTE_AGE_SEC) {
    throw new CompactError('STALE_QUOTE', `Across quote age ${quoteAge}s > max ${MAX_QUOTE_AGE_SEC}s`)
  }

  if (ctx.signedBalance < input.inputAmount) {
    throw new CompactContractError('Deposit__InsufficientBalance', [ctx.signedBalance, input.inputAmount])
  }
  if (input.acceptableRelayFee >= input.inputAmount) {
    throw new CompactContractError('Deposit__InsufficientBalance', [input.inputAmount, input.acceptableRelayFee])
  }

  const acrossInputAmount = input.inputAmount - input.acceptableRelayFee
  if (input.outputAmount > acrossInputAmount) {
    throw new CompactError(
      'STALE_QUOTE',
      `Across outputAmount ${input.outputAmount} exceeds bridged input ${acrossInputAmount}; refetch quote`
    )
  }
  const bridgeFee = acrossInputAmount - input.outputAmount
  if (bridgeFee >= acrossInputAmount) {
    throw new CompactContractError('Deposit__BridgeFeeExceedsInput', [bridgeFee, acrossInputAmount])
  }

  const intent: IHubGate__BridgeToWalletIntent = {
    params: input.params,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: BigInt(ctx.chainId),
    inputToken,
    outputToken,
    inputAmount: input.inputAmount,
    bridgeFee,
    destinationChainId: input.destinationChainId,
    exclusiveRelayer: input.exclusiveRelayer,
    quoteTimestamp: input.quoteTimestamp,
    fillDeadline: input.fillDeadline,
    exclusivityDeadline: input.exclusivityDeadline
  }

  const typedData: TypedDataDefinition = {
    domain: HUB_DOMAIN,
    ...HUB_GATE_INTENTS.bridgeToWallet,
    message: intent as unknown as Record<string, unknown>
  }
  return { intent, typedData, args: [intent] }
}
