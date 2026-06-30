import { CHAIN_IDS, HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import { FUND_GATE_INTENTS, PUPPET_GATE_INTENTS } from '@puppet/contracts/intents'
import type {
  IAccountLib__AccountInitParams,
  IFundAccountLib__FundAccountInitParams,
  IFundGate__SwapIntent,
  IPuppetGate__SwapIntent,
  ISwapLib__SwapParams
} from '@puppet/contracts/types'
import { type Address, getAddress, type Hex, isAddressEqual, type TypedDataDefinition } from 'viem'
import { predictFundAccount, predictPuppetAccount, predictRoute } from '../account/index.js'
import { CompactContractError } from '../compact/error.js'
import { CompactError } from '../compact/index.js'
import type { ChainId } from '../const/index.js'
import { buildRouteAcrossDeposit, type IAcrossRouteFields } from './acrossDeposit.js'
import * as IntentLib from './intentLib.js'
import { fundGateDomain, type IDeployProof, type IDraftContext, puppetGateDomain } from './shared.js'
import { verifySwapBounds } from './swapGuard.js'

export type ISwapRoute =
  | ({ kind: 'across' } & IAcrossRouteFields)
  | { kind: 'swap'; provider: Address; providerCallData: Hex }

// Fields common to the PA (PuppetGate) and FA (FundGate) swap. Swap is always route-sourced.
// destinationChainId discriminates: == chainId is a local same-chain DEX swap (output delivered to the
// route then forwarded + credited signed, strong output floor); == hubChainId is a cross-chain swap/bridge
// (route → SpokePool → hub route, recognized on the hub). fillDeadline feeds the Across calldata only; it
// is not part of the signed intent.
interface ISwapCommon {
  params: IAccountLib__AccountInitParams
  inputToken: Address
  outputToken: Address
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  inputAmount: bigint
  outputAmount: bigint
  destinationChainId: bigint
  route: ISwapRoute
  fillDeadline: number
}

// PA swap creates the account on first use (deploy proofs empty when it already exists).
export interface ISwapInput extends ISwapCommon, IDeployProof {}

export interface IFundSwapInput extends ISwapCommon {
  fundParams: IFundAccountLib__FundAccountInitParams
  fromRoute: boolean
}

interface ISwapAttestContext extends IDraftContext {
  currentBlock: bigint
  sourceBalance: bigint
  expectedOutputAmount: bigint | null
}

// Resolve the swap leg: verify the common intent, classify local vs cross-chain, enforce balance/relay/
// output bounds (strong output floor LOCAL only — cross-chain relies on SpokePool minOutput + the dest-side
// recognize + the provider allowlist), then resolve provider/providerCallData. `account` (PA or FA) owns the
// route that funds the swap and receives the output (M2: recipient is always that route).
function buildSwapParams(account: Address, ctx: ISwapAttestContext, input: ISwapCommon): ISwapLib__SwapParams {
  if (input.inputAmount === 0n) throw new CompactContractError('Balance__NothingToSwap', [])

  const inputToken = IntentLib.verifyCommonIntent(ctx, {
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    intentChainId: input.chainId,
    baseToken: input.inputToken,
    lookupChain: ctx.chainId,
    capAmount: input.inputAmount,
    acceptableRelayFee: input.acceptableRelayFee,
    relayFeeDenominator: input.inputAmount
  })

  // Classify local vs cross-chain from route.kind, NOT the client-controlled destinationChainId: a 'swap' (local DEX
  // provider call) is ALWAYS same-chain (output forwarded + credited under the strong output floor) and an 'across'
  // bridge ALWAYS targets a different known chain. Deriving this from destinationChainId let a 'swap' carry a foreign
  // destinationChainId to fall outside `isLocal` and dodge the output floor entirely while still executing the local
  // provider call — the co-signer then supplied no slippage bound (sandwich/MEV drain of the route).
  const isLocal = input.route.kind === 'swap'
  if (isLocal) {
    if (input.destinationChainId !== input.chainId) {
      throw new CompactContractError('Balance__InvalidDestinationChain', [input.chainId, input.destinationChainId])
    }
  } else if (
    input.destinationChainId === input.chainId ||
    !(CHAIN_IDS as readonly number[]).includes(Number(input.destinationChainId))
  ) {
    throw new CompactContractError('Balance__InvalidDestinationChain', [BigInt(HUB_CHAIN_ID), input.destinationChainId])
  }
  IntentLib.verifyTokenAndCap(
    ctx.tokenRegistry,
    Number(input.destinationChainId) as ChainId,
    input.outputToken,
    isLocal ? input.outputAmount : 0n
  )
  const outputToken = input.outputToken

  if (isAddressEqual(getAddress(inputToken), PROTOCOL.nativeToken)) {
    throw new CompactError('BAD_REQUEST', 'native input swaps are not supported; wrap to WETH first')
  }
  if (!isLocal && isAddressEqual(getAddress(outputToken), PROTOCOL.nativeToken)) {
    throw new CompactError('BAD_REQUEST', 'cross-chain swap to native output is not supported')
  }

  verifySwapBounds(input, {
    sourceBalance: ctx.sourceBalance,
    expectedOutputAmount: isLocal ? ctx.expectedOutputAmount : null
  })

  const route = predictRoute(account)
  let provider: Address
  let providerCallData: Hex
  if (input.route.kind === 'across') {
    const built = buildRouteAcrossDeposit({
      depositor: route,
      recipient: route,
      inputToken,
      outputToken,
      inputAmount: input.inputAmount - input.acceptableRelayFee,
      outputAmount: input.outputAmount,
      destinationChainId: input.destinationChainId,
      fillDeadline: input.fillDeadline,
      route: input.route
    })
    provider = built.provider
    providerCallData = built.providerCallData
  } else {
    if (input.route.providerCallData === '0x') {
      throw new CompactError('BAD_REQUEST', 'swap provider calldata is empty')
    }
    provider = input.route.provider
    providerCallData = input.route.providerCallData
  }

  return {
    inputToken: input.inputToken,
    outputToken: input.outputToken,
    provider,
    providerCallData,
    inputAmount: input.inputAmount,
    outputAmount: input.outputAmount
  }
}

export function attestSwapIntent(ctx: ISwapAttestContext, input: ISwapInput) {
  const swap = buildSwapParams(predictPuppetAccount(input.params), ctx, input)

  const intent: IPuppetGate__SwapIntent = {
    params: input.params,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: input.chainId,
    swap,
    destinationChainId: input.destinationChainId
  }

  const typedData: TypedDataDefinition = {
    domain: puppetGateDomain(ctx.chainId),
    ...PUPPET_GATE_INTENTS.swap,
    message: intent as unknown as Record<string, unknown>
  }
  // Base (no-proof) args; the dispatch layer appends [userDeploySig, userSignerProof] for the
  // create overload when the PA isn't deployed (deploy proofs are not part of the digest).
  return { intent, typedData, args: [intent] }
}

export function attestFundSwapIntent(ctx: ISwapAttestContext, input: IFundSwapInput) {
  const swap = buildSwapParams(predictFundAccount(input.fundParams), ctx, input)

  const intent: IFundGate__SwapIntent = {
    params: input.params,
    fundParams: input.fundParams,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: input.chainId,
    swap,
    destinationChainId: input.destinationChainId,
    fromRoute: input.fromRoute
  }

  const typedData: TypedDataDefinition = {
    domain: fundGateDomain(ctx.chainId),
    ...FUND_GATE_INTENTS.swap,
    message: intent as unknown as Record<string, unknown>
  }
  return { intent, typedData, args: [intent] }
}
