import type { ISpokeGate__OperateIntent } from '@puppet/contracts/types'
import { type Address, decodeAbiParameters, getAddress, type Hex, isAddressEqual, size, slice, type TypedDataDefinition } from 'viem'
import { CompactContractError, CompactError } from '../compact/error.js'
import { deploymentAddress } from '../const/deployments.js'
import type { ChainId } from '../const/index.js'
import { operateOutflows } from '../venue/screen.js'
import { venueSpenders } from '../venue/venues.js'
import * as IntentLib from './intentLib.js'
import { type IDraftContext, type IGenesisContext, intentTypedData, verifyHeaderOrGenesis } from './shared.js'

const APPROVE = '0x095ea7b3'
const INCREASE_ALLOWANCE = '0x39509351'
const PERMIT = '0xd505accf'
const DAI_PERMIT = '0x8fcbaf0c'

interface IOperateAttestContext extends IDraftContext, IGenesisContext {
  balances: ReadonlyMap<Address, bigint>
}

function outflowsOf(callList: ISpokeGate__OperateIntent['callList']): Map<Address, bigint> {
  const totals = new Map<Address, bigint>()
  for (const outflow of operateOutflows(callList)) {
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
  await verifyHeaderOrGenesis(ctx, intent.header, 'operate')
  IntentLib.verifyRegisteredTokenCap(ctx.tokenRegistry, ctx.chainId, intent.header.feeToken, intent.header.fee)
  const account = getAddress(intent.header.account)
  const module = deploymentAddress('AccountModule', ctx.chainId)
  for (const call of intent.callList) {
    const target = getAddress(call.target)
    if (isAddressEqual(target, account) || isAddressEqual(target, module)) {
      throw new CompactContractError('Account__ForbiddenTarget', [target])
    }
  }
  const outflows = outflowsOf(intent.callList)
  const feeToken = getAddress(intent.header.feeToken)
  const spent = outflows.get(feeToken) ?? 0n
  const fundBalance = balanceOf(ctx, feeToken)
  if (fundBalance < spent + intent.header.fee) throw new CompactContractError('Balance__InsufficientBalance', [fundBalance, spent + intent.header.fee])
  verifyStandingAllowance(ctx, ctx.chainId, intent)
  return intentTypedData('operate', ctx.chainId, intent)
}

export function allowanceTokensOf(callList: ISpokeGate__OperateIntent['callList']): Address[] {
  return [...new Set(callList.filter(call => grantOf(call.callData) !== null).map(call => getAddress(call.target)))]
}

function grantOf(grant: Hex): { spender: Address; amount: bigint | null } | null {
  if (size(grant) < 68) return null
  const selector = slice(grant, 0, 4)
  if (selector === APPROVE) {
    const [spender, amount] = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], slice(grant, 4, 68))
    return amount === 0n ? null : { spender: getAddress(spender), amount }
  }
  if (selector === INCREASE_ALLOWANCE) {
    const [spender, amount] = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], slice(grant, 4, 68))
    return amount === 0n ? null : { spender: getAddress(spender), amount: null }
  }
  if (selector === PERMIT) {
    if (size(grant) < 100) return null
    const [, spender, value] = decodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }],
      slice(grant, 4, 100)
    )
    return { spender: getAddress(spender), amount: value }
  }
  if (selector === DAI_PERMIT) {
    const [, spender] = decodeAbiParameters([{ type: 'address' }, { type: 'address' }], slice(grant, 4, 68))
    return { spender: getAddress(spender), amount: null }
  }
  return null
}

function verifyStandingAllowance(
  ctx: Pick<IOperateAttestContext, 'balances'>,
  chainId: ChainId,
  intent: Pick<ISpokeGate__OperateIntent, 'header' | 'callList'>
): void {
  const spenders = venueSpenders(chainId)
  const feeToken = getAddress(intent.header.feeToken)
  const callList = intent.callList
  for (let i = 0; i < callList.length; i++) {
    const grant = grantOf(callList[i]!.callData)
    if (grant === null) continue
    const spender = grant.spender
    const token = getAddress(callList[i]!.target)
    if (spenders.some(venueSpender => isAddressEqual(venueSpender, spender))) {
      const fundBalance = balanceOf(ctx, token) - (isAddressEqual(token, feeToken) ? intent.header.fee : 0n)
      if (grant.amount === null || grant.amount > fundBalance) {
        throw new CompactError(
          'STANDING_ALLOWANCE',
          `${token} grants ${grant.amount === null ? 'an allowance whose result this check cannot bound' : grant.amount} to ${spender} while the fund balance after this operate's relay fee is ${fundBalance}; an allowance is capped at that balance, set with approve`,
          'hard'
        )
      }
      continue
    }
    let reset = false
    for (let j = i + 1; j < callList.length; j++) {
      if (!isAddressEqual(callList[j]!.target, token)) continue
      const later = callList[j]!.callData
      if (size(later) < 68 || slice(later, 0, 4) !== APPROVE) continue
      const [target, clears] = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], slice(later, 4, 68))
      if (isAddressEqual(getAddress(target), spender) && clears === 0n) {
        reset = true
        break
      }
    }
    if (!reset) throw new CompactError('STANDING_ALLOWANCE', `${token} keeps an allowance for ${spender} after the call list; reset it to zero in the same operate`, 'hard')
  }
}
