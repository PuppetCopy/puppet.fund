import { PROTOCOL } from '@puppet/contracts/const'
import type { IAccountLib__IntentHeader, IDeposit__SwapIntent, ISwapLib__SwapParams } from '@puppet/contracts/types'
import { type Address, type Hex, isAddressEqual, type TypedDataDefinition } from 'viem'
import { predictUserAccount } from '../account/createAccount.js'
import { CompactContractError } from '../compact/error.js'
import { ADDRESS_ZERO, type ChainId } from '../const/index.js'
import * as IntentLib from './intentLib.js'
import type { IAcrossTiming } from './route/acrossDeposit.js'
import { type IWithdrawRoute, resolveSwapRoute, routeProvider, routeSwaps, verifySwap } from './route/swap.js'
import { type IGenesisContext, intentTypedData, verifyHeaderOrGenesis } from './shared.js'


interface IWithdrawLegs {
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

interface IWithdrawAttestContext extends IGenesisContext {
  chainId: ChainId
  balance: bigint
  timing: IAcrossTiming
}

function withdrawSwapParams(
  chainId: ChainId,
  user: Address,
  legs: IWithdrawLegs,
  relayFee: bigint,
  timing: IAcrossTiming,
  mineableUntil: bigint
): ISwapLib__SwapParams {
  let provider: Address = ADDRESS_ZERO
  let providerCallData: Hex = '0x'
  if (legs.route.kind !== 'transfer') {
    providerCallData = resolveSwapRoute(predictUserAccount(user), user, {
      ...legs,
      timing,
      mineableUntil,
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

function verifyWithdrawLegs(ctx: IWithdrawAttestContext, legs: IWithdrawLegs, relayFee: bigint): void {
  if (legs.inputAmount === 0n) throw new CompactContractError('Balance__NothingToWithdraw', [])
  if (ctx.balance < legs.inputAmount) {
    throw new CompactContractError('Balance__InsufficientBalance', [ctx.balance, legs.inputAmount])
  }
  if (legs.route.kind !== 'transfer') {
    verifySwap(relayFee, legs.inputAmount, legs.outputAmount)
    return
  }
  IntentLib.verifyRelayFeeRatio(relayFee, legs.inputAmount, PROTOCOL.maxRelayFeeBps)
  if (legs.destinationChainId !== BigInt(ctx.chainId) || !isAddressEqual(legs.inputToken, legs.outputToken) || legs.outputAmount !== legs.inputAmount - relayFee) {
    throw new CompactContractError('Balance__InvalidWithdraw', [])
  }
}

export async function attestWithdrawIntent(
  ctx: IWithdrawAttestContext,
  input: IWithdrawInput
): Promise<{ intent: IDeposit__SwapIntent; typedData: TypedDataDefinition }> {
  if (!isAddressEqual(predictUserAccount(input.header.user), input.header.account)) {
    throw new CompactContractError('Account__HeaderMismatch', [input.header.account])
  }
  await verifyHeaderOrGenesis(ctx, input.header, 'withdraw')
  if (routeSwaps(input.route)) IntentLib.verifyPricedDeadline(input.header.deadline, ctx.now)
  if (!isAddressEqual(input.header.feeToken, input.inputToken)) {
    throw new CompactContractError('Intent__FeeTokenMismatch', [input.header.feeToken, input.inputToken])
  }
  verifyWithdrawLegs(ctx, input, input.header.fee)
  const intent: IDeposit__SwapIntent = {
    header: input.header,
    swap: withdrawSwapParams(ctx.chainId, input.header.user, input, input.header.fee, ctx.timing, input.header.deadline),
    destinationChainId: input.destinationChainId
  }

  return { intent, typedData: intentTypedData('withdraw', ctx.chainId, intent) }
}
