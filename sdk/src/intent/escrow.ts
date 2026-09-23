import type { ILiquidityGate__EscrowIntent } from '@puppet/contracts/types'
import { type Address, getAddress, isAddressEqual, type TypedDataDefinition } from 'viem'
import { predictUserAccount } from '../account/createAccount.js'
import { CompactContractError, CompactError } from '../compact/error.js'
import * as IntentLib from './intentLib.js'
import { type IDraftContext, type IHeaderContext, intentTypedData, USER_GENESIS_NONCE, verifyHeader } from './shared.js'

interface IEscrowAttestContext extends IDraftContext {
  masterParent: Address | null
  balances: ReadonlyMap<Address, bigint>
}

function verifyFunded(ctx: IEscrowAttestContext, account: Address, demand: readonly (readonly [Address, bigint])[]): void {
  const owed = new Map<Address, bigint>()
  for (const [token, amount] of demand) {
    const key = getAddress(token)
    owed.set(key, (owed.get(key) ?? 0n) + amount)
  }
  for (const [token, amount] of owed) {
    const balance = ctx.balances.get(token)
    if (balance === undefined) throw new CompactError('BALANCE_UNREAD', `the ${token} balance of ${account} was not read`, 'soft')
    if (balance < amount) throw new CompactContractError('Balance__InsufficientBalance', [balance, amount])
  }
}

export function attestEscrowIntent(ctx: IEscrowAttestContext & IHeaderContext, intent: ILiquidityGate__EscrowIntent): TypedDataDefinition {
  const header = intent.header
  if (ctx.account !== null) verifyHeader(ctx, header)
  else {
    if (!isAddressEqual(predictUserAccount(header.user), header.account)) {
      throw new CompactContractError('Account__HeaderMismatch', [header.account])
    }
    if (header.nonce !== USER_GENESIS_NONCE) {
      throw new CompactContractError('Account__NonceMismatch', [header.account, USER_GENESIS_NONCE, header.nonce])
    }
    IntentLib.verifyDeadline(header.deadline)
    if (header.fee === 0n) throw new CompactContractError('Intent__ZeroRelayFee', [header.account])
  }
  if (intent.amount === 0n) throw new CompactContractError('Balance__ZeroAmount', [])
  IntentLib.verifyRegisteredTokenCap(ctx.tokenRegistry, ctx.chainId, intent.token, intent.amount)
  IntentLib.verifyRegisteredTokenCap(ctx.tokenRegistry, ctx.chainId, intent.header.feeToken, intent.header.fee)
  if (ctx.masterParent !== null && !isAddressEqual(ctx.masterParent, header.account)) {
    throw new CompactContractError('Account__HeaderMismatch', [intent.master])
  }
  verifyFunded(ctx, getAddress(intent.header.account), [
    [getAddress(intent.token), intent.amount],
    [getAddress(intent.header.feeToken), intent.header.fee]
  ])
  return intentTypedData('escrow', ctx.chainId, intent)
}
