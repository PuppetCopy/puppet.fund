import type { IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import { predictFundAccount, predictPuppetAccount } from '@puppet/sdk/account'
import {
  encodeRuleBody,
  type IMandateInput,
  type IMandateRule,
  isRevokedRule,
  signMandate
} from '@puppet/sdk/attestation'
import type { Hex } from 'viem'
import type { ISubscribeDraft } from '../draft.js'
import { type ExecContext, resolveRelayFee, stepMetadata } from './_shared.js'

export async function buildMandateInput(drafts: ISubscribeDraft[], ctx: ExecContext): Promise<IMandateInput> {
  const params: IAccountLib__AccountInitParams = {
    user: ctx.wallet.address,
    signer: ctx.session.signer
  }
  const puppet = predictPuppetAccount(params)
  const baseToken = drafts[0]!.baseToken

  const acceptableRelayFee = await resolveRelayFee(ctx, 'HubGate', 'mandate', baseToken, BigInt(drafts.length))

  const built = await Promise.all(
    drafts.map(async draft => {
      const ruleBody = {
        throttlePeriod: draft.throttlePeriod,
        rateLimit: draft.rateLimit,
        exitFreeze: draft.exitFreeze,
        allocationRate: draft.allocationRate,
        symmetry: draft.symmetry
      }
      // The fund's pinned name (carried on the rule) completes its {master, baseToken, name}
      // CREATE2 identity so the on-chain fund address derives correctly under multi-key.
      const fundParams = { master: draft.master, baseToken: draft.baseToken, name: draft.name }
      const fund = predictFundAccount(fundParams)
      const revoked = isRevokedRule(ruleBody)
      const body: Hex = revoked ? '0x' : encodeRuleBody(ruleBody)
      const mandate: Hex = revoked ? '0x' : await signMandate(ctx.session.account, puppet, fund, baseToken, body)
      return { fund, rule: { fundParams, body, mandate } satisfies IMandateRule }
    })
  )
  built.sort((a, b) => (BigInt(a.fund) < BigInt(b.fund) ? -1 : BigInt(a.fund) > BigInt(b.fund) ? 1 : 0))

  return {
    params,
    baseToken,
    rules: built.map(b => b.rule),
    ...stepMetadata(ctx),
    acceptableRelayFee,
    userDeploySig: ctx.session.bindSig,
    userSignerProof: ctx.session.signerProof
  }
}
