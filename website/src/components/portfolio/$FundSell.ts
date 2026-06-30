import { HUB_CHAIN_ID, PRECISION } from '@puppet/contracts/const'
import { getRegisteredTokenDescription, readableTokenAmountLabel } from '@puppet/sdk/core'
import type { IFundPosition } from '@puppet/sdk/schema'
import { type ITokenRegistryMap, tokenInfoFor } from '@puppet/sdk/state'
import { combine, constant, type IStream, map, op } from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $text, component, style } from 'aelea/ui'
import { $Popover, $row, spacing } from 'aelea/ui-components'
import { type Address, getAddress, type Hex } from 'viem'
import { $amountDisplay, $ButtonSecondary, $defaultMiniButtonSecondary, $popoverCaret, text } from '@/ui-components'
import { formatUsd, priceFor } from '../../io/gmx/priceFeed.js'
import { liveFundPool } from '../../io/live.js'
import { $FundSellEditor } from './$FundSellEditor.js'
import type { IClaimDraft, ISellDraft } from './draft.js'

export interface I$FundSell {
  hideBalances: IStream<boolean>
  puppet: Address
  masterAccount: Address
  baseToken: Address
  tokenRegistry: ITokenRegistryMap
  position: IStream<IFundPosition | undefined>
}

export const $FundSell = ({
  hideBalances,
  puppet,
  masterAccount,
  baseToken,
  tokenRegistry,
  position
}: I$FundSell) =>
  component(
    (
      [redeemDraft, redeemDraftTether]: IBehavior<ISellDraft | IClaimDraft>,
      [popManage, popManageTether]: IBehavior<PointerEvent>
    ) => {
      const editorProps = { puppet, masterAccount, baseToken, tokenRegistry }
      const desc = getRegisteredTokenDescription(tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, baseToken).token)

      const pool = op(liveFundPool(getAddress(masterAccount)), state())
      const settle = combine({ position, pool })

      const baseValue: IStream<bigint> = map(
        p => ((p.position?.sharesHeld ?? 0n) * (p.pool?.navPerShare ?? 0n)) / PRECISION.floatPrecisionExp,
        settle
      )
      const sellable: IStream<boolean> = map(
        p => (p.position?.sharesHeld ?? 0n) > 0n && (p.pool?.liquidationRate ?? 0n) === 0n,
        settle
      )

      const $value = $amountDisplay({
        hideBalances,
        usd: map(p => formatUsd(p.v, p.price), combine({ v: baseValue, price: priceFor(baseToken) })),
        amount: map(v => readableTokenAmountLabel(desc, v), baseValue),
        usdFontSize: text.sm,
        align: 'flex-end'
      })

      const $managePopover = $Popover({
        $target: $ButtonSecondary({
          $container: $defaultMiniButtonSecondary,
          $content: $row(spacing.tiny, style({ alignItems: 'center' }))(
            $text(map(s => (s ? 'Sell' : 'Claim'), sellable)),
            $popoverCaret()
          )
        })({ click: popManageTether() }),
        $open: constant($FundSellEditor(editorProps)({ changeDraft: redeemDraftTether() }), popManage),
        dismiss: redeemDraft
      })({})

      return [
        $row(spacing.default, style({ alignItems: 'center' }))($managePopover, $value),
        { changeRedeemDraft: redeemDraft }
      ]
    }
  )
