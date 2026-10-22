import type { ITradeDraft } from '@puppet/sdk/client'
import { getTokenDescription, readableTokenAmountLabel } from '@puppet/sdk/core'
import type { IVenue, IVenueWithdraw } from '@puppet/sdk/venue'
import { combine, empty, type IStream, just, map, op, periodic, reduce, sampleMap, skipRepeatsWith, start, switchLatest } from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { component, $element, $node, style, styleBehavior, $text } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { $amountDisplay, $infoTooltip, $intermediateFailure, $intermediateText } from '@/ui-components'
import { formatUsd, MINUS, priceFor } from '../../io/price.js'
import type { IOpenPositions } from '../../io/venue.js'
import { ago } from '../../pages/common.js'
import { $DraftSave } from './$DraftSave.js'
import { $SourceAmountInput, $sourceAnchor } from './$SourceAmountInput.js'
import { amountUsdLabel, submitOn } from './editorUtils.js'

export interface I$VenueWithdrawEditor {
  venue: IVenue
  withdraw: IVenueWithdraw
  withdrawable: IStream<IOpenPositions['venues'][number]['withdrawable']>
}

export const $VenueWithdrawEditor = ({ venue, withdraw, withdrawable }: I$VenueWithdrawEditor) =>
  component(
    (
      [changeAmount, changeAmountTether]: IBehavior<bigint>,
      [enterPress, enterPressTether]: IBehavior<KeyboardEvent>,
      [clickSave, clickSaveTether]: IBehavior<PointerEvent>
    ) => {
      const token = getTokenDescription(withdraw.chainId, withdraw.token)
      const price = priceFor(withdraw.chainId, withdraw.token)
      const amount: IStream<bigint> = state(0n, changeAmount)
      const reading = op(
        withdrawable,
        reduce(
          (held: { known: { total: bigint; free: bigint; at: number } | null; failure: string | null }, w: IOpenPositions['venues'][number]['withdrawable']) =>
            w === null ? held : w.reason !== undefined ? { known: held.known, failure: w.reason } : { known: { total: w.total, free: w.free, at: w.at }, failure: null },
          { known: null, failure: null }
        ),
        skipRepeatsWith(
          (a, b) => a.failure === b.failure && (a.known === null || b.known === null ? a.known === b.known : a.known.free === b.known.free && a.known.total === b.known.total && a.known.at === b.known.at)
        ),
        state()
      )
      const max: IStream<bigint | null> = map(r => (r.known === null ? null : r.known.free), reading)
      const total: IStream<bigint | null> = map(r => (r.known === null ? null : r.known.total), reading)
      const alert: IStream<string | null> = map(p => {
        if (p.amount === 0n) return null
        if (p.amount <= withdraw.feeOf(p.amount)) return `${venue.name} withdrawals pay up to ${readableTokenAmountLabel(token, withdraw.feeOf(p.amount))} in fees; withdraw more than that`
        if (p.max !== null && p.amount > p.max) return `Exceeds the ${readableTokenAmountLabel(token, p.max)} ${venue.name} can release now`
        return null
      }, combine({ amount, max }))
      const disabled: IStream<boolean> = map(p => p.alert !== null || p.amount === 0n, combine({ alert, amount }))
      return [
        $column(spacing.default, style({ width: '394px', maxWidth: '100%' }))(
          $SourceAmountInput({
            locked: just(false),
            label: 'Withdraw',
            decimals: just(token.decimals),
            amount,
            max,
            total,
            alert,
            note: amountUsdLabel(amount, price),
            $anchor: $sourceAnchor(
              empty,
              switchLatest(
                map(r => {
                  if (r.known === null) {
                    return r.failure === null ? $text('Withdrawable: -') : $element('span')($text('Withdrawable: '), $intermediateFailure(new Error(r.failure), $text('-'), false))
                  }
                  const known = r.known
                  const $value = $intermediateText(amountUsdLabel(just(known.free), price))
                  return $column(style({ alignItems: 'flex-end', gap: '2px' }))(
                    $element('span')($text('Withdrawable: '), r.failure === null ? $value : $intermediateFailure(new Error(r.failure), $value, true)),
                    $text(map(() => ago(known.at), start(null, periodic(1_000))))
                  )
                }, reading)
              )
            )
          })({ change: changeAmountTether(), enter: enterPressTether() }),
          $DraftSave({
            target: null,
            request: just(null),
            active: just(false),
            alert,
            disabled,
            $receive: $node(style({ flex: 1, display: 'flex' }))(
              $row(spacing.small, style({ flex: 1, alignItems: 'center' }), styleBehavior(map(a => (withdraw.feeOf(a) === 0n ? { display: 'none' } : null), amount)))(
                $amountDisplay({
                  hideBalances: just(false),
                  usd: map(p => {
                    const fee = withdraw.feeOf(p.amount)
                    return p.price.then(at => (at === null ? `${MINUS}${readableTokenAmountLabel(token, fee)}` : formatUsd(-fee, at)))
                  }, combine({ amount, price })),
                  amount: `${venue.name} fee`,
                  usdColor: just(palette.negative),
                  align: 'flex-end'
                }),
                $infoTooltip(`Charged by ${venue.name}, taken from the amount before it reaches your fund.`)
              )
            )
          })({ save: clickSaveTether() })
        ),
        {
          changeTradeDraft: sampleMap(
            (a): ITradeDraft => ({ kind: 'venueWithdraw', id: `${venue.venueId}:withdraw`, venueId: venue.venueId, amount: a }),
            amount,
            submitOn(disabled, clickSave, enterPress)
          )
        }
      ]
    }
  )
