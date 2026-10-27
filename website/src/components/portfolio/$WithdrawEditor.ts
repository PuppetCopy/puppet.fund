import { PROTOCOL } from '@puppet/contracts/const'
import { predictUserAccount } from '@puppet/sdk/account'
import type { IUnsealed, IWithdrawDraft } from '@puppet/sdk/client'
import { formatThrownError } from '@puppet/sdk/compact'
import { type ChainId, PRECISION, resolveDispatchChainId } from '@puppet/sdk/const'
import { getTokenDescription, readablePercentage, readableTokenAmount, readableTokenAmountLabel } from '@puppet/sdk/core'
import type { IWithdrawInput } from '@puppet/sdk/intent'
import {
  type IRelayFeeQuote,
  RELAY_RATE_MAX_STALE_MS,
  symbolOf,
  TYPICAL_SUBCALL_GAS
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
import { uiStorage } from '@/ui-storage'
import { editorChoiceKey, type IStoredPath } from '../../app/localStoreSchema.js'
import { $intermediateText, $noteTooltip, text, $TokenAmountInput } from '@/ui-components'
import type { ISwapRequest } from '../../io/bridge/swapQuote.js'
import context, { DISPLAY_QUOTE_TTL_MS } from '../../io/context.js'
import { priceFor } from '../../io/price.js'
import type { IConnectedWallet } from '../../wallet/index.js'
import { balanceAt, type IRootState } from '../../wallet/index.js'
import { $DraftSave, type ISelectedRoute } from './$DraftSave.js'
import { $crumbTrail } from './$InlineSwitchView.js'
import { type ISwapTargetOption, withdrawTargetOptions } from './$SwapTargetFlow.js'
import {
  $editorAmountLabel,
  $editorFlowContainer,
  $editorPercentSlider,
  $maxAmountButton,
  $noteSlot,
  $overlaySliderContainer,
  amountUsdLabel,
  createFocusState,
  QUOTE_CALLDATA_BYTES,
  scaleByPercent,
} from './editorUtils.js'

export interface I$WithdrawEditor {
  accountState: IRootState
  chainId: ChainId
  token: Hex
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
      const { accountState, chainId, token, existingDraft } = config
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

      const receiveOptions = withdrawTargetOptions(chainId, token)
      const isDestChainId = (id: number): id is ChainId => receiveOptions.some(o => o.chainId === id)
      const optionsOn = (chainId: ChainId): readonly ISwapTargetOption[] => receiveOptions.filter(o => o.chainId === chainId)
      const userChain: IStream<ChainId> = op(
        pickReceive,
        map(o => o.chainId),
        multicast
      )
      const draftChain: IStream<ChainId> = op(
        existingDraft,
        filter((d): d is IWithdrawDraft => d !== null && isDestChainId(d.output.chainId)),
        map(d => d.output.chainId)
      )
      const storedReceive: IStream<ISwapTargetOption> = op(
        combine({
          path: uiStorage.replayWrite<IStoredPath | null>(
            editorChoiceKey(to, 'withdraw'), null,
            map(o => ({ source: { chainId, address: token }, dest: { chainId: o.chainId, address: o.id } }), pickReceive)
          ),
          draft: existingDraft
        }),
        map(p =>
          p.draft !== null || p.path === null || p.path.source.chainId !== chainId || !isAddressEqual(p.path.source.address, token)
            ? undefined
            : receiveOptions.find(o => o.chainId === p.path!.dest.chainId && isAddressEqual(o.id, p.path!.dest.address))
        ),
        filter((o): o is ISwapTargetOption => o !== undefined),
        state()
      )
      const chainSelection = state(chainId, merge(userChain, draftChain, map(o => o.chainId, storedReceive)))

      const draftReceiveToken: IStream<Hex> = op(
        existingDraft,
        filter((d): d is IWithdrawDraft => d !== null),
        map(d => d.input.outputToken as Hex)
      )
      const rawReceiveToken: IStream<Hex> = state(
        token,
        merge(map(o => o.id, pickReceive), draftReceiveToken, map(o => o.id, storedReceive))
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
        combine({ feeMap: relayFeeMapQuery, sel: receiveSel }),
        map(p =>
          p.feeMap === null
            ? null
            : needsRoute(p.sel)
              ? p.feeMap('withdraw', false, 0n, TYPICAL_SUBCALL_GAS, QUOTE_CALLDATA_BYTES)
              : p.feeMap('withdraw', false, 0n, 0n, 0n)
        ),
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
            depositor: predictUserAccount(to),
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
              return `Balance must exceed the relay fee ${readableTokenAmountLabel(tokenDescription, fee)}`
            }
            if (params.amount === 0n) return null
            if (params.amount + fee > params.balance) {
              return `Exceeds available ${readableTokenAmount(tokenDescription, params.balance - fee)}`
            }
            const moved = params.amount === 0n ? params.balance : params.amount + fee
            const capBps = needsRoute(params.sel) ? PROTOCOL.maxSwapRelayFeeBps : PROTOCOL.maxRelayFeeBps
            if (fee * PRECISION.basisPoints > moved * capBps) {
              const floor = (fee * PRECISION.basisPoints + capBps - 1n) / capBps
              return `Below the ${readableTokenAmountLabel(tokenDescription, floor)} minimum: the relay fee is capped at ${readablePercentage(capBps)} of what moves`
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

      const amountUsd: IStream<Promise<string> | string> = amountUsdLabel(amountValue, tokenPrice)
      const $alert = $noteSlot(
        switchMap(
          msg => (msg ? $noteTooltip($text(msg)) : $node(style({ color: palette.foreground, fontSize: text.xs }))($intermediateText(amountUsd))),
          alert
        )
      )

      const $maxButton = $maxAmountButton(amountValue, balance, clickMaxTether(nodeEvent('click')))

      const $amount = $editorAmountLabel(
        $crumbTrail([{ label: 'Withdraw' }]),
        $row(spacing.small, style({ alignItems: 'center' }))($field, $maxButton),
        $alert
      )
      const $topSection = $editorFlowContainer($amount)

      const hidden: IStream<boolean> = start(false, selectingDest)

      return [
        $column(spacing.default, style({ width: '394px', maxWidth: '100%' }))(
          $node(style({ display: 'contents' }), styleBehavior(map(h => (h ? { display: 'none' } : { display: 'contents' }), hidden)))(
            $topSection,
            $node(style({ margin: '0 -26px', display: 'flex' }))($percentSlider)
          ),
          $DraftSave({
            target: { value: receiveSel, optionList: just(receiveOptions), source: just({ chainId, symbol: symbolOf(chainId, token) }) },
            request,
            inputFee: map(p => (p.feeMap === null ? null : { gross: p.draft === 0n ? p.balance : p.draft, quote: p.feeMap, kind: 'withdraw' as const }), combine({ balance, draft: draftAmount, feeMap: relayFeeMapQuery })),
            active: map(needsRoute, receiveSel),
            alert,
            disabled
          })({ select: pickReceiveTether(), selecting: selectingDestTether(), selectRoute: selectedRouteTether(), save: clickAddDraftTether() })
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
                  routeInput: input.outputAmount,
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
              if (plan === null) throw new Error('this withdraw has no quoted route yet; wait for the route before adding it')
              const input: IUnsealed<IWithdrawInput> = {
                inputToken: token,
                outputToken: params.sel.id,
                inputAmount: grossAmount,
                outputAmount: plan.outputAmount,
                destinationChainId: BigInt(params.sel.chainId),
                route: plan.route,
                fillDeadline: Math.floor(plan.fillDeadline)
              }
              return {
                kind: 'withdraw',
                id,
                chainId,
                balanceBefore: authoredBalance,
                inputAmount: { amount: grossAmount, token },
                routeInput: plan.inputAmount,
                output: {
                  receiver: to,
                  chainId: params.sel.chainId,
                  amount: plan.outputAmount,
                  expected: plan.expectedOutputAmount,
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
