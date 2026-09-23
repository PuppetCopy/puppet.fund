import { HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import { gridOf } from '@puppet/sdk/account'
import { CompactContractError, formatThrownError } from '@puppet/sdk/compact'
import type { ChainId } from '@puppet/sdk/const'
import { getTokenDescription, readablePercentage, readableTokenAmount, readableTokenAmountLabel } from '@puppet/sdk/core'
import { VALUE_KEY } from '@puppet/sdk/evaluate'
import { deliveredLeg } from '@puppet/sdk/intent'
import { cashFor, EMPTY_QUEUE, planDrain, unitsFor } from '@puppet/sdk/pool'
import type { IFundRow, IQueueRow } from '@puppet/sdk/schema'
import { bondTokenOf, chainTokenOfKey, type ITokenRegistryMap, symbolOf, tokenKeyOf } from '@puppet/sdk/state'
import { combine, filter, filterNull, type IOps, type IStream, just, map, merge, op, sampleMap, start } from 'aelea/stream'
import { type IBehavior, PromiseStatus, promiseState, state } from 'aelea/stream-extended'
import { $node, $text, component, type I$Node, style, styleBehavior } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { type Address, isAddressEqual } from 'viem'
import { $ButtonPrimaryOutline, text } from '@/ui-components'
import { chainName } from '../../common/$chain.js'
import { $tokenProfile } from '../../common/$common.js'
import { $fundAvatar } from '../../common/$fundAvatar.js'
import type { ISwapRequest } from '../../io/bridge/swapQuote.js'
import context, { DISPLAY_QUOTE_TTL_MS } from '../../io/context.js'
import { priceFor } from '../../io/price.js'
import { $detailLine, $SourceAmountInput, $sourceAnchor } from './$SourceAmountInput.js'
import { $SwapProviderFeeEditor, type ISelectedRoute } from './$SwapProviderFeeEditor.js'
import { $SwapTargetFlow, type ISwapTargetOption, withdrawTargetOptions } from './$SwapTargetFlow.js'
import type { IFundSwapDraft, IRedeemDraft, ISellDraft, ITradeDraft } from './draft.js'
import { $editorPercentSlider, amountUsdLabel, scaleByPercent } from './editorUtils.js'

const value = getTokenDescription(HUB_CHAIN_ID, chainTokenOfKey(HUB_CHAIN_ID, VALUE_KEY))
const bond = getTokenDescription(HUB_CHAIN_ID, bondTokenOf(HUB_CHAIN_ID))

const valueLabel = (amount: bigint): string => readableTokenAmountLabel(value, amount)
const ratioOf = (part: bigint, whole: bigint): number => (whole === 0n ? 0 : Number((part * 10_000n) / whole) / 10_000)

const $caption = (label: string | IStream<string>): I$Node =>
  $node(style({ fontSize: text.xs, color: palette.foreground, lineHeight: '1.4' }))($text(label))
const $poolProfile = (fundRow: IFundRow): I$Node =>
  $row(spacing.small, style({ alignItems: 'center' }))($fundAvatar(gridOf(fundRow), 28), $node(style({ fontWeight: '600' }))($text('Pool share')))
const $saveRow = (disabled: IStream<boolean>, click: IOps<PointerEvent, PointerEvent>): I$Node =>
  $row(spacing.default, style({ alignItems: 'center' }))(
    $node(style({ flex: 1 }))(),
    $ButtonPrimaryOutline({ disabled, $content: $text('Save') })({ click })
  )
const submitOn = (disabled: IStream<boolean>, click: IStream<PointerEvent>, enter: IStream<KeyboardEvent>): IStream<unknown> =>
  merge(
    click,
    op(
      sampleMap((dis: boolean, evt: KeyboardEvent) => ({ dis, evt }), disabled, enter),
      filter(p => !p.dis)
    )
  )

export interface I$SellEditor {
  master: Address
  held: bigint
  fundRow: IFundRow
  draft: IStream<ISellDraft | null>
}

export const $SellEditor = ({ master, held, fundRow, draft }: I$SellEditor) =>
  component(
    (
      [changeAmount, changeAmountTether]: IBehavior<bigint>,
      [enterPress, enterPressTether]: IBehavior<KeyboardEvent>,
      [clickSave, clickSaveTether]: IBehavior<PointerEvent>
    ) => {
      const worth = cashFor(held, fundRow.totalUnits, fundRow.value)
      const unitsOf = (a: bigint): bigint => (a >= worth ? held : unitsFor(a, fundRow.totalUnits, fundRow.value))
      const amount: IStream<bigint> = state(0n, merge(changeAmount, map(d => (d === null ? 0n : d.value), draft)))
      const alert: IStream<string | null> = map(a => (a > worth ? `Exceeds your ${valueLabel(worth)} holding` : null), amount)
      const disabled: IStream<boolean> = map(p => p.alert !== null || p.amt === 0n, combine({ alert, amt: amount }))
      const $source = $SourceAmountInput({
        label: 'Sell',
        decimals: value.decimals,
        amount,
        max: just(worth),
        alert,
        note: map(a => `${readablePercentage(worth === 0n ? 0n : (unitsOf(a) * 10_000n) / held)} of your holding`, amount),
        $anchor: $sourceAnchor($poolProfile(fundRow), $text(`Held: ${readableTokenAmount(value.decimals, worth)}`))
      })({ change: changeAmountTether(), enter: enterPressTether() })
      return [
        $column(spacing.default, style({ width: '394px', maxWidth: '100%' }))(
          $source,
          $column(spacing.small)(
            $detailLine('Performance fee on the gain', $text(readablePercentage(PROTOCOL.performanceFee))),
            $caption(`What you sell joins the redemption queue at the last valuation and pays out in ${bond.symbol} on the hub as the trader drains it.`)
          ),
          $saveRow(disabled, clickSaveTether())
        ),
        {
          changeTradeDraft: sampleMap(
            (a): ITradeDraft => ({ kind: 'sell', id: `sell:${master}`, master, share: fundRow.share, units: unitsOf(a), value: a }),
            amount,
            submitOn(disabled, clickSave, enterPress)
          )
        }
      ]
    }
  )

export interface I$RedeemEditor {
  master: Address
  fundRow: IFundRow
  queue: IQueueRow | undefined
  held: bigint
  fundBalance: bigint
  draft: IStream<IRedeemDraft | null>
}

export const $RedeemEditor = ({ master, fundRow, queue, held, fundBalance, draft }: I$RedeemEditor) =>
  component(
    (
      [changeAmount, changeAmountTether]: IBehavior<bigint>,
      [enterPress, enterPressTether]: IBehavior<KeyboardEvent>,
      [changeRetire, changeRetireTether]: IBehavior<number>,
      [clickSave, clickSaveTether]: IBehavior<PointerEvent>
    ) => {
      const current = queue === undefined ? EMPTY_QUEUE : queue
      const currentQueued = queue === undefined ? 0n : queue.units
      const skin = fundRow.skin
      const retireShare: IStream<number> = state(0, merge(changeRetire, op(draft, filterNull, map(d => ratioOf(d.retire, held)))))
      const retire: IStream<bigint> = op(
        retireShare,
        map(p => scaleByPercent(held, p)),
        state()
      )
      const queued: IStream<bigint> = op(
        retire,
        map(r => currentQueued + r),
        state()
      )
      const worthOf = (u: bigint): bigint => cashFor(u, fundRow.totalUnits, fundRow.value)
      const queuedValue: IStream<bigint> = map(worthOf, queued)
      const amount: IStream<bigint> = state(0n, merge(queuedValue, changeAmount, op(draft, filterNull, map(d => d.value))))
      const preview = op(
        combine({ retire, amount }),
        map(p => {
          const nextQueued = currentQueued + p.retire
          const available = worthOf(nextQueued)
          if (p.amount > available) return { ...p, drain: 0n, plan: null, error: `Exceeds the ${valueLabel(available)} queued` }
          const drain = p.amount >= available ? nextQueued : unitsFor(p.amount, fundRow.totalUnits, fundRow.value)
          try {
            const plan =
              drain === 0n
                ? null
                : planDrain({
                    token: bond.address,
                    skin,
                    queue: current,
                    supply: fundRow.totalUnits,
                    queued: currentQueued,
                    masterUnits: held,
                    value: fundRow.value,
                    retire: p.retire,
                    drain,
                    funded: fundBalance
                  })
            return { ...p, drain, plan, error: null }
          } catch (err) {
            const unfunded = err instanceof CompactContractError && err.code === 'Balance__InsufficientFund'
            return {
              ...p,
              drain,
              plan: null,
              error: unfunded
                ? `Redemptions are paid from what your fund holds on ${chainName(HUB_CHAIN_ID)}, and it holds ${readableTokenAmountLabel(bond, fundBalance)} there. Bridge funds in with the fund's Swap first`
                : formatThrownError(err)
            }
          }
        }),
        state()
      )
      const alert: IStream<string | null> = map(p => p.error, preview)
      const disabled: IStream<boolean> = map(p => p.error !== null || p.plan === null, preview)
      const $source = $SourceAmountInput({
        label: 'Redeem',
        decimals: value.decimals,
        amount,
        max: queuedValue,
        alert,
        note: amountUsdLabel(amount, priceFor(HUB_CHAIN_ID, value.address)),
        $anchor: $sourceAnchor($poolProfile(fundRow), $text(map(q => `Queued: ${readableTokenAmount(value.decimals, q)}`, queuedValue)))
      })({ change: changeAmountTether(), enter: enterPressTether() })
      return [
        $column(spacing.default, style({ width: '394px', maxWidth: '100%' }))(
          $source,
          $column(spacing.small)(
            $detailLine('Retire your share into the queue', $text(map(r => `${valueLabel(worthOf(r))} of ${valueLabel(worthOf(held))}`, retire))),
            $editorPercentSlider({ value: retireShare, disabled: just(held === 0n), error: just(false), ariaLabel: 'share to retire' })({
              change: changeRetireTether()
            }),
            $detailLine('Paid from the fund', $text(map(p => (p.plan === null ? '-' : readableTokenAmountLabel(bond, p.plan.cash)), preview))),
            $detailLine('To backers', $text(map(p => (p.plan === null ? '-' : readableTokenAmountLabel(bond, p.plan.payout)), preview))),
            $detailLine('To you', $text(map(p => (p.plan === null ? '-' : readableTokenAmountLabel(bond, p.plan.cash - p.plan.payout)), preview))),
            $detailLine('Fund balance on the hub', $text(readableTokenAmountLabel(bond, fundBalance))),
            $caption('Redeem pays backers from the queue and returns your share to your account. Priced at the last valuation; the attestor values the fund again when you submit, and the drain stops where the fund balance on the hub runs out.')
          ),
          $saveRow(disabled, clickSaveTether())
        ),
        {
          changeTradeDraft: op(
            sampleMap(p => p, preview, submitOn(disabled, clickSave, enterPress)),
            filter(p => p.error === null && p.plan !== null),
            map((p): ITradeDraft => ({ kind: 'redeem', id: 'redeem', retire: p.retire, drain: p.drain, value: p.amount }))
          )
        }
      ]
    }
  )

export interface I$FundSwapEditor {
  account: Address
  chainId: ChainId
  token: Address
  fundBalance: bigint
  tokenRegistry: ITokenRegistryMap
  draft: IStream<IFundSwapDraft | null>
}

export const $FundSwapEditor = ({ account, chainId, token, fundBalance, tokenRegistry, draft }: I$FundSwapEditor) =>
  component(
    (
      [changeAmount, changeAmountTether]: IBehavior<bigint>,
      [enterPress, enterPressTether]: IBehavior<KeyboardEvent>,
      [pickTarget, pickTargetTether]: IBehavior<ISwapTargetOption>,
      [selectingTarget, selectingTargetTether]: IBehavior<boolean>,
      [selectRoute, selectRouteTether]: IBehavior<ISelectedRoute>,
      [clickSave, clickSaveTether]: IBehavior<PointerEvent>
    ) => {
      const input = getTokenDescription(chainId, token)
      const options = withdrawTargetOptions(tokenRegistry, chainId, token).filter(o => o.chainId !== chainId || !isAddressEqual(o.id, token))
      const initial = options.find(o => o.chainId !== chainId && tokenKeyOf(o.chainId, o.id) === tokenKeyOf(chainId, token)) ?? options[0]
      if (initial === undefined) throw new Error(`${input.symbol} on chain ${chainId} has no registered token to swap into`)
      const target: IStream<ISwapTargetOption> = state(
        initial,
        merge(
          pickTarget,
          op(
            draft,
            filterNull,
            map(d => options.find(o => o.chainId === d.destinationChainId && isAddressEqual(o.id, d.outputToken))),
            filter((o): o is ISwapTargetOption => o !== undefined)
          )
        )
      )
      const value: IStream<bigint> = state(
        0n,
        merge(
          changeAmount,
          op(
            draft,
            filterNull,
            map(d => d.inputAmount)
          )
        )
      )
      const relayFee = op(just(context.getRelayFeeQuote(chainId, token, DISPLAY_QUOTE_TTL_MS)), promiseState, state())
      const request: IStream<ISwapRequest | null> = map(
        p => {
          if (p.fee.status !== PromiseStatus.DONE) return null
          const net = p.amount - p.fee.value('depositAcross', false, 0n, 0n, 0n)
          return net <= 0n
            ? null
            : {
                originChainId: chainId,
                destinationChainId: p.target.chainId,
                inputToken: token,
                outputToken: p.target.id,
                inputAmount: net,
                depositor: account,
                recipient: account
              }
        },
        combine({ amount: value, target, fee: relayFee })
      )
      const route: IStream<ISelectedRoute> = state()(selectRoute)
      const alert: IStream<string | null> = op(
        combine({ amount: value, fee: relayFee, route, target }),
        map(p => {
          if (p.amount === 0n) return null
          if (p.amount > fundBalance) return `Exceeds the fund balance ${readableTokenAmountLabel(input, fundBalance)}`
          if (p.fee.status === PromiseStatus.ERROR) return `Relay fee unavailable: ${formatThrownError(p.fee.error)}`
          if (p.fee.status === PromiseStatus.DONE && p.amount <= p.fee.value('depositAcross', false, 0n, 0n, 0n)) {
            return `Swap more than the ${readableTokenAmountLabel(input, p.fee.value('depositAcross', false, 0n, 0n, 0n))} relay fee, which comes out of the amount`
          }
          return p.route.error ?? p.route.limitError
        }),
        state(null)
      )
      const disabled: IStream<boolean> = op(
        combine({ amount: value, alert, route }),
        map(p => p.amount === 0n || p.alert !== null || !p.route.ready || p.route.plan === null || p.route.plan.length !== 1),
        state(true)
      )
      const hidden: IStream<boolean> = start(false, selectingTarget)
      const $whileListed = $node(style({ display: 'contents' }), styleBehavior(map(h => (h ? { display: 'none' } : null), hidden)))
      return [
        $column(spacing.default, style({ width: '394px', maxWidth: '100%' }))(
          $whileListed(
            $SourceAmountInput({
              label: `Swap ${input.symbol}`,
              decimals: input.decimals,
              amount: value,
              max: just(fundBalance),
              alert,
              note: amountUsdLabel(value, priceFor(chainId, token)),
              $anchor: $sourceAnchor($tokenProfile(chainId, token), $text(`In fund: ${readableTokenAmount(input.decimals, fundBalance)}`))
            })({ change: changeAmountTether(), enter: enterPressTether() })
          ),
          $SwapTargetFlow({
            value: target,
            optionList: just(options),
            source: just({ chainId, symbol: symbolOf(chainId, token) }),
            $container: $row(
              style({ margin: '0 -28px', padding: '0 28px', gap: '12px', alignItems: 'center', fontSize: text.sm }),
              styleBehavior(map(h => (h ? { background: palette.background, padding: '20px 28px' } : null), hidden))
            ),
            $inputContent: $anchor =>
              $node(style({ display: 'contents' }))(
                $node(style({ color: palette.foreground, fontWeight: '500', whiteSpace: 'nowrap' }))($text('Receive')),
                $anchor
              )
          })({ select: pickTargetTether(), selecting: selectingTargetTether() }),
          $whileListed($caption('Swap moves fund holdings to any token on any chain.')),
          $whileListed(
            $row(spacing.small, style({ alignItems: 'center', fontSize: text.sm }))(
              $node(
                style({ display: 'flex' }),
                styleBehavior(
                  map(
                    p => (p.a !== null ? { display: 'none' } : p.req === null ? { opacity: '.45', pointerEvents: 'none' } : { opacity: '1', pointerEvents: 'auto' }),
                    combine({ a: alert, req: request })
                  )
                )
              )($SwapProviderFeeEditor({ active: just(true), request, maxLegs: 1 })({ selectRoute: selectRouteTether() })),
              $node(style({ flex: 1 }))(),
              $ButtonPrimaryOutline({ disabled, $content: $text('Save') })({ click: clickSaveTether() })
            )
          )
        ),
        {
          changeTradeDraft: op(
            sampleMap(p => p, combine({ amount: value, target, route }), submitOn(disabled, clickSave, enterPress)),
            map(p =>
              p.route.ready && p.route.plan !== null && p.route.plan.length === 1 ? { amount: p.amount, target: p.target, plan: p.route.plan } : null
            ),
            filterNull,
            map(
              (p): ITradeDraft => ({
                kind: 'fundSwap',
                id: `fundSwap:${chainId}:${token}`,
                chainId,
                destinationChainId: p.target.chainId,
                inputToken: token,
                outputToken: p.target.id,
                inputAmount: p.amount,
                outputAmount: deliveredLeg(p.plan).outputAmount,
                expectedOutput: deliveredLeg(p.plan).expectedOutputAmount,
                route: p.plan[0].route,
                fillDeadline: Math.floor(p.plan[0].fillDeadline)
              })
            )
          )
        }
      ]
    }
  )
