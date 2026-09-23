import type { IAccountLib__IntentHeader, IDeposit__SwapIntent } from '@puppet/contracts/types'
import { type Address, getAddress, isAddressEqual, type TypedDataDefinition } from 'viem'
import { CompactContractError } from '../compact/error.js'
import { resolveDispatchChainId } from '../const/index.js'
import type { IAcrossTiming } from './route/acrossDeposit.js'
import * as IntentLib from './intentLib.js'
import { type IDraftContext, type IHeaderContext, intentTypedData, verifyHeader } from './shared.js'
import { buildSwapParams, type ISwapRoute } from './route/swap.js'

export interface IFundSwapInput {
  header: IAccountLib__IntentHeader
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  outputAmount: bigint
  destinationChainId: bigint
  route: ISwapRoute
  fillDeadline: number
}

interface IFundSwapAttestContext extends IDraftContext, IHeaderContext {
  balance: bigint
  timing: IAcrossTiming
}

export function attestFundSwapIntent(
  ctx: IFundSwapAttestContext,
  input: IFundSwapInput
): { intent: IDeposit__SwapIntent; typedData: TypedDataDefinition } {
  verifyHeader(ctx, input.header)
  const account = getAddress(input.header.account)
  const inputToken = getAddress(input.inputToken)
  if (!isAddressEqual(input.header.feeToken, inputToken)) {
    throw new CompactContractError('Intent__FeeTokenMismatch', [input.header.feeToken, inputToken])
  }
  const destinationChainId = resolveDispatchChainId(Number(input.destinationChainId))
  if (destinationChainId === ctx.chainId) {
    if (isAddressEqual(input.outputToken, inputToken)) throw new CompactContractError('Balance__InvalidSwap', [])
    IntentLib.verifyRegisteredTokenCap(ctx.tokenRegistry, ctx.chainId, input.outputToken, input.outputAmount)
  }
  if (input.inputAmount > ctx.balance) throw new CompactContractError('Balance__InsufficientFund', [inputToken, ctx.balance, input.inputAmount])
  const swap = buildSwapParams(account, account, { ...ctx, sourceBalance: ctx.balance }, { ...input, inputToken })
  const intent: IDeposit__SwapIntent = { header: input.header, swap, destinationChainId: input.destinationChainId }
  return { intent, typedData: intentTypedData('fundSwap', ctx.chainId, intent) }
}
