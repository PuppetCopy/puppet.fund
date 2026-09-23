import { HUB_CHAIN_ID, PRECISION } from '@puppet/contracts/const'
import type { IHubGate__MandateIntent } from '@puppet/contracts/types'
import { getAddress, isAddressEqual, type PublicClient, type TypedDataDefinition } from 'viem'
import { CompactContractError, CompactError } from '../compact/error.js'
import { type IApprovalAuthority, verifyApproval } from './approval.js'
import * as IntentLib from './intentLib.js'
import { type IDraftContext, type IGenesisContext, intentTypedData, mandateDigest, verifyHeaderOrGenesis } from './shared.js'

interface IMandateAttestContext extends IDraftContext, IGenesisContext {
  rowAuthority: IApprovalAuthority | null
  client: PublicClient
  feeBalance: bigint
  nowSec: bigint
}

export async function attestMandateIntent(ctx: IMandateAttestContext, intent: IHubGate__MandateIntent): Promise<TypedDataDefinition> {
  if (ctx.chainId !== HUB_CHAIN_ID) throw new CompactError('BAD_REQUEST', 'mandates broadcast on the hub chain only', 'hard')
  const account = getAddress(intent.header.account)
  await verifyHeaderOrGenesis(ctx, intent.header, 'mandate')
  IntentLib.verifyRegisteredTokenCap(ctx.tokenRegistry, ctx.chainId, intent.header.feeToken, intent.header.fee)

  const len = intent.mandateList.length
  if (len !== intent.signatureList.length) throw new CompactContractError('Mandate__ListLengthMismatch', [BigInt(len), BigInt(intent.signatureList.length)])
  for (let i = 0; i < len; i++) {
    const mandate = intent.mandateList[i]!
    if (ctx.rowAuthority !== null) {
      await verifyApproval(ctx.client, account, ctx.rowAuthority, mandateDigest(account, mandate), intent.signatureList[i]!, ctx.nowSec)
    }
    const master = getAddress(mandate.master)
    if (i > 0 && BigInt(master) <= BigInt(intent.mandateList[i - 1]!.master)) {
      throw new CompactContractError('Mandate__ListNotSorted', [intent.mandateList[i - 1]!.master, master])
    }
    if (isAddressEqual(master, account)) throw new CompactContractError('Gate__MasterAsPuppet', [account])
    if (mandate.allocationRate >= PRECISION.basisPoints) throw new CompactContractError('Mandate__InvalidAllocationRate', [mandate.allocationRate])
    if (mandate.skin > PRECISION.basisPoints) throw new CompactContractError('Mandate__InvalidSkin', [mandate.skin])
  }
  if (ctx.feeBalance < intent.header.fee) {
    throw new CompactContractError('Balance__InsufficientBalance', [ctx.feeBalance, intent.header.fee])
  }
  return intentTypedData('mandate', ctx.chainId, intent)
}
