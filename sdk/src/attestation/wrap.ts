import { FUND_GATE_INTENTS } from '@puppet/contracts/intents'
import type {
  IAccountLib__AccountInitParams,
  IFundAccountLib__FundAccountInitParams,
  IFundGate__WrapIntent
} from '@puppet/contracts/types'
import { isAddressEqual, type TypedDataDefinition } from 'viem'
import { predictPuppetAccount } from '../account/index.js'
import { CompactContractError } from '../compact/error.js'
import { wrappedNativeAddressOf } from '../state/tokenRegistry.js'
import * as IntentLib from './intentLib.js'
import { fundGateDomain, type IDraftContext } from './shared.js'

export interface IWrapInput {
  params: IAccountLib__AccountInitParams
  fundParams: IFundAccountLib__FundAccountInitParams
  amount: bigint
  // false: native -> wrapped-native; true: wrapped-native -> native.
  unwrap: boolean
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
}

interface IWrapAttestContext extends IDraftContext {
  currentBlock: bigint
}

// Atomic native <-> wrapped-native re-key (FundGate.wrap). Mirrors the contract's checks: chain/time bounds, the master
// derives from params, and the wrapped-native token is registered/within cap. The conversion is a fixed WNT
// deposit/withdraw and the on-chain shortfall check makes the 1:1 re-key EXACT, so there is no value/slippage screen
// to run here (unlike swap) — the shape is not client-chosen.
export function attestWrapIntent(ctx: IWrapAttestContext, input: IWrapInput) {
  if (input.amount === 0n) throw new CompactContractError('Balance__NothingToRecord', [])
  IntentLib.verifyChainId(input.chainId, BigInt(ctx.chainId))
  IntentLib.verifyTimeBounds(input.blockNumber, input.deadline, ctx.currentBlock, ctx.chainId)

  const derivedMaster = predictPuppetAccount(input.params)
  if (!isAddressEqual(derivedMaster, input.fundParams.master)) {
    throw new CompactContractError('Share__MasterMismatch', [derivedMaster, input.fundParams.master])
  }
  IntentLib.verifyTokenAndCap(ctx.tokenRegistry, ctx.chainId, wrappedNativeAddressOf(ctx.chainId), input.amount)

  const intent: IFundGate__WrapIntent = {
    params: input.params,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: input.chainId,
    fundParams: input.fundParams,
    amount: input.amount,
    unwrap: input.unwrap
  }
  const typedData: TypedDataDefinition = {
    domain: fundGateDomain(ctx.chainId),
    ...FUND_GATE_INTENTS.wrap,
    message: intent as unknown as Record<string, unknown>
  }
  return { intent, typedData, args: [intent] }
}
