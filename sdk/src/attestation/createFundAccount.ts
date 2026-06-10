import { MASTER_GATE_INTENTS } from '@puppet/contracts/intents'
import type { IMasterGate__CreateFundAccountIntent } from '@puppet/contracts/types'
import type { Address, Hex, TypedDataDefinition } from 'viem'
import { CompactContractError } from '../compact/error.js'
import { CompactError } from '../compact/index.js'
import * as IntentLib from './intentLib.js'
import { type IDraftContext, MASTER_GATE_DOMAIN_MAP } from './shared.js'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export interface ICreateFundAccountInput {
  master: Address
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
  if (input.master === ZERO_ADDRESS) throw new CompactContractError('Account__InvalidUser', [])

  if (input.sweepAmount > 0n && ctx.routeBalance < input.sweepAmount) {
    throw new CompactError(
      'DEPOSIT_ROUTE_UNDERFUNDED',
      `route balance ${ctx.routeBalance} below sweep amount ${input.sweepAmount}`
    )
  }

  const intent: IMasterGate__CreateFundAccountIntent = {
    master: input.master,
    tokenId: input.tokenId,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: input.chainId,
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
