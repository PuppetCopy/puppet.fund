import { HUB_CHAIN_ID, MAX_QUOTE_AGE_SEC } from '@puppet/contracts/const'
import { SPOKE_GATE_INTENTS } from '@puppet/contracts/intents'
import type {
  IAccountLib__AccountInitParams,
  ISpokeGate__BridgeHubIntent,
  ISpokeGate__BridgeIntent
} from '@puppet/contracts/types'
import type { Address, TypedDataDefinition } from 'viem'
import { CompactContractError } from '../compact/error.js'
import { CompactError } from '../compact/index.js'
import type { ChainId } from '../const/index.js'
import { tokenInfoFor } from '../state/tokenRegistry.js'
import * as IntentLib from './intentLib.js'
import { type IDraftContext, SPOKE_GATE_DOMAIN_MAP } from './shared.js'

export interface IBridgeHubInput {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  fromTransientRoute: boolean
  inputAmount: bigint
  destinationChainId: bigint
  exclusiveRelayer: Address
  quoteTimestamp: number
  fillDeadline: number
  exclusivityDeadline: number
  outputAmount: bigint
}

export interface IBridgeHubAttestContext extends IDraftContext {
  currentBlock: bigint
  signedBalance: bigint
  transientRouteBalance: bigint
}

export function attestBridgeHubIntent(ctx: IBridgeHubAttestContext, input: IBridgeHubInput) {
  // SpokeGate.bridgeHub leading guards (before verifyTimeBounds)
  if (input.inputAmount === 0n) throw new CompactContractError('Deposit__NothingToBridge', [])
  if (input.destinationChainId !== BigInt(HUB_CHAIN_ID)) {
    throw new CompactContractError('Deposit__InvalidDestinationChain', [BigInt(HUB_CHAIN_ID), input.destinationChainId])
  }
  IntentLib.verifyTimeBounds(input.blockNumber, input.deadline, ctx.currentBlock)
  const inputToken = IntentLib.verifyTokenAndCap(
    ctx.tokenRegistry,
    ctx.chainId,
    input.params.baseTokenId,
    input.inputAmount
  )
  // SpokeGate.bridgeHub derives outputToken from the spoke registry row's hubToken (Deposit__BaseTokenMismatch)
  const outputToken = tokenInfoFor(ctx.tokenRegistry, ctx.chainId, input.params.baseTokenId).hubToken
  IntentLib.verifyRelayFee(input.acceptableRelayFee, input.inputAmount)

  const quoteAge = BigInt(Math.floor(Date.now() / 1000)) - BigInt(input.quoteTimestamp)
  if (quoteAge > MAX_QUOTE_AGE_SEC) {
    throw new CompactError('STALE_QUOTE', `Across quote age ${quoteAge}s > max ${MAX_QUOTE_AGE_SEC}s`)
  }

  if (input.fromTransientRoute) {
    if (ctx.transientRouteBalance < input.inputAmount) {
      throw new CompactContractError('Deposit__InsufficientBalance', [ctx.transientRouteBalance, input.inputAmount])
    }
  } else {
    if (ctx.signedBalance < input.inputAmount) {
      throw new CompactContractError('Deposit__InsufficientBalance', [ctx.signedBalance, input.inputAmount])
    }
  }
  if (input.acceptableRelayFee >= input.inputAmount) {
    throw new CompactContractError('Deposit__InsufficientBalance', [input.inputAmount, input.acceptableRelayFee])
  }

  const acrossInputAmount = input.inputAmount - input.acceptableRelayFee
  if (input.outputAmount > acrossInputAmount) {
    throw new CompactError(
      'STALE_QUOTE',
      `Across outputAmount ${input.outputAmount} exceeds bridged input ${acrossInputAmount} (inputAmount ${input.inputAmount} - relayFee ${input.acceptableRelayFee}); refetch quote`
    )
  }
  const bridgeFee = acrossInputAmount - input.outputAmount
  if (bridgeFee >= acrossInputAmount) {
    throw new CompactContractError('Deposit__BridgeFeeExceedsInput', [bridgeFee, acrossInputAmount])
  }

  const intent: ISpokeGate__BridgeHubIntent = {
    params: input.params,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: input.chainId,
    fromTransientRoute: input.fromTransientRoute,
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

  const domain = SPOKE_GATE_DOMAIN_MAP[ctx.chainId]
  if (!domain) throw new CompactError('BAD_REQUEST', `unsupported chain ${ctx.chainId}`)
  const typedData: TypedDataDefinition = {
    domain,
    ...SPOKE_GATE_INTENTS.bridgeHub,
    message: intent as unknown as Record<string, unknown>
  }
  return { intent, typedData, args: [intent] }
}

export type IBridgeInput = IBridgeHubInput
export type IBridgeAttestContext = IBridgeHubAttestContext

export function attestBridgeIntent(ctx: IBridgeAttestContext, input: IBridgeInput) {
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

  if (input.fromTransientRoute) {
    if (ctx.transientRouteBalance < input.inputAmount) {
      throw new CompactContractError('Deposit__InsufficientBalance', [ctx.transientRouteBalance, input.inputAmount])
    }
  } else {
    if (ctx.signedBalance < input.inputAmount) {
      throw new CompactContractError('Deposit__InsufficientBalance', [ctx.signedBalance, input.inputAmount])
    }
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

  const intent: ISpokeGate__BridgeIntent = {
    params: input.params,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: input.chainId,
    fromTransientRoute: input.fromTransientRoute,
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

  const domain = SPOKE_GATE_DOMAIN_MAP[ctx.chainId]
  if (!domain) throw new CompactError('BAD_REQUEST', `unsupported chain ${ctx.chainId}`)
  const typedData: TypedDataDefinition = {
    domain,
    ...SPOKE_GATE_INTENTS.bridge,
    message: intent as unknown as Record<string, unknown>
  }
  return { intent, typedData, args: [intent] }
}
