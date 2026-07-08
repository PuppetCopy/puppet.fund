import { CHAIN_IDS, HUB_CHAIN_ID, PROTOCOL, SWAP_PROVIDER } from '@puppet/contracts/const'
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
import { wrappedNativeAddressOf } from '../state/tokenRegistry.js'
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
function buildSwapParams(
  account: Address,
  ctx: ISwapAttestContext,
  input: ISwapCommon,
  allowNativeInput = false
): ISwapLib__SwapParams {
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

  // Local vs cross-chain is the DESTINATION, not route.kind: a local leg (destinationChainId == chainId) delivers and
  // credits output on this chain under the strong synchronous output floor (the BaseAccount shortfall check); a
  // cross-chain leg bridges the output to the destination route and recognizes it THERE, so it carries no synchronous
  // floor and is bounded instead by the co-signer's mandatory in-domain oracle screen (evaluateSwapValue /
  // evaluateCrossChainSwapValue) + the provider allowlist + the dest-side recognize. A provider-call 'swap' route may be
  // local OR cross-chain (swap-and-bridge in one provider call); an 'across' bridge is cross-chain only. The earlier MEV
  // vector (a local DEX 'swap' lying about destinationChainId to skip the floor) is closed by that cross-chain value
  // screen — every cross-chain leg must clear it before this attests.
  const isLocal = input.destinationChainId === input.chainId
  if (isLocal) {
    if (input.route.kind !== 'swap') {
      throw new CompactContractError('Balance__InvalidDestinationChain', [BigInt(HUB_CHAIN_ID), input.destinationChainId])
    }
  } else if (!(CHAIN_IDS as readonly number[]).includes(Number(input.destinationChainId))) {
    throw new CompactContractError('Balance__InvalidDestinationChain', [BigInt(HUB_CHAIN_ID), input.destinationChainId])
  }
  IntentLib.verifyTokenAndCap(
    ctx.tokenRegistry,
    Number(input.destinationChainId) as ChainId,
    input.outputToken,
    isLocal ? input.outputAmount : 0n
  )
  const outputToken = input.outputToken

  // FundGate.swap wraps a native input INSIDE the dispatch (a WNT.deposit leg precedes the sandwich), so a fund swap
  // signs the native marker directly and the provider-facing token is its wrapped twin. PuppetGate has no such branch —
  // PA swaps keep refusing native.
  const nativeIn = isAddressEqual(getAddress(inputToken), PROTOCOL.nativeToken)
  if (nativeIn && !allowNativeInput) {
    throw new CompactError('BAD_REQUEST', 'native input swaps are not supported; wrap to WETH first')
  }
  const swapIn = nativeIn ? wrappedNativeAddressOf(Number(ctx.chainId) as ChainId) : getAddress(inputToken)
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
      originChainId: Number(input.chainId),
      depositor: route,
      recipient: route,
      // The provider-facing token is the wrapped twin: FundGate.swap wraps a native input in-dispatch, so the
      // SpokePool deposit pulls WNT, not the native marker the intent signs.
      inputToken: swapIn,
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
    // A cross-chain leg delivers to whatever recipient the provider calldata encodes, and this branch's calldata is
    // CLIENT-built and opaque (LI.FI swap-and-bridge, Across /swap periphery) — the co-signer cannot verify it targets
    // the account's own route. Signing it would let a leaked/hostile session key bridge funds to an arbitrary address,
    // the exact escalation the local branch (on-chain output forward + shortfall) and the 'across' branch (recipient
    // REBUILT = route) both prevent. Only the 'across' kind is a safe cross-chain delivery; refuse the rest. Cross-chain
    // CROSS-ASSET flows go through the composed route (local swap to a bridgeable asset + a same-asset 'across' bridge).
    if (!isLocal) {
      throw new CompactError(
        'BAD_REQUEST',
        'cross-chain swap-and-bridge is not signable: its delivery recipient cannot be verified. Use a same-asset bridge, or bridge same-asset then swap locally.'
      )
    }
    if (input.route.providerCallData === '0x') {
      throw new CompactError('BAD_REQUEST', 'swap provider calldata is empty')
    }
    provider = input.route.provider
    providerCallData = input.route.providerCallData
  }

  const swapProviders = SWAP_PROVIDER[Number(ctx.chainId) as keyof typeof SWAP_PROVIDER] as Record<string, Address> | undefined
  if (!swapProviders || !Object.values(swapProviders).some(p => isAddressEqual(getAddress(p), getAddress(provider)))) {
    throw new CompactContractError('Intent__ProviderNotAllowed', [getAddress(provider)])
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
  const derivedMaster = predictPuppetAccount(input.params)
  if (!isAddressEqual(derivedMaster, input.fundParams.master)) {
    throw new CompactContractError('Share__MasterMismatch', [derivedMaster, input.fundParams.master])
  }
  const swap = buildSwapParams(predictFundAccount(input.fundParams), ctx, input, true)

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
