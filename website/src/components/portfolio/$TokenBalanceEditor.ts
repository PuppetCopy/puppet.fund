import type { ChainId } from '@puppet/sdk/const'
import { getTokenDescription, readableTokenAmountLabel } from '@puppet/sdk/core'
import type { ITokenRegistryMap } from '@puppet/sdk/state'
import { combine, constant, empty, filter, type IStream, just, map, merge, op, skipRepeatsWith, switchLatest } from 'aelea/stream'
import { type IBehavior, multicast } from 'aelea/stream-extended'
import { $node, $text, component, style } from 'aelea/ui'
import { $column, $Popover, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { type Hex, isAddressEqual } from 'viem'
import {
  $amountDisplay,
  $ButtonPrimary,
  $defaultMiniButtonPrimary,
  $popoverCaret
} from '@/ui-components'
import { $tokenProfile } from '../../common/$common.js'
import { formatUsd, priceFor } from '../../io/price.js'
import type { IConnectedWallet, IRootState } from '../../wallet/index.js'
import { $AccountSwapEditor } from './$AccountSwapEditor.js'
import { $DepositEditor } from './$DepositEditor.js'
import { $WithdrawEditor } from './$WithdrawEditor.js'
import { depositCreditToken, type IDepositDraft, type IEditorDraft, type IWithdrawDraft } from './draft.js'
import { $editorPopoverContentContainer } from './editorUtils.js'

export interface I$TokenBalanceEditor {
  hideBalances: IStream<boolean>
  accountState: IStream<IRootState>
  chainId: ChainId
  token: Hex
  tokenRegistry: ITokenRegistryMap
  walletAccount: IConnectedWallet
  draft: IStream<IEditorDraft | null>
  open?: IStream<Hex>
}

export const $TokenBalanceEditor = ({
  hideBalances,
  accountState,
  chainId,
  token,
  tokenRegistry,
  walletAccount,
  draft,
  open
}: I$TokenBalanceEditor) =>
  component(
    (
      [popEditor, popEditorTether]: IBehavior<PointerEvent, 'deposit' | 'withdraw' | 'convert'>,
      [changeDraft, changeDraftTether]: IBehavior<IEditorDraft>
    ) => {
      const chainRow = (s: IRootState) => s.balances.find(r => r.chainId === chainId && isAddressEqual(r.token, token))
      const $body = op(
        accountState,
        skipRepeatsWith((a, b) => {
          const x = chainRow(a)
          const y = chainRow(b)
          return a.account === b.account && x?.balance === y?.balance
        }),
        map(metric => {
          const tokenDescription = getTokenDescription(chainId, token)
          const bookRow = chainRow(metric)
          const liveBalance = bookRow?.balance ?? 0n
          const balanceOf = (d: IEditorDraft | null): bigint =>
            d !== null && d.kind === 'withdraw' ? d.balanceBefore : liveBalance
          const usdValue: IStream<string> = map(
            p => formatUsd(balanceOf(p.d), p.price),
            combine({ d: draft, price: priceFor(chainId, token) })
          )

          const pendingAmount: IStream<bigint> = op(
            draft,
            map(d => {
              if (d === null) return 0n
              if (d.kind === 'withdraw') return -d.inputAmount.amount
              return Number(d.deposit.destinationChainId) === chainId && isAddressEqual(depositCreditToken(d), token) ? d.expectedOutput : 0n
            }),
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
                    usd: formatUsd(balanceOf(p.d) + p.amount, p.price),
                    amount: readableTokenAmountLabel(tokenDescription, balanceOf(p.d) + p.amount)
                  },
            combine({ amount: pendingAmount, price: priceFor(chainId, token), d: draft })
          )

          const $balanceDisplay = $amountDisplay({
            hideBalances,
            usd: usdValue,
            amount: map(d => readableTokenAmountLabel(tokenDescription, balanceOf(d)), draft),
            change: adjustmentChange,
            color: adjustmentColor,
            align: 'flex-end'
          })

          const depositDraft: IStream<IDepositDraft | null> = map(d => (d?.kind === 'deposit' && d.deposit.route === null ? d : null), draft)
          const withdrawDraft: IStream<IWithdrawDraft | null> = map(d => (d?.kind === 'withdraw' ? d : null), draft)
          const convertDraft: IStream<IDepositDraft | null> = map(d => (d?.kind === 'deposit' && d.deposit.route !== null ? d : null), draft)

          const withdrawDisabled = liveBalance === 0n
          const convertDisabled = liveBalance === 0n

          return $Popover({
            $contentContainer: $editorPopoverContentContainer,
            $target: $row(
              spacing.default,
              style({ borderRadius: '4px', alignItems: 'center', flex: 1, padding: '10px 0' })
            )(
              $tokenProfile(chainId, token),
              $row(spacing.small, style({ alignItems: 'center' }))(
                $ButtonPrimary({
                  $container: $defaultMiniButtonPrimary,
                  $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Add'), $popoverCaret())
                })({ click: popEditorTether(constant('deposit')) }),
                $ButtonPrimary({
                  $container: $defaultMiniButtonPrimary,
                  $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Withdraw'), $popoverCaret()),
                  disabled: just(withdrawDisabled)
                })({ click: popEditorTether(constant('withdraw')) }),
                $ButtonPrimary({
                  $container: $defaultMiniButtonPrimary,
                  $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Swap'), $popoverCaret()),
                  disabled: just(convertDisabled)
                })({ click: popEditorTether(constant('convert')) })
              ),
              $node(style({ flex: 1 }))(),
              $column(style({ alignItems: 'flex-end' }))($balanceDisplay)
            ),
            $open: map(
              action =>
                action === 'deposit'
                  ? $DepositEditor({
                      hideBalances,
                      account: metric.account,
                      tokenRegistry,
                      walletAccount,
                      destination: { chainId, token },
                      arrival: 'credit',
                      existingDraft: depositDraft
                    })({ changeDraft: changeDraftTether() })
                  : action === 'convert'
                    ? $AccountSwapEditor({
                        accountState: metric,
                        chainId,
                        token,
                        tokenRegistry,
                        existingDraft: convertDraft
                      })({ changeDraft: changeDraftTether() })
                    : $WithdrawEditor({
                        accountState: metric,
                        chainId,
                        token,
                        tokenRegistry,
                        walletAccount,
                        existingDraft: withdrawDraft
                      })({ changeDraft: changeDraftTether() }),
              merge(
                popEditor,
                open ? op(open, filter(t => isAddressEqual(t, token)), constant('deposit' as const)) : empty
              )
            ),
            dismiss: changeDraft
          })({})
        }),
        switchLatest
      )

      return [$body, { changeDraft }]
    }
  )
