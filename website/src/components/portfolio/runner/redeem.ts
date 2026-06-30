import type { IClaimInput, ILiquidateInput, IRedeemInput, ISellInput } from '@puppet/sdk/attestation'
import { assertNavSignable, composeCashLeg, evaluateAccountNav } from '@puppet/sdk/evaluate'
import { fundTable } from '@puppet/sdk/schema'
import { getAddress } from 'viem'
import { getRate } from '../../../io/context.js'
import {  gmxPositionProvider } from '../../../io/gmx/navProviders.js'
import { client } from '../../../io/matchmaker/reads.js'
import type { IClaimDraft, IRedeemDraft, ISellDraft } from '../draft.js'
import { buildFundIntentEnvelope, type ExecContext } from './_shared.js'

export async function buildSellInput(draft: ISellDraft, ctx: ExecContext): Promise<ISellInput> {
  const { envelope } = await buildFundIntentEnvelope(ctx, {
    masterAccount: draft.masterAccount,
    baseToken: draft.baseToken,
    method: 'sell'
  })
  return { ...envelope, sharesOut: draft.sharesOut }
}

export async function buildRedeemInput(draft: IRedeemDraft, ctx: ExecContext): Promise<IRedeemInput> {
  const { envelope, fund } = await buildFundIntentEnvelope(ctx, {
    masterAccount: draft.masterAccount,
    baseToken: draft.baseToken,
    method: 'redeem'
  })
  const [pool, redeemEval] = await Promise.all([
    client.find(fundTable, { id: getAddress(draft.masterAccount) }),
    evaluateAccountNav({
      master: draft.masterAccount,
      baseToken: draft.baseToken,
      kind: 'redeem',
      cashLeg: composeCashLeg(fund, ctx.chainLiveness, draft.baseToken),
      getRate,
      positions: await gmxPositionProvider(draft.masterAccount, draft.baseToken)
    })
  ])
  assertNavSignable(redeemEval.gate)
  // A missing/zero pool snapshot (read not yet indexed, or a transient failure that resolved to no row) would clamp
  // assetsOut to 0n and sign a doomed redeem (reverts on RelayFeeTooHigh / NothingToRetire). Abort instead so the user
  // retries against a real snapshot rather than wasting a signature.
  if (!pool || pool.totalShareSupply === 0n) {
    throw new Error('Fund pool state is not available yet; refresh and retry the redeem.')
  }
  // navSigned builds on the fund's SIGNED balances (true accounting), which is exactly
  // what the drain can pay; no live clamp needed.
  const acceptableNetAssetValue = redeemEval.navSigned
  // Signed always equals executed: assetsOut above the live queue value reverts, so the
  // amount re-derives at sign time. A fulfill signs exactly the queue's worth; a queue
  // that grew in-flight simply makes the same signed amount a graceful partial.
  const queueValue = ((pool.queuedShares + draft.sharesOut) * acceptableNetAssetValue) / pool.totalShareSupply
  const assetsOut = draft.fulfill || draft.assetsOut > queueValue ? queueValue : draft.assetsOut
  return { ...envelope, sharesOut: draft.sharesOut, assetsOut, acceptableNetAssetValue }
}

export async function buildLiquidateInput(draft: IRedeemDraft, ctx: ExecContext): Promise<ILiquidateInput> {
  const { envelope, fund } = await buildFundIntentEnvelope(ctx, {
    masterAccount: draft.masterAccount,
    baseToken: draft.baseToken,
    method: 'liquidate'
  })
  const liquidateEval = await evaluateAccountNav({
    master: draft.masterAccount,
    baseToken: draft.baseToken,
    kind: 'liquidate',
    cashLeg: composeCashLeg(fund, ctx.chainLiveness, draft.baseToken),
    getRate,
    positions: await gmxPositionProvider(draft.masterAccount, draft.baseToken)
  })
  assertNavSignable(liquidateEval.gate)
  return { ...envelope, acceptableNetAssetValue: liquidateEval.navSigned }
}

export async function buildClaimInput(draft: IClaimDraft, ctx: ExecContext): Promise<IClaimInput> {
  const { envelope } = await buildFundIntentEnvelope(ctx, {
    masterAccount: draft.masterAccount,
    baseToken: draft.baseToken,
    method: 'claim'
  })
  return { ...envelope }
}
