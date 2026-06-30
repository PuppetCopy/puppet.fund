import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { HUB_GATE_INTENTS } from '@puppet/contracts/intents'
import type {
  IAccountLib__AccountInitParams,
  IFundAccountLib__FundAccountInitParams,
  IRedeem__ClaimIntent
} from '@puppet/contracts/types'
import type { TypedDataDefinition } from 'viem'
import { CompactContractError } from '../compact/error.js'
import * as IntentLib from './intentLib.js'
import { HUB_DOMAIN, type IDraftContext } from './shared.js'

export interface IClaimInput {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  fundParams: IFundAccountLib__FundAccountInitParams
}

interface IClaimAttestContext extends IDraftContext {
  currentBlock: bigint
  claimable?: bigint
}

export function attestClaimIntent(ctx: IClaimAttestContext, input: IClaimInput) {
  IntentLib.verifyCommonIntent(ctx, {
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    baseToken: input.fundParams.baseToken,
    lookupChain: HUB_CHAIN_ID,
    capAmount: 0n,
    acceptableRelayFee: input.acceptableRelayFee
  })
  if (ctx.claimable !== undefined && ctx.claimable === 0n) throw new CompactContractError('Share__Empty', [])

  const intent: IRedeem__ClaimIntent = {
    params: input.params,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: BigInt(ctx.chainId),
    fundParams: input.fundParams
  }

  const typedData: TypedDataDefinition = {
    domain: HUB_DOMAIN,
    ...HUB_GATE_INTENTS.claim,
    message: intent as unknown as Record<string, unknown>
  }
  return { intent, typedData, args: [intent] }
}
