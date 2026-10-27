import { HUB_CANONICAL_TOKEN, HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import { gridOf } from '@puppet/sdk/account'
import type { IRedeemDraft, ITradeDraft } from '@puppet/sdk/client'
import { CompactContractError, CompactError, formatThrownError, type IValuationOwner, requestValuation } from '@puppet/sdk/compact'
import { type ChainId, CROSS_CHAIN_MIN_USD, PRECISION } from '@puppet/sdk/const'
import { getTokenDescription, readablePercentage, readableTokenAmountLabel } from '@puppet/sdk/core'
import { DEFAULT_EVALUATION_CONFIG, USD_PRICE_DECIMALS } from '@puppet/sdk/evaluate'
import { type IFundState, REDEEM_BRIDGE_MARGIN_BPS, redeemFeeFor, sizeRedeem } from '@puppet/sdk/intent'
import { cashFor, claimOf, type IRedeemPlan, isOpen, joinCapOf, payoutLineOf, planCohort, planRedeem, sharesFor, valuationOf, valueFor } from '@puppet/sdk/pool'
import type { IFundRow, IHoldingRow } from '@puppet/sdk/schema'
import { tokenKeyOf, tokenMetaByChainToken, tokenMetaKey, TYPICAL_SUBCALL_GAS } from '@puppet/sdk/state'
import { combine, constant, empty, filter, filterNull, type IStream, just, map, merge, op, sampleMap, skipRepeats, skipRepeatsWith, switchLatest, switchMap, take } from 'aelea/stream'
import { type IBehavior, promiseState, type PromiseState, type PromiseStateDone, PromiseStatus, state } from 'aelea/stream-extended'
import { attr, component, $element, type I$Node, $node, style, styleBehavior, stylePseudo, $text } from 'aelea/ui'
import { $column, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { type Address, getAddress, isAddressEqual } from 'viem'
import { uiStorage } from '@/ui-storage'
import { editorChoiceKey, type IChainAddress } from '../../app/localStoreSchema.js'
import { $amountDisplay, $ButtonSecondary, $ButtonToggle, $defaultButtonToggleBtn, $defaultMiniButtonSecondary, $icon, $infoTooltip, $intermediateFailure, $intermediateText, intermediateState, maskBalance, $puppet, $puppeteer, $intermediateLine, text } from '@/ui-components'
import { $tokenProfile } from '../../common/$common.js'
import { chainName } from '../../common/$chain.js'
import { $fundAvatar } from '../../common/$fundAvatar.js'
import type { ISwapRequest } from '../../io/bridge/swapQuote.js'
import context, { DISPLAY_QUOTE_TTL_MS, getPrice } from '../../io/context.js'
import { matchmakerUrl } from '../../io/matchmaker/index.js'
import { freshPrice, priceFor, usdOf } from '../../io/price.js'
import { $addressLink } from '../$AccountProfile.js'
import { $DraftSave, type ISelectedRoute } from './$DraftSave.js'
import { $SourceAmountInput } from './$SourceAmountInput.js'
import { $TokenSelectFlow, type ITokenInputOption } from './$tokenOption.js'
import { $editorFlowContainer, amountUsdLabel, QUOTE_CALLDATA_BYTES, submitOn } from './editorUtils.js'
import { answerState, notLocal } from '../../io/datastore/reads.js'

const HUB = HUB_CHAIN_ID as ChainId
const HUB_CANONICAL: readonly Address[] = Object.values(HUB_CANONICAL_TOKEN)
const WHOLE = PRECISION.basisPoints

export interface IRedeemState {
  fund: IFundState
  holdings: readonly IHoldingRow[]
}

export interface I$RedeemEditor {
  master: Address
  owner: IValuationOwner
  signed: boolean
  hideBalances: IStream<boolean>
  fundRow: IFundRow
  fundState: Promise<IRedeemState>
  holders: IStream<Promise<readonly IHoldingRow[]>>
  holdings: readonly { chainId: ChainId; token: Address; fundBalance: bigint }[]
  drafts: IStream<readonly ITradeDraft[]>
}

type IRedeemSide = 'everyone' | 'queue'
type IRedeemOption = ITokenInputOption & { balance: bigint; price: IStream<Promise<bigint | null>> }

const hubCashLine = (token: Address, asset: { chainId: bigint; token: Address }): boolean =>
  Number(asset.chainId) === HUB &&
  (isAddressEqual(asset.token, token) || (isAddressEqual(token, HUB_CANONICAL_TOKEN.WETH) && isAddressEqual(asset.token, PROTOCOL.nativeToken)))

const shadedUp = (value: bigint): bigint => value + (value * DEFAULT_EVALUATION_CONFIG.driftToleranceBps) / (2n * PRECISION.basisPoints)

const shortfallOf = (err: unknown): bigint | null => {
  if (!(err instanceof CompactContractError) || err.code !== 'Balance__InsufficientFund') return null
  const [, , required]: readonly unknown[] = err.args
  return typeof required === 'bigint' ? required : null
}

const readablePlanError = (err: unknown): string => {
  if (err instanceof CompactContractError) {
    const args: readonly unknown[] = err.args
    if (err.code === 'Balance__InsufficientFund' && typeof args[0] === 'string' && typeof args[1] === 'bigint' && typeof args[2] === 'bigint') {
      const token = getTokenDescription(HUB, getAddress(args[0]))
      return `Paying out needs ${readableTokenAmountLabel(token, args[2])} on ${chainName(HUB)}; your fund holds ${readableTokenAmountLabel(token, args[1])} there`
    }
    if (err.code === 'Redeem__Dust') return 'Too small to carry its relay fee; redeem more at once'
    if (err.code === 'Redeem__JoinAboveSymmetry') return 'You can join with at most the share of your stake the queue exits'
    if (err.code === 'Balance__ZeroAmount') return 'Nothing to pay out'
  }
  if (err instanceof CompactError && err.code === 'REDEEM_TOO_SMALL') return 'Too little to pay one basis point of the fund after its fees; redeem more at once'
  return formatThrownError(err)
}

export const $RedeemEditor = ({ master, owner, signed, hideBalances, fundRow, fundState, holders, holdings, drafts }: I$RedeemEditor) =>
  component(
    (
      [changeAmount, changeAmountTether]: IBehavior<bigint>,
      [enterPress, enterPressTether]: IBehavior<KeyboardEvent>,
      [commitAmount, commitAmountTether]: IBehavior<bigint>,
      [selectSide, selectSideTether]: IBehavior<IRedeemSide>,
      [selectRoute, selectRouteTether]: IBehavior<ISelectedRoute>,
      [clickSave, clickSaveTether]: IBehavior<PointerEvent>,
      [selectSource, selectSourceTether]: IBehavior<ITokenInputOption>,
      [selecting, selectingTether]: IBehavior<boolean>,
      [moveToHub, moveToHubTether]: IBehavior<PointerEvent, { chainId: ChainId; token: Address; amount: bigint }>,
      [enableSession, enableSessionTether]: IBehavior<PointerEvent>
    ) => {
      const hubHeldOf = (token: Address): bigint => holdings.filter(h => h.chainId === HUB && isAddressEqual(h.token, token)).reduce((total, h) => total + h.fundBalance, 0n)
      const hubNative = hubHeldOf(PROTOCOL.nativeToken)
      const cashOf = (token: Address): bigint => hubHeldOf(token) + (isAddressEqual(token, HUB_CANONICAL_TOKEN.WETH) ? hubNative : 0n)
      const hubCash = cashOf(HUB_CANONICAL_TOKEN.WETH)
      const optionOf = (chainId: ChainId, token: Address, balance: bigint): IRedeemOption => {
        const description = getTokenDescription(chainId, token)
        return {
          symbol: description.symbol,
          chainId,
          address: token,
          token,
          balance,
          decimals: description.decimals,
          price: priceFor(chainId, token)
        }
      }
      const cashOption = optionOf(HUB, HUB_CANONICAL_TOKEN.WETH, hubCash)
      const options: IRedeemOption[] = [
        ...(hubCash > 0n ? [cashOption] : []),
        ...holdings
          .filter(h => h.fundBalance > 0n && !(h.chainId === HUB && (isAddressEqual(h.token, HUB_CANONICAL_TOKEN.WETH) || isAddressEqual(h.token, PROTOCOL.nativeToken))))
          .map(h => optionOf(h.chainId, h.token, h.fundBalance))
      ]
      const firstPick = options[0]
      if (firstPick === undefined) throw new Error(`the fund ${master} holds nothing a redeem can pay from`)
      const optionAt = (chainId: ChainId, token: Address): IRedeemOption | undefined =>
        options.find(o => o.chainId === chainId && isAddressEqual(o.address, token))
      const twinOf = (from: IRedeemOption): Address | undefined =>
        from.chainId === HUB
          ? HUB_CANONICAL.find(canonical => isAddressEqual(canonical, from.address))
          : HUB_CANONICAL.find(canonical => tokenKeyOf(HUB, canonical) === tokenKeyOf(from.chainId, from.address))
      const kindOf = (from: IRedeemOption): 'cash' | 'bridge' | 'swap' => (twinOf(from) === undefined ? 'swap' : from.chainId === HUB ? 'cash' : 'bridge')
      const payoutOf = (from: IRedeemOption): Address => twinOf(from) ?? HUB_CANONICAL_TOKEN.WETH
      const cashOptions = options.filter(o => kindOf(o) === 'cash')
      const queueOptions = cashOptions.length === 0 ? [cashOption] : cashOptions
      const routeOf = (from: IRedeemOption): string => {
        const kind = kindOf(from)
        if (kind === 'cash') return `Direct from ${chainName(HUB)} cash`
        if (kind === 'bridge') return `Bridged to ${chainName(HUB)}`
        if (from.chainId === HUB) return `Swapped to WETH on ${chainName(from.chainId)}`
        return `Swapped into ${chainName(HUB)} WETH`
      }

      const draft: IStream<IRedeemDraft | null> = map(list => list.find((d): d is IRedeemDraft => d.kind === 'redeem') ?? null, drafts)
      const saved: IStream<{ from: IRedeemOption; amount: bigint } | null> = map(d => {
        if (d === null) return null
        if (d.source !== null) {
          const picked = optionAt(d.source.chainId, d.source.token)
          return picked === undefined ? null : { from: picked, amount: d.source.whole ? picked.balance : d.source.amount }
        }
        const from = d.leg === null ? optionAt(HUB, d.token) : optionAt(d.leg.chainId, d.leg.inputToken)
        if (from === undefined) return null
        if (d.leg !== null) return { from, amount: d.leg.inputAmount }
        if (d.plan === null) return null
        return { from, amount: d.plan.redemption.potLeft + d.plan.redemption.masterPay }
      }, draft)
      const side: IStream<IRedeemSide> = op(
        state(
          'everyone' as IRedeemSide,
          merge(
            selectSide,
            op(
              draft,
              filterNull,
              take(1),
              map((d): IRedeemSide => (d.fraction > 0n ? 'everyone' : 'queue'))
            )
          )
        ),
        skipRepeats
      )
      const storedSource: IStream<IRedeemOption> = op(
        combine({
          stored: uiStorage.replayWrite<IChainAddress | null>(
            editorChoiceKey(master, 'redeemSource'), null,
            map(picked => ({ chainId: picked.chainId, address: picked.address }), selectSource)
          ),
          draft: saved
        }),
        map(p => (p.draft !== null || p.stored === null ? undefined : optionAt(p.stored.chainId, p.stored.address))),
        filter((o): o is IRedeemOption => o !== undefined)
      )
      const source: IStream<IRedeemOption> = op(
        state(
          firstPick,
          merge(
            storedSource,
            op(
              selectSource,
              map(picked => {
                const from = optionAt(picked.chainId, picked.address)
                if (from === undefined) throw new Error(`${picked.symbol} on chain ${picked.chainId} is not a token the fund ${master} holds`)
                return from
              })
            ),
            op(
              saved,
              filterNull,
              take(1),
              map(s => s.from)
            )
          )
        ),
        skipRepeats
      )
      const picked: IStream<IRedeemOption> = op(
        combine({ side, source }),
        map(p => (p.side === 'queue' ? (kindOf(p.source) === 'cash' ? p.source : (cashOptions[0] ?? cashOption)) : p.source)),
        skipRepeats,
        state()
      )
      const selectingState: IStream<boolean> = state(false, selecting)
      const whileListed = styleBehavior(map(open => (open ? { display: 'none' } : null), selectingState))

      const stateQuery = op(just(fundState), promiseState, state())
      const valuationRead = requestValuation(matchmakerUrl, master, fundRow.shareToken, HUB_CANONICAL_TOKEN.WETH, owner, null)
      const payoutRead = (from: IRedeemOption) => {
        const token = payoutOf(from)
        return Promise.all([
          valuationRead,
          context.getFeeConverter(HUB, token, DISPLAY_QUOTE_TTL_MS),
          context.getRelayFeeQuote(from.chainId, from.address, DISPLAY_QUOTE_TTL_MS),
          kindOf(from) === 'swap' ? Promise.all([getPrice(from.chainId, from.address), getPrice(HUB, HUB_CANONICAL_TOKEN.WETH)]) : null
        ]).then(([quote, convert, sourceFeeQuote, prices]) => {
          const line =
            payoutLineOf(quote.valuation.assetList, token) ??
            quote.valuation.assetList.find(asset => Number(asset.chainId) === from.chainId && isAddressEqual(asset.token, from.address) && asset.id === 0n && asset.amount > 0n)
          const price = isAddressEqual(token, HUB_CANONICAL_TOKEN.WETH) ? { amount: 1n, value: 1n } : line === undefined ? null : { amount: line.amount, value: line.value }
          if (price === null) throw new Error(`the attestor's valuation prices no ${getTokenDescription(HUB, token).symbol} to pay out in`)
          return {
            from,
            token,
            price,
            valuation: quote.valuation,
            nav: valuationOf(quote.valuation),
            convert,
            sourceFeeQuote,
            rate: prices === null ? null : { source: prices[0].price, eth: prices[1].price }
          }
        })
      }
      type IRead = Awaited<ReturnType<typeof payoutRead>>
      const readQuery = op(picked, map(payoutRead), promiseState, state())

      const planOf = (
        ready: IRedeemState,
        read: Pick<IRead, 'convert' | 'token' | 'price'>,
        input: { fraction: bigint; join: bigint; valuation: bigint; held: bigint; native: bigint }
      ) => {
        const { fund } = ready
        const holders = BigInt(ready.holdings.filter(h => !isAddressEqual(h.holder, master) && claimOf(h, h.shares, Number(input.fraction)) > 0n).length)
        const base = {
          supply: fund.supply,
          masterBalance: fund.masterShares,
          redemption: fund.redemption,
          fraction: input.fraction,
          join: input.join,
          valuation: input.valuation,
          token: read.token,
          price: read.price,
          held: input.held,
          native: input.native
        }
        const fee = redeemFeeFor(read.convert, holders, planRedeem({ ...base, fee: 0n }))
        const plan = planRedeem({ ...base, fee })
        return { plan, fee, holders, masterPaid: plan.redemption.masterPay > 0n }
      }
      type ISized = ReturnType<typeof planOf> & { fraction: bigint; join: bigint }

      const everyoneOf = (ready: IRedeemState, read: IRead, nav: bigint, held: bigint, native: bigint, target: bigint, whole: boolean): ISized | { error: string } => {
        const { fund } = ready
        if (fund.masterShares === 0n) return { error: 'You hold no share of your fund' }
        try {
          const supply = fund.supply
          const queued = fund.redemption.queued
          const targetValue = valueFor(target, read.price)
          const shares = sharesFor(targetValue, supply, nav)
          const fraction = shares <= queued ? 0n : ((shares - queued) * WHOLE) / (supply - queued)
          if (fraction === 0n) return { error: 'Only enough for the exit queue; pay it from the Exit queue tab' }
          const capped = fraction < WHOLE ? fraction : WHOLE - 1n
          const partial = planOf(ready, read, { fraction: capped, join: 0n, valuation: nav, held, native })
          const feeValue = valueFor(partial.fee, read.price)
          const dust = [
            ...read.valuation.assetList.filter(
              asset => !hubCashLine(read.token, asset) && !(Number(asset.chainId) === read.from.chainId && isAddressEqual(asset.token, read.from.address))
            ),
            ...read.valuation.positionList
          ]
            .filter(line => line.value < feeValue)
            .reduce((total, line) => total + line.value, 0n)
          const realizable = nav - dust
          const cashValue = valueFor(isAddressEqual(read.token, HUB_CANONICAL_TOKEN.WETH) ? held + native : held, read.price)
          if (cashValue >= realizable && (whole || targetValue >= realizable)) {
            return { ...planOf(ready, read, { fraction: WHOLE, join: 0n, valuation: cashValue, held, native }), fraction: WHOLE, join: 0n }
          }
          return { ...partial, fraction: capped, join: 0n }
        } catch (err) {
          return { error: readablePlanError(err) }
        }
      }
      const sizedOf = (ready: IRedeemState, read: IRead, amount: bigint, bridge: { relay: bigint; rate: { input: bigint; output: bigint }; least: bigint } | null) => {
        try {
          const sized = sizeRedeem({
            fund: ready.fund,
            valuation: read.valuation,
            token: read.token,
            price: read.price,
            convert: read.convert,
            claimants: fraction => BigInt(ready.holdings.filter(h => !isAddressEqual(h.holder, master) && claimOf(h, h.shares, Number(fraction)) > 0n).length),
            hub: { held: hubHeldOf(read.token), native: hubNative },
            source: { chainId: read.from.chainId, token: read.from.address, amount },
            leg: bridge === null ? null : { relayFee: bridge.relay, input: bridge.rate.input, output: bridge.rate.output, least: bridge.least, price: read.price }
          })
          return {
            sized: { plan: sized.plan, fee: sized.fee, holders: sized.claimants, masterPaid: sized.plan.redemption.masterPay > 0n, fraction: sized.fraction, join: 0n },
            spend: sized.spend,
            leg:
              sized.leg === null
                ? null
                : {
                    chainId: read.from.chainId,
                    token: read.from.address,
                    input: sized.leg.gross,
                    request: { originChainId: read.from.chainId, destinationChainId: HUB, inputToken: read.from.address, outputToken: read.token, inputAmount: sized.leg.routed, depositor: master, recipient: master }
                  },
            delivered: sized.leg === null ? 0n : sized.leg.delivered
          }
        } catch (err) {
          return { error: readablePlanError(err) }
        }
      }
      const joinCapAt = (ready: IRedeemState): bigint =>
        joinCapOf({ supply: ready.fund.supply, masterShares: ready.fund.masterShares, queued: ready.fund.redemption.queued })
      const queueOf = (ready: IRedeemState, read: IRead, nav: bigint, joinAmount: bigint): ISized | { error: string; need: bigint | null } => {
        const { fund } = ready
        if (fund.redemption.queued === 0n) return { error: 'No one is waiting to exit', need: null }
        const cap = joinCapAt(ready)
        const wanted = joinAmount === 0n ? 0n : sharesFor(valueFor(joinAmount, read.price), fund.supply, nav)
        const join = wanted < cap ? wanted : cap
        try {
          return { ...planOf(ready, read, { fraction: 0n, join, valuation: nav, held: hubHeldOf(read.token), native: hubNative }), fraction: 0n, join }
        } catch (err) {
          const required = shortfallOf(err)
          return {
            error:
              err instanceof CompactContractError && err.code === 'Redeem__Dust'
                ? 'The exit queue is worth less than one relay fee; redeem from Everyone, or wait for more to queue'
                : readablePlanError(err),
            need: required === null ? null : shadedUp(required)
          }
        }
      }

      const estimate = op(
        combine({ side, fund: stateQuery, read: readQuery }),
        map(p => {
          if (p.fund.status !== PromiseStatus.DONE || p.read.status !== PromiseStatus.DONE) return null
          const read = p.read.value
          if (p.side === 'everyone') return { from: read.from, max: read.from.balance }
          if (p.fund.value.fund.redemption.queued === 0n) return { from: read.from, max: 0n }
          return { from: read.from, max: (cashFor(joinCapAt(p.fund.value), p.fund.value.fund.supply, read.nav) * read.price.amount) / read.price.value }
        }),
        state()
      )
      const max: IStream<bigint | null> = op(
        estimate,
        map(e => (e === null ? null : e.max)),
        skipRepeats
      )
      const chosen: IStream<boolean> = state(false, constant(true, selectSource))
      const typed: IStream<{ from: IRedeemOption; value: bigint }> = op(
        combine({ from: picked, side }),
        switchMap(p =>
          map(
            value => ({ from: p.from, value }),
            state(
              0n,
              merge(
                op(
                  combine({ q: saved, manual: chosen }),
                  map(s => (!s.manual && p.side === 'everyone' && s.q !== null && s.q.from === p.from ? s.q.amount : null)),
                  filterNull,
                  skipRepeats
                ),
                changeAmount
              )
            )
          )
        ),
        state()
      )
      const amount: IStream<bigint> = map(t => t.value, typed)

      const ethPrice = priceFor(HUB, HUB_CANONICAL_TOKEN.WETH)
      const sourcePrice: IStream<Promise<bigint | null>> = op(
        picked,
        switchMap(from => from.price),
        answerState
      )
      const freshSourcePrice: IStream<PromiseState<bigint | null>> = op(
        picked,
        map(from => freshPrice(from.chainId, from.address)),
        promiseState,
        state()
      )
      const payoutToken: IStream<Address> = op(picked, map(payoutOf), skipRepeats, state())
      const idle = {
        sized: null as ISized | null,
        leg: null as { chainId: ChainId; token: Address; input: bigint; request: ISwapRequest } | null,
        need: null as bigint | null,
        spend: null as bigint | null,
        bridge: null as { relay: bigint; least: bigint } | null,
        source: null as IRedeemDraft['source']
      }
      const base = op(
        combine({ side, typed, read: readQuery, fund: stateQuery, price: freshSourcePrice }),
        map(p => {
          if (p.fund.status === PromiseStatus.ERROR) return { ...idle, ready: null, error: `Fund state unavailable: ${formatThrownError(p.fund.error)}` }
          if (p.read.status === PromiseStatus.ERROR) return { ...idle, ready: null, error: signed ? `Fund valuation unavailable: ${formatThrownError(p.read.error)}` : null }
          if (p.fund.status === PromiseStatus.PENDING || p.read.status === PromiseStatus.PENDING) return { ...idle, ready: null, error: null }
          const read = p.read.value
          const from = read.from
          if (p.typed.from !== from) return { ...idle, ready: null, error: null }
          const ready = p.fund.value
          if (isOpen(ready.fund.redemption)) return { ...idle, ready, error: null }
          const typedAmount = p.typed.value
          if (p.side === 'queue') {
            const sized = queueOf(ready, read, read.nav, typedAmount)
            if ('error' in sized) return { ...idle, ready, error: sized.error, need: sized.need }
            const need = shadedUp(sized.plan.redemption.potLeft + sized.plan.redemption.masterPay)
            return { ...idle, ready, sized, need, error: need > cashOf(read.token) ? `${chainName(HUB)} holds too little to pay the queue` : null }
          }
          if (typedAmount > from.balance) return { ...idle, ready, error: `Exceeds the fund balance ${readableTokenAmountLabel(from, from.balance)}` }
          if (typedAmount === 0n) return { ...idle, ready, error: null }
          const intent = { chainId: from.chainId, token: from.address, amount: typedAmount, whole: typedAmount === from.balance }
          if (kindOf(from) === 'cash') {
            if (ready.fund.masterShares === 0n) return { ...idle, ready, error: 'You hold no share of your fund' }
            if (sharesFor(valueFor(typedAmount, read.price), ready.fund.supply, read.nav) <= ready.fund.redemption.queued) {
              return { ...idle, ready, error: 'Only enough for the exit queue; pay it from the Exit queue tab' }
            }
            const sized = sizedOf(ready, read, typedAmount, null)
            if ('error' in sized) return { ...idle, ready, error: sized.error }
            return { ...idle, ready, sized: sized.sized, error: null, source: intent }
          }
          const relay = read.sourceFeeQuote('fundSwap', false, 0n, TYPICAL_SUBCALL_GAS, QUOTE_CALLDATA_BYTES)
          if (relay * PRECISION.basisPoints > typedAmount * PROTOCOL.maxSwapRelayFeeBps) {
            const floor = (relay * PRECISION.basisPoints + PROTOCOL.maxSwapRelayFeeBps - 1n) / PROTOCOL.maxSwapRelayFeeBps
            return { ...idle, ready, error: `Below the ${readableTokenAmountLabel(from, floor)} minimum: the relay fee is capped at ${readablePercentage(PROTOCOL.maxSwapRelayFeeBps)} of what moves` }
          }
          if (from.chainId !== HUB) {
            if (read.rate === null && p.price.status === PromiseStatus.ERROR) return { ...idle, ready, error: `Pricing unavailable: ${formatThrownError(p.price.error)}` }
            const unitPrice = read.rate !== null ? read.rate.source : p.price.status === PromiseStatus.DONE ? p.price.value : null
            if (unitPrice === null) return { ...idle, ready, error: read.rate === null && p.price.status === PromiseStatus.DONE ? 'This token has no price, so the bridge cannot be sized' : 'Waiting for the price to size the bridge' }
            if (typedAmount * unitPrice < CROSS_CHAIN_MIN_USD * 10n ** BigInt(USD_PRICE_DECIMALS)) return { ...idle, ready, error: `Cross-chain moves start at $${CROSS_CHAIN_MIN_USD}` }
            if (kindOf(from) === 'bridge') {
              const least = (CROSS_CHAIN_MIN_USD * 10n ** BigInt(USD_PRICE_DECIMALS) + unitPrice - 1n) / unitPrice
              const bridged = sizedOf(ready, read, typedAmount, { relay, rate: { input: 1n, output: 1n }, least })
              if ('error' in bridged) return { ...idle, ready, error: bridged.error }
              return { ...idle, ready, error: null, sized: bridged.sized, leg: bridged.leg, spend: bridged.spend, bridge: { relay, least }, source: intent }
            }
          }
          const request: ISwapRequest = {
            originChainId: from.chainId,
            destinationChainId: HUB,
            inputToken: from.address,
            outputToken: read.token,
            inputAmount: typedAmount - relay,
            depositor: master,
            recipient: master
          }
          return { ...idle, ready, error: null, leg: { chainId: from.chainId, token: from.address, input: typedAmount, request }, source: intent }
        }),
        state()
      )
      const request: IStream<ISwapRequest | null> = op(
        base,
        map(b => (b.leg === null ? null : b.leg.request)),
        skipRepeatsWith((a, b) =>
          a === null || b === null
            ? a === b
            : a.inputAmount === b.inputAmount &&
              a.originChainId === b.originChainId &&
              a.destinationChainId === b.destinationChainId &&
              isAddressEqual(a.inputToken, b.inputToken)
        )
      )
      const route: IStream<ISelectedRoute> = state()(selectRoute)
      const preview = op(
        combine({ base, route, read: readQuery, typed }),
        map(p => {
          const b = p.base
          const none = { ...b, routePlan: null, arrival: 0n }
          if (b.error !== null || b.leg === null) return none
          const routeError = p.route.error ?? p.route.limitError
          if (routeError !== null) return { ...none, error: routeError }
          if (b.ready === null || p.read.status !== PromiseStatus.DONE || p.read.value.from !== p.typed.from) return none
          const read = p.read.value
          const leg = b.leg
          const quoted = p.route.plan
          if (p.route.ready && quoted === null) return none
          const routePlan = p.route.ready ? quoted : null
          const lane =
            quoted !== null && quoted.chainId === leg.chainId && isAddressEqual(quoted.inputToken, leg.request.inputToken) && quoted.inputAmount > 0n
              ? quoted
              : null
          const arrival =
            routePlan !== null
              ? routePlan.outputAmount
              : lane !== null
                ? (lane.outputAmount * leg.request.inputAmount) / lane.inputAmount
                : read.rate === null
                  ? leg.request.inputAmount
                  : (leg.request.inputAmount * read.rate.source) / read.rate.eth
          const worth = read.rate === null ? valueFor(leg.input, read.price) : (leg.input * read.rate.source) / read.rate.eth
          const arrivalValue = valueFor(arrival, read.price)
          const nav = read.nav > worth - arrivalValue ? read.nav - (worth > arrivalValue ? worth - arrivalValue : 0n) : 0n
          if (b.bridge !== null) {
            if (lane === null) return { ...b, routePlan, arrival }
            const bridged = sizedOf(b.ready, read, p.typed.value, { relay: b.bridge.relay, rate: { input: lane.inputAmount, output: lane.outputAmount }, least: b.bridge.least })
            if ('error' in bridged) return { ...none, error: bridged.error }
            return { ...b, sized: bridged.sized, spend: bridged.spend, leg: bridged.leg, routePlan, arrival: bridged.delivered }
          }
          const target = arrival - (arrival * REDEEM_BRIDGE_MARGIN_BPS) / PRECISION.basisPoints
          if (target === 0n) return { ...none, error: 'The swap delivers too little to pay out' }
          const sized = everyoneOf(b.ready, read, nav, hubHeldOf(read.token) + arrival, hubNative, target, leg.input === read.from.balance)
          if ('error' in sized) return { ...none, error: sized.error }
          return { ...b, sized, routePlan, arrival }
        }),
        state()
      )

      const $paid = (chainId: ChainId, token: Address, received: bigint, estimated: boolean): I$Node =>
        $amountDisplay({
          hideBalances,
          usd: map(price => usdOf(received, price).then(text => (estimated && text !== '-' ? `≈${text}` : text)), priceFor(chainId, token)),
          amount: readableTokenAmountLabel(getTokenDescription(chainId, token), received),
          align: 'flex-end',
          usdFontSize: text.sm
        })
      const $payee = (chainId: ChainId, token: Address, master: boolean, account: Address, $value: I$Node): I$Node =>
        $row(spacing.small, style({ alignItems: 'center', justifyContent: 'space-between' }))(
          $tokenProfile(
            chainId,
            token,
            28,
            true,
            $row(spacing.tiny, style({ alignItems: 'center' }))(
              $icon({ $content: master ? $puppeteer : $puppet, width: '14px', viewBox: '0 0 32 32', fill: palette.foreground }),
              $addressLink(account, 14)
            )
          ),
          $value
        )
      const $payoutRows = $column(style({ gap: '8px' }))
      type IPuppetList = { payees: readonly { holder: Address; shares: bigint; paid: bigint }[]; supply: bigint }
      const $puppets = (token: Address, answers: IStream<Promise<IPuppetList>>, $value: I$Node): I$Node =>
        $row(spacing.small, style({ alignItems: 'center', justifyContent: 'space-between' }))(
          $tokenProfile(
            HUB,
            token,
            28,
            true,
            $row(spacing.tiny, style({ alignItems: 'center' }))(
              $icon({ $content: $puppet, width: '14px', viewBox: '0 0 32 32', fill: palette.foreground }),
              $intermediateText(map(answer => answer.then(list => `${list.payees.length} ${list.payees.length === 1 ? 'Puppet' : 'Puppets'}`), answers)),
              switchLatest(
                map(
                  ({ payees, supply }) =>
                    payees.length === 0
                      ? empty
                      : $infoTooltip(
                          $column(spacing.small, style({ maxHeight: '240px', overflowY: 'auto', minWidth: '260px' }))(
                            ...[...payees]
                              .sort((a, b) => (b.shares > a.shares ? 1 : b.shares < a.shares ? -1 : 0))
                              .map(payee =>
                                $row(spacing.small, style({ alignItems: 'center', justifyContent: 'space-between' }))(
                                  $addressLink(payee.holder, 16),
                                  $row(spacing.small, style({ alignItems: 'baseline' }))(
                                    $node(style({ fontSize: text.xs, color: palette.foreground }))($text(readablePercentage(supply === 0n ? 0n : (payee.shares * WHOLE) / supply))),
                                    $node(style({ fontSize: text.sm, color: palette.message }))($intermediateText(maskBalance(map(price => usdOf(payee.paid, price), priceFor(HUB, token)), hideBalances)))
                                  )
                                )
                              )
                          ),
                          palette.foreground
                        ),
                  op(
                    answers,
                    intermediateState,
                    filter((settled): settled is PromiseStateDone<IPuppetList> => settled.status === PromiseStatus.DONE),
                    map(settled => settled.value)
                  )
                )
              )
            )
          ),
          $value
        )
      const $pendingValue = (): I$Node => $intermediateText(just(notLocal))
      const $sessionNeeded = (): I$Node =>
        $row(spacing.small, style({ alignItems: 'center' }))(
          $node(style({ fontSize: text.sm, color: palette.foreground }))($text('Live value needs a session')),
          $infoTooltip("The payout is priced on your fund's live value, which the attestor serves only to a session on this device. Signing it is free.", palette.foreground),
          $node(style({ flex: 1 }))(),
          $ButtonSecondary({ $container: $defaultMiniButtonSecondary, $content: $text('Sign session') })({ click: enableSessionTether() })
        )
      const $pendingPayout = (queue: boolean, token: Address, $value: () => I$Node): I$Node => {
        const answers = map(
          answer =>
            answer.then(list => ({
              payees: list
                .filter(h => !isAddressEqual(h.holder, master) && (queue ? h.queued > 0n : h.shares > 0n))
                .map(h => ({ holder: getAddress(h.holder), shares: h.shares, paid: 0n })),
              supply: fundRow.totalShares
            })),
          holders
        )
        return $payoutRows(
          $payee(HUB, token, true, owner.user, $value()),
          $puppets(token, answers, $value())
        )
      }
      const $idle = (ready: IRedeemState, queue: boolean, token: Address): I$Node => {
        const payees = ready.holdings
          .filter(h => !isAddressEqual(h.holder, master) && (queue ? h.queued > 0n : h.shares > 0n))
          .map(h => ({ holder: getAddress(h.holder), shares: h.shares, paid: 0n }))
        return $payoutRows(
          $payee(HUB, token, true, owner.user, $paid(HUB, token, 0n, false)),
          $puppets(token, just(Promise.resolve({ payees, supply: ready.fund.supply })), $paid(HUB, token, 0n, false))
        )
      }
      const $breakdown = (ready: IRedeemState, sized: ISized, estimated: boolean): I$Node => {
        const plan: IRedeemPlan = sized.plan
        const token = plan.redemption.token
        const cohort = planCohort({
          master,
          redemption: plan.redemption,
          performanceFee: ready.fund.performanceFee,
          protocolFeeShare: PROTOCOL.protocolFeeShare,
          holders: ready.holdings
            .filter(h => !isAddressEqual(h.holder, master))
            .map(h => ({
              holder: getAddress(h.holder),
              balance: h.shares,
              refused: false,
              holding: { allocatedAt: Number(h.allocatedAt), redeemedAt: Number(h.redeemedAt), queued: h.queued, cost: h.cost }
            }))
        })
        const payees = cohort.settled
          .filter(settled => !settled.cut)
          .map(settled => ({
            holder: settled.holder,
            shares: ready.holdings.find(h => isAddressEqual(h.holder, settled.holder))?.shares ?? 0n,
            paid: settled.payout - settled.profitFee - settled.fee
          }))
        const paid = payees.reduce((total, payee) => total + payee.paid, 0n)
        const mine = cohort.settled.reduce((total, settled) => total + settled.profitFee - settled.protocolCut, plan.redemption.masterPay)
        return $payoutRows(
          ...(mine === 0n ? [] : [$payee(HUB, token, true, owner.user, $paid(HUB, token, mine, estimated))]),
          ...(payees.length === 0 ? [] : [$puppets(token, just(Promise.resolve({ payees, supply: ready.fund.supply })), $paid(HUB, token, paid, estimated))])
        )
      }
      const $cohort = switchLatest(
        map(
          p =>
            p.preview.ready === null
              ? !signed
                ? $column(spacing.default)($sessionNeeded(), $pendingPayout(p.side === 'queue', p.token, $pendingValue))
                : p.preview.error !== null
                  ? $pendingPayout(p.side === 'queue', p.token, () => $intermediateFailure(p.preview.error, $text('-'), false))
                  : $pendingPayout(p.side === 'queue', p.token, $pendingValue)
              : p.preview.sized === null
                ? $idle(p.preview.ready, p.side === 'queue', p.token)
                : $breakdown(p.preview.ready, p.preview.sized, p.preview.leg !== null && p.preview.routePlan === null),
          combine({ preview, side, token: payoutToken })
        )
      )
      const heldElsewhere: IStream<string[]> = map(p => {
        const from = p.typed.from
        const read = p.read.status === PromiseStatus.DONE && p.read.value.from === from ? p.read.value : null
        if (read === null || p.preview.sized === null) return []
        const fee = valueFor(p.preview.sized.fee, read.price)
        const off = read.valuation.assetList.filter(
          asset => asset.value >= fee && !hubCashLine(read.token, asset) && !(Number(asset.chainId) === from.chainId && isAddressEqual(asset.token, from.address))
        )
        const positions = read.valuation.positionList.filter(position => position.value >= fee).length
        const rest = [
          ...[...new Set(off.map(asset => Number(asset.chainId) as ChainId))].map(chainId => {
            const held = off.filter(asset => Number(asset.chainId) === chainId)
            const listed = held.filter(asset => tokenMetaByChainToken.has(tokenMetaKey(chainId, asset.token)))
            const unlisted = held.length - listed.length
            return `${chainName(chainId)} still holds ${[
              ...listed.map(asset => readableTokenAmountLabel(getTokenDescription(chainId, asset.token), asset.amount)),
              ...(unlisted === 0 ? [] : [`${unlisted} Valuable ERC-20 ${unlisted === 1 ? 'token' : 'tokens'} to swap first`])
            ].join(', ')}`
          }),
          ...(positions === 0 ? [] : [`${positions} open ${positions === 1 ? 'position' : 'positions'}`])
        ]
        return rest
      }, combine({ preview, typed, read: readQuery }))
      const closeTip: IStream<string> = map(rest => {
        const base =
          'Pays the exit queue, then the same fraction of every stake, yours last. Each puppet pays the performance fee on its own gain from its payout. Closing the fund needs all of its value in the token it pays out.'
        return rest.length === 0 ? base : `${base} ${rest.join('; ')}.`
      }, heldElsewhere)
      const $capNote = switchLatest(
        map(p => {
          const sized = p.preview.sized
          const source = p.preview.source
          if (sized === null || source === null || !source.whole || sized.fraction === WHOLE) return empty
          const unit = getTokenDescription(HUB, p.token)
          const sourceUnit = getTokenDescription(source.chainId, source.token)
          const kept = cashOf(p.token) + p.preview.arrival - sized.plan.redemption.potLeft - sized.plan.redemption.masterPay
          const free = p.preview.spend === null ? 0n : source.amount - p.preview.spend
          const lines = [
            ...(p.rest.length === 0 ? [] : [`One ${unit.symbol} redemption pays at most this; ${p.rest.join('; ')}, which stays in the fund for a next redemption.`]),
            ...(free > sized.fee ? [`${chainName(source.chainId)} keeps ${readableTokenAmountLabel(sourceUnit, free)} that the bridge leaves; redeem it next from ${chainName(source.chainId)}.`] : []),
            ...(kept > sized.fee ? [`${chainName(HUB)} keeps ${readableTokenAmountLabel(unit, kept)} that this redemption does not pay out; redeem it next from ${chainName(HUB)}.`] : [])
          ]
          return lines.length === 0 ? empty : $node(style({ fontSize: text.xs, color: palette.foreground, lineHeight: '1.5' }))($text(lines.join(' ')))
        }, combine({ preview, token: payoutToken, rest: heldElsewhere }))
      )
      const maskedUsd = (value: bigint, price: IStream<Promise<bigint | null>>): IStream<Promise<string>> => maskBalance(map(at => usdOf(value, at), price), hideBalances)
      const $hubMeter = switchLatest(
        map(p => {
          const need = p.side === 'queue' ? p.preview.need : null
          if (need === null) return empty
          const cash = cashOf(p.token)
          const shortfall = need > cash ? need - cash : 0n
          const wanted = shortfall + (shortfall * REDEEM_BRIDGE_MARGIN_BPS) / PRECISION.basisPoints
          const spoke = options.find(o => kindOf(o) === 'bridge' && isAddressEqual(payoutOf(o), p.token) && o.balance > 0n)
          const price = priceFor(HUB, p.token)
          return $row(spacing.small, style({ alignItems: 'center' }))(
            $row(spacing.tiny, style({ alignItems: 'center', fontSize: text.xs, color: shortfall > 0n ? palette.negative : palette.foreground }))(
              $element('span')($text(`${chainName(HUB)} must cover `), $intermediateText(maskedUsd(need, price)), $text(' · holds '), $intermediateText(maskedUsd(cash, price))),
              $infoTooltip(`${chainName(HUB)} pays the exit queue at one price, so the fund's cash there must cover it.`, palette.foreground)
            ),
            ...(shortfall === 0n || spoke === undefined
              ? []
              : [
                  $node(style({ flex: 1 }))(),
                  $ButtonSecondary({
                    $container: $defaultMiniButtonSecondary,
                    $content: $element('span')($text('Move '), $intermediateText(maskedUsd(wanted, price)), $text(` to ${chainName(HUB)}`))
                  })({ click: moveToHubTether(map(() => ({ chainId: spoke.chainId, token: spoke.address, amount: wanted < spoke.balance ? wanted : spoke.balance }))) })
                ])
          )
        }, combine({ preview, side, token: payoutToken }))
      )
      const alert: IStream<string | null> = map(p => p.error, preview)
      const disabled: IStream<boolean> = map(p => p.error !== null || p.sized === null || (p.leg !== null && p.routePlan === null), preview)
      const standing = op(
        combine({ fund: stateQuery, read: readQuery }),
        map((p): PromiseState<{ mine: bigint; queue: bigint; sellers: number }> => {
          if (p.fund.status === PromiseStatus.ERROR) return p.fund
          if (p.read.status === PromiseStatus.ERROR) return p.read
          if (p.fund.status !== PromiseStatus.DONE || p.read.status !== PromiseStatus.DONE) return { status: PromiseStatus.PENDING }
          const ready = p.fund.value
          const nav = p.read.value.nav
          return {
            status: PromiseStatus.DONE,
            value: {
              mine: cashFor(ready.fund.masterShares, ready.fund.supply, nav),
              queue: cashFor(ready.fund.redemption.queued, ready.fund.supply, nav),
              sellers: ready.holdings.filter(h => !isAddressEqual(h.holder, master) && h.queued > 0n).length
            }
          }
        }),
        state()
      )
      const $sideToggle = $ButtonToggle({
        value: side,
        optionList: ['everyone', 'queue'] as const,
        $container: $node(attr({ role: 'group' }), style({ flex: 1, display: 'grid', gridAutoFlow: 'column', gridAutoColumns: '1fr', borderRadius: '22px 22px 0 0', overflow: 'hidden' })),
        $button: $defaultButtonToggleBtn(
          style({ borderRadius: '0', margin: '0', border: 'none', padding: '16px 28px', placeContent: 'flex-start' }),
          stylePseudo('[aria-pressed="true"]', { backgroundColor: palette.background, boxShadow: 'none !important' })
        ),
        $$option: map((option: IRedeemSide) =>
          $column(style({ alignItems: 'flex-start', gap: '2px', textAlign: 'left' }))(
            option === 'everyone'
              ? $row(spacing.tiny, style({ alignItems: 'center', fontWeight: '600' }))($text('Everyone'), $infoTooltip($node($text(closeTip)), palette.foreground))
              : $node(style({ fontWeight: '600' }))($text('Exit queue')),
            $node(style({ display: 'flex', alignItems: 'center', minHeight: '1.4em', fontSize: text.xs, color: palette.foreground, whiteSpace: 'nowrap' }))(
              switchLatest(
                map(s => {
                  if (s.status === PromiseStatus.PENDING) return $intermediateLine('7em')
                  if (s.status === PromiseStatus.ERROR) return signed ? $intermediateFailure(s.error, $text('-'), false) : $text('-')
                  const held = s.value
                  if (option === 'queue' && held.sellers === 0) return $text('No one waiting')
                  return $element('span')($text(option === 'everyone' ? 'You hold ' : `${held.sellers} waiting · `), $intermediateText(maskedUsd(option === 'everyone' ? held.mine : held.queue, ethPrice)))
                }, standing)
              )
            )
          )
        )
      })({ select: selectSideTether() })
      const queueEmpty: IStream<boolean> = op(
        stateQuery,
        map(s => s.status === PromiseStatus.DONE && s.value.fund.redemption.queued === 0n),
        skipRepeats
      )
      const $sourceOf = (queue: boolean): I$Node =>
        $SourceAmountInput({
          label: queue ? 'Join with' : 'Redeem',
          decimals: op(
            picked,
            map(from => from.decimals),
            skipRepeats
          ),
          amount,
          max,
          locked: queue ? queueEmpty : just(false),
          alert,
          note: amountUsdLabel(amount, sourcePrice),
          $frame: $amount =>
            $TokenSelectFlow({
              hideBalances,
              selection: map(from => ({ chainId: from.chainId, address: from === cashOption ? PROTOCOL.nativeToken : from.address }), picked),
              value: picked,
              optionList: map(from => (queue ? queueOptions : options).map(o => ({ ...o, selected: o === from, caption: queue ? `Your own exit beside the queue` : routeOf(o) })), picked),
              listLabel: 'Select a token to redeem',
              $balanceLead: $fundAvatar(gridOf(fundRow), 12),
              $container: $editorFlowContainer(style({ margin: isDesktopScreen ? '-16px -28px 0' : '-16px -16px 0', borderRadius: '0' })),
              $inputContent: $anchor => $node(style({ display: 'contents' }))($amount, $anchor)
            })({ select: selectSourceTether(), selecting: selectingTether() })
        })({ change: changeAmountTether(), enter: enterPressTether(), commit: commitAmountTether() })
      const $source = switchLatest(map(s => $sourceOf(s === 'queue'), side))
      const $progress = (ready: IRedeemState): I$Node => {
        const live = ready.fund.redemption
        const waiting = ready.holdings.filter(h => !isAddressEqual(h.holder, master) && h.redeemedAt !== live.id && claimOf(h, h.shares, live.fraction) > 0n).length
        return $column(spacing.default, style({ width: '394px', maxWidth: '100%' }))(
          $column(spacing.tiny)(
            $node(style({ fontWeight: '600', color: palette.message }))($text(`Redemption ${live.id} is paying out`)),
            $node(style({ fontSize: text.xs, color: palette.foreground }))(
              $text(`${waiting} ${waiting === 1 ? 'holder' : 'holders'} still waiting · the attestor pays them by itself`)
            )
          ),
          ...(live.masterPay === 0n ? [] : [$payee(HUB, live.token, true, owner.user, $paid(HUB, live.token, live.masterPay, false))])
        )
      }
      const submitted = op(
        sampleMap(p => p, preview, submitOn(disabled, clickSave, enterPress)),
        filter(p => p.error === null && p.sized !== null && (p.leg === null || p.routePlan !== null))
      )
      const $editor = $column(spacing.default, style({ width: '394px', maxWidth: '100%' }))(
        $node(whileListed, style({ display: 'flex', margin: '-28px -28px 0' }))($sideToggle),
        $source,
        $column(spacing.default, whileListed)(
          $cohort,
          $capNote,
          $hubMeter,
          $DraftSave({
            target: null,
            request,
            inputFee: map(p => (p.base.leg === null || p.read.status !== PromiseStatus.DONE ? null : { gross: p.base.leg.input, quote: p.read.value.sourceFeeQuote, kind: 'fundSwap' as const }), combine({ base, read: readQuery })),
            commit: commitAmount,
            active: map(b => b.leg !== null, base),
            alert,
            disabled
          })({
            selectRoute: selectRouteTether(),
            save: clickSaveTether()
          })
        )
      )
      return [
        switchLatest(
          map(s => (s.status === PromiseStatus.DONE && isOpen(s.value.fund.redemption) ? $progress(s.value) : $editor), stateQuery)
        ),
        {
          changeTradeDraft: op(
            submitted,
            map((p): ITradeDraft | null => {
              const sized = p.sized
              if (sized === null) return null
              return {
                kind: 'redeem',
                id: 'redeem',
                fraction: sized.fraction,
                join: sized.join,
                token: sized.plan.redemption.token,
                source: p.source,
                leg:
                  p.leg === null || p.routePlan === null
                    ? null
                    : {
                        chainId: p.leg.chainId,
                        inputToken: p.leg.token,
                        inputAmount: p.leg.input,
                        routeInput: p.routePlan.inputAmount,
                        outputAmount: p.routePlan.outputAmount,
                        expectedOutput: p.routePlan.expectedOutputAmount,
                        route: p.routePlan.route,
                        fillDeadline: Math.floor(p.routePlan.fillDeadline)
                      },
                holders: sized.holders,
                plan: sized.plan
              }
            }),
            filterNull
          ),
          moveToHub,
          enableSession
        }
      ]
    }
  )
