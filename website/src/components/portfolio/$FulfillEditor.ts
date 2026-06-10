import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { readableTokenAmount } from '@puppet/sdk/core'
import { getTokenDescription } from '@puppet/sdk/gmx'
import {
  getFundPoolState,
  type IFundPoolState,
  type ISubaccountState,
  type ITokenRegistryMap,
  liveFundPoolState,
  livePuppetRedeemPosition,
  tokenInfoFor
} from '@puppet/sdk/state'
import {
  combine,
  constant,
  filter,
  fromPromise,
  type IStream,
  map,
  merge,
  op,
  sampleMap,
  switchMap
} from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $element, $node, $text, attr, component, type INode, nodeEvent, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import type { Address, Hex } from 'viem'
import { $ButtonSecondary, $Checkbox, $defaultSliderContainer, $Slider, $TokenAmountInput, text } from '@/ui-components'
import { sqlClient } from '../../io/indexer/sql.js'
import { type IFulfillDraft, SHARE_DECIMALS } from './draft.js'

export interface I$FulfillEditor {
  master: Address
  masterAccount: Address
  account: IStream<ISubaccountState>
  baseToken: Address
  baseTokenId: Hex
  tokenRegistry: ITokenRegistryMap
}

export const $FulfillEditor = ({
  master,
  masterAccount,
  account,
  baseToken,
  baseTokenId,
  tokenRegistry
}: I$FulfillEditor) =>
  component(
    (
      [inputShares, inputSharesTether]: IBehavior<bigint>,
      [focusShares, focusSharesTether]: IBehavior<FocusEvent>,
      [blurShares, blurSharesTether]: IBehavior<FocusEvent>,
      [enterShares, enterSharesTether]: IBehavior<KeyboardEvent>,
      [sliderPercent, sliderPercentTether]: IBehavior<number>,
      [clickMax, clickMaxTether]: IBehavior<INode<HTMLButtonElement>, MouseEvent>,
      [clickFulfill, clickFulfillTether]: IBehavior<PointerEvent>,
      [toggleQueueOwn, toggleQueueOwnTether]: IBehavior<boolean>
    ) => {
      const desc = getTokenDescription(tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, baseTokenId).token)

      const poolStream: IStream<IFundPoolState> = op(
        merge(fromPromise(getFundPoolState(sqlClient, masterAccount)), liveFundPoolState(sqlClient, masterAccount)),
        state({ totalShareSupply: 0n, queuedShares: 0n })
      )
      const navStream: IStream<bigint> = op(
        account,
        map(acc => acc.balances.get(baseTokenId)?.signedBalance ?? 0n),
        state(0n)
      )
      // Master close composite: queueing the master's own held shares in the same fulfill
      // (an embedded self-sell on-chain, sell -> fulfill -> claim collapses to fulfill -> claim).
      const heldShares: IStream<bigint> = op(
        livePuppetRedeemPosition(sqlClient, master, masterAccount),
        map(pos => pos.sharesHeld),
        state(0n)
      )
      const queueOwn: IStream<boolean> = state(false, toggleQueueOwn)
      const sharesOutValue: IStream<bigint> = op(
        combine({ on: queueOwn, held: heldShares }),
        map(p => (p.on ? p.held : 0n))
      )
      // Retire ceiling mirrors the contract: the master's queued self-sell joins the pool
      // first, and the FULL pool retires when the store would hold the entire supply;
      // otherwise one share always remains.
      const maxRetirableStream: IStream<bigint> = map(
        p => {
          const poolShares = p.pool.queuedShares + p.out
          return poolShares === p.pool.totalShareSupply ? poolShares : poolShares >= 2n ? poolShares - 1n : 0n
        },
        combine({ pool: poolStream, out: sharesOutValue })
      )

      const sliderShares: IStream<bigint> = sampleMap(
        (max, pct) => {
          const bp = BigInt(Math.round(Math.max(0, Math.min(1, pct)) * 10000))
          return (max * bp) / 10000n
        },
        maxRetirableStream,
        sliderPercent
      )
      const maxShares: IStream<bigint> = sampleMap(max => max, maxRetirableStream, clickMax)
      const sharesValue: IStream<bigint> = op(merge(inputShares, sliderShares, maxShares), state(0n))

      const focused: IStream<boolean> = state(false, merge(constant(true, focusShares), constant(false, blurShares)))

      const fulfillDraft: IStream<IFulfillDraft> = sampleMap(
        (params): IFulfillDraft => ({
          kind: 'fulfill',
          id: `fulfill:${masterAccount}`,
          account: masterAccount,
          title: 'Fulfill',
          alert: null,
          master,
          masterAccount,
          baseToken,
          baseTokenId,
          sharesOut: params.out,
          acceptableShares: params.shares
        }),
        combine({ shares: sharesValue, out: sharesOutValue }),
        merge(clickFulfill, enterShares)
      )

      const $editor = switchMap(
        p => {
          const max = p.maxRetirable
          const nav = p.nav
          const amt = p.amt
          const drained = p.pool.totalShareSupply > 0n ? (amt * nav) / p.pool.totalShareSupply : 0n

          const valueToShow: IStream<string> = map(
            (x: { amt: bigint; focused: boolean }) => (x.amt === 0n ? '' : readableTokenAmount(SHARE_DECIMALS, x.amt)),
            filter((x: { amt: bigint; focused: boolean }) => !x.focused, combine({ amt: sharesValue, focused }))
          )

          const sliderValue: IStream<number> = map(
            cur => (max > 0n ? Number((cur * 10000n) / max) / 10000 : 0),
            sharesValue
          )

          const fulfillDisabled: IStream<boolean> = map(cur => cur === 0n || cur > max, sharesValue)

          const $field = $TokenAmountInput({ decimals: SHARE_DECIMALS, valueToShow })({
            inputAmount: inputSharesTether(),
            focus: focusSharesTether(),
            blur: blurSharesTether(),
            enter: enterSharesTether()
          })

          const $maxButton = $element('button')(
            attr({ type: 'button', disabled: max === 0n ? 'true' : null }),
            style({
              background: 'transparent',
              border: `1px solid ${colorShade(palette.foreground, 25)}`,
              borderRadius: '8px',
              padding: '2px 8px',
              fontSize: text.xs,
              fontWeight: '600',
              color: palette.foreground,
              cursor: max > 0n ? 'pointer' : 'not-allowed',
              opacity: max > 0n ? '1' : '0.4'
            }),
            clickMaxTether(nodeEvent('click'))
          )($text('Max'))

          const $statRow = (label: string, value: string) =>
            $row(spacing.small, style({ alignItems: 'baseline', justifyContent: 'space-between' }))(
              $node(style({ color: palette.foreground, fontSize: text.xs }))($text(label)),
              $node(style({ color: palette.message, fontWeight: '600' }))($text(value))
            )

          const queuedLabel = readableTokenAmount(SHARE_DECIMALS, p.pool.queuedShares)
          const navLabel = `${readableTokenAmount(desc, nav)} ${desc.symbol}`
          const drainedLabel = `${readableTokenAmount(desc, drained)} ${desc.symbol}`

          return $column(spacing.default, style({ minWidth: '380px' }))(
            $row(
              style({
                padding: '18px 28px',
                borderRadius: '22px 22px 0 0',
                background: palette.background,
                margin: '-28px -28px 0px',
                gap: '12px',
                alignItems: 'center'
              })
            )(
              $element('label')(
                style({
                  display: 'flex',
                  flexDirection: 'column',
                  cursor: 'text',
                  flex: '1',
                  minWidth: '0',
                  gap: '4px'
                })
              )(
                $node(style({ color: palette.foreground, fontSize: text.sm, fontWeight: '500' }))(
                  $text('Fulfill shares')
                ),
                $row(spacing.small, style({ alignItems: 'center' }))($field, $maxButton)
              )
            ),
            $node(style({ margin: '0 -26px', display: 'flex' }))(
              $Slider({
                value: sliderValue,
                step: 0.01,
                orientation: 'horizontal',
                ariaLabel: 'Fulfill percentage',
                disabled: map(() => max === 0n, sharesValue),
                error: map(() => false, sharesValue),
                motion: { stiffness: 800, damping: 58 },
                $container: $defaultSliderContainer(
                  style({ height: '14px', width: '100%', margin: '-26px 0', flexShrink: '0' })
                )
              })({ change: sliderPercentTether() })
            ),
            $column(spacing.small)(
              ...(p.held > 0n
                ? [
                    $row(spacing.small, style({ alignItems: 'center', justifyContent: 'space-between' }))(
                      $Checkbox({ value: queueOwn, label: 'Queue my held shares' })({
                        check: toggleQueueOwnTether()
                      }),
                      $node(style({ color: palette.message, fontWeight: '600', fontSize: text.xs }))(
                        $text(`${readableTokenAmount(SHARE_DECIMALS, p.held)} shares`)
                      )
                    )
                  ]
                : []),
              $statRow('Queued', `${queuedLabel} shares`),
              $statRow('NAV', navLabel),
              $statRow('Pay', drainedLabel)
            ),
            $row(spacing.small, style({ alignItems: 'center' }))(
              $node(style({ flex: 1 }))(),
              $ButtonSecondary({ disabled: fulfillDisabled, $content: $text('Fulfill') })({
                click: clickFulfillTether()
              })
            )
          )
        },
        combine({
          pool: poolStream,
          nav: navStream,
          maxRetirable: maxRetirableStream,
          amt: sharesValue,
          held: heldShares
        })
      )

      return [$editor, { changeDraft: fulfillDraft }]
    }
  )
