import { HUB_CANONICAL_TOKEN, HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import type { IFund__Price, IFund__Valuation, IFundStore__Redemption, IRedeem__RedeemIntent } from '@puppet/contracts/types'
import { type Address, getAddress, isAddressEqual, type TypedDataDefinition } from 'viem'
import { CompactContractError, CompactError } from '../compact/error.js'
import { PRECISION } from '../const/common.js'
import type { ChainId } from '../const/index.js'
import { claimOf, type IRedeemPlan, payoutLineOf, planCohort, planRedeem, valuationOf, valueFor } from '../pool/index.js'
import type { IHoldingRow } from '../schema/index.js'
import { driftVerdict, redeemSignerGain } from '../evaluate/gain.js'
import { DEFAULT_EVALUATION_CONFIG } from '../evaluate/types.js'
import { dispatchGasLimit, type IFeeConvert, MAX_TX_GAS, redeemFeeOf } from '../state/fee.js'
import { verifyPricedDeadline } from './intentLib.js'
import { type IDraftContext, type IGenesisContext, intentTypedData, verifyFundShare, verifyHeaderOrGenesis } from './shared.js'
import type { IFundState, IHolderState } from './terms.js'
import { assetKey, type IValuationAudit, shadeQuote, verifyValuation } from './valuation.js'

export const REDEEM_FEE_BAND_BPS = 500n

export const claimantsOf = (master: Address, holders: ReadonlyMap<Address, IHolderState>, fraction: bigint): bigint =>
  BigInt([...holders].filter(([holder, s]) => !isAddressEqual(holder, master) && claimOf(s.holding, s.balance, Number(fraction)) > 0n).length)

const quotedOf = (convert: IFeeConvert, plan: IRedeemPlan, claimants: bigint): bigint =>
  redeemFeeOf(convert, { holders: claimants, masterPaid: plan.redemption.masterPay > 0n })

export const redeemFeeFor = (convert: IFeeConvert, claimants: bigint, plan: IRedeemPlan): bigint =>
  (quotedOf(convert, plan, claimants) * (2n * PRECISION.basisPoints + REDEEM_FEE_BAND_BPS)) / (2n * PRECISION.basisPoints)

export const REDEEM_BRIDGE_MARGIN_BPS = 100n
const REDEEM_FEE_CAP_MARGIN_BPS = 2500n

export const redeemLegFloorOf = (relayFee: bigint): bigint =>
  (relayFee * (PRECISION.basisPoints + REDEEM_FEE_CAP_MARGIN_BPS) + PROTOCOL.maxRelayFeeBps - 1n) / PROTOCOL.maxRelayFeeBps

const hubCashOf = (token: Address) => {
  const wrappable = isAddressEqual(token, HUB_CANONICAL_TOKEN.WETH)
  return (asset: { chainId: bigint; token: Address }): boolean =>
    asset.chainId === BigInt(HUB_CHAIN_ID) && (isAddressEqual(asset.token, token) || (wrappable && isAddressEqual(asset.token, PROTOCOL.nativeToken)))
}

export function redeemValuationOf(input: {
  valuation: IFund__Valuation
  token: Address
  fraction: bigint
  planOf: () => Pick<IRedeemPlan, 'supply' | 'masterShares' | 'masterPart' | 'full' | 'redemption'>
  performanceFee: bigint
}): IFund__Valuation {
  if (input.fraction === PRECISION.basisPoints) return { assetList: input.valuation.assetList.filter(hubCashOf(input.token)), positionList: [] }
  const gain = {
    valuation: redeemSignerGain({ plan: input.planOf(), performanceFee: input.performanceFee, protocolFeeShare: PROTOCOL.protocolFeeShare }),
    price: { above: 0n, below: 0n }
  }
  const quote = { valuation: input.valuation, price: { amount: 1n, value: 1n } }
  const lean = shadeQuote(quote, input.token, gain, DEFAULT_EVALUATION_CONFIG.driftToleranceBps).valuation
  if (isAddressEqual(input.token, HUB_CANONICAL_TOKEN.WETH)) return lean
  const half = shadeQuote(quote, input.token, gain, DEFAULT_EVALUATION_CONFIG.driftToleranceBps / 2n).valuation
  const line = payoutLineOf(input.valuation.assetList, input.token)
  return { assetList: lean.assetList.map((asset, i) => (input.valuation.assetList[i] === line ? half.assetList[i]! : asset)), positionList: lean.positionList }
}

export interface IRedeemSizeInput {
  fund: Pick<IFundState, 'supply' | 'masterShares' | 'performanceFee' | 'redemption'>
  valuation: IFund__Valuation
  token: Address
  price: IFund__Price | null
  convert: IFeeConvert
  claimants: (fraction: bigint) => bigint
  hub: { held: bigint; native: bigint }
  source: { chainId: ChainId; token: Address; amount: bigint }
  leg: { relayFee: bigint; input: bigint; output: bigint; least: bigint; price: IFund__Price } | null
}

export interface IRedeemSizing {
  fraction: bigint
  fee: bigint
  claimants: bigint
  plan: IRedeemPlan
  leg: { gross: bigint; routed: bigint; delivered: bigint } | null
  spend: bigint
}

const SIZING_LIMITS: ReadonlySet<string> = new Set(['Balance__InsufficientFund', 'Balance__ZeroAmount', 'Redeem__Dust', 'FULL_EXIT_LEAVES_VALUE'])

export function sizeRedeemAt(input: IRedeemSizeInput, fraction: bigint): IRedeemSizing {
  const { fund, source } = input
  const quote = input.leg
  const wrappable = isAddressEqual(input.token, HUB_CANONICAL_TOKEN.WETH)
  const hubCash = input.hub.held + (wrappable ? input.hub.native : 0n)
  const claimants = input.claimants(fraction)
  const cashLine = hubCashOf(input.token)
  const rate = wrappable ? { amount: 1n, value: 1n } : input.price
  const landed = (delivered: bigint) =>
    wrappable && source.chainId !== HUB_CHAIN_ID ? { held: input.hub.held, native: input.hub.native + delivered } : { held: input.hub.held + delivered, native: input.hub.native }
  const moved = (gross: bigint, delivered: bigint): IFund__Valuation => {
    if (quote === null || rate === null) return input.valuation
    const arrival = wrappable && source.chainId !== HUB_CHAIN_ID ? PROTOCOL.nativeToken : input.token
    const assetList = input.valuation.assetList.map(asset =>
      Number(asset.chainId) === source.chainId && isAddressEqual(asset.token, source.token) && asset.id === 0n
        ? { ...asset, amount: asset.amount - gross, value: asset.value - valueFor(gross, quote.price) }
        : asset
    )
    const at = assetList.findIndex(asset => Number(asset.chainId) === HUB_CHAIN_ID && isAddressEqual(asset.token, arrival) && asset.id === 0n)
    const value = valueFor(delivered, rate)
    return {
      assetList:
        at === -1
          ? [...assetList, { chainId: BigInt(HUB_CHAIN_ID), token: arrival, id: 0n, amount: delivered, value }]
          : assetList.map((asset, i) => (i === at ? { ...asset, amount: asset.amount + delivered, value: asset.value + value } : asset)),
      positionList: input.valuation.positionList
    }
  }
  const planAt = (cash: { held: bigint; native: bigint }, valuation: IFund__Valuation) => {
    const priceOf = (list: IFund__Valuation): IFund__Price | null => {
      const line = payoutLineOf(list.assetList, input.token)
      return line === null ? input.price : { amount: line.amount, value: line.value }
    }
    const baseAt = (nav: bigint, price: IFund__Price | null) => ({
      supply: fund.supply,
      masterBalance: fund.masterShares,
      redemption: fund.redemption,
      fraction,
      join: 0n,
      valuation: nav,
      token: input.token,
      price,
      held: cash.held,
      native: cash.native
    })
    const signed = redeemValuationOf({
      valuation,
      token: input.token,
      fraction,
      planOf: () => planRedeem({ ...baseAt(valuationOf(valuation), priceOf(valuation)), fee: 0n }),
      performanceFee: fund.performanceFee
    })
    const base = baseAt(valuationOf(signed), priceOf(signed))
    const fee = redeemFeeFor(input.convert, claimants, planRedeem({ ...base, fee: 0n }))
    const plan = planRedeem({ ...base, fee })
    if (plan.full) {
      const feeValue = valueFor(fee, plan.rate)
      const kept = [...valuation.assetList.filter(asset => !cashLine(asset)), ...valuation.positionList].filter(line => line.value >= feeValue).length
      if (kept > 0) {
        throw new CompactError(
          'FULL_EXIT_LEAVES_VALUE',
          `a full redemption pays out only the fund's cash on chain ${HUB_CHAIN_ID}, while ${kept} of its other holdings are each worth more than its fee`,
          'soft'
        )
      }
    }
    return { plan, fee }
  }
  if (quote === null) {
    const { plan, fee } = planAt(input.hub, input.valuation)
    return { fraction, fee, claimants, plan, leg: null, spend: plan.redemption.potLeft + plan.redemption.masterPay }
  }
  const whole = ((source.amount - quote.relayFee) * quote.output) / quote.input
  const upper = planAt(landed(whole), moved(source.amount, whole))
  if (upper.plan.full) {
    return { fraction, fee: upper.fee, claimants, plan: upper.plan, leg: { gross: source.amount, routed: source.amount - quote.relayFee, delivered: whole }, spend: source.amount }
  }
  const short = upper.plan.redemption.potLeft + upper.plan.redemption.masterPay - hubCash
  if (short <= 0n) {
    const { plan, fee } = planAt(input.hub, input.valuation)
    return { fraction, fee, claimants, plan, leg: null, spend: 0n }
  }
  const need = short + (short * REDEEM_BRIDGE_MARGIN_BPS) / PRECISION.basisPoints
  const wanted = (need * quote.input + quote.output - 1n) / quote.output
  const atLeast = wanted > quote.least ? wanted : quote.least
  const floor = redeemLegFloorOf(quote.relayFee)
  const gross = atLeast + quote.relayFee > floor ? atLeast + quote.relayFee : floor
  const delivered = ((gross - quote.relayFee) * quote.output) / quote.input
  const { plan, fee } = planAt(landed(delivered), moved(gross, delivered))
  return { fraction, fee, claimants, plan, leg: { gross, routed: gross - quote.relayFee, delivered }, spend: gross }
}

export function sizeRedeem(input: IRedeemSizeInput): IRedeemSizing {
  const { source } = input
  const fits = (fraction: bigint): IRedeemSizing | null => {
    try {
      const sized = sizeRedeemAt(input, fraction)
      return sized.spend <= source.amount ? sized : null
    } catch (err) {
      if ((err instanceof CompactContractError || err instanceof CompactError) && SIZING_LIMITS.has(err.code)) return null
      throw err
    }
  }
  const full = fits(PRECISION.basisPoints)
  if (full !== null) return full
  let best: IRedeemSizing | null = null
  for (let low = 1n, high = PRECISION.basisPoints - 1n; low <= high; ) {
    const mid = (low + high) / 2n
    const sized = fits(mid)
    if (sized === null) {
      high = mid - 1n
    } else {
      best = sized
      low = mid + 1n
    }
  }
  if (best === null) throw new CompactError('REDEEM_TOO_SMALL', `${source.amount} from chain ${source.chainId} is too little to pay one basis point of the fund after its fees`, 'hard')
  return best
}

interface IRedeemAttestContext extends IDraftContext, IGenesisContext {
  fund: IFundState | null
  audit: Omit<IValuationAudit, 'gain'> | null
  held: bigint
  native: bigint
  holders: ReadonlyMap<Address, IHolderState> | null
  convert: IFeeConvert | null
}

export async function attestRedeemIntent(
  ctx: IRedeemAttestContext,
  intent: IRedeem__RedeemIntent
): Promise<{ typedData: TypedDataDefinition; plan: IRedeemPlan }> {
  if (ctx.chainId !== HUB_CHAIN_ID) throw new CompactError('BAD_REQUEST', 'redemptions open on the hub chain only', 'hard')
  await verifyHeaderOrGenesis(ctx, intent.header, 'redeem')
  verifyPricedDeadline(intent.header.deadline, ctx.now)
  const master = getAddress(intent.header.account)
  verifyFundShare(ctx.fund, master, intent.shareToken)
  const token = getAddress(intent.token)
  if (!Object.values(HUB_CANONICAL_TOKEN).some(canonical => isAddressEqual(canonical, token))) throw new CompactContractError('Fund__TokenNotCanonical', [token])
  if (!isAddressEqual(intent.header.feeToken, token)) throw new CompactContractError('Intent__FeeTokenMismatch', [intent.header.feeToken, token])
  const wrappable = isAddressEqual(token, HUB_CANONICAL_TOKEN.WETH)
  const valuation = valuationOf(intent.valuation)
  const payoutLine = payoutLineOf(intent.valuation.assetList, token)
  const plan = planRedeem({
    supply: ctx.fund.supply,
    masterBalance: ctx.fund.masterShares,
    redemption: ctx.fund.redemption,
    fraction: intent.fraction,
    join: intent.join,
    valuation,
    token,
    price: payoutLine === null ? null : { amount: payoutLine.amount, value: payoutLine.value },
    held: ctx.held,
    native: ctx.native,
    fee: intent.header.fee
  })
  const feeValue = valueFor(intent.header.fee, plan.rate)
  if (!wrappable && payoutLine !== null && payoutLine.amount !== ctx.held) {
    throw new CompactError(
      'PAYOUT_LINE_MISMATCH',
      `the redemption prices its ${token} payouts on a hub line of ${payoutLine.amount}, where the fund holds ${ctx.held} there`,
      'hard'
    )
  }
  if (ctx.audit !== null) {
    const hubCash = hubCashOf(token)
    const mark = plan.full
      ? {
          assetList: ctx.audit.mark.assetList.filter(asset => hubCash(asset) || asset.value >= feeValue),
          positionList: ctx.audit.mark.positionList.filter(position => position.value >= feeValue)
        }
      : ctx.audit.mark
    const gain = redeemSignerGain({ plan, performanceFee: ctx.fund.performanceFee, protocolFeeShare: PROTOCOL.protocolFeeShare })
    verifyValuation('redeem', intent.valuation, { ...ctx.audit, mark, gain })
    if (!wrappable && payoutLine !== null) {
      const marked = mark.assetList.find(asset => assetKey(asset) === assetKey(payoutLine))
      if (marked === undefined) throw new CompactError('VALUATION_UNHELD', `the redemption pays in ${token}, which the attestor's mark does not hold on the hub`, 'hard')
      if (marked.value === 0n) throw new CompactError('POOL_UNVALUABLE', `the attestor's mark prices the hub ${token} at nothing, so a payout in it cannot be checked`, 'soft')
      const worth = (valuation * plan.rate.amount) / plan.rate.value
      const fair = (valuationOf(mark) * marked.amount) / marked.value
      const { drift, allowed, profits, above } = driftVerdict(worth, fair, gain, ctx.audit.config.driftToleranceBps)
      if (drift > allowed) {
        throw new CompactError(
          'PAYOUT_DRIFT',
          profits
            ? `the redemption values the fund at ${worth} of ${token}, ${above ? 'above' : 'below'} the attestor's ${fair} by ${drift}bps, the side the signer profits from, where no drift is allowed`
            : `the redemption values the fund at ${worth} of ${token}, ${drift}bps off the attestor's ${fair}, past the ${allowed}bps band`,
          'hard'
        )
      }
    }
  }
  if (ctx.holders === null || ctx.convert === null) throw new CompactError('BALANCE_UNREAD', `the holders of ${master} were not read`, 'soft')
  const quoted = quotedOf(ctx.convert, plan, claimantsOf(master, ctx.holders, intent.fraction))
  if (intent.header.fee < quoted || intent.header.fee * PRECISION.basisPoints > quoted * (PRECISION.basisPoints + REDEEM_FEE_BAND_BPS)) {
    throw new CompactError(
      'RELAY_FEE_EXCEEDED',
      `the redemption fixes a per-recipient fee of ${intent.header.fee}, outside the ${quoted} quote and its ${REDEEM_FEE_BAND_BPS}bps band`,
      'hard'
    )
  }
  return { typedData: intentTypedData('redeem', ctx.chainId, intent), plan }
}

export function planCohortLists(input: {
  kind: 'redeem' | 'redeemCohort'
  master: Address
  redemption: IFundStore__Redemption
  performanceFee: bigint
  holders: readonly Pick<IHoldingRow, 'holder' | 'shares' | 'queued' | 'allocatedAt' | 'redeemedAt' | 'cost'>[]
}): Address[][] {
  const ranked = input.holders
    .filter(row => !isAddressEqual(row.holder, input.master) && row.redeemedAt !== input.redemption.id)
    .map(row => ({ row, claim: claimOf(row, row.shares, input.redemption.fraction) }))
    .filter(each => each.claim > 0n)
    .sort((a, b) => (a.claim > b.claim ? -1 : a.claim < b.claim ? 1 : BigInt(a.row.holder) < BigInt(b.row.holder) ? -1 : 1))
  const lists: Address[][] = []
  let redemption = input.redemption
  let current: Address[] = []
  for (const { row } of ranked) {
    if (redemption.potLeft <= redemption.fee) break
    const settled = planCohort({
      master: input.master,
      redemption,
      performanceFee: input.performanceFee,
      protocolFeeShare: PROTOCOL.protocolFeeShare,
      holders: [
        {
          holder: row.holder,
          balance: row.shares,
          holding: { allocatedAt: Number(row.allocatedAt), redeemedAt: Number(row.redeemedAt), queued: row.queued, cost: row.cost },
          refused: false
        }
      ]
    }).settled[0]
    if (settled === undefined) break
    redemption = settled.redemption
    current.push(getAddress(row.holder))
    if (
      BigInt(current.length) === PROTOCOL.maxCohortSize ||
      dispatchGasLimit(lists.length === 0 ? input.kind : 'redeemCohort', false, BigInt(current.length + 1), 0n, 0n) > MAX_TX_GAS
    ) {
      lists.push(current)
      current = []
    }
  }
  if (current.length > 0) lists.push(current)
  return lists
}
