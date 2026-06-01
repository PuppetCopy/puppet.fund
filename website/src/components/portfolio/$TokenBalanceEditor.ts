import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import { readableTokenAmount } from '@puppet/sdk/core'
import { getTokenDescription } from '@puppet/sdk/gmx'
import { type ISubaccountState, type ITokenRegistryMap, tokenInfoFor } from '@puppet/sdk/state'
import { constant, type IStream, just, map, op, switchLatest } from 'aelea/stream'
import { type IBehavior, multicast } from 'aelea/stream-extended'
import { $node, $text, component, style } from 'aelea/ui'
import { $column, $Popover, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { $ButtonSecondary, $defaultMiniButtonSecondary, $hintAdjustment, intermediateText, text } from '@/ui-components'
import { $route } from '../../common/$common.js'
import { formatUsd, priceFor } from '../../io/gmx/priceFeed.js'
import type { IConnectedWallet } from '../../wallet/index.js'
import { $DepositEditor } from './$DepositEditor.js'
import { $WithdrawEditor } from './$WithdrawEditor.js'
import type { IDepositDraft, IWithdrawDraft } from './draft.js'

export type IEditorDraft = IDepositDraft | IWithdrawDraft

export interface I$TokenBalanceEditor {
  accountState: IStream<ISubaccountState>
  tokenRegistry: ITokenRegistryMap
  walletAccount: IConnectedWallet
  lateBindDerivation?: Omit<IAccountLib__AccountInitParams, 'signer'>
  draft: IStream<IEditorDraft | null>
}

export const $TokenBalanceEditor = ({
  accountState,
  tokenRegistry,
  walletAccount,
  lateBindDerivation,
  draft
}: I$TokenBalanceEditor) =>
  component(
    (
      [popEditor, popEditorTether]: IBehavior<PointerEvent, 'deposit' | 'withdraw'>,
      [changeDraft, changeDraftTether]: IBehavior<IEditorDraft>
    ) => {
      const $body = op(
        accountState,
        map(metric => {
          const token = tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, metric.baseTokenId).token
          const tokenDescription = getTokenDescription(token)
          const balance = metric.chains.get(HUB_CHAIN_ID)?.signedBalance ?? 0n
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

          const adjustmentChange: IStream<string> = intermediateText(
            map(
              async amount => (amount === 0n ? '' : readableTokenAmount(tokenDescription, balance + amount)),
              pendingAmount
            ),
            ''
          )

          const $balanceDisplay = $column(style({ gap: '1px', alignItems: 'flex-start' }))(
            $node(style({ fontWeight: '600', fontSize: text.base, color: palette.message }))($text(usdValue)),
            $hintAdjustment({
              color: adjustmentColor,
              change: adjustmentChange,
              $val: $node(style({ color: palette.foreground, fontSize: text.xs }))(
                $text(readableTokenAmount(tokenDescription, balance))
              )
            })
          )

          const depositDraft: IStream<IDepositDraft | null> = map(d => (d?.kind === 'deposit' ? d : null), draft)
          const withdrawDraft: IStream<IWithdrawDraft | null> = map(d => (d?.kind === 'withdraw' ? d : null), draft)

          const $depositEditor = $DepositEditor({
            accountState: metric,
            tokenRegistry,
            walletAccount,
            lateBindDerivation,
            existingDraft: depositDraft
          })({ changeDraft: changeDraftTether() })

          const $withdrawEditor = $WithdrawEditor({
            accountState: metric,
            tokenRegistry,
            walletAccount,
            existingDraft: withdrawDraft
          })({ changeDraft: changeDraftTether() })

          const withdrawDisabled = balance === 0n

          return $Popover({
            $target: $row(
              spacing.default,
              style({ padding: '4px', borderRadius: '4px', alignItems: 'center', display: 'inline-flex' })
            )(
              $route(tokenDescription, true),
              $balanceDisplay,
              $row(spacing.small, style({ alignItems: 'center' }))(
                $ButtonSecondary({
                  $container: $defaultMiniButtonSecondary,
                  $content: $text('Deposit')
                })({ click: popEditorTether(constant('deposit')) }),
                $ButtonSecondary({
                  $container: $defaultMiniButtonSecondary,
                  $content: $text('Withdraw'),
                  disabled: just(withdrawDisabled)
                })({ click: popEditorTether(constant('withdraw')) })
              )
            ),
            $open: map(action => (action === 'deposit' ? $depositEditor : $withdrawEditor), popEditor),
            dismiss: changeDraft
          })({})
        }),
        switchLatest
      )

      return [$body, { changeDraft }]
    }
  )
