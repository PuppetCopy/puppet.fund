import { HUB_CHAIN_ID, } from '@puppet/contracts/const'
import type { IFund__RedeemIntent, IFundStore__Queue } from '@puppet/contracts/types'
import { getAddress, isAddressEqual, keccak256, type TypedDataDefinition, toHex } from 'viem'
import { CompactContractError, CompactError } from '../compact/error.js'
import { readableTokenAmountLabel } from '../core/readable.js'
import { getTokenDescription } from '../core/token.js'
import { type IDrainPlan, planDrain } from '../pool/index.js'
import { bondTokenOf } from '../state/tokenRegistry.js'
import { VENUES } from '../venue/venues.js'
import * as IntentLib from './intentLib.js'
import { type IDraftContext, type IGenesisContext, intentTypedData, verifyHeaderOrGenesis } from './shared.js'
import { type IValuationAudit, verifyValuation } from './valuation.js'

interface IRedeemAttestContext extends IDraftContext, IGenesisContext {
  skin: bigint
  audit: IValuationAudit | null
  queue: IFundStore__Queue
  supply: bigint
  queued: bigint
  masterUnits: bigint
  funded: bigint
  feeBalance: bigint
  nowSec: bigint
}

export async function attestRedeemIntent(
  ctx: IRedeemAttestContext,
  intent: IFund__RedeemIntent
): Promise<{ typedData: TypedDataDefinition; plan: IDrainPlan }> {
  if (ctx.chainId !== HUB_CHAIN_ID) throw new CompactError('BAD_REQUEST', 'redemptions run on the hub chain only', 'hard')
  await verifyHeaderOrGenesis(ctx, intent.header, 'redeem')
  IntentLib.verifyRegisteredTokenCap(ctx.tokenRegistry, ctx.chainId, intent.header.feeToken, intent.header.fee)
  const v = intent.valuation
  verifyValuation('redeem', v, intent.header.deadline, ctx.nowSec, ctx.audit)
  if (v.positionList.length > 0) {
    const bond = getTokenDescription(ctx.chainId, bondTokenOf(ctx.chainId))
    const venueOf = (hash: string): string =>
      VENUES.find(venue => keccak256(toHex(venue.venueId)) === hash)?.name ?? (keccak256(toHex('across')) === hash ? 'Across transfer' : hash)
    throw new CompactError(
      'POOL_NOT_FLAT',
      `redeem needs a flat fund; still out: ${v.positionList.map(p => `${venueOf(p.venue)} ${readableTokenAmountLabel(bond, p.valueInUsd)}`).join(', ')}. Close positions and bring the funds back first`,
      'soft'
    )
  }
  const bond = bondTokenOf(ctx.chainId)
  const plan = planDrain({
    token: bond,
    skin: ctx.skin,
    queue: ctx.queue,
    supply: ctx.supply,
    queued: ctx.queued,
    masterUnits: ctx.masterUnits,
    value: v.value,
    retire: intent.retire,
    drain: intent.drain,
    funded: ctx.funded
  })
  const feeToken = getAddress(intent.header.feeToken)
  const cover = ctx.feeBalance + (isAddressEqual(feeToken, bond) ? plan.retired : 0n)
  if (cover < intent.header.fee) throw new CompactContractError('Balance__InsufficientBalance', [cover, intent.header.fee])
  return { typedData: intentTypedData('redeem', ctx.chainId, intent), plan }
}
