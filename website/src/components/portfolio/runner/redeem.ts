import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { IClaimInput, ILiquidateInput, IRedeemInput, ISellInput } from '@puppet/sdk/attestation'
import { HUB_CHAIN } from '@puppet/sdk/const'
import { assertNavSignable, composeCashLeg, composeHoldings, evaluateAccountNav } from '@puppet/sdk/evaluate'
import { fundTable } from '@puppet/sdk/schema'
import { getAddress } from 'viem'
import { getRate } from '../../../io/context.js'
import { client } from '../../../io/datastore/reads.js'
import { gmxClaimableProvider, gmxOrderProvider, gmxPositionProvider } from '../../../io/gmx/navProviders.js'
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
      holdings: composeHoldings(fund, draft.baseToken),
      getRate,
      positions: await gmxPositionProvider(draft.masterAccount, draft.baseToken),
      orders: await gmxOrderProvider(draft.masterAccount),
      claimables: await gmxClaimableProvider(draft.masterAccount)
    })
  ])
  assertNavSignable(redeemEval.gate)
  // A missing/zero pool snapshot (read not yet indexed, or a transient failure that resolved to no row) would clamp
  // assetsOut to 0n and sign a doomed redeem (reverts on RelayFeeTooHigh / NothingToRetire). Abort instead so the user
  // retries against a real snapshot rather than wasting a signature.
  if (!pool || pool.totalShareSupply === 0n) {
    throw new Error('Fund pool state is not available yet; refresh and retry the redeem.')
  }
  // navSigned PRICES the queue (all-chain signed balances + holdings + position floor), but the drain itself can only
  // pay from the fund's hub base balance, so assetsOut clamps to that payable leg or the dispatch reverts on
  // Account__OutflowExceedsSigned. Both re-derive at sign time; a queue that grew in-flight simply makes the same
  // signed amount a graceful partial.
  const acceptableNetAssetValue = redeemEval.navSigned
  const supply = pool.totalShareSupply
  const payable = redeemEval.breakdown.perChain
    .filter(c => c.chainId === HUB_CHAIN_ID)
    .reduce((acc, c) => acc + c.signedBalance, 0n)
  const fullQueueValue = ((pool.queuedShares + draft.sharesOut) * acceptableNetAssetValue) / supply
  const target = draft.fulfill || draft.assetsOut > fullQueueValue ? fullQueueValue : draft.assetsOut
  const assetsOut = target < payable ? target : payable
  if (assetsOut === 0n) {
    throw new Error(
      `Nothing is payable on ${HUB_CHAIN.name}: redemptions draw from the fund's base balance there. Swap or bridge holdings back first, then retry.`
    )
  }
  // The drafted sharesOut was sized against a display snapshot; resize it to the clamped drain so the master never
  // queues shares this redeem cannot retire (ceil keeps the resulting queue worth >= assetsOut, never over-drained).
  let sharesOut = draft.sharesOut
  if (sharesOut > 0n && assetsOut < fullQueueValue) {
    const needed = (assetsOut * supply + acceptableNetAssetValue - 1n) / acceptableNetAssetValue - pool.queuedShares
    sharesOut = needed <= 0n ? 0n : needed < sharesOut ? needed : sharesOut
  }
  return { ...envelope, sharesOut, assetsOut, acceptableNetAssetValue }
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
    holdings: composeHoldings(fund, draft.baseToken),
    getRate,
    positions: await gmxPositionProvider(draft.masterAccount, draft.baseToken),
    orders: await gmxOrderProvider(draft.masterAccount),
    claimables: await gmxClaimableProvider(draft.masterAccount)
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
