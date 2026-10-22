import { HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import { depositArrivalToken, type IDepositDraft, type IEditorDraft, type IWalletWithdrawDraft, type IWithdrawDraft } from '@puppet/sdk/client'
import type { ChainId } from '@puppet/sdk/const'
import { getTokenDescription, readableTokenAmountLabel } from '@puppet/sdk/core'
import { combine, constant, empty, type IStream, just, map, merge, op, sample, sampleMap, skipRepeats, start, switchLatest, switchMap } from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $node, $text, component, style, styleBehavior, stylePseudo } from 'aelea/ui'
import { $column, $Popover, $row, spacing } from 'aelea/ui-components'
import { interaction, palette } from 'aelea/ui-components-theme'
import { type Hex, isAddressEqual } from 'viem'
import { $amountDisplay, $ButtonPrimary, $ButtonSecondary, $defaultMiniButtonPrimary, $defaultMiniButtonSecondary, $popoverCaret, type IAmountChange, text } from '@/ui-components'
import { $tokenProfile } from '../../common/$common.js'
import { priceFor, usdOf } from '../../io/price.js'
import type { IConnectedWallet, IRootState } from '../../wallet/index.js'
import { $AccountSwapEditor } from './$AccountSwapEditor.js'
import { $WithdrawEditor } from './$WithdrawEditor.js'
import { $editorPopoverContentContainer } from './editorUtils.js'

type IBalanceMode = 'withdraw' | 'swap'

const $transferContainer = $defaultMiniButtonPrimary(
  style({ borderColor: palette.indeterminate, color: palette.indeterminate, fill: palette.indeterminate }),
  stylePseudo(':hover', { borderColor: palette.indeterminate, filter: interaction.hoverFilter }),
  stylePseudo('[aria-expanded="true"]', { borderColor: palette.indeterminate, filter: interaction.hoverFilter })
)

export interface I$TokenBalanceEditor {
  hideBalances: IStream<boolean>
  viewOnly: IStream<boolean>
  accountState: IStream<IRootState>
  chainId: ChainId
  token: Hex
  walletAccount: IConnectedWallet
  draft: IStream<IEditorDraft | null>
  exit: IStream<'waiting' | 'open' | 'closed' | null>
}

export const $TokenBalanceEditor = ({ hideBalances, viewOnly, accountState, chainId, token, walletAccount, draft, exit }: I$TokenBalanceEditor) =>
  component(
    (
      [popSwap, popSwapTether]: IBehavior<PointerEvent>,
      [popWithdraw, popWithdrawTether]: IBehavior<PointerEvent>,
      [changeDraft, changeDraftTether]: IBehavior<IEditorDraft>,
      [walletWithdraw, walletWithdrawTether]: IBehavior<PointerEvent>
    ) => {
      const opened: IStream<IBalanceMode> = merge(constant('swap', popSwap), constant('withdraw', popWithdraw))

      const tokenDescription = getTokenDescription(chainId, token)
      const price = priceFor(chainId, token)
      const liveBalance: IStream<bigint> = op(
        accountState,
        map(s => s.balances.find(r => r.chainId === chainId && isAddressEqual(r.token, token))?.balance ?? 0n),
        skipRepeats,
        state()
      )
      const shownBalance: IStream<bigint> = op(
        combine({ d: draft, live: liveBalance }),
        map(p => (p.d !== null && p.d.kind === 'withdraw' ? p.d.balanceBefore : p.live)),
        state()
      )
      const syncError: IStream<string | null> = op(accountState, map(s => s.syncError), skipRepeats, state())
      const synced = (value: IStream<Promise<string> | string>): IStream<Promise<string> | string> =>
        op(
          combine({ value, syncError }),
          switchMap(p => (p.syncError === null ? just(p.value) : start(p.value, just(Promise.reject(new Error(p.syncError))))))
        )

      const pendingAmount: IStream<bigint> = op(
        draft,
        map(d => {
          if (d === null) return 0n
          if (d.kind === 'withdraw') return -d.inputAmount.amount
          return Number(d.deposit.destinationChainId) === chainId && isAddressEqual(depositArrivalToken(d), token) ? d.expectedOutput : 0n
        }),
        state()
      )

      const adjustmentColor = map(amount => (amount > 0n ? palette.positive : amount < 0n ? palette.negative : undefined), pendingAmount)

      const adjustmentChange = op(
        combine({ amount: pendingAmount, price, balance: shownBalance, syncError }),
        switchMap((p): IStream<IAmountChange | null> => {
          if (p.amount === 0n) return just(null)
          const projected: IAmountChange = { usd: usdOf(p.balance + p.amount, p.price), amount: readableTokenAmountLabel(tokenDescription, p.balance + p.amount) }
          return p.syncError === null ? just(projected) : start(projected, just({ ...projected, usd: Promise.reject(new Error(p.syncError)) }))
        })
      )

      const $balanceDisplay = $amountDisplay({
        hideBalances,
        usd: synced(map(p => usdOf(p.balance, p.price), combine({ balance: shownBalance, price }))),
        amount: synced(map(balance => readableTokenAmountLabel(tokenDescription, balance), shownBalance)),
        change: adjustmentChange,
        color: adjustmentColor,
        align: 'flex-end'
      })

      const withdrawDraft: IStream<IWithdrawDraft | null> = map(d => (d?.kind === 'withdraw' ? d : null), draft)
      const convertDraft: IStream<IDepositDraft | null> = map(d => (d?.kind === 'deposit' && d.deposit.route !== null ? d : null), draft)
      const exitPhase: IStream<'waiting' | 'open' | 'closed' | null> = op(exit, start(null), skipRepeats, state())
      const actionDisabled = map(
        p => p.view || p.balance === 0n || p.phase === 'waiting' || p.phase === 'open',
        combine({ view: viewOnly, balance: liveBalance, phase: exitPhase })
      )

      const $body = $Popover({
        $contentContainer: $editorPopoverContentContainer,
        $target: $row(spacing.default, style({ borderRadius: '4px', alignItems: 'center', flex: 1, padding: '10px 0' }))(
          chainId === HUB_CHAIN_ID && isAddressEqual(token, PROTOCOL.nativeToken)
            ? $column(spacing.tiny, style({ minWidth: '0' }))(
                $tokenProfile(chainId, token),
                $node(style({ fontSize: text.xs, color: palette.indeterminate }), styleBehavior(map(balance => (balance > 0n ? null : { display: 'none' }), liveBalance)))(
                  $text('Withdraw native ETH and deposit WETH to get matched')
                )
              )
            : $tokenProfile(chainId, token),
          $row(spacing.small, style({ alignItems: 'center' }))(
            $ButtonPrimary({
              $container: chainId === HUB_CHAIN_ID ? $defaultMiniButtonSecondary : $transferContainer,
              $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text(chainId === HUB_CHAIN_ID ? 'Swap' : 'Transfer to hub'), $popoverCaret()),
              disabled: actionDisabled
            })({ click: popSwapTether() }),
            $ButtonSecondary({
              $container: $defaultMiniButtonSecondary,
              $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Withdraw'), $popoverCaret()),
              disabled: actionDisabled
            })({ click: popWithdrawTether() }),
            switchLatest(
              map(
                phase =>
                  phase !== 'open'
                    ? empty
                    : $ButtonPrimary({
                        $container: $defaultMiniButtonPrimary,
                        $content: $text('Withdraw to wallet'),
                        disabled: map(p => p.view || p.balance === 0n, combine({ view: viewOnly, balance: liveBalance }))
                      })({ click: walletWithdrawTether() }),
                exitPhase
              )
            )
          ),
          $node(style({ flex: 1 }))(),
          $column(style({ alignItems: 'flex-end' }))($balanceDisplay)
        ),
        $open: sampleMap(
          (metric: IRootState, mode: IBalanceMode) =>
            mode === 'swap'
              ? $AccountSwapEditor({ accountState: metric, chainId, token, existingDraft: convertDraft })({ changeDraft: changeDraftTether() })
              : $WithdrawEditor({ accountState: metric, chainId, token, walletAccount, existingDraft: withdrawDraft })({ changeDraft: changeDraftTether() }),
          accountState,
          opened
        ),
        dismiss: changeDraft
      })({})

      return [
        $body,
        {
          changeDraft,
          walletWithdraw: sample(
            map((balance): IWalletWithdrawDraft => ({ kind: 'walletWithdraw', id: `walletWithdraw:${chainId}:${token}`, chainId, token, amount: balance }), liveBalance),
            walletWithdraw
          )
        }
      ]
    }
  )
