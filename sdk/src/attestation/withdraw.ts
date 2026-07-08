import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { HUB_GATE_INTENTS } from '@puppet/contracts/intents'
import type { IAccountLib__AccountInitParams, IHubGate__WithdrawIntent } from '@puppet/contracts/types'
import type { Address, Hex, TypedDataDefinition } from 'viem'
import { predictPuppetAccount, predictRoute } from '../account/index.js'
import { CompactContractError } from '../compact/error.js'
import { CompactError } from '../compact/index.js'
import { ADDRESS_ZERO } from '../const/common.js'
import type { ChainId } from '../const/index.js'
import { ACROSS_PERIPHERY, buildRouteAcrossDeposit } from './acrossDeposit.js'
import { verifyAcrossSwapAndBridge } from './acrossSwapAndBridge.js'
import * as IntentLib from './intentLib.js'
import { HUB_DOMAIN, type IDraftContext } from './shared.js'
import type { ISwapRoute } from './swap.js'
import { verifyOutputFloor, verifyQuoteFreshness } from './swapGuard.js'

// The fused Across swap-and-bridge (origin swap -> bridge -> optional destination swap, delivered to the user's
// wallet). WITHDRAW-ONLY: fund-side swaps must return value to the ACCOUNT, which this route structurally cannot
// guarantee, so ISwapRoute deliberately does not carry it.
export type IAcrossSwapRoute = { kind: 'acrossSwap'; providerCallData: Hex }

export type IWithdrawRoute = { kind: 'transfer' } | ISwapRoute | IAcrossSwapRoute

export interface IWithdrawInput {
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
  route: IWithdrawRoute
  expires: number
  fillDeadline: number
}

interface IWithdrawAttestContext extends IDraftContext {
  currentBlock: bigint
  signedBalance: bigint
  expectedOutputAmount: bigint | null
}

export function attestWithdrawIntent(ctx: IWithdrawAttestContext, input: IWithdrawInput) {
  if (BigInt(ctx.chainId) !== BigInt(HUB_CHAIN_ID)) {
    throw new CompactError('BAD_REQUEST', `withdraw runs on hub chain only; got ${ctx.chainId}`)
  }
  if (input.inputAmount === 0n) throw new CompactContractError('Balance__NothingToWithdraw', [])

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

  if (ctx.signedBalance < input.inputAmount) {
    throw new CompactContractError('Balance__InsufficientBalance', [ctx.signedBalance, input.inputAmount])
  }
  if (input.acceptableRelayFee >= input.inputAmount) throw new CompactContractError('Balance__RelayFeeTooHigh', [])

  let provider: Address = ADDRESS_ZERO
  let providerCallData: Hex = '0x'
  if (input.route.kind === 'transfer') {
    if (input.destinationChainId !== BigInt(HUB_CHAIN_ID)) {
      throw new CompactContractError('Balance__InvalidWithdraw', [])
    }
  } else {
    IntentLib.verifyTokenAndCap(ctx.tokenRegistry, Number(input.destinationChainId) as ChainId, input.outputToken, 0n)
    const outputToken = input.outputToken
    verifyQuoteFreshness(input.expires, input.fillDeadline)
    verifyOutputFloor(input.outputAmount, ctx.expectedOutputAmount)
    if (input.route.kind === 'across') {
      const account = predictPuppetAccount(input.params)
      const built = buildRouteAcrossDeposit({
        originChainId: Number(input.chainId),
        depositor: predictRoute(account),
        recipient: input.params.user,
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
    } else if (input.route.kind === 'acrossSwap') {
      // Cross-asset cross-chain delivery to the WALLET: field-pinned rather than rebuilt — every structurally
      // decodable field (refund depositor, canonical SpokePool, destination, amounts, recipient/fallback/drains)
      // must match the intent; the route internals (exchange + router calldata) carry the same user-signed trust
      // as a local swap's opaque calldata and stay bounded by the relay's oracle value screen.
      verifyAcrossSwapAndBridge(
        {
          originChainId: Number(input.chainId),
          user: input.params.user,
          inputToken,
          inputAmount: input.inputAmount,
          acceptableRelayFee: input.acceptableRelayFee,
          outputToken,
          destinationChainId: input.destinationChainId,
          fillDeadline: input.fillDeadline
        },
        input.route.providerCallData
      )
      provider = ACROSS_PERIPHERY
      providerCallData = input.route.providerCallData
    } else {
      // Only a LOCAL swap-and-deliver is signable through opaque provider calldata: HubGate.withdraw forwards its
      // output on-chain to the pinned receiver (the synchronous shortfall floor). A 'swap' whose destination is off-hub
      // delivers through provider calldata whose recipient the co-signer cannot verify, the exact escalation
      // buildSwapParams refuses. Same-asset cross-chain withdraws take the 'across' branch above (recipient REBUILT =
      // the user).
      if (input.destinationChainId !== BigInt(HUB_CHAIN_ID)) {
        throw new CompactError(
          'BAD_REQUEST',
          'cross-chain swap-and-bridge withdraw is not signable: its delivery recipient cannot be verified. Use a same-asset bridge.'
        )
      }
      if (input.route.providerCallData === '0x') {
        throw new CompactError('BAD_REQUEST', 'swap provider calldata is empty')
      }
      provider = input.route.provider
      providerCallData = input.route.providerCallData
    }
  }

  const intent: IHubGate__WithdrawIntent = {
    params: input.params,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: input.chainId,
    inputToken: input.inputToken,
    outputToken: input.outputToken,
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
    ...HUB_GATE_INTENTS.withdraw,
    message: intent as unknown as Record<string, unknown>
  }
  return { intent, typedData, args: [intent] }
}
