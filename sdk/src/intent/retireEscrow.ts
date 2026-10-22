import { HUB_CANONICAL_TOKEN, HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { ILiquidityGate__RetireEscrowIntent } from '@puppet/contracts/types'
import { type Address, getAddress, isAddressEqual, type TypedDataDefinition } from 'viem'
import { predictUserAccount } from '../account/createAccount.js'
import { CompactContractError, CompactError } from '../compact/error.js'
import { tokenKeyOf } from '../state/tokenRegistry.js'
import { GENESIS_NONCE, type IDraftContext, type IHeaderContext, intentTypedData, verifyHeader } from './shared.js'

interface IRetireEscrowAttestContext extends IDraftContext, IHeaderContext {
  balances: ReadonlyMap<Address, bigint>
}

export function attestRetireEscrowIntent(ctx: IRetireEscrowAttestContext, intent: ILiquidityGate__RetireEscrowIntent): TypedDataDefinition {
  const account = getAddress(intent.header.account)
  if (!isAddressEqual(account, predictUserAccount(intent.header.user))) throw new CompactContractError('Account__HeaderMismatch', [account])
  verifyHeader({ ...ctx, account: ctx.account === null ? { user: getAddress(intent.header.user), nonce: GENESIS_NONCE } : ctx.account }, intent.header)
  if (intent.amount === 0n) throw new CompactContractError('Balance__ZeroAmount', [])
  const token = getAddress(intent.token)
  const key = tokenKeyOf(ctx.chainId, token)
  if (!Object.values(HUB_CANONICAL_TOKEN).some(hubToken => tokenKeyOf(HUB_CHAIN_ID, hubToken) === key)) {
    throw new CompactError('RETIRE_TOKEN', `escrow on chain ${ctx.chainId} holds the twin of a canonical hub token, not ${token}`, 'hard')
  }
  const balanceOf = (held: Address): bigint => {
    const balance = ctx.balances.get(getAddress(held))
    if (balance === undefined) throw new CompactError('BALANCE_UNREAD', `the ${held} balance of ${account} was not read`, 'soft')
    return balance
  }
  const feeToken = getAddress(intent.header.feeToken)
  const locking = intent.amount + (isAddressEqual(feeToken, token) ? intent.header.fee : 0n)
  if (balanceOf(token) < locking) {
    throw new CompactError('BALANCE_SHORT', `${account} holds ${balanceOf(token)} of ${token} on chain ${ctx.chainId}, short of the ${locking} the escrow and its fee take`, 'hard')
  }
  if (!isAddressEqual(feeToken, token) && balanceOf(feeToken) < intent.header.fee) {
    throw new CompactError('FEE_UNFUNDED', `${account} holds ${balanceOf(feeToken)} of ${feeToken}, short of the ${intent.header.fee} relay fee`, 'hard')
  }
  return intentTypedData('retireEscrow', ctx.chainId, intent)
}
