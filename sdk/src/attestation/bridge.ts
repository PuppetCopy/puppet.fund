import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { ACCOUNT_GATE_INTENTS } from '@puppet/contracts/intents'
import type { IAccountGate__BridgeIntent, IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import type { Address, Hex, TypedDataDefinition } from 'viem'
import { predictPuppetAccount, predictRoute } from '../account/index.js'
import { CompactContractError } from '../compact/error.js'
import { CompactError } from '../compact/index.js'
import type { ChainId } from '../const/index.js'
import { acrossSpokePool, buildAcrossDeposit } from './acrossDeposit.js'
import { verifyBridgeQuoteRatio } from './bridgeGuard.js'
import * as IntentLib from './intentLib.js'
import { ACCOUNT_GATE_DOMAIN_MAP, type IDraftContext } from './shared.js'

export type IBridgeRoute =
  | { kind: 'across'; exclusiveRelayer: Address; quoteTimestamp: number; exclusivityParameter: number }
  | { kind: 'swap'; provider: Address; providerCallData: Hex }

export interface IBridgeInput {
  params: IAccountLib__AccountInitParams
  tokenId: Hex
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  inputAmount: bigint
  destinationChainId: bigint
  route: IBridgeRoute
  outputAmount: bigint
  expires: number
  fillDeadline: number
}

export interface IBridgeAttestContext extends IDraftContext {
  currentBlock: bigint
  routeBalance: bigint
  expectedOutputAmount: bigint | null
}

export function attestBridgeIntent(ctx: IBridgeAttestContext, input: IBridgeInput) {
  if (input.inputAmount === 0n) throw new CompactContractError('Deposit__NothingToBridge', [])

  const inputToken = IntentLib.verifyCommonIntent(ctx, {
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    intentChainId: input.chainId,
    baseTokenId: input.tokenId,
    lookupChain: ctx.chainId,
    capAmount: input.inputAmount,
    acceptableRelayFee: input.acceptableRelayFee,
    relayFeeDenominator: input.inputAmount
  })

  if (input.destinationChainId !== BigInt(HUB_CHAIN_ID)) {
    throw new CompactContractError('Deposit__InvalidDestinationChain', [BigInt(HUB_CHAIN_ID), input.destinationChainId])
  }
  const outputToken = IntentLib.verifyTokenAndCap(ctx.tokenRegistry, HUB_CHAIN_ID as ChainId, input.tokenId, 0n)

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

  let provider: Address
  let providerCallData: Hex
  if (input.route.kind === 'across') {
    const account = predictPuppetAccount(input.params)
    const sweepRoute = predictRoute(account)
    provider = acrossSpokePool(Number(input.chainId))
    providerCallData = buildAcrossDeposit({
      depositor: sweepRoute,
      recipient: sweepRoute,
      inputToken,
      outputToken,
      inputAmount: input.inputAmount - input.acceptableRelayFee,
      outputAmount: input.outputAmount,
      destinationChainId: input.destinationChainId,
      exclusiveRelayer: input.route.exclusiveRelayer,
      quoteTimestamp: input.route.quoteTimestamp,
      fillDeadline: input.fillDeadline,
      exclusivityParameter: input.route.exclusivityParameter
    })
  } else {
    if (input.route.providerCallData === '0x') {
      throw new CompactError('BAD_REQUEST', 'swap provider calldata is empty')
    }
    provider = input.route.provider
    providerCallData = input.route.providerCallData
  }

  const intent: IAccountGate__BridgeIntent = {
    params: input.params,
    tokenId: input.tokenId,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: input.chainId,
    provider,
    providerCallData,
    inputAmount: input.inputAmount,
    outputAmount: input.outputAmount,
    destinationChainId: input.destinationChainId,
    expires: input.expires,
    fillDeadline: input.fillDeadline
  }

  const domain = ACCOUNT_GATE_DOMAIN_MAP[ctx.chainId]
  if (!domain) throw new CompactError('BAD_REQUEST', `unsupported chain ${ctx.chainId}`)
  const typedData: TypedDataDefinition = {
    domain,
    ...ACCOUNT_GATE_INTENTS.bridge,
    message: intent as unknown as Record<string, unknown>
  }
  return { intent, typedData, args: [intent] }
}
