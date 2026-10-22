import { PROTOCOL } from '@puppet/contracts/const'
import type { IAccountLib__IntentHeader, IDeposit__SwapIntent } from '@puppet/contracts/types'
import { type Address, getAddress, isAddressEqual, type TypedDataDefinition } from 'viem'
import { predictUserAccount } from '../account/createAccount.js'
import { CompactContractError, CompactError } from '../compact/error.js'
import { CHAIN_TOKEN_MAP, type ChainId, resolveDispatchChainId } from '../const/index.js'
import { tokenKeyOf, tokenMetaByChainToken, tokenMetaKey, wrappedNativeAddressOf } from '../state/tokenRegistry.js'
import type { IAcrossTiming } from './route/acrossDeposit.js'
import { verifyPricedDeadline } from './intentLib.js'
import { buildSwapParams, type ISwapRoute, routeSwaps, verifySwap } from './route/swap.js'
import { type IDraftContext, type IGenesisContext, intentTypedData, verifyHeaderOrGenesis } from './shared.js'

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
  if (!isAddressEqual(predictUserAccount(input.header.user), input.header.account)) {
    throw new CompactContractError('Account__HeaderMismatch', [input.header.account])
  }
  await verifyHeaderOrGenesis(ctx, input.header, 'depositAcross')
  if (routeSwaps(input.route)) verifyPricedDeadline(input.header.deadline, ctx.now)
  const inputToken = getAddress(input.inputToken)
  if (!isAddressEqual(input.header.feeToken, inputToken)) {
    throw new CompactContractError('Intent__FeeTokenMismatch', [input.header.feeToken, inputToken])
  }
  verifySwap(input.header.fee, input.inputAmount, input.outputAmount)
  const local = input.destinationChainId === BigInt(ctx.chainId)
  const destination = resolveDispatchChainId(Number(input.destinationChainId))
  if (!tokenMetaByChainToken.has(tokenMetaKey(destination, input.outputToken))) {
    throw new CompactError(
      'ASSET_NOT_EXITABLE',
      `${input.outputToken} is not a registered token on chain ${destination}; your account moves a token out only by paying the relay fee in it, so it may acquire registered tokens only`,
      'hard'
    )
  }
  if (!local && (CHAIN_TOKEN_MAP[ctx.chainId] as Record<string, string>)[tokenKeyOf(destination, input.outputToken)] === undefined) {
    throw new CompactError(
      'CROSS_CHAIN_ASSET_MISMATCH',
      `chain ${ctx.chainId} lists no twin of ${input.outputToken} on chain ${destination}, so the deposit's arrival could not be booked`,
      'hard'
    )
  }
  const wnt = wrappedNativeAddressOf(ctx.chainId)
  const fused = isAddressEqual(inputToken, PROTOCOL.nativeToken) || isAddressEqual(inputToken, wnt)
  if (local) {
    if (isAddressEqual(input.outputToken, inputToken)) throw new CompactContractError('Balance__InvalidDeposit', [])
    if (fused && (isAddressEqual(input.outputToken, PROTOCOL.nativeToken) || isAddressEqual(input.outputToken, wnt))) {
      throw new CompactContractError('Balance__InvalidDeposit', [])
    }
  }
  const held = heldOf(ctx, inputToken)
  if (held < input.inputAmount) throw new CompactContractError('Balance__InsufficientBalance', [held, input.inputAmount])

  const route = getAddress(input.header.account)
  const swap = buildSwapParams(
    route,
    route,
    ctx,
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
