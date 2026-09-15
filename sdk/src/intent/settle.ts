import { HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import type { ICoreGate__SettleIntent, IHubGate__DrawIntent } from '@puppet/contracts/types'
import { isAddressEqual, type TypedDataDefinition } from 'viem'
import { settleNet } from '../backing/index.js'
import { CompactContractError, CompactError } from '../compact/error.js'
import type { ISettlementRow } from '../schema/index.js'
import * as IntentLib from './intentLib.js'
import { gainListHash, type IDraftContext, type IGenesisContext, type IHeaderContext, intentTypedData, lossListHash, verifyHeader, verifyHeaderOrGenesis } from './shared.js'
import { type ISettleTermsContext, settleTermsOf } from './terms.js'

export interface ISettleAttestContext extends IDraftContext, IHeaderContext, ISettleTermsContext {
  feeTokenBalance: bigint
}

export interface IDrawAttestContext extends ISettleAttestContext, IGenesisContext {
  drawn: ISettlementRow | undefined
}

function verifyCycle(ctx: ISettleAttestContext, header: ICoreGate__SettleIntent['header'], cycle: bigint): void {
  IntentLib.verifyRegisteredTokenCap(ctx.tokenRegistry, ctx.chainId, header.feeToken, header.fee)
  if (!isAddressEqual(ctx.book.master, header.account)) {
    throw new CompactError('BAD_REQUEST', `book ${ctx.book.id} is not this account's book`, 'hard')
  }
  if (ctx.book.cycle !== cycle) throw new CompactError('CYCLE_MISMATCH', `the book is at cycle ${ctx.book.cycle}; the intent settles cycle ${cycle}`, 'hard')
}

export function attestSettleIntent(ctx: ISettleAttestContext, intent: ICoreGate__SettleIntent): TypedDataDefinition {
  if (ctx.chainId !== ctx.spokeChainId) throw new CompactError('BAD_REQUEST', `gains settle on the book's chain ${ctx.spokeChainId}, not ${ctx.chainId}`, 'hard')
  verifyHeader(ctx, intent.header)
  verifyCycle(ctx, intent.header, intent.cycle)
  if (ctx.settled !== undefined) throw new CompactError('SETTLED', `cycle ${intent.cycle} was settled in ${ctx.settled.transactionHash}`, 'hard')
  if (!isAddressEqual(intent.token, ctx.token)) {
    throw new CompactError('BAD_REQUEST', `intent settles in ${intent.token}; the attestor composed ${ctx.token}`, 'hard')
  }
  if (intent.value !== ctx.closingValue) {
    throw new CompactError('VALUE_MISMATCH', `intent closes at ${intent.value}; the attestor values the book at ${ctx.closingValue}`, 'hard')
  }
  IntentLib.verifyRegisteredTokenCap(ctx.tokenRegistry, ctx.chainId, intent.token, 0n)
  if (BigInt(intent.gainList.length) > PROTOCOL.maxCohortSize) {
    throw new CompactContractError('Gate__ListTooLong', [BigInt(intent.gainList.length), PROTOCOL.maxCohortSize])
  }
  const terms = settleTermsOf(ctx)
  if (gainListHash(intent.gainList) !== gainListHash(terms.gainList)) {
    throw new CompactError('OWED_MISMATCH', 'the gain rows differ from what the ledger settles; compose again on fresh state', 'hard')
  }
  const sameFeeToken = isAddressEqual(intent.header.feeToken, intent.token)
  const paid = terms.gainList.reduce((total, g) => total + settleNet(g.amount, PROTOCOL.performanceFee), 0n)
  const owedOut = paid + (sameFeeToken ? intent.header.fee : 0n)
  if (ctx.masterHolding < owedOut) {
    throw new CompactContractError('Balance__InsufficientBalance', [ctx.masterHolding, owedOut])
  }
  if (!sameFeeToken && ctx.feeTokenBalance < intent.header.fee) {
    throw new CompactContractError('Balance__InsufficientBalance', [ctx.feeTokenBalance, intent.header.fee])
  }
  return intentTypedData('settle', ctx.chainId, intent)
}

export async function attestDrawIntent(ctx: IDrawAttestContext, intent: IHubGate__DrawIntent): Promise<TypedDataDefinition> {
  if (ctx.chainId !== HUB_CHAIN_ID) throw new CompactError('BAD_REQUEST', 'losses draw on the hub chain only', 'hard')
  await verifyHeaderOrGenesis(ctx, intent.header)
  verifyCycle(ctx, intent.header, intent.cycle)
  if (intent.spokeChainId !== BigInt(ctx.spokeChainId)) {
    throw new CompactError('CYCLE_MISMATCH', `the book lives on chain ${ctx.spokeChainId}; the intent draws for chain ${intent.spokeChainId}`, 'hard')
  }
  if (ctx.settled === undefined) throw new CompactError('UNSETTLED', `cycle ${intent.cycle} has no settlement on chain ${ctx.spokeChainId} yet`, 'soft')
  if (ctx.drawn !== undefined) throw new CompactError('SETTLED', `cycle ${intent.cycle} was drawn in ${ctx.drawn.transactionHash}`, 'hard')
  if (BigInt(intent.lossList.length) > PROTOCOL.maxCohortSize) {
    throw new CompactContractError('Gate__ListTooLong', [BigInt(intent.lossList.length), PROTOCOL.maxCohortSize])
  }
  const terms = settleTermsOf(ctx)
  if (lossListHash(intent.lossList) !== lossListHash(terms.lossList)) {
    throw new CompactError('OWED_MISMATCH', 'the loss rows differ from what the ledger settles; compose again on fresh state', 'hard')
  }
  if (ctx.feeTokenBalance < intent.header.fee) throw new CompactContractError('Balance__InsufficientBalance', [ctx.feeTokenBalance, intent.header.fee])
  return intentTypedData('draw', ctx.chainId, intent)
}
