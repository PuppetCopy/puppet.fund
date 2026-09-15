import { HUB_CHAIN_ID, PRECISION } from '@puppet/contracts/const'
import type { IHubGate__MandateIntent } from '@puppet/contracts/types'
import { type Address, getAddress, isAddressEqual, recoverAddress, type TypedDataDefinition } from 'viem'
import { CompactContractError, CompactError } from '../compact/error.js'
import { type ICreditListContext, verifyCreditList } from './credit.js'
import * as IntentLib from './intentLib.js'
import { type IGenesisContext, intentTypedData, mandateDigest, verifyHeaderOrGenesis } from './shared.js'

export interface IMandateAttestContext extends ICreditListContext, IGenesisContext {
  bondToken: Address
  bondTokenBalance: bigint
  feeTokenBalance: bigint
}

export async function attestMandateIntent(ctx: IMandateAttestContext, intent: IHubGate__MandateIntent): Promise<TypedDataDefinition> {
  if (ctx.chainId !== HUB_CHAIN_ID) throw new CompactError('BAD_REQUEST', 'mandates broadcast on the hub chain only', 'hard')
  const account = getAddress(intent.header.account)
  const signer = await verifyHeaderOrGenesis(ctx, intent.header)
  IntentLib.verifyRegisteredTokenCap(ctx.tokenRegistry, ctx.chainId, intent.header.feeToken, intent.header.fee)
  const swept =
    intent.creditList.length > 0 ? verifyCreditList(ctx, intent.creditList, getAddress(intent.header.feeToken)) : 0n

  if (intent.bond > 0n) {
    const needed = intent.bond + (isAddressEqual(intent.header.feeToken, ctx.bondToken) ? intent.header.fee : 0n)
    if (ctx.bondTokenBalance < needed) throw new CompactContractError('Bond__InsufficientBalance', [account, ctx.bondTokenBalance, needed])
  }

  const len = intent.mandateList.length
  if (len !== intent.signatureList.length) throw new CompactContractError('Mandate__ListLengthMismatch', [BigInt(len), BigInt(intent.signatureList.length)])
  for (let i = 0; i < len; i++) {
    const mandate = intent.mandateList[i]!
    const master = getAddress(mandate.master)
    if (i > 0 && BigInt(master) <= BigInt(intent.mandateList[i - 1]!.master)) {
      throw new CompactContractError('Mandate__ListNotSorted', [intent.mandateList[i - 1]!.master, master])
    }
    if (isAddressEqual(master, account)) throw new CompactContractError('Gate__MasterAsPuppet', [account])
    if (mandate.allocationRate > PRECISION.basisPoints || mandate.skin > PRECISION.basisPoints) {
      throw new CompactContractError('Gate__InvalidAllocationRate', [mandate.allocationRate])
    }
    const recovered = await recoverAddress({ hash: mandateDigest(account, mandate), signature: intent.signatureList[i]! })
    if (!isAddressEqual(recovered, signer)) throw new CompactContractError('Account__InvalidSignature', [])
  }
  if (ctx.feeTokenBalance + swept < intent.header.fee) {
    throw new CompactContractError('Balance__InsufficientBalance', [ctx.feeTokenBalance + swept, intent.header.fee])
  }
  return intentTypedData('mandate', ctx.chainId, intent)
}
