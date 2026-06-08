import type { IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import { EMPTY_NAME } from '@puppet/sdk/account'
import {
  type IClaimInput,
  type IFulfillInput,
  type ISellInput,
  resolveDispatchChainId,
  resolveDispatchNetwork
} from '@puppet/sdk/attestation'
import { evaluateAccountNav } from '@puppet/sdk/evaluation'
import {
  getAcceptableRelayFee,
  getMasterPoolState,
  getSubaccountState,
  type ISubaccountState,
  indexerBlock,
  randomNonce
} from '@puppet/sdk/state'
import { homePublicClient } from '../../../wallet/index.js'
import type { IClaimDraft, IFulfillDraft, ISellDraft } from '../draft.js'
import { DEFAULT_DEADLINE_SEC, type ExecContext } from './_shared.js'

async function resolveMasterParams(
  draft: ISellDraft | IClaimDraft | IFulfillDraft,
  ctx: ExecContext
): Promise<{ params: IAccountLib__AccountInitParams; subaccount: ISubaccountState }> {
  const subaccount = await getSubaccountState(ctx.sql, draft.masterAccount)
  if (!subaccount) throw new Error(`master ${draft.masterAccount} not in indexer`)
  return {
    params: { user: subaccount.user, name: EMPTY_NAME, baseTokenId: subaccount.baseTokenId, signer: subaccount.signer },
    subaccount
  }
}

export async function buildSellInput(draft: ISellDraft, ctx: ExecContext): Promise<ISellInput> {
  const { params: masterParams } = await resolveMasterParams(draft, ctx)
  const params: IAccountLib__AccountInitParams = {
    user: ctx.wallet.address,
    name: EMPTY_NAME,
    baseTokenId: masterParams.baseTokenId,
    signer: ctx.session.signer
  }
  const acceptableRelayFee = await getAcceptableRelayFee(
    ctx.gasPrice,
    'HubGate',
    'sell',
    draft.baseToken,
    homePublicClient
  )
  return {
    params,
    blockNumber: indexerBlock(ctx.indexerHealth, resolveDispatchNetwork(resolveDispatchChainId(undefined))),
    deadline: BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC),
    acceptableRelayFee,
    nonce: randomNonce(),
    masterParams,
    sharesOut: draft.sharesOut
  }
}

export async function buildFulfillInput(draft: IFulfillDraft, ctx: ExecContext): Promise<IFulfillInput> {
  const { params, subaccount } = await resolveMasterParams(draft, ctx)
  const [pool, acceptableRelayFee, fulfillEval] = await Promise.all([
    getMasterPoolState(ctx.sql, draft.masterAccount),
    getAcceptableRelayFee(ctx.gasPrice, 'HubGate', 'fulfill', draft.baseToken, homePublicClient),
    evaluateAccountNav(ctx.sql, {
      master: draft.masterAccount,
      baseToken: draft.baseToken,
      health: ctx.indexerHealth,
      kind: 'fulfill',
      subaccount
    })
  ])
  return {
    params,
    blockNumber: indexerBlock(ctx.indexerHealth, resolveDispatchNetwork(resolveDispatchChainId(undefined))),
    deadline: BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC),
    acceptableRelayFee,
    nonce: randomNonce(),
    acceptableNetAssetValue: fulfillEval.navSigned,
    totalShareSupply: pool.totalShareSupply,
    acceptableShares: draft.acceptableShares
  }
}

export async function buildClaimInput(draft: IClaimDraft, ctx: ExecContext): Promise<IClaimInput> {
  const { params: masterParams } = await resolveMasterParams(draft, ctx)
  const params: IAccountLib__AccountInitParams = {
    user: ctx.wallet.address,
    name: EMPTY_NAME,
    baseTokenId: masterParams.baseTokenId,
    signer: ctx.session.signer
  }
  const acceptableRelayFee = await getAcceptableRelayFee(
    ctx.gasPrice,
    'HubGate',
    'claim',
    draft.baseToken,
    homePublicClient
  )
  return {
    params,
    blockNumber: indexerBlock(ctx.indexerHealth, resolveDispatchNetwork(resolveDispatchChainId(undefined))),
    deadline: BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC),
    acceptableRelayFee,
    nonce: randomNonce(),
    masterParams,
    amount: draft.amount
  }
}
