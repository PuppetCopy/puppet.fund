import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { getChainTokenDescription, readableTokenAmountLabel } from '@puppet/sdk/core'
import type { ISubaccountState, ITokenRegistryMap, } from '@puppet/sdk/state'
import { combine, constant, type IStream, just, map, op, skipRepeatsWith, switchLatest } from 'aelea/stream'
import { type IBehavior, multicast } from 'aelea/stream-extended'
import { $node, $text, component, style } from 'aelea/ui'
import { $Popover, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import type { Hex } from 'viem'
import {
  $amountDisplay,
  $ButtonPrimary,
  $defaultMiniButtonPrimary,
  $popoverCaret,
} from '@/ui-components'
import { $route } from '../../common/$common.js'
import { formatUsd, priceFor } from '../../io/price.js'
import type { IConnectedWallet } from '../../wallet/index.js'
import { $DepositEditor } from './$DepositEditor.js'
import { $WithdrawEditor } from './$WithdrawEditor.js'
import type { IDepositDraft, IWithdrawDraft } from './draft.js'
import { $editorPopoverContentContainer } from './editorUtils.js'

export type IEditorDraft = IDepositDraft | IWithdrawDraft

export interface I$TokenBalanceEditor {
  hideBalances: IStream<boolean>
  accountState: IStream<ISubaccountState>
  token: Hex
  tokenRegistry: ITokenRegistryMap
  walletAccount: IConnectedWallet
  draft: IStream<IEditorDraft | null>
}

export const $TokenBalanceEditor = ({
  hideBalances,
  accountState,
  token,
  tokenRegistry,
  walletAccount,
  draft
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
          const tokenDescription = getChainTokenDescription(HUB_CHAIN_ID, token)
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
            $contentContainer: $editorPopoverContentContainer,
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
                $ButtonPrimary({
                  $container: $defaultMiniButtonPrimary,
                  $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Withdraw'), $popoverCaret()),
                  disabled: just(withdrawDisabled)
                })({ click: popEditorTether(constant('withdraw')) })
              ),
              $node(style({ flex: 1 }))(),
              $balanceDisplay
            ),
            $open: map(
              action => (action === 'deposit' ? $depositEditor : $withdrawEditor),
              popEditor
            ),
            dismiss: changeDraft
          })({})
        }),
        switchLatest
      )

      return [$body, { changeDraft }]
    }
  )
