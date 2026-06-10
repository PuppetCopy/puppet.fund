import { MASTER_GATE_INTENTS } from '@puppet/contracts/intents'
import type { IAccountLib__AccountInitParams, IMasterGate__CreateFundAccountIntent } from '@puppet/contracts/types'
import type { Hex, TypedDataDefinition } from 'viem'
import { CompactContractError } from '../compact/error.js'
import { CompactError } from '../compact/index.js'
import * as IntentLib from './intentLib.js'
import { type IDraftContext, MASTER_GATE_DOMAIN_MAP } from './shared.js'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export interface ICreateFundAccountInput {
  params: IAccountLib__AccountInitParams
  tokenId: Hex
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  sweepAmount: bigint
}

export interface ICreateFundAccountAttestContext extends IDraftContext {
  currentBlock: bigint
  routeBalance: bigint
}

export function attestCreateFundAccountIntent(ctx: ICreateFundAccountAttestContext, input: ICreateFundAccountInput) {
  IntentLib.verifyCommonIntent(ctx, {
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    intentChainId: input.chainId,
    baseTokenId: input.tokenId,
    lookupChain: ctx.chainId,
    capAmount: input.sweepAmount,
    acceptableRelayFee: input.acceptableRelayFee,
    relayFeeDenominator: input.sweepAmount
  })
  if (input.params.user === ZERO_ADDRESS) throw new CompactContractError('Account__InvalidUser', [])

  if (input.sweepAmount > 0n && ctx.routeBalance < input.sweepAmount) {
    throw new CompactError(
      'DEPOSIT_ROUTE_UNDERFUNDED',
      `route balance ${ctx.routeBalance} below sweep amount ${input.sweepAmount}`
    )
  }

  const intent: IMasterGate__CreateFundAccountIntent = {
    params: input.params,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: input.chainId,
    tokenId: input.tokenId,
    sweepAmount: input.sweepAmount
  }

  const domain = MASTER_GATE_DOMAIN_MAP[ctx.chainId]
  if (!domain) throw new CompactError('BAD_REQUEST', `unsupported chain ${ctx.chainId}`)
  const typedData: TypedDataDefinition = {
    domain,
    ...MASTER_GATE_INTENTS.createFundAccount,
    message: intent as unknown as Record<string, unknown>
  }
  return { intent, typedData, args: [intent] }
}
