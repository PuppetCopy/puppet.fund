import type { IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import {
  type IClaimInput,
  type ILiquidateInput,
  type IRedeemInput,
  type ISellInput,
  resolveDispatchChainId,
  resolveDispatchNetwork
} from '@puppet/sdk/attestation'
import { evaluateAccountNav } from '@puppet/sdk/evaluate'
import {
  getAcceptableRelayFee,
  getFundPoolState,
  getSubaccountState,
  type ISubaccountState,
  indexerBlock,
  randomNonce
} from '@puppet/sdk/state'
import type { Address, Hex } from 'viem'
import { fetchMasterPoolState } from '../../../io/indexer/query.js'
import { homePublicClient } from '../../../wallet/index.js'
import type { IClaimDraft, IRedeemDraft, ISellDraft } from '../draft.js'
import { DEFAULT_DEADLINE_SEC, type ExecContext } from './_shared.js'

async function resolveFund(
  draft: ISellDraft | IClaimDraft | IRedeemDraft,
  ctx: ExecContext
): Promise<ISubaccountState> {
  const fund = await getSubaccountState(ctx.sql, draft.masterAccount)
  if (!fund) throw new Error(`fund ${draft.masterAccount} not in indexer`)
  return fund
}

// The redeem intents carry the fund's NAME because the ShareToken address derives from
// it; the digest only verifies against the name the fund was created with.
async function fundName(master: Address): Promise<Hex> {
  const fund = await fetchMasterPoolState(master)
  if (!fund) throw new Error(`fund ${master} pool state not in indexer`)
  return fund.name as Hex
}

export async function buildSellInput(draft: ISellDraft, ctx: ExecContext): Promise<ISellInput> {
  const fund = await resolveFund(draft, ctx)
  const params: IAccountLib__AccountInitParams = {
    user: ctx.wallet.address,
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
    share: {
      master: fund.signer,
      baseTokenId: draft.baseTokenId,
      name: await fundName(draft.masterAccount)
    },
    sharesOut: draft.sharesOut
  }
}

export async function buildRedeemInput(draft: IRedeemDraft, ctx: ExecContext): Promise<IRedeemInput> {
  const fund = await resolveFund(draft, ctx)
  const [pool, acceptableRelayFee, redeemEval] = await Promise.all([
    getFundPoolState(ctx.sql, draft.masterAccount),
    getAcceptableRelayFee(ctx.gasPrice, 'HubGate', 'redeem', draft.baseToken, homePublicClient),
    evaluateAccountNav(ctx.sql, {
      master: draft.masterAccount,
      baseToken: draft.baseToken,
      baseTokenId: draft.baseTokenId,
      health: ctx.indexerHealth,
      kind: 'redeem',
      subaccount: fund
    })
  ])
  // navSigned builds on the fund's SIGNED balances (true accounting), which is exactly
  // what the drain can pay; no live clamp needed.
  const acceptableNetAssetValue = redeemEval.navSigned
  // Signed always equals executed: assetsOut above the live queue value reverts, so the
  // amount re-derives at sign time. A fulfill signs exactly the queue's worth; a queue
  // that grew in-flight simply makes the same signed amount a graceful partial.
  const queueValue =
    pool.totalShareSupply === 0n
      ? 0n
      : ((pool.queuedShares + draft.sharesOut) * acceptableNetAssetValue) / pool.totalShareSupply
  const assetsOut = draft.fulfill || draft.assetsOut > queueValue ? queueValue : draft.assetsOut
  return {
    params: {
      user: ctx.wallet.address,
      signer: ctx.session.signer
    },
    blockNumber: indexerBlock(ctx.indexerHealth, resolveDispatchNetwork(resolveDispatchChainId(undefined))),
    deadline: BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC),
    acceptableRelayFee,
    nonce: randomNonce(),
    share: {
      master: fund.signer,
      baseTokenId: draft.baseTokenId,
      name: await fundName(draft.masterAccount)
    },
    sharesOut: draft.sharesOut,
    assetsOut,
    acceptableNetAssetValue
  }
}

export async function buildLiquidateInput(draft: IRedeemDraft, ctx: ExecContext): Promise<ILiquidateInput> {
  const fund = await resolveFund(draft, ctx)
  const [acceptableRelayFee, liquidateEval] = await Promise.all([
    getAcceptableRelayFee(ctx.gasPrice, 'HubGate', 'liquidate', draft.baseToken, homePublicClient),
    evaluateAccountNav(ctx.sql, {
      master: draft.masterAccount,
      baseToken: draft.baseToken,
      baseTokenId: draft.baseTokenId,
      health: ctx.indexerHealth,
      kind: 'liquidate',
      subaccount: fund
    })
  ])
  return {
    params: {
      user: ctx.wallet.address,
      signer: ctx.session.signer
    },
    blockNumber: indexerBlock(ctx.indexerHealth, resolveDispatchNetwork(resolveDispatchChainId(undefined))),
    deadline: BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC),
    acceptableRelayFee,
    nonce: randomNonce(),
    share: {
      master: fund.signer,
      baseTokenId: draft.baseTokenId,
      name: await fundName(draft.masterAccount)
    },
    acceptableNetAssetValue: liquidateEval.navSigned
  }
}

export async function buildClaimInput(draft: IClaimDraft, ctx: ExecContext): Promise<IClaimInput> {
  const fund = await resolveFund(draft, ctx)
  const params: IAccountLib__AccountInitParams = {
    user: ctx.wallet.address,
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
    share: {
      master: fund.signer,
      baseTokenId: draft.baseTokenId,
      name: await fundName(draft.masterAccount)
    },
    amount: draft.amount
  }
}
