import { CHAIN_IDS, PROTOCOL } from '@puppet/contracts/const'
import type { IAccountLib__IntentHeader, ISwapLib__SwapParams } from '@puppet/contracts/types'
import { type Address, encodeFunctionData, getAddress, type Hex, isAddressEqual, parseAbi, size } from 'viem'
import { CompactContractError } from '../../compact/error.js'
import { CompactError } from '../../compact/index.js'
import type { ChainId } from '../../const/index.js'
import { SWAP_PROVIDER } from '../../const/network.js'
import { providerToken, wrappedNativeAddressOf } from '../../state/tokenRegistry.js'
import * as IntentLib from '../intentLib.js'
import type { IDraftContext, } from '../shared.js'
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
import { verifyKyberSwap } from './kyberSwap.js'
import { verifyLifiSwap } from './lifiSwap.js'
import { verifyRelaySwap } from './relaySwap.js'

export type ISwapRoute =
  | ({ kind: 'across' } & IAcrossRouteFields)
  | { kind: 'swap'; provider: Address; providerCallData: Hex }
  | { kind: 'acrossSwap'; providerCallData: Hex }

export type IWithdrawRoute = { kind: 'transfer' } | ISwapRoute

export const routeSwaps = (route: IWithdrawRoute): boolean => route.kind === 'swap' || route.kind === 'acrossSwap'

const WRAPPED_NATIVE_ABI = parseAbi(['function deposit() payable', 'function withdraw(uint256 wad)'])

export const wrapCallData = (chainId: ChainId, inputToken: Address, outputToken: Address, amount: bigint): Hex | null => {
  const wrapped = wrappedNativeAddressOf(chainId)
  if (isAddressEqual(inputToken, PROTOCOL.nativeToken) && isAddressEqual(outputToken, wrapped)) return encodeFunctionData({ abi: WRAPPED_NATIVE_ABI, functionName: 'deposit' })
  if (isAddressEqual(inputToken, wrapped) && isAddressEqual(outputToken, PROTOCOL.nativeToken)) {
    return encodeFunctionData({ abi: WRAPPED_NATIVE_ABI, functionName: 'withdraw', args: [amount] })
  }
  return null
}

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

interface ISwapCommon {
  header: IAccountLib__IntentHeader
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  outputAmount: bigint
  destinationChainId: bigint
  route: ISwapRoute
  fillDeadline: number
}

interface ISwapAttestContext extends IDraftContext {
  timing: IAcrossTiming
}

interface IRouteBounds {
  inputToken: Address
  outputToken: Address
  netInputAmount: bigint
  outputAmount: bigint
  chainId: ChainId
  destinationChainId: bigint
  route: ISwapRoute
  fillDeadline: number
  timing: IAcrossTiming
  mineableUntil: bigint
}

export function routeProvider(chainId: ChainId, route: ISwapRoute): Address {
  if (route.kind === 'across') return acrossSpokePoolOf(chainId)
  if (route.kind === 'acrossSwap') {
    const decoded = decodeAcrossSwapAndBridge(route.providerCallData)
    if (decoded === null) throw new CompactError('BAD_REQUEST', 'the across swap route calldata matches none of the swapAndBridge, depositNative or SpokePool deposit shapes', 'hard')
    return decoded.origin.kind === 'deposit' ? acrossSpokePoolOf(chainId) : ACROSS_PERIPHERY
  }
  const provider = getAddress(route.provider)
  if (isAddressEqual(provider, wrappedNativeAddressOf(chainId))) return provider
  const declared = SWAP_PROVIDER[chainId as keyof typeof SWAP_PROVIDER] as Record<string, Address> | undefined
  if (declared === undefined) {
    throw new CompactError('BAD_REQUEST', `chain ${chainId} declares no swap provider`, 'hard')
  }
  const allowed = Object.values(declared)
  if (!allowed.some(address => isAddressEqual(address, provider))) {
    throw new CompactError(
      'BAD_REQUEST',
      `swap provider ${provider} is not declared for chain ${chainId}; declared: ${allowed.join(', ')}`,
      'hard'
    )
  }
  return provider
}

export function resolveSwapRoute(depositor: Address, recipient: Address, input: IRouteBounds): Hex {
  const isLocal = input.destinationChainId === BigInt(input.chainId)
  if (isLocal) {
    if (input.route.kind !== 'swap') {
      throw new CompactError('BAD_REQUEST', `local swap must use a DEX route, got ${input.route.kind}`, 'hard')
    }
  } else if (!(CHAIN_IDS as readonly number[]).includes(Number(input.destinationChainId))) {
    throw new CompactError('BAD_REQUEST', `unsupported destination chain ${input.destinationChainId}`, 'hard')
  }

  const inputToken = getAddress(input.inputToken)

  if (input.route.kind === 'across') {
    const exclusive = getAddress(input.route.exclusiveRelayer)
    if (isAddressEqual(exclusive, depositor) || isAddressEqual(exclusive, recipient)) {
      throw new CompactError(
        'BAD_REQUEST',
        `bridge deposit names ${exclusive} as exclusive filler, which is a party to this intent; the signer cannot be the guaranteed counterparty to their own bridge`
      )
    }
    verifyAcrossTiming(input.timing, input.route.quoteTimestamp, input.fillDeadline, input.mineableUntil)
    return buildAcrossDeposit({
      depositor,
      recipient,
      inputToken: providerToken(inputToken, input.chainId),
      outputToken: providerToken(input.outputToken, Number(input.destinationChainId)),
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
        depositor,
        recipient,
        inputToken,
        inputAmount: input.netInputAmount,
        outputToken: input.outputToken,
        outputAmount: input.outputAmount,
        destinationChainId: input.destinationChainId,
        timing: input.timing,
        mineableUntil: input.mineableUntil
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
    if (isAddressEqual(input.route.provider, wrappedNativeAddressOf(input.chainId))) {
      const expected = wrapCallData(input.chainId, inputToken, input.outputToken, input.netInputAmount)
      if (
        !isAddressEqual(depositor, recipient) ||
        expected === null ||
        input.route.providerCallData.toLowerCase() !== expected.toLowerCase() ||
        input.outputAmount > input.netInputAmount
      ) {
        throw new CompactError('BAD_REQUEST', `the wrapped native contract only wraps or unwraps exactly ${input.netInputAmount} into the account itself`, 'hard')
      }
      return expected
    }
    if (input.route.providerCallData === '0x') {
      throw new CompactError('BAD_REQUEST', 'swap provider calldata is empty')
    }
    const declared = SWAP_PROVIDER[input.chainId as keyof typeof SWAP_PROVIDER] as { lifiDiamond?: Address; relayApprovalProxy?: Address; kyberswap?: Address } | undefined
    const provider = input.route.provider
    if (declared?.relayApprovalProxy !== undefined && isAddressEqual(provider, declared.relayApprovalProxy)) {
      verifyRelaySwap(recipient, input.route.providerCallData, inputToken, input.netInputAmount, input.outputToken)
    } else if (declared?.lifiDiamond !== undefined && isAddressEqual(provider, declared.lifiDiamond)) {
      verifyLifiSwap(input.chainId, recipient, input.route.providerCallData, inputToken, input.netInputAmount, input.outputToken, input.outputAmount)
    } else if (declared?.kyberswap !== undefined && isAddressEqual(provider, declared.kyberswap)) {
      verifyKyberSwap(recipient, input.route.providerCallData, inputToken, input.netInputAmount, input.outputToken, input.outputAmount)
    } else {
      throw new CompactError('BAD_REQUEST', `swap provider ${provider} has no calldata decoder on chain ${input.chainId}, so its route cannot be screened`, 'hard')
    }
    return input.route.providerCallData
  }
}

export function verifySwap(fee: bigint, inputAmount: bigint, outputAmount: bigint): void {
  if (inputAmount === 0n) throw new CompactContractError('Balance__NothingToSwap', [])
  if (outputAmount === 0n) throw new CompactContractError('Balance__ZeroSwapOutput', [])
  IntentLib.verifyRelayFeeRatio(fee, inputAmount, PROTOCOL.maxSwapRelayFeeBps)
}

export function buildSwapParams(
  depositor: Address,
  recipient: Address,
  ctx: ISwapAttestContext,
  input: ISwapCommon
): ISwapLib__SwapParams {
  const providerCallData = resolveSwapRoute(depositor, recipient, {
    ...input,
    timing: ctx.timing,
    mineableUntil: input.header.deadline,
    chainId: ctx.chainId,
    netInputAmount: input.inputAmount - input.header.fee
  })
  const provider = routeProvider(ctx.chainId, input.route)

  return {
    inputToken: input.inputToken,
    inputAmount: input.inputAmount,
    outputToken: input.outputToken,
    outputAmount: input.outputAmount,
    provider,
    providerCallData
  }
}
