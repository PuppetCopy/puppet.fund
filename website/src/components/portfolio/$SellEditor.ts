import { HUB_CANONICAL_TOKEN, HUB_CHAIN_ID } from '@puppet/contracts/const'
import { gridOf } from '@puppet/sdk/account'
import type { ISellDraft, ITradeDraft } from '@puppet/sdk/client'
import { getTokenDescription, readablePercentage } from '@puppet/sdk/core'
import { cashFor, sharesFor } from '@puppet/sdk/pool'
import type { IFundRow } from '@puppet/sdk/schema'
import { combine, filter, type IStream, just, map, merge, op, sampleMap, start, switchLatest } from 'aelea/stream'
import { type IBehavior, PromiseStatus, type PromiseStateDone, state } from 'aelea/stream-extended'
import { $element, $node, $text, component, type I$Node, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import type { Address } from 'viem'
import { $intermediateText, intermediateState } from '@/ui-components'
import { ethUsd } from '../../common/$common.js'
import { $fundAvatar } from '../../common/$fundAvatar.js'
import { $tokenFlows } from '../../common/$tokenFlows.js'
import { priceFor } from '../../io/price.js'
import { $DraftSave } from './$DraftSave.js'
import { $SourceAmountInput, $sourceAnchor } from './$SourceAmountInput.js'
import { submitOn } from './editorUtils.js'

const WETH = getTokenDescription(HUB_CHAIN_ID, HUB_CANONICAL_TOKEN.WETH)

const $poolProfile = (fundRow: IFundRow): I$Node =>
  $row(spacing.small, style({ alignItems: 'center' }))($fundAvatar(gridOf(fundRow)), $node(style({ fontWeight: '600' }))($text('Pool share')))

export interface I$SellEditor {
  master: Address
  hideBalances: IStream<boolean>
  held: bigint
  fundRow: IFundRow
  draft: IStream<ISellDraft | null>
}

export const $SellEditor = ({ master, hideBalances, held, fundRow, draft }: I$SellEditor) =>
  component(
    (
      [changeAmount, changeAmountTether]: IBehavior<bigint>,
      [enterPress, enterPressTether]: IBehavior<KeyboardEvent>,
      [clickSave, clickSaveTether]: IBehavior<PointerEvent>
    ) => {
      const worth = cashFor(held, fundRow.totalShares, fundRow.value)
      const sharesOf = (a: bigint): bigint => (a >= worth ? held : sharesFor(a, fundRow.totalShares, fundRow.value))
      const amount: IStream<bigint> = state(0n, merge(changeAmount, map(d => (d === null ? 0n : d.value), draft)))
      const alert: IStream<string | null> = switchLatest(
        map(
          (a): IStream<string | null> =>
            a > worth
              ? op(
                  intermediateState(ethUsd(worth)),
                  filter((s): s is PromiseStateDone<string> => s.status === PromiseStatus.DONE),
                  map(s => `Exceeds your ${s.value} holding`),
                  start('Exceeds your holding')
                )
              : just(null),
          amount
        )
      )
      const disabled: IStream<boolean> = map(p => p.alert !== null || p.amt === 0n, combine({ alert, amt: amount }))
      const $source = $SourceAmountInput({
        label: 'Sell',
        decimals: just(WETH.decimals),
        amount,
        locked: just(false),
        max: just(worth),
        alert,
        note: map(a => `${readablePercentage(worth === 0n ? 0n : (sharesOf(a) * 10_000n) / held)} of your holding`, amount),
        $anchor: $sourceAnchor($poolProfile(fundRow), $element('span')($text('Held: '), $intermediateText(ethUsd(worth))))
      })({ change: changeAmountTether(), enter: enterPressTether() })
      return [
        $column(spacing.default, style({ width: '394px', maxWidth: '100%' }))(
          $source,
          $DraftSave({
            target: null,
            request: just(null),
            active: just(false),
            alert,
            disabled,
            $receive: $tokenFlows(hideBalances, [], [
              { chainId: HUB_CHAIN_ID, token: HUB_CANONICAL_TOKEN.WETH, profile: WETH, amount, exact: false, price: priceFor(HUB_CHAIN_ID, HUB_CANONICAL_TOKEN.WETH) }
            ])
          })({ save: clickSaveTether() })
        ),
        {
          changeTradeDraft: sampleMap(
            (a): ITradeDraft => ({ kind: 'sell', id: `sell:${master}`, master, shareToken: fundRow.shareToken, shares: sharesOf(a), value: a }),
            amount,
            submitOn(disabled, clickSave, enterPress)
          )
        }
      ]
    }
  )
