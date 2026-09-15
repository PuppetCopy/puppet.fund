import { PROTOCOL } from '@puppet/contracts/const'
import type { IAccountLib__IntentHeader, IDeposit__DepositSwap } from '@puppet/contracts/types'
import { type Address, getAddress, isAddressEqual, type TypedDataDefinition } from 'viem'
import { CompactContractError, CompactError } from '../compact/error.js'
import { type ChainId, resolveDispatchChainId } from '../const/index.js'
import { wrappedNativeAddressOf } from '../state/tokenRegistry.js'
import type { IAcrossTiming } from './acrossDeposit.js'
import { type IDepositCredit, verifyClaimWindow } from './credit.js'
import * as IntentLib from './intentLib.js'
import { type IDraftContext, intentTypedData } from './shared.js'
import { buildSwapParams, type ISwapRoute } from './swap.js'

export interface IDepositSwapInput {
  header: IAccountLib__IntentHeader
  chainId: ChainId
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  outputAmount: bigint
  destinationChainId: bigint
  credit: IDepositCredit
  route: ISwapRoute
  fillDeadline: number
}

export interface IDepositSwapAttestContext extends IDraftContext {
  routeBalances: ReadonlyMap<Address, bigint>
  timing: IAcrossTiming
}

export function routeHolding(ctx: IDepositSwapAttestContext, token: Address): bigint {
  const wnt = wrappedNativeAddressOf(ctx.chainId)
  const atRoute = (held: Address): bigint => {
    const balance = ctx.routeBalances.get(getAddress(held))
    if (balance === undefined) {
      throw new CompactError('BALANCE_UNREAD', `the route's ${held} balance was not read on chain ${ctx.chainId}`, 'soft')
    }
    return balance
  }
  return isAddressEqual(token, PROTOCOL.nativeToken) || isAddressEqual(token, wnt)
    ? atRoute(wnt) + atRoute(PROTOCOL.nativeToken)
    : atRoute(token)
}

export function attestDepositSwap(
  ctx: IDepositSwapAttestContext,
  input: IDepositSwapInput
): { intent: IDeposit__DepositSwap; typedData: TypedDataDefinition } {
  const account = input.header.account
  const inputToken = getAddress(input.inputToken)
  if (!isAddressEqual(input.header.feeToken, inputToken)) {
    throw new CompactContractError('Intent__FeeTokenMismatch', [input.header.feeToken, inputToken])
  }
  const { claim } = input.credit
  if (!isAddressEqual(claim.token, input.outputToken) || claim.amount !== input.outputAmount) {
    throw new CompactError('CLAIM_MISMATCH', `the destination claim names ${claim.amount} ${claim.token}; the swap delivers ${input.outputAmount} ${input.outputToken}`, 'hard')
  }
  verifyClaimWindow(claim, account)
  IntentLib.verifyRegisteredTokenCap(ctx.tokenRegistry, resolveDispatchChainId(Number(input.destinationChainId)), claim.token, 0n)

  const local = input.destinationChainId === BigInt(ctx.chainId)
  const wnt = wrappedNativeAddressOf(ctx.chainId)
  const fused = isAddressEqual(inputToken, PROTOCOL.nativeToken) || isAddressEqual(inputToken, wnt)
  if (local) {
    if (isAddressEqual(input.outputToken, inputToken)) throw new CompactContractError('Balance__InvalidDeposit', [])
    if (fused && (isAddressEqual(input.outputToken, PROTOCOL.nativeToken) || isAddressEqual(input.outputToken, wnt))) {
      throw new CompactContractError('Balance__InvalidDeposit', [])
    }
  }

  const swap = buildSwapParams(
    account,
    { ...ctx, sourceBalance: routeHolding(ctx, inputToken) },
    {
      header: input.header,
      inputToken,
      outputToken: input.outputToken,
      inputAmount: input.inputAmount,
      outputAmount: input.outputAmount,
      destinationChainId: input.destinationChainId,
      route: input.route,
      fillDeadline: input.fillDeadline
    }
  )
  const intent: IDeposit__DepositSwap = { header: input.header, swap, destinationChainId: input.destinationChainId }
  return { intent, typedData: intentTypedData('depositAcross', ctx.chainId, intent) }
}
