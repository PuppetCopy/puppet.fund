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
import { HUB_DOMAIN, type IDeployProof, type IDraftContext } from './shared.js'

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

// Mirror Mandate.sol's per-rule check: each non-empty rule carries the puppet's signature over
// Mandate(puppet, fund, baseToken, bodyHash) and the gate runs IntentLib.verifySignature(puppetAccount, ...)
// (ERC-1271 against the account) before storing it. The relay reconstructs the same digest and verifies it
// through the account's own isValidSignature, so a bad inner-rule signature is rejected up front instead of
// only by the on-chain simulate backstop. Verifiable only once the account is DEPLOYED (isValidSignature is a
// contract call); the create-on-first-use path defers to the on-chain deploy-then-verify ordering + backstop.
// An empty body (revoke) carries no signature on-chain, so it is skipped here too. Reads fail loud: a verify
// call that throws (RPC failure) propagates rather than masquerading as an invalid signature.
type ITypedDataVerifier = {
  verifyTypedData: (args: {
    address: Address
    domain: typeof HUB_DOMAIN
    types: typeof MANDATE_TYPED_DATA.types
    primaryType: typeof MANDATE_TYPED_DATA.primaryType
    message: { puppet: Address; fund: Address; baseToken: Address; bodyHash: Hex }
    signature: Hex
  }) => Promise<boolean>
}

export async function verifyMandateRuleSignatures(
  client: ITypedDataVerifier,
  puppet: Address,
  baseToken: Address,
  rules: readonly IMandateRule[]
): Promise<void> {
  for (const rule of rules) {
    if (rule.body === '0x') continue
    const fund = predictFundAccount(rule.fundParams)
    const ok = await client.verifyTypedData({
      address: puppet,
      domain: HUB_DOMAIN,
      ...MANDATE_TYPED_DATA,
      message: { puppet, fund, baseToken, bodyHash: keccak256(rule.body) },
      signature: rule.mandate
    })
    if (!ok) throw new CompactContractError('Account__InvalidSignature', [])
  }
}

// Under multi-key CREATE2 a fund address derives from {master, baseToken, name};
// a bare account address can no longer reconstruct it. Each rule therefore carries the
// funded fund's identity so the off-chain builder can derive the on-chain Rule.fund.
export interface IMandateRule {
  fundParams: IFundAccountLib__FundAccountInitParams
  body: Hex
  mandate: Hex
}

export interface IMandateInput extends IDeployProof {
  params: IAccountLib__AccountInitParams
  baseToken: Address
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  rules: readonly IMandateRule[]
}

interface IMandateAttestContext extends IDraftContext {
  currentBlock: bigint
  signedBalance: bigint
  routeBalance: bigint
}

export function attestMandateIntent(ctx: IMandateAttestContext, input: IMandateInput) {
  // HubGate._mandate sweeps the puppet's deposit route into its signed balance (auto-recognize: _recognize =
  // base.balanceOf(route)) and pays the relay fee from the combined balance — verifyRelayFeeRatio(fee, signedBalanceOf +
  // recognize). Mirror that here so a fresh deposit sitting on the route covers the fee with NO separate recognize step.
  const creditable = ctx.signedBalance + ctx.routeBalance
  IntentLib.verifyCommonIntent(ctx, {
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    baseToken: input.baseToken,
    lookupChain: HUB_CHAIN_ID,
    capAmount: 0n,
    acceptableRelayFee: input.acceptableRelayFee,
    relayFeeDenominator: creditable
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

  if (creditable < input.acceptableRelayFee) {
    throw new CompactError(
      'MANDATE_INSUFFICIENT_FEE_BALANCE',
      `puppet base balance ${creditable} (signed ${ctx.signedBalance} + route ${ctx.routeBalance}) below mandate relay fee ${input.acceptableRelayFee}; deposit a small amount first`
    )
  }

  const intent: IMandate__MandateIntent = {
    params: input.params,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: BigInt(ctx.chainId),
    baseToken: input.baseToken,
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
