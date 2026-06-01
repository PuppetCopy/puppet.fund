import type { IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import { EMPTY_NAME, predictMasterAccount, predictPuppetAccount } from '@puppet/sdk/account'
import {
  encodeRuleBody,
  type ISubscribeInput,
  isRevokedRule,
  resolveDispatchChainId,
  resolveDispatchNetwork,
  signMandate
} from '@puppet/sdk/attestation'
import { getAcceptableRelayFee, getSubaccountState, indexerBlock, randomNonce } from '@puppet/sdk/state'
import type { Hex } from 'viem'
import { homePublicClient } from '../../../wallet/index.js'
import type { ISubscribeDraft } from '../draft.js'
import { DEFAULT_DEADLINE_SEC, type ExecContext } from './_shared.js'

export async function buildSubscribeInput(draft: ISubscribeDraft, ctx: ExecContext): Promise<ISubscribeInput> {
  const master = await getSubaccountState(ctx.sql, draft.master)
  if (!master) throw new Error(`master ${draft.master} not in indexer`)
  const masterParams: IAccountLib__AccountInitParams = {
    user: master.user,
    name: EMPTY_NAME,
    baseTokenId: master.baseTokenId,
    signer: master.signer
  }
  const params: IAccountLib__AccountInitParams = {
    user: ctx.wallet.address,
    name: EMPTY_NAME,
    baseTokenId: masterParams.baseTokenId,
    signer: ctx.session.signer
  }
  const puppet = predictPuppetAccount(params)

  const acceptableRelayFee = await getAcceptableRelayFee(
    ctx.gasPrice,
    'HubGate',
    'subscribe',
    draft.baseToken,
    homePublicClient
  )

  const ruleBody = {
    throttlePeriod: draft.throttlePeriod,
    rateLimit: draft.rateLimit,
    exitFreeze: draft.exitFreeze,
    allocationRate: draft.allocationRate,
    symmetry: draft.symmetry
  }
  const masterAddress = predictMasterAccount(masterParams)
  const revoked = isRevokedRule(ruleBody)
  const body: Hex = revoked ? '0x' : encodeRuleBody(ruleBody)
  const mandate: Hex = revoked
    ? '0x'
    : await signMandate(ctx.session.account, puppet, masterAddress, draft.baseToken, body)
  const blockNumber = indexerBlock(ctx.indexerHealth, resolveDispatchNetwork(resolveDispatchChainId(undefined)))

  return {
    params,
    rules: [{ masterParams, body, mandate }],
    blockNumber,
    deadline: BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC),
    nonce: randomNonce(),
    acceptableRelayFee
  }
}
