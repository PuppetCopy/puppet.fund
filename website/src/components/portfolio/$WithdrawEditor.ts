import { formatThrownError } from '@puppet/sdk/compact'
import { ADDRESS_ZERO, type ChainId, resolveDispatchChainId } from '@puppet/sdk/const'
import { getTokenDescription, readableTokenAmount, readableTokenAmountLabel } from '@puppet/sdk/core'
import { deliveredLeg, type IWithdrawInput } from '@puppet/sdk/intent'
import {
  type IRelayFeeQuote,
  type ITokenRegistryMap,
  RELAY_RATE_MAX_STALE_MS,
  symbolOf
} from '@puppet/sdk/state'
import {
  awaitPromises,
  combine,
  filter,
  type IStream,
  just,
  map,
  merge,
  op,
  sample,
  sampleMap,
  skipRepeats,
  start,
  switchMap,
} from 'aelea/stream'
import { type IBehavior, multicast, type PromiseState, PromiseStatus, promiseState, state } from 'aelea/stream-extended'
import { $node, $text, component, type INode, nodeEvent, style, styleBehavior } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { type Hex, isAddressEqual } from 'viem'
import { $ButtonPrimaryOutline, $noteTooltip, $TokenAmountInput, text } from '@/ui-components'
import { uiStorage } from '@/ui-storage'
import { originChainKey } from '../../app/localStoreSchema.js'
import type { ISwapRequest } from '../../io/bridge/swapQuote.js'
import context, { DISPLAY_QUOTE_TTL_MS } from '../../io/context.js'
import { priceFor } from '../../io/price.js'
import type { IConnectedWallet } from '../../wallet/index.js'
import { balanceAt, type IRootState } from '../../wallet/index.js'
import { $crumbTrail } from './$InlineSwitchView.js'
import { $SwapProviderFeeEditor, type ISelectedRoute } from './$SwapProviderFeeEditor.js'
import { $SwapTargetFlow, type ISwapTargetOption, withdrawTargetOptions } from './$SwapTargetFlow.js'
import type { IUnsealed, IWithdrawDraft } from './draft.js'
import {
  $editorAmountLabel,
  $editorFlowContainer,
  $editorPercentSlider,
  $maxAmountButton,
  $noteSlot,
  $overlaySliderContainer,
  amountUsdLabel,
  createFocusState,
  scaleByPercent,
} from './editorUtils.js'
import { walletClientForChain } from './runner/_shared.js'

export interface I$WithdrawEditor {
  accountState: IRootState
  chainId: ChainId
  token: Hex
  tokenRegistry: ITokenRegistryMap
  walletAccount: IConnectedWallet
  existingDraft: IStream<IWithdrawDraft | null>
}

export const $WithdrawEditor = (config: I$WithdrawEditor) =>
  component(
    (
      [clickAddDraft, clickAddDraftTether]: IBehavior<PointerEvent>,
      [pickReceive, pickReceiveTether]: IBehavior<ISwapTargetOption>,
      [selectingDest, selectingDestTether]: IBehavior<boolean>,
      [inputAmount, inputAmountTether]: IBehavior<bigint>,
      [focusEvt, focusEvtTether]: IBehavior<FocusEvent>,
      [blurEvt, blurEvtTether]: IBehavior<FocusEvent>,
      [sliderPercent, sliderPercentTether]: IBehavior<number>,
      [clickMax, clickMaxTether]: IBehavior<INode<HTMLButtonElement>, MouseEvent>,
      [enterPress, enterPressTether]: IBehavior<KeyboardEvent>,
      [selectedRoute, selectedRouteTether]: IBehavior<ISelectedRoute>
    ) => {
      const { accountState, chainId, token, tokenRegistry, walletAccount, existingDraft } = config
      const authoredBalance = balanceAt(accountState.balances, chainId, token)
      const from = accountState.account
      const to = accountState.user
      const tokenDescription = getTokenDescription(chainId, token)
      const decimals = tokenDescription.decimals
      const relayFeeQuery: IStream<PromiseState<IRelayFeeQuote>> = op(
        just(chainId),
        map(id => context.getRelayFeeQuote(id, token, DISPLAY_QUOTE_TTL_MS)),
        promiseState,
        state()
      )
      const relayFeeMapQuery: IStream<IRelayFeeQuote | null> = map(f => (f.status === PromiseStatus.DONE ? f.value : null), relayFeeQuery)

      const balance: IStream<bigint> = just(authoredBalance)

      const receiveOptions = withdrawTargetOptions(tokenRegistry, chainId, token)
      const isDestChainId = (id: number): id is ChainId => receiveOptions.some(o => o.chainId === id)
      const optionsOn = (chainId: ChainId): readonly ISwapTargetOption[] => receiveOptions.filter(o => o.chainId === chainId)
      const walletChainId = walletAccount.walletClient.chain?.id
      const defaultChainId = walletChainId !== undefined && isDestChainId(walletChainId) ? walletChainId : chainId
      const userChain: IStream<ChainId> = op(
        pickReceive,
        map(o => {
          void walletClientForChain(walletAccount.walletClient, o.chainId).catch(err =>
            console.error('[withdraw] wallet chain switch failed', err)
          )
          return o.chainId
        }),
        multicast
      )
      const draftChain: IStream<ChainId> = op(
        existingDraft,
        filter((d): d is IWithdrawDraft => d !== null && isDestChainId(d.output.chainId)),
        map(d => d.output.chainId)
      )
      const persistedChain: IStream<number | null> = uiStorage.replayWrite(
        originChainKey(to),
        filter(isDestChainId, userChain)
      )
      const initialChain: IStream<ChainId> = op(
        persistedChain,
        map(saved => (saved !== null && isDestChainId(saved) ? saved : defaultChainId))
      )
      const chainSelection = state(defaultChainId, merge(userChain, draftChain, initialChain))

      const draftReceiveToken: IStream<Hex> = op(
        existingDraft,
        filter((d): d is IWithdrawDraft => d !== null),
        map(d => d.input.outputToken as Hex)
      )
      const rawReceiveToken: IStream<Hex> = state(
        token,
        merge(map(o => o.id, pickReceive), draftReceiveToken)
      )
      const receiveSel: IStream<ISwapTargetOption> = op(
        combine({ chainId: chainSelection, id: rawReceiveToken }),
        map(p => {
          const onChain = optionsOn(p.chainId)
          return onChain.find(o => isAddressEqual(o.id, p.id)) ?? onChain[0]
        }),
        state()
      )
      const needsRoute = (sel: ISwapTargetOption): boolean => !(sel.chainId === chainId && isAddressEqual(sel.id, token))

      const relayFee: IStream<bigint | null> = op(
        relayFeeMapQuery,
        map(feeMap => (feeMap === null ? null : feeMap('withdraw', false, 0n, 0n, 0n))),
        skipRepeats
      )

      const sliderFee: IStream<bigint | null> = start(null, relayFee)
      const sliderAmount: IStream<bigint> = sampleMap(
        (s, pct) => {
          if (Math.max(0, Math.min(1, pct)) >= 1) return s.balance
          if (s.fee === null) return 0n
          const available = s.balance > s.fee ? s.balance - s.fee : 0n
          return scaleByPercent(available, pct)
        },
        combine({ balance, fee: sliderFee }),
        sliderPercent
      )
      const maxAmount: IStream<bigint> = sample(balance, clickMax)
      const draftAmountHydration: IStream<bigint> = op(
        existingDraft,
        map(d => (d ? d.inputAmount.amount : 0n))
      )
      const amountValue: IStream<bigint> = state(0n, merge(inputAmount, sliderAmount, maxAmount, draftAmountHydration))

      const focused = createFocusState(focusEvt, blurEvt)

      const draftAmount: IStream<bigint> = map(
        p => (p.amount > 0n && p.amount === p.balance ? 0n : p.amount),
        combine({ amount: amountValue, balance })
      )

      const request: IStream<ISwapRequest | null> = multicast(
        map(params => {
          if (!needsRoute(params.sel)) return null
          if (params.raw === 0n || params.fee === null) return null
          const input = params.draft === 0n ? params.balance - params.fee : params.draft
          if (input <= 0n) return null
          return {
            originChainId: chainId,
            destinationChainId: resolveDispatchChainId(params.sel.chainId),
            inputToken: token,
            outputToken: params.sel.id,
            inputAmount: input,
            account: from,
            recipient: to
          }
        }, combine({ balance, sel: receiveSel, draft: draftAmount, raw: amountValue, fee: relayFee }))
      )

      const alert: IStream<string | null> = op(
        sampleMap(
          (sample, params): string | null => {
            if (params.feeQuote.status === PromiseStatus.ERROR) return `Relay fee unavailable: ${formatThrownError(params.feeQuote.error)}`
            const fee = sample.relayFee
            if (fee === null) return null
            if (needsRoute(params.sel)) {
              if (params.route.error) return params.route.error
              if (params.route.limitError) return params.route.limitError
            }
            if (params.balance <= fee) {
              return `Balance must exceed execution fee ${readableTokenAmountLabel(tokenDescription, fee)}`
            }
            if (params.amount === 0n) return null
            if (params.amount + fee > params.balance) {
              return `Exceeds available ${readableTokenAmount(tokenDescription, params.balance - fee)}`
            }
            return null
          },
          combine({ relayFee }),
          combine({
            balance,
            sel: receiveSel,
            route: selectedRoute,
            amount: draftAmount,
            feeQuote: relayFeeQuery
          })
        ),
        state(null)
      )

      const disabled = op(
        combine({
          alert,
          route: selectedRoute,
          sel: receiveSel,
          rawAmount: amountValue,
          feeMap: relayFeeMapQuery
        }),
        map(p => {
          if (p.rawAmount === 0n) return true
          if (p.alert !== null) return true
          if (p.feeMap === null) return true
          if (!needsRoute(p.sel)) return false
          return !p.route.ready
        }),
        state(true)
      )

      const submitTrigger: IStream<unknown> = merge(
        clickAddDraft,
        op(
          sampleMap((dis: boolean, evt: KeyboardEvent) => ({ dis, evt }), disabled, enterPress),
          filter(p => !p.dis)
        )
      )

      const tokenPrice = priceFor(chainId, token)

      const $bridgeFeeRow = $SwapProviderFeeEditor({
        active: map(needsRoute, receiveSel),
        request,
        maxLegs: 1
      })({ selectRoute: selectedRouteTether() })

      const valueToShow: IStream<string> = map(
        (p: { amt: bigint; focused: boolean }) => (p.amt === 0n ? '' : readableTokenAmount(decimals, p.amt)),
        filter((p: { amt: bigint; focused: boolean }) => !p.focused, combine({ amt: amountValue, focused }))
      )

      const $field = $TokenAmountInput({ decimals, valueToShow })({
        inputAmount: inputAmountTether(),
        focus: focusEvtTether(),
        blur: blurEvtTether(),
        enter: enterPressTether()
      })

      const sliderValue: IStream<number> = map(
        p => {
          if (p.fee === null) return 0
          const available = p.bal > p.fee ? p.bal - p.fee : 0n
          if (available <= 0n) return 0
          return Math.min(1, Number((p.amt * 10000n) / available) / 10000)
        },
        combine({ amt: amountValue, bal: balance, fee: sliderFee })
      )
      const hasError: IStream<boolean> = map(a => a !== null, alert)
      const sliderDisabled: IStream<boolean> = map(b => b === 0n, balance)
      const $percentSlider = $editorPercentSlider({
        value: sliderValue,
        ariaLabel: 'Amount percentage',
        disabled: sliderDisabled,
        error: hasError,
        $container: $overlaySliderContainer
      })({ change: sliderPercentTether() })

      const amountUsd: IStream<string> = amountUsdLabel(amountValue, tokenPrice)
      const $alert = $noteSlot(
        switchMap(
          msg => (msg ? $noteTooltip($text(msg)) : $node(style({ color: palette.foreground, fontSize: text.xs }))($text(amountUsd))),
          alert
        )
      )

      const $maxButton = $maxAmountButton(amountValue, balance, clickMaxTether(nodeEvent('click')))

      const $topSection = $SwapTargetFlow({
        value: receiveSel,
        optionList: just(receiveOptions),
        source: just({ chainId, symbol: symbolOf(chainId, token) }),
        $container: $editorFlowContainer,
        $inputContent: $anchor =>
          $node(style({ display: 'contents' }))(
            $editorAmountLabel(
              $crumbTrail([{ label: 'Withdraw' }]),
              $row(spacing.small, style({ alignItems: 'center' }))($field, $maxButton),
              $alert
            ),
            $anchor
          )
      })({ select: pickReceiveTether(), selecting: selectingDestTether() })

      return [
        $column(spacing.default, style({ minWidth: '380px' }))(
          $topSection,
          $node(
            style({ display: 'contents' }),
            styleBehavior(map(s => (s ? { display: 'none' } : { display: 'contents' }), selectingDest))
          )(
            $node(style({ margin: '0 -26px', display: 'flex' }))($percentSlider),
            $row(style({ fontSize: text.sm }))($bridgeFeeRow),
            $row(spacing.default, style({ alignItems: 'center' }))(
              $node(style({ flex: 1 }))(),
              $ButtonPrimaryOutline({ disabled, $content: $text('Save') })({ click: clickAddDraftTether() })
            )
          )
        ),
        (() => {
          type IDraftSnapshot = {
            balance: bigint
            sel: ISwapTargetOption
            amount: bigint
            route: ISelectedRoute
          }
          const buildDraft = (params: IDraftSnapshot & { fee: bigint }): IWithdrawDraft => {
              const isHome = params.sel.chainId === chainId
              const liveBalance = params.balance
              const isSweep = params.amount === 0n
              const id = `withdraw:${from}:${chainId}:${token}`
              const grossAmount = isSweep ? liveBalance : params.amount + params.fee

              if (isHome && !needsRoute(params.sel)) {
                const input: IUnsealed<IWithdrawInput> = {
                  inputToken: token,
                  outputToken: token,
                  inputAmount: grossAmount,
                  outputAmount: grossAmount > params.fee ? grossAmount - params.fee : 0n,
                  destinationChainId: BigInt(chainId),
                  route: { kind: 'transfer' },
                  fillDeadline: 0
                }
                return {
                  kind: 'withdraw',
                  id,
                  chainId,
                  balanceBefore: authoredBalance,
                  inputAmount: { amount: grossAmount, token },
                  output: {
                    receiver: to,
                    chainId,
                    amount: grossAmount,
                    expected: grossAmount,
                    token,
                    approx: false
                  },
                  input
                }
              }

              const plan = params.route.plan
              const signed = plan === null || plan.length > 1 ? null : plan[0]
              const outputToken = params.sel.id
              const input: IUnsealed<IWithdrawInput> = {
                inputToken: token,
                outputToken,
                inputAmount: grossAmount,
                outputAmount: plan === null ? 0n : deliveredLeg(plan).outputAmount,
                destinationChainId: BigInt(params.sel.chainId),
                route:
                  signed !== null
                    ? signed.route
                    : {
                        kind: 'across',
                        exclusiveRelayer: ADDRESS_ZERO,
                        quoteTimestamp: 0,
                        exclusivityParameter: 0
                      },
                fillDeadline: signed === null ? 0 : Math.floor(signed.fillDeadline)
              }
              return {
                kind: 'withdraw',
                id,
                chainId,
                balanceBefore: authoredBalance,
                inputAmount: { amount: grossAmount, token },
                output: {
                  receiver: to,
                  chainId: params.sel.chainId,
                  amount: plan === null ? grossAmount : deliveredLeg(plan).outputAmount,
                  expected: plan === null ? grossAmount : deliveredLeg(plan).expectedOutputAmount,
                  token: params.sel.id,
                  approx: true
                },
                input
              }
          }
          const changeDraft: IStream<IWithdrawDraft> = op(
            sample(
              combine({
                balance,
                sel: receiveSel,
                amount: draftAmount,
                route: selectedRoute
              }),
              submitTrigger
            ),
            map(async (snap): Promise<IWithdrawDraft> => {
              const feeMap = await context.getRelayFeeQuote(chainId, token, RELAY_RATE_MAX_STALE_MS)
              return buildDraft({ ...snap, fee: feeMap('withdraw', false, 0n, 0n, 0n) })
            }),
            awaitPromises
          )
          return { changeDraft }
        })()
      ]
    }
  )
