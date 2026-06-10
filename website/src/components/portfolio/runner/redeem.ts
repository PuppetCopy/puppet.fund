import type { IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import {
  type IClaimInput,
  type IFulfillInput,
  type ISellInput,
  resolveDispatchChainId,
  resolveDispatchNetwork
} from '@puppet/sdk/attestation'
import { evaluateAccountNav } from '@puppet/sdk/evaluation'
import {
  fetchRouteBalance,
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
import type { IClaimDraft, IFulfillDraft, ISellDraft } from '../draft.js'
import { DEFAULT_DEADLINE_SEC, type ExecContext } from './_shared.js'

async function resolveFund(
  draft: ISellDraft | IClaimDraft | IFulfillDraft,
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
    baseTokenId: draft.baseTokenId,
    master: fund.signer,
    name: await fundName(draft.masterAccount),
    sharesOut: draft.sharesOut
  }
}

export async function buildFulfillInput(draft: IFulfillDraft, ctx: ExecContext): Promise<IFulfillInput> {
  const fund = await resolveFund(draft, ctx)
  const [pool, acceptableRelayFee, fulfillEval, liveBalance] = await Promise.all([
    getFundPoolState(ctx.sql, draft.masterAccount),
    getAcceptableRelayFee(ctx.gasPrice, 'HubGate', 'fulfill', draft.baseToken, homePublicClient),
    evaluateAccountNav(ctx.sql, {
      master: draft.masterAccount,
      baseToken: draft.baseToken,
      baseTokenId: draft.baseTokenId,
      health: ctx.indexerHealth,
      kind: 'fulfill',
      subaccount: fund
    }),
    fetchRouteBalance(homePublicClient, draft.baseToken, draft.masterAccount)
  ])
  // The fund pays sharesRetired * nav / supply (payout + relay fee) out of its live token balance, so an
  // indexer-overstated signed balance (fee debits are invisible to events) reverts the dispatch on-chain.
  // Clamp the attested NAV to what the fund can actually pay.
  const acceptableNetAssetValue = fulfillEval.navSigned < liveBalance ? fulfillEval.navSigned : liveBalance
  return {
    master: fund.signer,
    baseTokenId: draft.baseTokenId,
    blockNumber: indexerBlock(ctx.indexerHealth, resolveDispatchNetwork(resolveDispatchChainId(undefined))),
    deadline: BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC),
    acceptableRelayFee,
    nonce: randomNonce(),
    acceptableNetAssetValue,
    name: await fundName(draft.masterAccount),
    totalShareSupply: pool.totalShareSupply,
    acceptableShares: draft.acceptableShares
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
    baseTokenId: draft.baseTokenId,
    master: fund.signer,
    name: await fundName(draft.masterAccount),
    amount: draft.amount
  }
}
