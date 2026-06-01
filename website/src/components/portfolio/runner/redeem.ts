import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import { EMPTY_NAME } from '@puppet/sdk/account'
import {
  fetchAccountOrThrow,
  type IClaimInput,
  type IFulfillInput,
  type ISellInput,
  resolveDispatchChainId,
  resolveDispatchNetwork
} from '@puppet/sdk/attestation'
import {
  getAcceptableRelayFee,
  getMasterPoolState,
  getSubaccountState,
  indexerBlock,
  randomNonce
} from '@puppet/sdk/state'
import { homePublicClient } from '../../../wallet/index.js'
import type { IClaimDraft, IFulfillDraft, ISellDraft } from '../draft.js'
import { DEFAULT_DEADLINE_SEC, type ExecContext } from './_shared.js'

async function resolveMasterParams(
  draft: ISellDraft | IClaimDraft | IFulfillDraft,
  ctx: ExecContext
): Promise<IAccountLib__AccountInitParams> {
  const master = await getSubaccountState(ctx.sql, draft.masterAccount)
  if (!master) throw new Error(`master ${draft.masterAccount} not in indexer`)
  return { user: master.user, name: EMPTY_NAME, baseTokenId: master.baseTokenId, signer: master.signer }
}

export async function buildSellInput(draft: ISellDraft, ctx: ExecContext): Promise<ISellInput> {
  const masterParams = await resolveMasterParams(draft, ctx)
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
  const params = await resolveMasterParams(draft, ctx)
  const [masterRow, pool, acceptableRelayFee] = await Promise.all([
    fetchAccountOrThrow(ctx.sql, draft.masterAccount, HUB_CHAIN_ID),
    getMasterPoolState(ctx.sql, draft.masterAccount),
    getAcceptableRelayFee(ctx.gasPrice, 'HubGate', 'fulfill', draft.baseToken, homePublicClient)
  ])
  return {
    params,
    blockNumber: indexerBlock(ctx.indexerHealth, resolveDispatchNetwork(resolveDispatchChainId(undefined))),
    deadline: BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC),
    acceptableRelayFee,
    nonce: randomNonce(),
    acceptableNetAssetValue: masterRow.signedBalance,
    totalShareSupply: pool.totalShareSupply,
    acceptableShares: draft.acceptableShares
  }
}

export async function buildClaimInput(draft: IClaimDraft, ctx: ExecContext): Promise<IClaimInput> {
  const masterParams = await resolveMasterParams(draft, ctx)
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
