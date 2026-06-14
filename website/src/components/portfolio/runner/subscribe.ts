import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import { predictFundAccount, predictPuppetAccount } from '@puppet/sdk/account'
import {
  encodeRuleBody,
  type ISubscribeInput,
  isRevokedRule,
  resolveDispatchChainId,
  resolveDispatchNetwork,
  signMandate
} from '@puppet/sdk/attestation'
import { getAcceptableRelayFee, indexerBlock, randomNonce } from '@puppet/sdk/state'
import type { Address, Hex } from 'viem'
import { homePublicClient } from '../../../wallet/index.js'
import type { ISubscribeDraft } from '../draft.js'
import { DEFAULT_DEADLINE_SEC, type ExecContext } from './_shared.js'

function resolveBaseTokenId(ctx: ExecContext, baseToken: Address): Hex {
  for (const info of ctx.tokenRegistry.get(HUB_CHAIN_ID)?.values() ?? []) {
    if (info.token === baseToken) return info.tokenId
  }
  throw new Error(`token ${baseToken} not registered on hub`)
}

export async function buildSubscribeInput(draft: ISubscribeDraft, ctx: ExecContext): Promise<ISubscribeInput> {
  const params: IAccountLib__AccountInitParams = {
    user: ctx.wallet.address,
    signer: ctx.session.signer
  }
  const puppet = predictPuppetAccount(params)
  const baseTokenId = resolveBaseTokenId(ctx, draft.baseToken)

  const acceptableRelayFee = await getAcceptableRelayFee(
    ctx.gasPrice,
    'HubGate',
    'subscribe',
    draft.baseToken,
    homePublicClient,
    1n
  )

  const ruleBody = {
    throttlePeriod: draft.throttlePeriod,
    rateLimit: draft.rateLimit,
    exitFreeze: draft.exitFreeze,
    allocationRate: draft.allocationRate,
    symmetry: draft.symmetry
  }
  const fund = predictFundAccount(draft.master)
  const revoked = isRevokedRule(ruleBody)
  const body: Hex = revoked ? '0x' : encodeRuleBody(ruleBody)
  const mandate: Hex = revoked ? '0x' : await signMandate(ctx.session.account, puppet, fund, draft.baseToken, body)
  const rule: ISubscribeInput['rules'][number] = { master: draft.master, body, mandate }
  const blockNumber = indexerBlock(ctx.indexerHealth, resolveDispatchNetwork(resolveDispatchChainId(undefined)))

  return {
    params,
    baseTokenId,
    rules: [rule],
    blockNumber,
    deadline: BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC),
    nonce: randomNonce(),
    acceptableRelayFee
  }
}
