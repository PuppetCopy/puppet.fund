import { SPOKE_GATE_INTENTS } from '@puppet/contracts/intents'
import type {
  IAccountLib__AccountInitParams,
  IIAccount__Call,
  ISpokeGate__OperateIntent
} from '@puppet/contracts/types'
import { type Address, encodeAbiParameters, keccak256, type TypedDataDefinition } from 'viem'
import { CompactError } from '../compact/index.js'
import * as IntentLib from './intentLib.js'
import { type IDraftContext, SPOKE_GATE_DOMAIN_MAP } from './shared.js'

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

export interface IOperateInput {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  callList: IIAccount__Call[]
  amountIn: bigint
  amountOut: bigint
}

export interface IOperateAttestContext extends IDraftContext {
  currentBlock: bigint
  signedBalance: bigint
}

export function attestOperateIntent(ctx: IOperateAttestContext, input: IOperateInput) {
  IntentLib.verifyChainId(input.chainId, BigInt(ctx.chainId))
  IntentLib.verifyTimeBounds(input.blockNumber, input.deadline, ctx.currentBlock)
  const baseToken: Address = IntentLib.verifyTokenAndCap(
    ctx.tokenRegistry,
    ctx.chainId,
    input.params.baseTokenId,
    input.amountIn
  )
  IntentLib.verifyRelayFee(input.acceptableRelayFee, ctx.signedBalance + input.amountIn)

  const intent: ISpokeGate__OperateIntent = {
    params: input.params,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: input.chainId,
    baseToken,
    callList: input.callList,
    amountIn: input.amountIn,
    amountOut: input.amountOut
  }

  const domain = SPOKE_GATE_DOMAIN_MAP[ctx.chainId]
  if (!domain) throw new CompactError('BAD_REQUEST', `unsupported chain ${ctx.chainId}`)
  const { callList, ...rest } = intent
  const typedData: TypedDataDefinition = {
    domain,
    ...SPOKE_GATE_INTENTS.operate,
    message: { ...rest, callListHash: keccak256(encodeAbiParameters(CALL_TUPLE_ARRAY, [callList])) }
  }
  return { intent, typedData, args: [intent] }
}
