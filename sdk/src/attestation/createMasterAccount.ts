import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { MASTER_GATE_INTENTS } from '@puppet/contracts/intents'
import type { IAccountLib__AccountInitParams, IAccountModule__CreateMasterAccountIntent } from '@puppet/contracts/types'
import type { Hex, TypedDataDefinition } from 'viem'
import { CompactContractError } from '../compact/error.js'
import { CompactError } from '../compact/index.js'
import * as IntentLib from './intentLib.js'
import { MASTER_GATE_DOMAIN_MAP, type IDraftContext } from './shared.js'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'

export interface ICreateMasterAccountInput {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  initialDepositAmount: bigint
  userDeploySig: Hex
  userSignerProof: Hex
}

export interface ICreateMasterAccountAttestContext extends IDraftContext {
  currentBlock: bigint
  transientRouteBalance: bigint
}

export function attestCreateMasterAccountIntent(
  ctx: ICreateMasterAccountAttestContext,
  input: ICreateMasterAccountInput
) {
  if (BigInt(ctx.chainId) === BigInt(HUB_CHAIN_ID)) {
    throw new CompactError(
      'BAD_REQUEST',
      'hub master accounts are created via createMaster; createMasterAccount is spoke-only'
    )
  }
  IntentLib.verifyCommonIntent(ctx, {
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    intentChainId: input.chainId,
    baseTokenId: input.params.baseTokenId,
    lookupChain: ctx.chainId,
    capAmount: 0n,
    acceptableRelayFee: input.acceptableRelayFee,
    relayFeeDenominator: input.initialDepositAmount
  })
  if (input.params.user === ZERO_ADDRESS) throw new CompactContractError('Account__InvalidUser', [])
  if (input.params.baseTokenId === ZERO_BYTES32) throw new CompactContractError('Account__InvalidBaseTokenId', [])

  if (input.initialDepositAmount > 0n && ctx.transientRouteBalance < input.initialDepositAmount) {
    throw new CompactError(
      'TRANSIENT_ROUTE_UNDERFUNDED',
      `transient route balance ${ctx.transientRouteBalance} below initial deposit ${input.initialDepositAmount}`
    )
  }

  const intent: IAccountModule__CreateMasterAccountIntent = {
    params: input.params,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: input.chainId,
    initialDepositAmount: input.initialDepositAmount
  }

  const domain = MASTER_GATE_DOMAIN_MAP[ctx.chainId]
  if (!domain) throw new CompactError('BAD_REQUEST', `unsupported chain ${ctx.chainId}`)
  const typedData: TypedDataDefinition = {
    domain,
    ...MASTER_GATE_INTENTS.createMasterAccount,
    message: intent as unknown as Record<string, unknown>
  }
  return { intent, typedData, args: [intent, input.userDeploySig, input.userSignerProof] }
}
