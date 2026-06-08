import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { MASTER_GATE_INTENTS, PUPPET_GATE_INTENTS } from '@puppet/contracts/intents'
import type {
  IAccountLib__AccountInitParams,
  IMasterGate__BridgeIntent,
  IPuppetGate__BridgeIntent
} from '@puppet/contracts/types'
import { type Address, type Hex, isAddressEqual, type TypedDataDefinition } from 'viem'
import { predictDepositRoute, predictMasterAccount, predictPuppetAccount } from '../account/index.js'
import { CompactContractError } from '../compact/error.js'
import { CompactError } from '../compact/index.js'
import type { ChainId } from '../const/index.js'
import { tokenInfoFor } from '../state/tokenRegistry.js'
import { acrossSpokePool, buildAcrossDeposit } from './acrossDeposit.js'
import { verifyBridgeQuoteRatio } from './bridgeGuard.js'
import * as IntentLib from './intentLib.js'
import { type IDraftContext, MASTER_GATE_DOMAIN_MAP, PUPPET_GATE_DOMAIN_MAP } from './shared.js'

export type IBridgeRoute =
  | { kind: 'across'; exclusiveRelayer: Address; quoteTimestamp: number; exclusivityParameter: number }
  | { kind: 'swap'; provider: Address; providerCallData: Hex }

export interface IBridgeInput {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  isMaster: boolean
  fromTransientRoute: boolean
  inputToken?: Address
  inputAmount: bigint
  destinationChainId: bigint
  route: IBridgeRoute
  outputAmount: bigint
  expires: number
  fillDeadline: number
}

export interface IBridgeAttestContext extends IDraftContext {
  currentBlock: bigint
  signedBalance: bigint
  routeBalance: bigint
  expectedOutputAmount: bigint | null
}

export function attestBridgeIntent(ctx: IBridgeAttestContext, input: IBridgeInput) {
  if (input.inputAmount === 0n) throw new CompactContractError('Deposit__NothingToBridge', [])

  let outputToken: Address
  if (input.isMaster) {
    if (input.destinationChainId === BigInt(ctx.chainId)) {
      throw new CompactContractError('Deposit__SameChainBridge', [input.destinationChainId])
    }
    outputToken = IntentLib.verifyTokenAndCap(
      ctx.tokenRegistry,
      Number(input.destinationChainId) as ChainId,
      input.params.baseTokenId,
      0n
    )
  } else {
    if (input.destinationChainId !== BigInt(HUB_CHAIN_ID)) {
      throw new CompactContractError('Deposit__InvalidDestinationChain', [
        BigInt(HUB_CHAIN_ID),
        input.destinationChainId
      ])
    }
    outputToken = tokenInfoFor(ctx.tokenRegistry, ctx.chainId, input.params.baseTokenId).hubToken
  }

  const baseToken = IntentLib.verifyCommonIntent(ctx, {
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    intentChainId: input.chainId,
    baseTokenId: input.params.baseTokenId,
    lookupChain: ctx.chainId,
    capAmount: input.inputAmount,
    acceptableRelayFee: input.acceptableRelayFee,
    relayFeeDenominator: input.inputAmount
  })
  if (!input.fromTransientRoute && input.inputToken !== undefined && !isAddressEqual(input.inputToken, baseToken)) {
    throw new CompactContractError('Intent__TokenMismatch', [input.params.baseTokenId, baseToken, input.inputToken])
  }
  const inputToken = input.fromTransientRoute && input.inputToken !== undefined ? input.inputToken : baseToken

  const nowSec = Math.floor(Date.now() / 1000)
  if (input.expires <= nowSec) {
    throw new CompactError('STALE_QUOTE', `OIF order expires ${input.expires} is in the past`)
  }
  if (input.fillDeadline > input.expires) {
    throw new CompactError('BAD_REQUEST', `fillDeadline ${input.fillDeadline} exceeds expires ${input.expires}`)
  }

  const available = input.fromTransientRoute ? ctx.routeBalance : ctx.signedBalance
  if (available < input.inputAmount) {
    throw new CompactContractError('Deposit__InsufficientBalance', [available, input.inputAmount])
  }
  if (input.acceptableRelayFee >= input.inputAmount) {
    throw new CompactContractError('Deposit__InsufficientBalance', [input.inputAmount, input.acceptableRelayFee])
  }

  if (input.outputAmount === 0n) {
    throw new CompactContractError('Deposit__ZeroBridgeOutput', [])
  }
  verifyBridgeQuoteRatio(input.outputAmount, ctx.expectedOutputAmount)

  let provider: Address
  let providerCallData: Hex
  if (input.route.kind === 'across') {
    const account = input.isMaster ? predictMasterAccount(input.params) : predictPuppetAccount(input.params)
    const sweepRoute = predictDepositRoute(account)
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

  const intent: IPuppetGate__BridgeIntent | IMasterGate__BridgeIntent = {
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
    outputAmount: input.outputAmount,
    destinationChainId: input.destinationChainId,
    provider,
    providerCallData,
    expires: input.expires,
    fillDeadline: input.fillDeadline
  }

  const domain = input.isMaster ? MASTER_GATE_DOMAIN_MAP[ctx.chainId] : PUPPET_GATE_DOMAIN_MAP[ctx.chainId]
  if (!domain) throw new CompactError('BAD_REQUEST', `unsupported chain ${ctx.chainId}`)
  const typedData: TypedDataDefinition = {
    domain,
    ...(input.isMaster ? MASTER_GATE_INTENTS.bridge : PUPPET_GATE_INTENTS.bridge),
    message: intent as unknown as Record<string, unknown>
  }
  return { intent, typedData, args: [intent] }
}
