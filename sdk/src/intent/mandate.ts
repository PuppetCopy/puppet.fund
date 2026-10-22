import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { IHubGate__MandateIntent } from '@puppet/contracts/types'
import { getAddress, isAddressEqual, type TypedDataDefinition } from 'viem'
import { predictUserAccount } from '../account/createAccount.js'
import { CompactContractError, CompactError } from '../compact/error.js'
import { PRECISION } from '../const/common.js'
import * as IntentLib from './intentLib.js'
import { type IDraftContext, type IGenesisContext, intentTypedData, verifyHeaderOrGenesis } from './shared.js'

const MAX_SKIN = 100n * PRECISION.basisPoints

interface IMandateAttestContext extends IDraftContext, IGenesisContext {
  epoch: bigint
  feeBalance: bigint
}

export async function attestMandateIntent(ctx: IMandateAttestContext, intent: IHubGate__MandateIntent): Promise<TypedDataDefinition> {
  if (ctx.chainId !== HUB_CHAIN_ID) throw new CompactError('BAD_REQUEST', 'mandates broadcast on the hub chain only', 'hard')
  const account = getAddress(intent.header.account)
  if (!isAddressEqual(predictUserAccount(intent.header.user), account)) throw new CompactContractError('Account__HeaderMismatch', [account])
  await verifyHeaderOrGenesis(ctx, intent.header, 'mandate')
  IntentLib.verifyOracleFed(ctx.chainId, intent.header.feeToken)
  if (intent.epoch !== ctx.epoch) throw new CompactContractError('Mandate__StaleEpoch', [intent.epoch, ctx.epoch])

  for (const [i, mandate] of intent.mandateList.entries()) {
    const master = getAddress(mandate.master)
    if (i > 0 && BigInt(master) <= BigInt(intent.mandateList[i - 1]!.master)) {
      throw new CompactContractError('Mandate__ListNotSorted', [intent.mandateList[i - 1]!.master, master])
    }
    const live = mandate.expiry > ctx.now
    if (mandate.allocationRate >= PRECISION.basisPoints || (live && mandate.allocationRate === 0n)) {
      throw new CompactContractError('Mandate__InvalidAllocationRate', [mandate.allocationRate])
    }
    if (mandate.skin > MAX_SKIN) throw new CompactContractError('Mandate__InvalidSkin', [mandate.skin])
    if (mandate.exitCap > PRECISION.basisPoints || (live && mandate.exitCap === 0n)) {
      throw new CompactContractError('Mandate__InvalidExitCap', [mandate.exitCap])
    }
  }
  if (ctx.feeBalance < intent.header.fee) {
    throw new CompactContractError('Balance__InsufficientBalance', [ctx.feeBalance, intent.header.fee])
  }
  return intentTypedData('mandate', ctx.chainId, intent)
}
