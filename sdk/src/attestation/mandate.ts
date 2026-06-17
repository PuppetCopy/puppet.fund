import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { HUB_GATE_INTENTS } from '@puppet/contracts/intents'
import type {
  IAccountLib__AccountInitParams,
  IFundAccountLib__FundAccountInitParams,
  IMandate__MandateIntent,
  IRuleLib__Rule
} from '@puppet/contracts/types'
import { type Address, type Hex, isAddressEqual, keccak256, type TypedDataDefinition } from 'viem'
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

// Under multi-key CREATE2 a fund address derives from {master, baseTokenId, name};
// a bare account address can no longer reconstruct it. Each rule therefore carries the
// funded fund's identity so the off-chain builder can derive the on-chain Rule.fund.
export interface IMandateRule {
  fundParams: IFundAccountLib__FundAccountInitParams
  body: Hex
  mandate: Hex
}

export interface IMandateInput {
  params: IAccountLib__AccountInitParams
  baseTokenId: Hex
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  rules: readonly IMandateRule[]
}

export interface IMandateAttestContext extends IDraftContext {
  currentBlock: bigint
  signedBalance: bigint
}

export function attestMandateIntent(ctx: IMandateAttestContext, input: IMandateInput) {
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
  if (n === 0) throw new CompactContractError('Mandate__EmptyRules', [])

  const puppetAccount = predictPuppetAccount(input.params)

  let prev: Address = '0x0000000000000000000000000000000000000000'
  for (let i = 0; i < n; i++) {
    const rule = input.rules[i]!
    const fund = predictFundAccount(rule.fundParams)
    // A fund whose master is this puppet's own account is signed by that puppet (the
    // contract reads FundAccount.getSigner()); the puppet may not mandate its own fund.
    if (isAddressEqual(rule.fundParams.master, puppetAccount)) {
      throw new CompactContractError('Mandate__SelfFund', [input.params.user])
    }
    if (i > 0 && BigInt(fund) <= BigInt(prev)) {
      throw new CompactContractError('Mandate__FundListNotSorted', [prev, fund])
    }
    prev = fund
  }

  if (ctx.signedBalance < input.acceptableRelayFee) {
    throw new CompactError(
      'MANDATE_INSUFFICIENT_FEE_BALANCE',
      `puppet base balance ${ctx.signedBalance} below mandate relay fee ${input.acceptableRelayFee}; deposit a small amount first`
    )
  }

  const intent: IMandate__MandateIntent = {
    params: input.params,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: BigInt(ctx.chainId),
    baseTokenId: input.baseTokenId,
    rules: input.rules.map(
      (r): IRuleLib__Rule => ({ fund: predictFundAccount(r.fundParams), body: r.body, mandate: r.mandate })
    )
  }

  if (!HUB_DOMAIN) throw new CompactError('BAD_REQUEST', 'missing HUB domain')
  const typedData: TypedDataDefinition = {
    domain: HUB_DOMAIN,
    ...HUB_GATE_INTENTS.mandate,
    message: intent as unknown as Record<string, unknown>
  }
  return { intent, typedData, args: [intent] }
}
