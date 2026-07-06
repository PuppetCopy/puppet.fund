import { HUB_CHAIN_ID, PRECISION } from '@puppet/contracts/const'
import { applyFactor, getChainTokenDescription, readableTokenAmount } from '@puppet/sdk/core'
import type { IFund, IFundPosition } from '@puppet/sdk/schema'
import { computeClaimable, computeQueuedShares, type ITokenRegistryMap, tokenInfoFor } from '@puppet/sdk/state'
import { combine, empty, filter, type IStream, map, merge, op, sampleMap, switchMap } from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $element, $node, $text, attr, component, type INode, nodeEvent, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { type Address, getAddress, } from 'viem'
import { $ButtonPrimaryOutline, $ButtonSecondary, $TokenAmountInput, text } from '@/ui-components'
import { liveFundPool, liveRedeemPosition } from '../../io/live.js'
import type { IClaimDraft, ISellDraft } from './draft.js'
import { $editorPercentSlider, createFocusState, scaleByPercent } from './editorUtils.js'

export interface I$FundSellEditor {
  puppet: Address
  masterAccount: Address
  baseToken: Address
  tokenRegistry: ITokenRegistryMap
}

const positionStreamFor = (puppet: Address, masterAccount: Address): IStream<IFundPosition | undefined> =>
  op(liveRedeemPosition(getAddress(puppet), getAddress(masterAccount)), state())

const poolStreamFor = (masterAccount: Address): IStream<IFund | undefined> =>
  op(liveFundPool(getAddress(masterAccount)), state())

const $statLine = (label: string, $value: ReturnType<typeof $node>) =>
  $row(spacing.small, style({ alignItems: 'baseline', justifyContent: 'space-between' }))(
    $node(style({ color: palette.foreground, fontSize: text.xs }))($text(label)),
    $value
  )

export const $FundSellEditor = ({ puppet, masterAccount, baseToken, tokenRegistry }: I$FundSellEditor) =>
  component(
    (
      [inputShares, inputSharesTether]: IBehavior<bigint>,
      [focusShares, focusSharesTether]: IBehavior<FocusEvent>,
      [blurShares, blurSharesTether]: IBehavior<FocusEvent>,
      [enterShares, enterSharesTether]: IBehavior<KeyboardEvent>,
      [sliderPercent, sliderPercentTether]: IBehavior<number>,
      [clickMax, clickMaxTether]: IBehavior<INode<HTMLButtonElement>, MouseEvent>,
      [clickSell, clickSellTether]: IBehavior<PointerEvent>,
      [clickClaim, clickClaimTether]: IBehavior<PointerEvent>
    ) => {
      const desc = getChainTokenDescription(HUB_CHAIN_ID, tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, baseToken).token)

      const positionStream = positionStreamFor(puppet, masterAccount)
      const poolStream = poolStreamFor(masterAccount)
      const settleState = combine({ position: positionStream, pool: poolStream })
      const sharesHeldStream: IStream<bigint> = map(p => p?.sharesHeld ?? 0n, positionStream)

      const sliderShares: IStream<bigint> = sampleMap(scaleByPercent, sharesHeldStream, sliderPercent)
      const maxShares: IStream<bigint> = sampleMap(held => held, sharesHeldStream, clickMax)
      const sharesValue: IStream<bigint> = op(merge(inputShares, sliderShares, maxShares), state(0n))
      const focused: IStream<boolean> = createFocusState(focusShares, blurShares)

      const sellDraft: IStream<ISellDraft> = sampleMap(
        (shares): ISellDraft => ({
          kind: 'sell',
          id: `sell:${masterAccount}`,
          account: puppet,
          title: 'Sell shares',
          alert: null,
          master: masterAccount,
          masterAccount,
          baseToken,
          sharesOut: shares
        }),
        sharesValue,
        merge(clickSell, enterShares)
      )

      const claimDraft: IStream<IClaimDraft> = sampleMap(
        (): IClaimDraft => ({
          kind: 'claim',
          id: `claim:${masterAccount}`,
          account: puppet,
          title: 'Claim',
          alert: null,
          master: masterAccount,
          masterAccount,
          baseToken
        }),
        settleState,
        clickClaim
      )

      const $editor = switchMap(p => {
        const held = p.position?.sharesHeld ?? 0n
        const liquidationRate = p.pool?.liquidationRate ?? 0n
        const liquidated = liquidationRate !== 0n
        const queued = computeQueuedShares(p.position, p.pool)
        const queueSide = computeClaimable(p.position, p.pool)
        const surrenderSide = liquidated ? applyFactor(liquidationRate, held) : 0n
        const claimable = queueSide + surrenderSide

        const $claimButton = $ButtonSecondary({
          disabled: map(() => claimable === 0n, positionStream),
          $content: $text(`Claim ${readableTokenAmount(desc, claimable)} ${desc.symbol}`)
        })({ click: clickClaimTether() })

        if (liquidated) {
          return $column(spacing.default, style({ width: '360px' }))(
            $row(spacing.small, style({ alignItems: 'center', justifyContent: 'space-between' }))(
              $node(style({ color: palette.foreground, fontSize: text.sm, fontWeight: '500' }))(
                $text('Fund liquidated')
              ),
              $node(style({ color: palette.message, fontWeight: '600' }))(
                $text(`${readableTokenAmount(desc, claimable)} ${desc.symbol}`)
              )
            ),
            $node(style({ color: palette.foreground, fontSize: text.xs, lineHeight: '1.5' }))(
              $text(
                `Liquidated at ${readableTokenAmount(desc, applyFactor(liquidationRate, 10n ** BigInt(PRECISION.shareTokenDecimals)))} ${desc.symbol} per share. Claiming converts your ${readableTokenAmount(PRECISION.shareTokenDecimals, held)} shares (${readableTokenAmount(desc, surrenderSide)}) plus queue payout ${readableTokenAmount(desc, queueSide)} = ${readableTokenAmount(desc, claimable)} ${desc.symbol}. Anything you don't take now stays claimable anytime.`
              )
            ),
            $claimButton
          )
        }

        const valueToShow: IStream<string> = map(
          (s: { amt: bigint; focused: boolean }) => (s.amt === 0n ? '' : readableTokenAmount(PRECISION.shareTokenDecimals, s.amt)),
          filter((s: { amt: bigint; focused: boolean }) => !s.focused, combine({ amt: sharesValue, focused }))
        )
        const sliderValue: IStream<number> = map(
          amt => (held > 0n ? Number((amt * 10000n) / held) / 10000 : 0),
          sharesValue
        )
        const sellDisabled: IStream<boolean> = map(amt => amt === 0n || amt > held, sharesValue)

        const $field = $TokenAmountInput({ decimals: PRECISION.shareTokenDecimals, valueToShow })({
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

        const $heldBadge = $row(
          spacing.small,
          style({
            alignItems: 'center',
            padding: '8px 12px',
            borderRadius: '12px',
            background: colorShade(palette.foreground, 12),
            flexShrink: '0'
          })
        )(
          $node(style({ fontWeight: '600', fontSize: text.sm }))($text('held')),
          $node(style({ color: palette.foreground, fontSize: text.xs }))(
            $text(readableTokenAmount(PRECISION.shareTokenDecimals, held))
          )
        )

        return $column(spacing.default, style({ minWidth: '380px' }))(
          $row(
            style({
              padding: '18px 28px',
              borderRadius: '22px 22px 0 0',
              background: palette.background,
              margin: '-28px -28px 0px',
              width: '450px',
              gap: '12px',
              alignItems: 'center'
            })
          )(
            $element('label')(
              style({ display: 'flex', flexDirection: 'column', cursor: 'text', flex: '1', minWidth: '0', gap: '4px' })
            )(
              $node(style({ color: palette.foreground, fontSize: text.sm, fontWeight: '500' }))($text('Sell shares')),
              $row(spacing.small, style({ alignItems: 'center' }))($field, $maxButton)
            ),
            $heldBadge
          ),
          $node(style({ margin: '0 -26px', display: 'flex' }))(
            $editorPercentSlider({
              value: sliderValue,
              ariaLabel: 'Sell percentage',
              disabled: map(() => held === 0n, sharesValue),
              error: map(() => false, sharesValue)
            })({ change: sliderPercentTether() })
          ),
          queued > 0n
            ? $statLine(
                'Queued',
                $node(style({ color: palette.message, fontWeight: '600', fontSize: text.xs }))(
                  $text(`${readableTokenAmount(PRECISION.shareTokenDecimals, queued)} shares · awaiting redeem`)
                )
              )
            : empty,
          claimable > 0n
            ? $statLine(
                'Claimable',
                $node(style({ color: palette.message, fontWeight: '600', fontSize: text.xs }))(
                  $text(`${readableTokenAmount(desc, claimable)} ${desc.symbol} · paid out when you sell`)
                )
              )
            : empty,
          $row(spacing.small, style({ alignItems: 'center' }))(
            $ButtonPrimaryOutline({
              disabled: sellDisabled,
              $content: $text(
                map(amt => (amt > 0n ? `Sell ${readableTokenAmount(PRECISION.shareTokenDecimals, amt)}` : 'Sell'), sharesValue)
              )
            })({ click: clickSellTether() }),
            $node(style({ flex: '1' }))(),
            claimable > 0n ? $claimButton : empty
          )
        )
      }, settleState)

      return [$editor, { changeDraft: merge(sellDraft, claimDraft) }]
    }
  )
