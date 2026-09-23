import { PROTOCOL } from '@puppet/contracts/const'
import type { IAccountLib__IntentHeader, IDeposit__SwapIntent } from '@puppet/contracts/types'
import { type Address, getAddress, isAddressEqual, type TypedDataDefinition } from 'viem'
import { CompactContractError, CompactError } from '../compact/error.js'
import { type ChainId, resolveDispatchChainId } from '../const/index.js'
import { wrappedNativeAddressOf } from '../state/tokenRegistry.js'
import type { IAcrossTiming } from './route/acrossDeposit.js'
import * as IntentLib from './intentLib.js'
import { type IDraftContext, type IGenesisContext, intentTypedData, verifyHeaderOrGenesis } from './shared.js'
import { buildSwapParams, type ISwapRoute } from './route/swap.js'

export interface IDepositSwapInput {
  header: IAccountLib__IntentHeader
  chainId: ChainId
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  outputAmount: bigint
  destinationChainId: bigint
  route: ISwapRoute
  fillDeadline: number
}

interface IDepositSwapAttestContext extends IDraftContext, IGenesisContext {
  balances: ReadonlyMap<Address, bigint>
  timing: IAcrossTiming
}

function heldOf(ctx: IDepositSwapAttestContext, token: Address): bigint {
  const wnt = wrappedNativeAddressOf(ctx.chainId)
  const atRoute = (held: Address): bigint => {
    const balance = ctx.balances.get(getAddress(held))
    if (balance === undefined) {
      throw new CompactError('BALANCE_UNREAD', `the route's ${held} balance was not read on chain ${ctx.chainId}`, 'soft')
    }
    return balance
  }
  return isAddressEqual(token, PROTOCOL.nativeToken) || isAddressEqual(token, wnt)
    ? atRoute(wnt) + atRoute(PROTOCOL.nativeToken)
    : atRoute(token)
}

export async function attestDepositSwap(
  ctx: IDepositSwapAttestContext,
  input: IDepositSwapInput
): Promise<{ intent: IDeposit__SwapIntent; typedData: TypedDataDefinition }> {
  await verifyHeaderOrGenesis(ctx, input.header, 'depositAcross')
  const inputToken = getAddress(input.inputToken)
  if (!isAddressEqual(input.header.feeToken, inputToken)) {
    throw new CompactContractError('Intent__FeeTokenMismatch', [input.header.feeToken, inputToken])
  }
  IntentLib.verifyRegisteredTokenCap(ctx.tokenRegistry, resolveDispatchChainId(Number(input.destinationChainId)), input.outputToken, 0n)

  const local = input.destinationChainId === BigInt(ctx.chainId)
  const wnt = wrappedNativeAddressOf(ctx.chainId)
  const fused = isAddressEqual(inputToken, PROTOCOL.nativeToken) || isAddressEqual(inputToken, wnt)
  if (local) {
    if (isAddressEqual(input.outputToken, inputToken)) throw new CompactContractError('Balance__InvalidDeposit', [])
    if (fused && (isAddressEqual(input.outputToken, PROTOCOL.nativeToken) || isAddressEqual(input.outputToken, wnt))) {
      throw new CompactContractError('Balance__InvalidDeposit', [])
    }
  }

  const route = getAddress(input.header.account)
  const swap = buildSwapParams(
    route,
    route,
    { ...ctx, sourceBalance: heldOf(ctx, inputToken) },
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
  const intent: IDeposit__SwapIntent = { header: input.header, swap, destinationChainId: input.destinationChainId }
  return { intent, typedData: intentTypedData('depositAcross', ctx.chainId, intent) }
}
