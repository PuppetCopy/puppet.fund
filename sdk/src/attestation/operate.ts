import { MASTER_GATE_INTENTS } from '@puppet/contracts/intents'
import type {
  IAccountLib__AccountInitParams,
  IIAccount__Call,
  IIAccount__SignTransfer,
  IMasterGate__OperateIntent
} from '@puppet/contracts/types'
import { encodeAbiParameters, type Hex, keccak256, type TypedDataDefinition } from 'viem'
import { CompactError } from '../compact/index.js'
import * as IntentLib from './intentLib.js'
import { type IDraftContext, MASTER_GATE_DOMAIN_MAP } from './shared.js'

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
      { name: 'tokenId', type: 'bytes32' },
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
  callList: IIAccount__Call[]
  transferList: IIAccount__SignTransfer[]
}

export interface IOperateAttestContext extends IDraftContext {
  currentBlock: bigint
  signedBalanceByTokenId: Record<Hex, bigint>
}

export function attestOperateIntent(ctx: IOperateAttestContext, input: IOperateInput) {
  IntentLib.verifyChainId(input.chainId, BigInt(ctx.chainId))
  IntentLib.verifyTimeBounds(input.blockNumber, input.deadline, ctx.currentBlock)

  for (const leg of input.transferList) {
    IntentLib.assertOutflowCovered(
      { signedBalance: ctx.signedBalanceByTokenId[leg.tokenId] ?? 0n },
      { amountIn: leg.amountIn, amountOut: leg.amountOut }
    )
  }

  const intent: IMasterGate__OperateIntent = {
    params: input.params,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: input.chainId,
    callList: input.callList,
    transferList: input.transferList
  }

  const domain = MASTER_GATE_DOMAIN_MAP[ctx.chainId]
  if (!domain) throw new CompactError('BAD_REQUEST', `unsupported chain ${ctx.chainId}`)
  const { callList, transferList, ...rest } = intent
  const typedData: TypedDataDefinition = {
    domain,
    ...MASTER_GATE_INTENTS.operate,
    message: {
      ...rest,
      callListHash: keccak256(encodeAbiParameters(CALL_TUPLE_ARRAY, [callList])),
      transferListHash: keccak256(encodeAbiParameters(TRANSFER_TUPLE_ARRAY, [transferList]))
    }
  }
  return { intent, typedData, args: [intent] }
}
