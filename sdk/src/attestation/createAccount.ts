import { ACCOUNT_GATE_INTENTS } from '@puppet/contracts/intents'
import type { IAccount__CreatePuppetAccountIntent, IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import type { Hex, TypedDataDefinition } from 'viem'
import { CompactContractError } from '../compact/error.js'
import { CompactError } from '../compact/index.js'
import * as IntentLib from './intentLib.js'
import { ACCOUNT_GATE_DOMAIN_MAP, type IDraftContext } from './shared.js'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export interface ICreatePuppetAccountInput {
  params: IAccountLib__AccountInitParams
  tokenId: Hex
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  initialDepositAmount: bigint
  userDeploySig: Hex
  userSignerProof: Hex
}

export interface ICreatePuppetAccountAttestContext extends IDraftContext {
  currentBlock: bigint
  depositRouteBalance: bigint
}

export function attestCreatePuppetAccountIntent(
  ctx: ICreatePuppetAccountAttestContext,
  input: ICreatePuppetAccountInput
) {
  IntentLib.verifyCommonIntent(ctx, {
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    intentChainId: input.chainId,
    baseTokenId: input.tokenId,
    lookupChain: ctx.chainId,
    capAmount: input.initialDepositAmount,
    acceptableRelayFee: input.acceptableRelayFee,
    relayFeeDenominator: input.initialDepositAmount
  })
  if (input.params.user === ZERO_ADDRESS) throw new CompactContractError('Account__InvalidUser', [])

  if (input.initialDepositAmount > 0n && ctx.depositRouteBalance < input.initialDepositAmount) {
    throw new CompactError(
      'DEPOSIT_ROUTE_UNDERFUNDED',
      `deposit route balance ${ctx.depositRouteBalance} below initial deposit ${input.initialDepositAmount}`
    )
  }

  const intent: IAccount__CreatePuppetAccountIntent = {
    params: input.params,
    tokenId: input.tokenId,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: input.chainId,
    initialDepositAmount: input.initialDepositAmount
  }

  const domain = ACCOUNT_GATE_DOMAIN_MAP[ctx.chainId]
  if (!domain) throw new CompactError('BAD_REQUEST', `unsupported chain ${ctx.chainId}`)
  const typedData: TypedDataDefinition = {
    domain,
    ...ACCOUNT_GATE_INTENTS.createPuppetAccount,
    message: intent as unknown as Record<string, unknown>
  }
  return { intent, typedData, args: [intent, input.userDeploySig, input.userSignerProof] }
}
