import type { IAccountLib__IntentHeader, IDeposit__SwapIntent } from '@puppet/contracts/types'
import { type Address, getAddress, isAddressEqual, type TypedDataDefinition } from 'viem'
import { predictUserAccount } from '../account/createAccount.js'
import { CompactContractError, CompactError } from '../compact/error.js'
import { resolveDispatchChainId } from '../const/index.js'
import { verifyExitable } from '../evaluate/unlisted.js'
import type { IAcrossTiming } from './route/acrossDeposit.js'
import { buildSwapParams, type ISwapRoute, verifySwap } from './route/swap.js'
import { verifyPricedDeadline } from './intentLib.js'
import { type IDraftContext, type IGenesisContext, intentTypedData, verifyHeaderOrGenesis } from './shared.js'

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

interface IFundSwapAttestContext extends IDraftContext, IGenesisContext {
  balance: bigint
  timing: IAcrossTiming
}

export async function attestFundSwapIntent(
  ctx: IFundSwapAttestContext,
  input: IFundSwapInput
): Promise<{ intent: IDeposit__SwapIntent; typedData: TypedDataDefinition }> {
  const account = getAddress(input.header.account)
  if (isAddressEqual(account, predictUserAccount(input.header.user))) throw new CompactContractError('Account__NotDelegated', [account])
  await verifyHeaderOrGenesis(ctx, input.header, 'fundSwap')
  verifyPricedDeadline(input.header.deadline, ctx.now)
  const inputToken = getAddress(input.inputToken)
  if (!isAddressEqual(input.header.feeToken, inputToken)) {
    throw new CompactContractError('Intent__FeeTokenMismatch', [input.header.feeToken, inputToken])
  }
  verifySwap(input.header.fee, input.inputAmount, input.outputAmount)
  const destinationChainId = resolveDispatchChainId(Number(input.destinationChainId))
  if (destinationChainId === ctx.chainId && isAddressEqual(input.outputToken, inputToken)) throw new CompactContractError('Balance__InvalidSwap', [])
  if (input.inputAmount > ctx.balance) {
    throw new CompactError('BALANCE_SHORT', `${account} holds ${ctx.balance} of ${inputToken} on chain ${ctx.chainId}, short of the ${input.inputAmount} the swap spends`, 'hard')
  }
  verifyExitable(destinationChainId, input.outputToken)
  const swap = buildSwapParams(account, account, ctx, { ...input, inputToken })
  const intent: IDeposit__SwapIntent = { header: input.header, swap, destinationChainId: input.destinationChainId }
  return { intent, typedData: intentTypedData('fundSwap', ctx.chainId, intent) }
}
