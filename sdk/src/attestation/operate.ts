import { FUND_GATE_INTENTS } from '@puppet/contracts/intents'
import type {
  IAccountLib__AccountInitParams,
  IFundAccountLib__FundAccountInitParams,
  IFundGate__OperateIntent,
  IIAccount__Call,
  IIAccount__SignTransfer
} from '@puppet/contracts/types'
import {
  type Address,
  encodeAbiParameters,
  getAddress,
  isAddressEqual,
  keccak256,
  type TypedDataDefinition
} from 'viem'
import { predictPuppetAccount } from '../account/index.js'
import { CompactContractError } from '../compact/error.js'
import { CompactError } from '../compact/index.js'
import * as IntentLib from './intentLib.js'
import { FUND_GATE_DOMAIN_MAP, type IDraftContext } from './shared.js'

const CALL_TUPLE_ARRAY = [
  {
    type: 'tuple[]',
    components: [
      { name: 'target', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'gasLimit', type: 'uint256' },
      { name: 'callData', type: 'bytes' }
    ]
  }
] as const

const TRANSFER_TUPLE_ARRAY = [
  {
    type: 'tuple[]',
    components: [
      { name: 'token', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOut', type: 'uint256' }
    ]
  }
] as const

export interface IOperateInput {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  fundParams: IFundAccountLib__FundAccountInitParams
  callList: IIAccount__Call[]
  transferList: IIAccount__SignTransfer[]
}

interface IOperateAttestContext extends IDraftContext {
  currentBlock: bigint
  signedBalanceByToken: Record<Address, bigint>
}

export function attestOperateIntent(ctx: IOperateAttestContext, input: IOperateInput) {
  IntentLib.verifyChainId(input.chainId, BigInt(ctx.chainId))
  IntentLib.verifyTimeBounds(input.blockNumber, input.deadline, ctx.currentBlock, ctx.chainId)

  const derivedMaster = predictPuppetAccount(input.params)
  if (!isAddressEqual(derivedMaster, input.fundParams.master)) {
    throw new CompactContractError('Share__MasterMismatch', [derivedMaster, input.fundParams.master])
  }

  for (const leg of input.transferList) {
    IntentLib.assertOutflowCovered(
      { signedBalance: ctx.signedBalanceByToken[getAddress(leg.token)] ?? 0n },
      { amountIn: leg.amountIn, amountOut: leg.amountOut }
    )
  }

  const intent: IFundGate__OperateIntent = {
    params: input.params,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: input.chainId,
    fundParams: input.fundParams,
    callList: input.callList,
    transferList: input.transferList
  }

  const domain = FUND_GATE_DOMAIN_MAP[ctx.chainId]
  if (!domain) throw new CompactError('BAD_REQUEST', `unsupported chain ${ctx.chainId}`)
  const { callList, transferList, ...rest } = intent
  const typedData: TypedDataDefinition = {
    domain,
    ...FUND_GATE_INTENTS.operate,
    message: {
      ...rest,
      callListHash: keccak256(encodeAbiParameters(CALL_TUPLE_ARRAY, [callList])),
      transferListHash: keccak256(encodeAbiParameters(TRANSFER_TUPLE_ARRAY, [transferList]))
    }
  }
  return { intent, typedData, args: [intent] }
}
