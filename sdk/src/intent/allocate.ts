import { HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import type { IFund__AllocateIntent } from '@puppet/contracts/types'
import { type Address, getAddress, type Hex, isAddressEqual, type TypedDataDefinition } from 'viem'
import { cooledDown } from '../allocation/index.js'
import { CompactContractError, CompactError } from '../compact/error.js'
import type { ChainId } from '../const/index.js'
import { type IAllocatePlan, planAllocate } from '../pool/index.js'
import { bondTokenOf } from '../state/tokenRegistry.js'
import * as IntentLib from './intentLib.js'
import { type IDraftContext, type IGenesisContext, intentTypedData, mandateDigest, verifyHeaderOrGenesis } from './shared.js'
import { creditableOf, type IEscrowCredit } from './terms.js'
import { type IValuationAudit, verifyValuation } from './valuation.js'

interface IAllocatePuppetState {
  mandate: Hex
  withdrawRequestedAt: bigint
  available: bigint
  basis: bigint
  allocatedAt: bigint
}

interface IAllocateAttestContext extends IDraftContext, IGenesisContext {
  opening: boolean
  skin: bigint
  audit: IValuationAudit | null
  supply: bigint
  queued: bigint
  masterUnits: bigint
  credit: IEscrowCredit | null
  creditMark: bigint | null
  puppets: ReadonlyMap<Address, IAllocatePuppetState>
  feeReserve: bigint
  blocked: string | null
  nowSec: bigint
}

export async function attestAllocateIntent(
  ctx: IAllocateAttestContext,
  intent: IFund__AllocateIntent
): Promise<{ typedData: TypedDataDefinition; plan: IAllocatePlan }> {
  if (ctx.chainId !== HUB_CHAIN_ID) throw new CompactError('BAD_REQUEST', 'allocation rounds run on the hub chain only', 'hard')
  const master = getAddress(intent.header.account)
  await verifyHeaderOrGenesis(ctx, intent.header, ctx.opening ? 'createFund' : 'allocate')
  IntentLib.verifyRegisteredTokenCap(ctx.tokenRegistry, ctx.chainId, intent.header.feeToken, intent.header.fee)
  const v = intent.valuation
  verifyValuation('allocate', v, intent.header.deadline, ctx.nowSec, ctx.audit)
  const rows = intent.allocationList
  if (ctx.blocked !== null && rows.length > 0) throw new CompactError('ALLOCATION_BLOCKED', ctx.blocked, 'hard')
  if (BigInt(rows.length) > PROTOCOL.maxCohortSize) throw new CompactContractError('Gate__ListTooLong', [BigInt(rows.length), PROTOCOL.maxCohortSize])

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    const puppet = getAddress(row.puppet)
    if (i > 0 && BigInt(puppet) <= BigInt(rows[i - 1]!.puppet)) {
      throw new CompactContractError('Fund__AllocationListNotSorted', [rows[i - 1]!.puppet, puppet])
    }
    if (ctx.puppets.get(puppet) === undefined) {
      throw new CompactError('BALANCE_UNREAD', `the route and holding of ${puppet} were not read`, 'soft')
    }
  }

  const verifyRow = (i: number): void => {
    const row = rows[i]!
    const puppet = getAddress(row.puppet)
    const state = ctx.puppets.get(puppet)!
    if (state.withdrawRequestedAt !== 0n) {
      throw new CompactError(
        'WITHDRAW_ARMED',
        `${puppet} armed a direct withdrawal at ${state.withdrawRequestedAt}, so its stake can leave under the round; it cannot be allocated until the withdrawal is used`,
        'hard'
      )
    }
    if (state.mandate !== mandateDigest(puppet, row.mandate)) throw new CompactContractError('Mandate__NotRegistered', [puppet, master])
    if (row.mandate.expiry <= intent.header.deadline) throw new CompactContractError('Mandate__Expired', [puppet, row.mandate.expiry])
    if (!cooledDown(state.allocatedAt, row.mandate.cooldownPeriod, ctx.nowSec)) {
      throw new CompactContractError('Mandate__Cooldown', [puppet, state.allocatedAt + row.mandate.cooldownPeriod])
    }
  }

  const row = intent.credit
  if (row.amount > 0n || row.value > 0n) {
    const held = ctx.credit
    if (held === null) throw new CompactError('BALANCE_UNREAD', `the escrow of ${row.token} on chain ${row.chainId} was not read`, 'soft')
    if (held.hubShutdown) throw new CompactContractError('Escrow__Shutdown', [])
    if (held.chainShutdown) {
      throw new CompactError('BAD_REQUEST', `escrow on chain ${row.chainId} is shut down and refundable, so a round cannot credit it`, 'hard')
    }
    IntentLib.verifyRegisteredTokenCap(ctx.tokenRegistry, Number(row.chainId) as ChainId, row.token, row.amount)
    if (row.amount > creditableOf(held)) {
      throw new CompactError(
        'BAD_REQUEST',
        `the round credits ${row.amount} of ${row.token} on chain ${row.chainId}, but its escrow ledger holds ${held.escrowed} with ${held.credited > held.fulfilled ? held.credited : held.fulfilled} already credited`,
        'hard'
      )
    }
    if (ctx.creditMark !== null && row.value > ctx.creditMark) {
      throw new CompactError(
        'VALUATION_DRIFT',
        `the round values ${row.amount} of ${row.token} on chain ${row.chainId} at ${row.value}, above the attestor's ${ctx.creditMark}, the side the signer profits from`,
        'hard'
      )
    }
  }

  const plan = planAllocate({
    skin: ctx.skin,
    supply: ctx.supply,
    queued: ctx.queued,
    masterUnits: ctx.masterUnits,
    value: v.value,
    fee: intent.header.fee,
    credit: intent.credit,
    rowList: rows.map(row => ({
      stake: row.stake,
      skin: row.mandate.skin,
      rate: row.mandate.allocationRate,
      balance: ctx.puppets.get(getAddress(row.puppet))!.available,
      basis: ctx.puppets.get(getAddress(row.puppet))!.basis
    })),
    verifyRow
  })

  const bond = bondTokenOf(ctx.chainId)
  if (!isAddressEqual(intent.header.feeToken, bond)) throw new CompactContractError('Intent__FeeTokenMismatch', [intent.header.feeToken, bond])
  return { typedData: intentTypedData('allocate', ctx.chainId, intent), plan }
}
