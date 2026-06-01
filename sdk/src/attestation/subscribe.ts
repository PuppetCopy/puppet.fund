import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { HUB_GATE_INTENTS } from '@puppet/contracts/intents'
import type { IAccountLib__AccountInitParams, ISubscribeModule__SubscribeIntent } from '@puppet/contracts/types'
import { type Address, type Hex, isAddressEqual, keccak256, type TypedDataDefinition } from 'viem'
import type { LocalAccount } from 'viem/accounts'
import { predictMasterAccount } from '../account/index.js'
import { CompactContractError } from '../compact/error.js'
import { CompactError } from '../compact/index.js'
import * as IntentLib from './intentLib.js'
import { HUB_DOMAIN, type IDraftContext } from './shared.js'

export const MANDATE_TYPED_DATA = {
  primaryType: 'Mandate' as const,
  types: {
    Mandate: [
      { name: 'puppet', type: 'address' },
      { name: 'master', type: 'address' },
      { name: 'baseToken', type: 'address' },
      { name: 'bodyHash', type: 'bytes32' }
    ]
  }
} satisfies Pick<TypedDataDefinition, 'primaryType' | 'types'>

export async function signMandate(
  signer: LocalAccount,
  puppet: Address,
  master: Address,
  baseToken: Address,
  body: Hex
): Promise<Hex> {
  return signer.signTypedData({
    domain: HUB_DOMAIN,
    ...MANDATE_TYPED_DATA,
    message: { puppet, master, baseToken, bodyHash: keccak256(body) }
  })
}

export interface ISubscribeRule {
  masterParams: IAccountLib__AccountInitParams
  body: Hex
  mandate: Hex
}

export interface ISubscribeInput {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  rules: readonly ISubscribeRule[]
}

export interface ISubscribeAttestContext extends IDraftContext {
  currentBlock: bigint
  signedBalance: bigint
}

export function attestSubscribeIntent(ctx: ISubscribeAttestContext, input: ISubscribeInput) {
  IntentLib.verifyTimeBounds(input.blockNumber, input.deadline, ctx.currentBlock)
  const baseToken = IntentLib.verifyTokenAndCap(ctx.tokenRegistry, HUB_CHAIN_ID, input.params.baseTokenId, 0n)

  const n = input.rules.length
  if (n === 0) throw new CompactContractError('Subscribe__EmptyRules', [])

  let prev: Address = '0x0000000000000000000000000000000000000000'
  for (let i = 0; i < n; i++) {
    const rule = input.rules[i]!
    if (input.params.baseTokenId !== rule.masterParams.baseTokenId) {
      throw new CompactContractError('Subscribe__BaseTokenMismatch', [
        input.params.baseTokenId,
        rule.masterParams.baseTokenId
      ])
    }
    if (isAddressEqual(input.params.user, rule.masterParams.user)) {
      throw new CompactContractError('Subscribe__SelfSubscribe', [input.params.user])
    }
    const master = predictMasterAccount(rule.masterParams)
    if (BigInt(master) <= BigInt(prev)) {
      throw new CompactContractError('Subscribe__MasterListNotSorted', [prev, master])
    }
    prev = master
  }

  IntentLib.verifyRelayFee(input.acceptableRelayFee, ctx.signedBalance)

  // SDK-only preflight: subscribe deducts the relay fee from signedBalance at runtime (Account__OutflowExceedsSigned);
  // no contract revert covers an under-funded fee balance, so surface it off-chain before signing.
  if (ctx.signedBalance < input.acceptableRelayFee) {
    throw new CompactError(
      'SUBSCRIBE_INSUFFICIENT_FEE_BALANCE',
      `puppet base balance ${ctx.signedBalance} below subscribe relay fee ${input.acceptableRelayFee}; deposit a small amount first`
    )
  }

  const intent: ISubscribeModule__SubscribeIntent = {
    params: input.params,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: BigInt(ctx.chainId),
    baseToken,
    rules: input.rules.map(r => ({ masterParams: r.masterParams, body: r.body, mandate: r.mandate }))
  }

  const typedData: TypedDataDefinition = {
    domain: HUB_DOMAIN,
    ...HUB_GATE_INTENTS.subscribe,
    message: intent as unknown as Record<string, unknown>
  }
  if (!HUB_DOMAIN) throw new CompactError('BAD_REQUEST', 'missing HUB domain')
  return { intent, typedData, args: [intent] }
}
