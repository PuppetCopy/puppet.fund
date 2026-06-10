import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { HUB_GATE_INTENTS } from '@puppet/contracts/intents'
import type {
  IAccountLib__AccountInitParams,
  IRuleLib__Rule,
  ISubscribeModule__SubscribeIntent
} from '@puppet/contracts/types'
import { type Address, type Hex, keccak256, type TypedDataDefinition } from 'viem'
import type { LocalAccount } from 'viem/accounts'
import { predictFundAccount, predictPuppetAccount } from '../account/index.js'
import { CompactContractError } from '../compact/error.js'
import { CompactError } from '../compact/index.js'
import * as IntentLib from './intentLib.js'
import { HUB_DOMAIN, type IDraftContext } from './shared.js'

export const MANDATE_TYPED_DATA = {
  primaryType: 'Mandate' as const,
  types: {
    Mandate: [
      { name: 'puppet', type: 'address' },
      { name: 'fund', type: 'address' },
      { name: 'baseToken', type: 'address' },
      { name: 'bodyHash', type: 'bytes32' }
    ]
  }
} satisfies Pick<TypedDataDefinition, 'primaryType' | 'types'>

export async function signMandate(
  signer: LocalAccount,
  puppet: Address,
  fund: Address,
  baseToken: Address,
  body: Hex
): Promise<Hex> {
  return signer.signTypedData({
    domain: HUB_DOMAIN,
    ...MANDATE_TYPED_DATA,
    message: { puppet, fund, baseToken, bodyHash: keccak256(body) }
  })
}

export interface ISubscribeRule {
  master: Address
  body: Hex
  mandate: Hex
}

export interface ISubscribeInput {
  params: IAccountLib__AccountInitParams
  baseTokenId: Hex
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
  IntentLib.verifyCommonIntent(ctx, {
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    baseTokenId: input.baseTokenId,
    lookupChain: HUB_CHAIN_ID,
    capAmount: 0n,
    acceptableRelayFee: input.acceptableRelayFee,
    relayFeeDenominator: ctx.signedBalance
  })

  const n = input.rules.length
  if (n === 0) throw new CompactContractError('Subscribe__EmptyRules', [])

  const ownFund = predictFundAccount(predictPuppetAccount(input.params))

  let prev: Address = '0x0000000000000000000000000000000000000000'
  for (let i = 0; i < n; i++) {
    const rule = input.rules[i]!
    const fund = predictFundAccount(rule.master)
    if (fund === ownFund) {
      throw new CompactContractError('Subscribe__SelfSubscribe', [input.params.user])
    }
    if (i > 0 && BigInt(fund) <= BigInt(prev)) {
      throw new CompactContractError('Subscribe__FundListNotSorted', [prev, fund])
    }
    prev = fund
  }

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
    baseTokenId: input.baseTokenId,
    rules: input.rules.map(
      (r): IRuleLib__Rule => ({ fund: predictFundAccount(r.master), body: r.body, mandate: r.mandate })
    )
  }

  if (!HUB_DOMAIN) throw new CompactError('BAD_REQUEST', 'missing HUB domain')
  const typedData: TypedDataDefinition = {
    domain: HUB_DOMAIN,
    ...HUB_GATE_INTENTS.subscribe,
    message: intent as unknown as Record<string, unknown>
  }
  return { intent, typedData, args: [intent] }
}
