import { PROTOCOL } from '@puppet/contracts/const'
import type { ISpokeGate__OperateIntent } from '@puppet/contracts/types'
import { type Address, getAddress, isAddressEqual, type PublicClient, type TypedDataDefinition } from 'viem'
import { predictUserAccount } from '../account/createAccount.js'
import { CompactContractError, CompactError } from '../compact/error.js'
import { PRECISION } from '../const/common.js'
import { deploymentAddress } from '../const/deployments.js'
import { type ChainId, chainNameOf, TOKEN_META } from '../const/index.js'
import { readableTokenAmountLabel } from '../core/readable.js'
import { getTokenDescription } from '../core/token.js'
import { DEFAULT_EVALUATION_CONFIG, type IGetRate } from '../evaluate/types.js'
import { wethValueOf } from '../evaluate/unlisted.js'
import { listedTokensOf } from '../state/tokenRegistry.js'
import { decodeErc20 } from '../venue/erc20.js'
import { assertOperateSignable, operateExchange, operateOutflows, resolveOperate, screenOperate } from '../venue/screen.js'
import { leftGrantsOf, mayStand, SAMPLEABLE_ALLOWANCE, VENUES } from '../venue/venues.js'
import * as IntentLib from './intentLib.js'
import { type IDraftContext, type IGenesisContext, intentTypedData, verifyHeaderOrGenesis } from './shared.js'
import { clientOf } from './terms.js'

interface IOperateAttestContext extends IDraftContext, IGenesisContext {
  clients: Readonly<Record<number, PublicClient>>
  blockNumber: bigint
  getRate: IGetRate
  balances: ReadonlyMap<Address, bigint>
}

function outflowsOf(account: Address, callList: ISpokeGate__OperateIntent['callList']): Map<Address, bigint> {
  const totals = new Map<Address, bigint>()
  for (const outflow of operateOutflows(account, callList)) {
    const token = getAddress(outflow.token)
    totals.set(token, (totals.get(token) ?? 0n) + outflow.amount)
  }
  return totals
}

function balanceOf(ctx: Pick<IOperateAttestContext, 'balances'>, token: Address): bigint {
  const balance = ctx.balances.get(getAddress(token))
  if (balance === undefined) throw new CompactError('BALANCE_UNREAD', `the master's ${token} balance was not read`, 'soft')
  return balance
}

export async function attestOperateIntent(ctx: IOperateAttestContext, intent: ISpokeGate__OperateIntent): Promise<TypedDataDefinition> {
  if (isAddressEqual(predictUserAccount(intent.header.user), intent.header.account)) {
    throw new CompactContractError('Account__NotDelegated', [intent.header.account])
  }
  const account = getAddress(intent.header.account)
  const registered = listedTokensOf(ctx.chainId)
  const client = clientOf(ctx, ctx.chainId)
  if (intent.callList.length > 0) {
    const facts = await resolveOperate(client, ctx.chainId, intent.callList, ctx.blockNumber)
    assertOperateSignable(screenOperate({ chainId: ctx.chainId, account, callList: intent.callList, registeredTokens: registered, facts }))
    const reasons = (await Promise.all(VENUES.flatMap(venue => (venue.attestOperate === undefined ? [] : [venue.attestOperate(ctx.clients, ctx.chainId, account, intent.callList)])))).flat()
    assertOperateSignable({ ok: reasons.length === 0, reasons })
  }
  await verifyHeaderOrGenesis(ctx, intent.header, 'operate')
  IntentLib.verifyOracleFed(ctx.chainId, intent.header.feeToken)
  const feeToken = getAddress(intent.header.feeToken)
  const exchange = operateExchange(ctx.chainId, account, intent.callList)
  if (exchange.received.size > 0) IntentLib.verifyPricedDeadline(intent.header.deadline, ctx.now)
  for (const token of intent.tokenList) {
    if (isAddressEqual(token, feeToken)) throw new CompactContractError('Intent__DuplicateToken', [feeToken])
  }
  for (const [token] of exchange.received) {
    if (!isAddressEqual(token, feeToken) && !intent.tokenList.some(recorded => isAddressEqual(recorded, token))) {
      throw new CompactError('ACQUIRED_NOT_RECORDED', `the operate delivers ${token} to the account but its tokenList does not record it; every asset an operate acquires is recorded`, 'hard')
    }
  }
  const valuesOf = (flows: ReadonlyMap<Address, bigint>) =>
    Promise.all(
      [...flows].map(async ([token, amount]) => ({
        token,
        value: amount === 0n ? 0n : ((await wethValueOf(ctx.getRate, client, ctx.chainId, ctx.blockNumber, token, amount))?.value ?? null)
      }))
    )
  const [sold, bought] = await Promise.all([valuesOf(exchange.spent), valuesOf(exchange.received)])
  const isPriced = (each: { token: Address; value: bigint | null }): each is { token: Address; value: bigint } => each.value !== null
  const boughtPriced = bought.filter(isPriced)
  if (boughtPriced.length < bought.length) {
    throw new CompactError(
      'ASSET_NOT_PRICEABLE',
      `the trade acquires ${bought.filter(each => !isPriced(each)).map(each => each.token).join(', ')}, which no oracle feed or Uniswap v3 pool with a 30-minute price history can value at this amount`,
      'hard'
    )
  }
  const soldPriced = sold.filter(isPriced)
  if (soldPriced.length > 0 && soldPriced.length < sold.length) {
    throw new CompactError(
      'TRADE_MIXES_EXITLESS',
      `this operate sells ${sold.filter(each => !isPriced(each)).map(each => each.token).join(', ')}, which no pool can value, together with priced tokens; sell it in an operate of its own`,
      'hard'
    )
  }
  const spentValue = soldPriced.reduce((total, each) => total + each.value, 0n)
  const receivedValue = boughtPriced.reduce((total, each) => total + each.value, 0n)
  const maxLoss = DEFAULT_EVALUATION_CONFIG.swapMaxSlippageBps
  if (receivedValue * PRECISION.basisPoints < spentValue * (PRECISION.basisPoints - maxLoss)) {
    throw new CompactError(
      'TRADE_UNDERPRICED',
      `This trade can spend up to ${readableTokenAmountLabel(TOKEN_META.WETH, spentValue)} of value but guarantees back only ${readableTokenAmountLabel(TOKEN_META.WETH, receivedValue)}, a loss past the ${Number(maxLoss) / 100}% any swap may take; raise the minimum output`,
      'hard'
    )
  }
  const module = deploymentAddress('AccountModule', ctx.chainId)
  for (const call of intent.callList) {
    if (isAddressEqual(call.target, module)) throw new CompactContractError('Account__ForbiddenTarget', [getAddress(call.target)])
  }
  const outgoing = (outflowsOf(account, intent.callList).get(feeToken) ?? 0n) + (exchange.spent.get(feeToken) ?? 0n) + intent.header.fee
  const covered = balanceOf(ctx, feeToken) + (exchange.received.get(feeToken) ?? 0n)
  if (covered < outgoing) {
    const unit = getTokenDescription(ctx.chainId, feeToken)
    throw new CompactError(
      'FEE_UNFUNDED',
      `This needs ${readableTokenAmountLabel(unit, outgoing)} including the ${readableTokenAmountLabel(unit, intent.header.fee)} relay fee, but your fund holds ${readableTokenAmountLabel(unit, covered)} on ${chainNameOf(ctx.chainId) ?? `chain ${ctx.chainId}`}`,
      'hard'
    )
  }
  verifyAllowances(ctx.chainId, intent.callList)
  return intentTypedData('operate', ctx.chainId, intent)
}

export function operateTokenList(ctx: IDraftContext, account: Address, feeToken: Address, callList: ISpokeGate__OperateIntent['callList']): Address[] {
  const registered = listedTokensOf(ctx.chainId)
  const approved = allowanceTokensOf(callList).filter(token => registered.some(r => isAddressEqual(r, token)))
  const exchange = operateExchange(ctx.chainId, account, callList)
  const sent = operateOutflows(account, callList).map(flow => getAddress(flow.token))
  const native = callList.some(call => call.value > 0n) ? [getAddress(PROTOCOL.nativeToken)] : []
  return [...new Set([...approved, ...exchange.spent.keys(), ...sent, ...native, ...exchange.received.keys()])].filter(token => !isAddressEqual(token, feeToken))
}

export function allowanceTokensOf(callList: ISpokeGate__OperateIntent['callList']): Address[] {
  return [
    ...new Set(
      callList.flatMap(call => {
        const dec = decodeErc20(call.callData)
        return dec?.functionName === 'approve' && dec.args[1] !== 0n ? [getAddress(call.target)] : []
      })
    )
  ]
}

function verifyAllowances(chainId: ChainId, callList: ISpokeGate__OperateIntent['callList']): void {
  for (const grant of leftGrantsOf(chainId, callList)) {
    if (mayStand(chainId, grant)) continue
    throw new CompactError(
      'ALLOWANCE_STANDING',
      `${grant.spender} keeps ${grant.amount} of ${grant.token} on ${grant.ledger} after the call list; only a standing venue spender may keep an allowance, at most ${SAMPLEABLE_ALLOWANCE} so every pull shows in it; reset it to zero in the same operate`,
      'hard'
    )
  }
}
