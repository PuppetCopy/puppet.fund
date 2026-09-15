import type { IAccountLib__IntentHeader, ICoreGate__WithdrawIntent, ISwapLib__SwapParams } from '@puppet/contracts/types'
import { type Address, type Hex, isAddressEqual, type TypedDataDefinition } from 'viem'
import { CompactContractError, } from '../compact/error.js'
import { ADDRESS_ZERO, type ChainId } from '../const/index.js'
import type { ITokenRegistryMap } from '../state/tokenRegistry.js'
import type { IAcrossTiming } from './acrossDeposit.js'
import * as IntentLib from './intentLib.js'
import { intentTypedData } from './shared.js'
import { type IWithdrawRoute, resolveSwapRoute, routeProvider } from './swap.js'


export interface IWithdrawLegs {
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  outputAmount: bigint
  destinationChainId: bigint
  route: IWithdrawRoute
  fillDeadline: number
}

export interface IWithdrawInput extends IWithdrawLegs {
  header: IAccountLib__IntentHeader
}

export interface IWithdrawAttestContext {
  chainId: ChainId
  tokenRegistry: ITokenRegistryMap
  sourceBalance: bigint
  timing: IAcrossTiming
}

export function withdrawSwapParams(
  chainId: ChainId,
  account: Address,
  user: Address,
  legs: IWithdrawLegs,
  relayFee: bigint,
  timing: IAcrossTiming
): ISwapLib__SwapParams {
  let provider: Address = ADDRESS_ZERO
  let providerCallData: Hex = '0x'
  if (legs.route.kind !== 'transfer') {
    IntentLib.verifyRelayFeeRatio(relayFee, legs.inputAmount)
    providerCallData = resolveSwapRoute(account, user, {
      ...legs,
      timing,
      chainId,
      route: legs.route,
      netInputAmount: legs.inputAmount - relayFee
    })
    provider = routeProvider(chainId, legs.route)
  }
  return {
    inputToken: legs.inputToken,
    inputAmount: legs.inputAmount,
    outputToken: legs.outputToken,
    outputAmount: legs.outputAmount,
    provider,
    providerCallData
  }
}

export function verifyWithdrawLegs(
  ctx: IWithdrawAttestContext,
  swap: ISwapLib__SwapParams,
  destinationChainId: bigint,
  relayFee: bigint
): void {
  if (swap.inputAmount === 0n) throw new CompactContractError('Balance__NothingToWithdraw', [])
  if (ctx.sourceBalance < swap.inputAmount) {
    throw new CompactContractError('Balance__InsufficientBalance', [ctx.sourceBalance, swap.inputAmount])
  }

  if (isAddressEqual(swap.provider, ADDRESS_ZERO)) {
    if (
      destinationChainId !== BigInt(ctx.chainId) ||
      !isAddressEqual(swap.inputToken, swap.outputToken) ||
      swap.outputAmount !== swap.inputAmount - relayFee
    ) {
      throw new CompactContractError('Balance__InvalidWithdraw', [])
    }
    IntentLib.verifyRelayFeeRatio(relayFee, swap.inputAmount)
    return
  }

  if (swap.outputAmount === 0n) throw new CompactContractError('Balance__ZeroSwapOutput', [])
  IntentLib.verifyRelayFeeRatio(relayFee, swap.inputAmount)
  IntentLib.verifyRegisteredTokenCap(ctx.tokenRegistry, ctx.chainId, swap.inputToken, swap.inputAmount)
}

export function attestWithdrawIntent(
  ctx: IWithdrawAttestContext,
  input: IWithdrawInput
): { intent: ICoreGate__WithdrawIntent; typedData: TypedDataDefinition } {
  if (!isAddressEqual(input.header.feeToken, input.inputToken)) {
    throw new CompactContractError('Intent__FeeTokenMismatch', [input.header.feeToken, input.inputToken])
  }
  const account = input.header.account
  const intent: ICoreGate__WithdrawIntent = {
    header: input.header,
    swap: withdrawSwapParams(ctx.chainId, account, input.header.user, input, input.header.fee, ctx.timing),
    destinationChainId: input.destinationChainId
  }
  verifyWithdrawLegs(ctx, intent.swap, intent.destinationChainId, input.header.fee)

  return { intent, typedData: intentTypedData('withdraw', ctx.chainId, intent) }
}
