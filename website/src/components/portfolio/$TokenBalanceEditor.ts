import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { getRegisteredTokenDescription, readableTokenAmountLabel } from '@puppet/sdk/core'
import { type ISubaccountState, type ITokenRegistryMap, tokenInfoFor } from '@puppet/sdk/state'
import { combine, constant, empty, type IStream, just, map, merge, op, skipRepeatsWith, switchLatest } from 'aelea/stream'
import { type IBehavior, multicast } from 'aelea/stream-extended'
import { $node, $text, component, style } from 'aelea/ui'
import { $Popover, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import type { Hex } from 'viem'
import {
  $amountDisplay,
  $ButtonPrimary,
  $ButtonSecondary,
  $defaultMiniButtonPrimary,
  $defaultMiniButtonSecondary,
  $icon,
  $info,
  $popoverCaret,
  text
} from '@/ui-components'
import { $route } from '../../common/$common.js'
import { formatUsd, priceFor } from '../../io/gmx/priceFeed.js'
import type { IConnectedWallet } from '../../wallet/index.js'
import { $DepositEditor } from './$DepositEditor.js'
import { $WithdrawEditor } from './$WithdrawEditor.js'
import type { IDepositDraft, IWithdrawDraft } from './draft.js'

export type IEditorDraft = IDepositDraft | IWithdrawDraft

export interface I$TokenBalanceEditor {
  hideBalances: IStream<boolean>
  accountState: IStream<ISubaccountState>
  token: Hex
  tokenRegistry: ITokenRegistryMap
  walletAccount: IConnectedWallet
  draft: IStream<IEditorDraft | null>
  inlineNote?: string
  // Deep-link trigger: emits 'deposit'/'withdraw' to open that editor's popover without a click (e.g. arriving from a
  // ?action=deposit-<symbol> link), merged with the button-driven popEditor.
  autoOpen?: IStream<'deposit' | 'withdraw'>
}

export const $TokenBalanceEditor = ({
  hideBalances,
  accountState,
  token,
  tokenRegistry,
  walletAccount,
  draft,
  inlineNote,
  autoOpen
}: I$TokenBalanceEditor) =>
  component(
    (
      [popEditor, popEditorTether]: IBehavior<PointerEvent, 'deposit' | 'withdraw'>,
      [changeDraft, changeDraftTether]: IBehavior<IEditorDraft>
    ) => {
      const $body = op(
        accountState,
        skipRepeatsWith(
          (a, b) =>
            a.account === b.account &&
            (a.balances.get(token)?.signedBalance ?? 0n) === (b.balances.get(token)?.signedBalance ?? 0n)
        ),
        map(metric => {
          const tokenDescription = getRegisteredTokenDescription(token)
          const balance = metric.balances.get(token)?.signedBalance ?? 0n
          const usdValue: IStream<string> = map(price => formatUsd(balance, price), priceFor(token))

          const pendingAmount: IStream<bigint> = op(
            draft,
            map(d => (d ? (d.kind === 'deposit' ? d.output.amount : -d.inputAmount.amount) : 0n)),
            multicast
          )

          const adjustmentColor = map(
            amount => (amount > 0n ? palette.positive : amount < 0n ? palette.negative : undefined),
            pendingAmount
          )

          const adjustmentChange = map(
            p =>
              p.amount === 0n
                ? null
                : {
                    usd: formatUsd(balance + p.amount, p.price),
                    amount: readableTokenAmountLabel(tokenDescription, balance + p.amount)
                  },
            combine({ amount: pendingAmount, price: priceFor(token) })
          )

          const $balanceDisplay = $amountDisplay({
            hideBalances,
            usd: usdValue,
            amount: readableTokenAmountLabel(tokenDescription, balance),
            change: adjustmentChange,
            color: adjustmentColor,
            align: 'flex-end'
          })

          const depositDraft: IStream<IDepositDraft | null> = map(d => (d?.kind === 'deposit' ? d : null), draft)
          const withdrawDraft: IStream<IWithdrawDraft | null> = map(d => (d?.kind === 'withdraw' ? d : null), draft)

          const $depositEditor = $DepositEditor({
            hideBalances,
            accountState: metric,
            token,
            tokenRegistry,
            walletAccount,
            existingDraft: depositDraft
          })({ changeDraft: changeDraftTether() })

          const $withdrawEditor = $WithdrawEditor({
            accountState: metric,
            token,
            tokenRegistry,
            walletAccount,
            existingDraft: withdrawDraft
          })({ changeDraft: changeDraftTether() })

          const withdrawDisabled = balance === 0n

          return $Popover({
            $target: $row(
              spacing.default,
              style({ padding: '4px', borderRadius: '4px', alignItems: 'center', flex: 1 })
            )(
              $route(tokenDescription, true),
              $row(spacing.small, style({ alignItems: 'center' }))(
                $ButtonPrimary({
                  $container: $defaultMiniButtonPrimary,
                  $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Deposit'), $popoverCaret())
                })({ click: popEditorTether(constant('deposit')) }),
                $ButtonSecondary({
                  $container: $defaultMiniButtonSecondary,
                  $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Withdraw'), $popoverCaret()),
                  disabled: just(withdrawDisabled)
                })({ click: popEditorTether(constant('withdraw')) })
              ),
              balance === 0n && inlineNote
                ? $row(spacing.small, style({ alignItems: 'center', flex: 1, minWidth: '0' }))(
                    $icon({ $content: $info, width: '12px', fill: palette.indeterminate }),
                    $node(
                      style({
                        color: palette.foreground,
                        fontSize: text.xs,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        minWidth: '0'
                      })
                    )($text(inlineNote))
                  )
                : $node(style({ flex: 1 }))(),
              $balanceDisplay
            ),
            $open: map(
              action => (action === 'deposit' ? $depositEditor : $withdrawEditor),
              merge(popEditor, autoOpen ?? empty)
            ),
            dismiss: changeDraft
          })({})
        }),
        switchLatest
      )

      return [$body, { changeDraft }]
    }
  )
