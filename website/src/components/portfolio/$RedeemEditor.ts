import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { readableTokenAmount } from '@puppet/sdk/core'
import { getTokenDescription } from '@puppet/sdk/gmx'
import {
  computeClaimable,
  getPuppetRedeemPosition,
  type IPuppetRedeemPosition,
  type ITokenRegistryMap,
  livePuppetRedeemPosition,
  tokenInfoFor
} from '@puppet/sdk/state'
import {
  combine,
  constant,
  empty,
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
import { $ButtonSecondary, $defaultSliderContainer, $Slider, $TokenAmountInput, text } from '@/ui-components'
import { sqlClient } from '../../io/indexer/sql.js'
import { type IClaimDraft, type ISellDraft, SHARE_DECIMALS } from './draft.js'

export interface I$RedeemEditor {
  puppet: Address
  masterAccount: Address
  baseToken: Address
  baseTokenId: Hex
  tokenRegistry: ITokenRegistryMap
}

const EMPTY_POSITION: IPuppetRedeemPosition = {
  sharesHeld: 0n,
  stake: 0n,
  cursor: 0n,
  accrued: 0n,
  accruedPerStake: 0n,
  totalStake: 0n
}

const positionStreamFor = (puppet: Address, masterAccount: Address): IStream<IPuppetRedeemPosition> =>
  op(
    merge(
      fromPromise(getPuppetRedeemPosition(sqlClient, puppet, masterAccount)),
      livePuppetRedeemPosition(sqlClient, puppet, masterAccount)
    ),
    state(EMPTY_POSITION)
  )

export const $RedeemEditor = ({ puppet, masterAccount, baseToken, baseTokenId, tokenRegistry }: I$RedeemEditor) =>
  component(
    (
      [inputShares, inputSharesTether]: IBehavior<bigint>,
      [focusShares, focusSharesTether]: IBehavior<FocusEvent>,
      [blurShares, blurSharesTether]: IBehavior<FocusEvent>,
      [enterShares, enterSharesTether]: IBehavior<KeyboardEvent>,
      [sliderPercent, sliderPercentTether]: IBehavior<number>,
      [clickMax, clickMaxTether]: IBehavior<INode<HTMLButtonElement>, MouseEvent>,
      [clickSell, clickSellTether]: IBehavior<PointerEvent>
    ) => {
      const baseTokenInfo = tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, baseTokenId)
      const desc = getTokenDescription(baseTokenInfo.token)

      const positionStream = positionStreamFor(puppet, masterAccount)
      const sharesHeldStream: IStream<bigint> = map(p => p.sharesHeld, positionStream)

      const sliderShares: IStream<bigint> = sampleMap(
        (held, pct) => {
          const bp = BigInt(Math.round(Math.max(0, Math.min(1, pct)) * 10000))
          return (held * bp) / 10000n
        },
        sharesHeldStream,
        sliderPercent
      )
      const maxShares: IStream<bigint> = sampleMap(held => held, sharesHeldStream, clickMax)
      const sharesValue: IStream<bigint> = op(merge(inputShares, sliderShares, maxShares), state(0n))

      const focused: IStream<boolean> = state(false, merge(constant(true, focusShares), constant(false, blurShares)))

      const changeDraft: IStream<ISellDraft> = sampleMap(
        (params): ISellDraft => ({
          kind: 'sell',
          id: `sell:${masterAccount}`,
          account: puppet,
          title: 'Sell shares',
          alert: null,
          master: masterAccount,
          masterAccount,
          baseToken,
          baseTokenId,
          sharesOut: params.shares
        }),
        combine({ shares: sharesValue }),
        merge(clickSell, enterShares)
      )

      const $editor = switchMap(position => {
        const queued = position.stake
        const held = position.sharesHeld

        const valueToShow: IStream<string> = map(
          (p: { amt: bigint; focused: boolean }) => (p.amt === 0n ? '' : readableTokenAmount(SHARE_DECIMALS, p.amt)),
          filter((p: { amt: bigint; focused: boolean }) => !p.focused, combine({ amt: sharesValue, focused }))
        )

        const sliderValue: IStream<number> = map(
          amt => (held > 0n ? Number((amt * 10000n) / held) / 10000 : 0),
          sharesValue
        )

        const sellDisabled: IStream<boolean> = map(amt => amt === 0n || amt > held, sharesValue)

        const $field = $TokenAmountInput({ decimals: SHARE_DECIMALS, valueToShow })({
          inputAmount: inputSharesTether(),
          focus: focusSharesTether(),
          blur: blurSharesTether(),
          enter: enterSharesTether()
        })

        const $maxButton = $element('button')(
          attr({ type: 'button', disabled: held === 0n ? 'true' : null }),
          style({
            background: 'transparent',
            border: `1px solid ${colorShade(palette.foreground, 25)}`,
            borderRadius: '8px',
            padding: '2px 8px',
            fontSize: text.xs,
            fontWeight: '600',
            color: palette.foreground,
            cursor: held > 0n ? 'pointer' : 'not-allowed',
            opacity: held > 0n ? '1' : '0.4'
          }),
          clickMaxTether(nodeEvent('click'))
        )($text('Max'))

        const $sharesBadge = $row(
          spacing.small,
          style({
            alignItems: 'center',
            padding: '8px 12px',
            borderRadius: '12px',
            background: colorShade(palette.foreground, 12),
            flexShrink: '0'
          })
        )(
          $node(style({ fontWeight: '600', fontSize: text.sm }))($text('shares')),
          $node(style({ color: palette.foreground, fontSize: text.xs }))(
            $text(readableTokenAmount(SHARE_DECIMALS, held))
          )
        )

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
              $node(style({ color: palette.foreground, fontSize: text.sm, fontWeight: '500' }))($text('Sell shares')),
              $row(spacing.small, style({ alignItems: 'center' }))($field, $maxButton)
            ),
            $sharesBadge
          ),
          $node(style({ margin: '0 -26px', display: 'flex' }))(
            $Slider({
              value: sliderValue,
              step: 0.01,
              orientation: 'horizontal',
              ariaLabel: 'Sell percentage',
              disabled: map(() => held === 0n, sharesValue),
              error: map(() => false, sharesValue),
              motion: { stiffness: 800, damping: 58 },
              $container: $defaultSliderContainer(
                style({ height: '14px', width: '100%', margin: '-26px 0', flexShrink: '0' })
              )
            })({ change: sliderPercentTether() })
          ),
          $row(spacing.small, style({ alignItems: 'baseline', justifyContent: 'space-between' }))(
            $node(style({ color: palette.foreground, fontSize: text.xs }))($text('Queued')),
            $row(spacing.small, style({ alignItems: 'baseline' }))(
              queued > 0n
                ? $node(style({ color: palette.foreground, fontSize: text.xs, fontStyle: 'italic' }))(
                    $text('awaiting fulfillment')
                  )
                : empty,
              $node(style({ color: palette.message, fontWeight: '600' }))(
                $text(`${readableTokenAmount(SHARE_DECIMALS, queued)} shares`)
              )
            )
          ),
          $row(spacing.small, style({ alignItems: 'center' }))(
            $node(style({ flex: 1 }))(),
            $ButtonSecondary({ disabled: sellDisabled, $content: $text('Sell') })({ click: clickSellTether() })
          )
        )
      }, positionStream)

      return [$editor, { changeDraft }]
    }
  )

export const $ClaimEditor = ({ puppet, masterAccount, baseToken, baseTokenId, tokenRegistry }: I$RedeemEditor) =>
  component(([clickClaim, clickClaimTether]: IBehavior<PointerEvent>) => {
    const baseTokenInfo = tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, baseTokenId)
    const desc = getTokenDescription(baseTokenInfo.token)

    const positionStream = positionStreamFor(puppet, masterAccount)

    const changeDraft: IStream<IClaimDraft> = sampleMap(
      (position): IClaimDraft => ({
        kind: 'claim',
        id: `claim:${masterAccount}`,
        account: puppet,
        title: 'Claim',
        alert: null,
        master: masterAccount,
        masterAccount,
        baseToken,
        baseTokenId,
        amount: computeClaimable(position)
      }),
      positionStream,
      clickClaim
    )

    const $editor = switchMap(position => {
      const claimable = computeClaimable(position)
      const queued = position.stake

      return $column(spacing.default, style({ minWidth: '380px' }))(
        $row(spacing.small, style({ alignItems: 'center', justifyContent: 'space-between' }))(
          $node(style({ color: palette.foreground, fontSize: text.sm, fontWeight: '500' }))($text('Claim accrued')),
          $node(style({ color: palette.message, fontWeight: '600' }))(
            $text(`${readableTokenAmount(desc, claimable)} ${desc.symbol}`)
          )
        ),
        queued > 0n
          ? $node(style({ color: palette.foreground, fontSize: text.xs }))(
              $text(`${readableTokenAmount(SHARE_DECIMALS, queued)} shares queued, waiting on master fulfillment.`)
            )
          : $node(style({ color: palette.foreground, fontSize: text.xs }))(
              $text('Nothing queued. Sell shares first, then claim once the master fulfills.')
            ),
        $row(spacing.small)(
          $node(style({ flex: 1 }))(),
          $ButtonSecondary({
            disabled: map(() => claimable === 0n, positionStream),
            $content: $text(`Claim ${readableTokenAmount(desc, claimable)} ${desc.symbol}`)
          })({ click: clickClaimTether() })
        )
      )
    }, positionStream)

    return [$editor, { changeDraft }]
  })
