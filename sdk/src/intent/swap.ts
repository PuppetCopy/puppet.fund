import { CHAIN_IDS, PROTOCOL } from '@puppet/contracts/const'
import type { IAccountLib__IntentHeader, ISwapLib__SwapParams } from '@puppet/contracts/types'
import { type Address, getAddress, type Hex, isAddressEqual, size, } from 'viem'
import { predictDepositRoute } from '../account/createAccount.js'
import { CompactContractError } from '../compact/error.js'
import { CompactError } from '../compact/index.js'
import type { ChainId } from '../const/index.js'
import { providerToken } from '../state/tokenRegistry.js'
import type { IAcrossTiming } from './acrossDeposit.js'
import {
  ACROSS_DEPOSIT_BYTES,
  ACROSS_PERIPHERY,
  acrossQuoteExpiry,
  acrossSpokePoolOf,
  buildAcrossDeposit,
  type IAcrossRouteFields,
  verifyAcrossTiming
} from './acrossDeposit.js'
import { decodeAcrossSwapAndBridge, verifyAcrossSwapAndBridge } from './acrossSwapAndBridge.js'
import * as IntentLib from './intentLib.js'
import { verifyLifiSwap } from './lifiSwap.js'
import type { IDraftContext, } from './shared.js'

export type ISwapRoute =
  | ({ kind: 'across' } & IAcrossRouteFields)
  | { kind: 'swap'; provider: Address; providerCallData: Hex }
  | { kind: 'acrossSwap'; providerCallData: Hex }

export type IWithdrawRoute = { kind: 'transfer' } | ISwapRoute

export function routeQuoteExpiry(route: IWithdrawRoute, timing: IAcrossTiming): number | null {
  if (route.kind === 'across') return acrossQuoteExpiry(timing, route.quoteTimestamp)
  if (route.kind === 'acrossSwap') {
    const decoded = decodeAcrossSwapAndBridge(route.providerCallData)
    return decoded === null ? null : acrossQuoteExpiry(timing, decoded.quoteTimestamp)
  }
  return null
}

export const routeCalldataBytes = (route: IWithdrawRoute): bigint => {
  if (route.kind === 'transfer') return 0n
  if (route.kind === 'across') return ACROSS_DEPOSIT_BYTES
  return BigInt(size(route.providerCallData))
}

export interface ISwapCommon {
  header: IAccountLib__IntentHeader
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  outputAmount: bigint
  destinationChainId: bigint
  route: ISwapRoute
  fillDeadline: number
}

export interface ISwapAttestContext extends IDraftContext {
  sourceBalance: bigint
  timing: IAcrossTiming
}

export interface IRouteBounds {
  inputToken: Address
  outputToken: Address
  netInputAmount: bigint
  outputAmount: bigint
  chainId: ChainId
  destinationChainId: bigint
  route: ISwapRoute
  fillDeadline: number
  timing: IAcrossTiming
}

export function routeProvider(chainId: ChainId, route: ISwapRoute): Address {
  if (route.kind === 'across') return acrossSpokePoolOf(chainId)
  if (route.kind === 'acrossSwap') return ACROSS_PERIPHERY
  return getAddress(route.provider)
}

export function resolveSwapRoute(account: Address, recipient: Address, input: IRouteBounds): Hex {
  const isLocal = input.destinationChainId === BigInt(input.chainId)
  if (isLocal) {
    if (input.route.kind !== 'swap') {
      throw new CompactError('BAD_REQUEST', `local swap must use a DEX route, got ${input.route.kind}`, 'hard')
    }
  } else if (!(CHAIN_IDS as readonly number[]).includes(Number(input.destinationChainId))) {
    throw new CompactError('BAD_REQUEST', `unsupported destination chain ${input.destinationChainId}`, 'hard')
  }

  const inputToken = getAddress(input.inputToken)
  if (isAddressEqual(inputToken, PROTOCOL.nativeToken) && !isLocal) {
    throw new CompactError('BAD_REQUEST', 'cross-chain swaps from native are not supported; swap to a base token first')
  }

  if (input.route.kind === 'across') {
    const exclusive = getAddress(input.route.exclusiveRelayer)
    if (isAddressEqual(exclusive, account) || isAddressEqual(exclusive, recipient)) {
      throw new CompactError(
        'BAD_REQUEST',
        `bridge deposit names ${exclusive} as exclusive filler, which is a party to this intent; the signer cannot be the guaranteed counterparty to their own bridge`
      )
    }
    verifyAcrossTiming(input.timing, input.route.quoteTimestamp, input.fillDeadline)
    return buildAcrossDeposit({
      depositor: account,
      recipient,
      inputToken,
      outputToken: input.outputToken,
      inputAmount: input.netInputAmount,
      outputAmount: input.outputAmount,
      destinationChainId: input.destinationChainId,
      exclusiveRelayer: input.route.exclusiveRelayer,
      quoteTimestamp: input.route.quoteTimestamp,
      fillDeadline: input.fillDeadline,
      exclusivityParameter: input.route.exclusivityParameter
    })
  } else if (input.route.kind === 'acrossSwap') {
    verifyAcrossSwapAndBridge(
      {
        originChainId: input.chainId,
        depositor: account,
        recipient,
        inputToken,
        inputAmount: input.netInputAmount,
        outputToken: input.outputToken,
        outputAmount: input.outputAmount,
        destinationChainId: input.destinationChainId,
        timing: input.timing
      },
      input.route.providerCallData
    )
    return input.route.providerCallData
  } else {
    if (!isLocal) {
      throw new CompactError(
        'BAD_REQUEST',
        'cross-chain swap-and-bridge is not signable: its delivery recipient cannot be verified. Use a same-asset bridge, or bridge same-asset then swap locally.'
      )
    }
    if (input.route.providerCallData === '0x') {
      throw new CompactError('BAD_REQUEST', 'swap provider calldata is empty')
    }
    verifyLifiSwap(
      recipient,
      input.route.providerCallData,
      providerToken(inputToken, input.chainId),
      input.netInputAmount,
      input.outputToken,
      input.outputAmount
    )
    return input.route.providerCallData
  }
}

export function buildSwapParams(
  account: Address,
  ctx: ISwapAttestContext,
  input: ISwapCommon
): ISwapLib__SwapParams {
  if (input.header.fee > 0n && !isAddressEqual(input.header.feeToken, input.inputToken)) {
    throw new CompactContractError('Intent__FeeTokenMismatch', [input.header.feeToken, input.inputToken])
  }
  if (input.inputAmount === 0n) throw new CompactContractError('Balance__NothingToSwap', [])
  if (input.outputAmount === 0n) throw new CompactContractError('Balance__ZeroSwapOutput', [])
  IntentLib.verifyRelayFeeRatio(input.header.fee, input.inputAmount)

  const local = input.destinationChainId === BigInt(ctx.chainId)
  const providerCallData = resolveSwapRoute(account, predictDepositRoute(input.header.user), {
    ...input,
    timing: ctx.timing,
    chainId: ctx.chainId,
    netInputAmount: input.inputAmount - input.header.fee
  })
  const provider = routeProvider(ctx.chainId, input.route)
  IntentLib.verifyRegisteredTokenCap(ctx.tokenRegistry, ctx.chainId, input.inputToken, input.inputAmount)

  if (ctx.sourceBalance < input.inputAmount) {
    throw new CompactContractError('Balance__InsufficientBalance', [ctx.sourceBalance, input.inputAmount])
  }

  if (local) {
    const destChainId = Number(input.destinationChainId) as ChainId
    IntentLib.verifyRegisteredTokenCap(ctx.tokenRegistry, destChainId, input.outputToken, input.outputAmount)
  }

  return {
    inputToken: input.inputToken,
    inputAmount: input.inputAmount,
    outputToken: input.outputToken,
    outputAmount: input.outputAmount,
    provider,
    providerCallData
  }
}
