import { HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import { predictUserAccount } from '@puppet/sdk/account'
import type { IDepositDraft } from '@puppet/sdk/client'
import { formatThrownError } from '@puppet/sdk/compact'
import { type ChainId, PRECISION, resolveDispatchChainId } from '@puppet/sdk/const'
import { getTokenDescription, readableTokenAmount, readableTokenAmountLabel } from '@puppet/sdk/core'
import { routeCalldataBytes } from '@puppet/sdk/intent'
import { type IRelayFeeQuote, listedTokensOf, providerToken, symbolOf, tokenKeyOf, TYPICAL_SUBCALL_GAS } from '@puppet/sdk/state'
import { combine, filter, type IStream, just, map, merge, op, sampleMap, skipRepeats, skipRepeatsWith, start, switchLatest, switchMap } from 'aelea/stream'
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
import type { IRootState } from '../../wallet/index.js'
import { $DraftSave, type ISelectedRoute } from './$DraftSave.js'
import { $crumbTrail } from './$InlineSwitchView.js'
import type { ISwapTargetOption } from './$SwapTargetFlow.js'
import type { ITokenInputOption } from './$tokenOption.js'
import {
  $editorAmountLabel,
  $editorFlowContainer,
  $editorPercentSlider,
  $maxAmountButton,
  $noteSlot,
  $overlaySliderContainer,
  $overlaySliderRow,
  amountUsdLabel,
  createFocusState,
  QUOTE_CALLDATA_BYTES,
  scaleByPercent
} from './editorUtils.js'
import { answerState } from '../../io/datastore/reads.js'

export interface I$AccountSwapEditor {
  accountState: IRootState
  chainId: ChainId
  token: Hex
  existingDraft: IStream<IDepositDraft | null>
}

export const $AccountSwapEditor = ({ accountState, chainId, token, existingDraft }: I$AccountSwapEditor) =>
  component(
    (
      [clickAddDraft, clickAddDraftTether]: IBehavior<PointerEvent>,
      [pickTarget, pickTargetTether]: IBehavior<ISwapTargetOption>,
      [selectingTarget, selectingTargetTether]: IBehavior<boolean>,
      [inputAmount, inputAmountTether]: IBehavior<bigint>,
      [focusEvt, focusEvtTether]: IBehavior<FocusEvent>,
      [blurEvt, blurEvtTether]: IBehavior<FocusEvent>,
      [sliderPercent, sliderPercentTether]: IBehavior<number>,
      [clickMax, clickMaxTether]: IBehavior<INode<HTMLButtonElement>, MouseEvent>,
      [enterPress, enterPressTether]: IBehavior<KeyboardEvent>,
      [selectedRoute, selectedRouteTether]: IBehavior<ISelectedRoute>
    ) => {
      const account = accountState.account
      const rowBalance = accountState.balances.find(b => b.balance > 0n && b.chainId === chainId && isAddressEqual(b.token, token))
      if (rowBalance === undefined) throw new Error(`the account holds no ${symbolOf(chainId, token)} on chain ${chainId} to swap`)
      const desc = getTokenDescription(rowBalance.chainId, rowBalance.token)
      const source: IStream<ITokenInputOption> = just({
        symbol: desc.symbol,
        chainId: rowBalance.chainId,
        address: rowBalance.token,
        token: rowBalance.token,
        balance: rowBalance.balance,
        decimals: desc.decimals
      })
      const decimals: IStream<number> = op(source, map(s => s.decimals), skipRepeats)
      const balance: IStream<bigint> = map(s => s.balance ?? 0n, source)
      const sourcePrice: IStream<Promise<bigint | null>> = op(source, switchMap(s => priceFor(s.chainId, s.token)), answerState)

      const targetsFor = (s: ITokenInputOption): ISwapTargetOption[] =>
        listedTokensOf(HUB_CHAIN_ID)
          .filter(
            id =>
              !isAddressEqual(id, PROTOCOL.nativeToken) &&
              !(s.chainId === HUB_CHAIN_ID && isAddressEqual(providerToken(id, HUB_CHAIN_ID), providerToken(s.token, s.chainId)))
          )
          .map(id => ({ chainId: HUB_CHAIN_ID, id: id as Hex, symbol: tokenKeyOf(HUB_CHAIN_ID, id) }))
      const targetOptions: IStream<readonly ISwapTargetOption[]> = map(targetsFor, source)
      const draftTarget: IStream<ISwapTargetOption> = op(
        existingDraft,
        filter((d): d is IDepositDraft => d !== null),
        map(d => {
          const chainId = Number(d.deposit.destinationChainId) as ChainId
          const id = d.deposit.outputToken as Hex
          return { chainId, id, symbol: tokenKeyOf(chainId, id) }
        })
      )
      const storedTarget: IStream<ISwapTargetOption> = op(
        combine({
          path: uiStorage.replayWrite<IStoredPath | null>(
            editorChoiceKey(account, 'accountSwap'), null,
            map(o => ({ source: { chainId, address: token }, dest: { chainId: o.chainId, address: o.id } }), pickTarget)
          ),
          draft: existingDraft
        }),
        map(p =>
          p.draft !== null || p.path === null || p.path.source.chainId !== chainId || !isAddressEqual(p.path.source.address, token)
            ? undefined
            : { chainId: p.path.dest.chainId, id: p.path.dest.address, symbol: tokenKeyOf(p.path.dest.chainId, p.path.dest.address) }
        ),
        filter((o): o is ISwapTargetOption => o !== undefined)
      )
      const target: IStream<ISwapTargetOption | null> = op(
        combine({ s: source, picked: state(null as ISwapTargetOption | null, merge(pickTarget, draftTarget, storedTarget)) }),
        map(p => {
          const options = targetsFor(p.s)
          const valid = p.picked !== null && options.some(o => o.chainId === p.picked!.chainId && isAddressEqual(o.id, p.picked!.id))
          if (valid) return p.picked
          const twin = options.find(o => tokenKeyOf(o.chainId, o.id) === tokenKeyOf(p.s.chainId, p.s.token))
          return twin ?? null
        }),
        state()
      )

      const relayFeeQuery: IStream<PromiseState<IRelayFeeQuote>> = op(
        source,
        map(s => context.getRelayFeeQuote(s.chainId, s.token, DISPLAY_QUOTE_TTL_MS)),
        promiseState,
        state()
      )
      const feeMap: IStream<IRelayFeeQuote | null> = map(f => (f.status === PromiseStatus.DONE ? f.value : null), relayFeeQuery)
      const routeCalldataLength: IStream<bigint> = op(
        selectedRoute,
        filter(r => r.plan !== null || r.error !== null),
        map(r => (r.plan === null ? 0n : routeCalldataBytes(r.plan.route))),
        skipRepeats,
        start(0n)
      )
      const relayFee: IStream<bigint | null> = op(
        combine({ feeMap, calldata: routeCalldataLength }),
        map(p => (p.feeMap === null ? null : p.feeMap('depositAcross', false, 0n, TYPICAL_SUBCALL_GAS, p.calldata))),
        state()
      )
      const minInput: IStream<bigint | null> = map(
        fee => (fee === null ? null : (fee * PRECISION.basisPoints + PROTOCOL.maxSwapRelayFeeBps - 1n) / PROTOCOL.maxSwapRelayFeeBps),
        relayFee
      )

      const sliderAmount: IStream<bigint> = sampleMap((bal, pct) => scaleByPercent(bal, pct), balance, sliderPercent)
      const maxAmount: IStream<bigint> = sampleMap(bal => bal, balance, clickMax)
      const draftAmount: IStream<bigint> = map(d => (d === null ? 0n : d.deposit.inputAmount), existingDraft)
      const value: IStream<bigint> = state(0n, merge(inputAmount, sliderAmount, maxAmount, draftAmount))
      const focused = createFocusState(focusEvt, blurEvt)

      const request: IStream<ISwapRequest | null> = op(
        combine({ s: source, t: target, value, feeMap }),
        map(p => {
          if (p.t === null || p.feeMap === null) return null
          const fee = p.feeMap('depositAcross', false, 0n, TYPICAL_SUBCALL_GAS, QUOTE_CALLDATA_BYTES)
          if (p.value <= fee) return null
          return {
            originChainId: resolveDispatchChainId(p.s.chainId),
            destinationChainId: resolveDispatchChainId(p.t.chainId),
            inputToken: providerToken(p.s.token, p.s.chainId),
            outputToken: p.t.id,
            inputAmount: p.value - fee,
            depositor: predictUserAccount(accountState.user),
            recipient: predictUserAccount(accountState.user)
          }
        }),
        skipRepeatsWith((a, b) => JSON.stringify(a, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) === JSON.stringify(b, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))),
        state()
      )

      const alert: IStream<string | null> = op(
        combine({ value, balance, s: source, t: target, minInput, feeQuote: relayFeeQuery, route: selectedRoute }),
        map(p => {
          if (p.feeQuote.status === PromiseStatus.ERROR) return `Relay fee unavailable: ${formatThrownError(p.feeQuote.error)}`
          if (p.value === 0n) return null
          const desc = { decimals: p.s.decimals, symbol: p.s.symbol }
          if (p.value > p.balance) return `Exceeds balance ${readableTokenAmountLabel(desc, p.balance)}`
          if (p.minInput !== null && p.value < p.minInput) {
            return `Add at least ${readableTokenAmountLabel(desc, p.minInput - p.value)}: a smaller swap makes the relay fee exceed ${Number(PROTOCOL.maxSwapRelayFeeBps) / 100}% of the amount`
          }
          if (p.t === null) return 'Pick a token to receive'
          if (p.route.error) return p.route.error
          if (p.route.limitError) return p.route.limitError
          return null
        }),
        state(null)
      )
      const disabled: IStream<boolean> = op(
        combine({ alert, value, route: selectedRoute, existing: existingDraft, s: source, t: target, feeQuote: relayFeeQuery }),
        map(p => {
          if (p.value === 0n || p.alert !== null || p.t === null || p.feeQuote.status !== PromiseStatus.DONE) return true
          if (p.existing && p.existing.deposit.inputAmount === p.value && p.existing.deposit.chainId === p.s.chainId && isAddressEqual(p.existing.deposit.inputToken, p.s.token)) return true
          return !p.route.ready
        }),
        state()
      )
      const submitTrigger: IStream<unknown> = merge(
        clickAddDraft,
        op(
          sampleMap((dis: boolean, evt: KeyboardEvent) => ({ dis, evt }), disabled, enterPress),
          filter(p => !p.dis)
        )
      )

      const valueToShow: IStream<string> = map(
        (p: { amt: bigint; dec: number; focused: boolean }) => (p.amt === 0n ? '' : readableTokenAmount(p.dec, p.amt)),
        filter((p: { amt: bigint; dec: number; focused: boolean }) => !p.focused, combine({ amt: value, dec: decimals, focused }))
      )
      const $field = switchLatest(
        map(
          dec =>
            $TokenAmountInput({ decimals: dec, valueToShow })({
              inputAmount: inputAmountTether(),
              focus: focusEvtTether(),
              blur: blurEvtTether(),
              enter: enterPressTether()
            }),
          decimals
        )
      )
      const $maxButton = $maxAmountButton(value, balance, clickMaxTether(nodeEvent('click')))
      const amountUsd: IStream<Promise<string> | string> = amountUsdLabel(value, sourcePrice)
      const $alert = $noteSlot(
        switchMap(
          msg => (msg ? $noteTooltip($text(msg)) : $node(style({ color: palette.foreground, fontSize: text.xs }))($intermediateText(amountUsd))),
          alert
        )
      )
      const sliderValue: IStream<number> = map(p => (p.bal === 0n ? 0 : Math.min(1, Number((p.amt * 10000n) / p.bal) / 10000)), combine({ amt: value, bal: balance }))
      const $percentSlider = $editorPercentSlider({
        value: sliderValue,
        ariaLabel: 'Swap percentage',
        disabled: map(b => b === 0n, balance),
        error: map(a => a !== null, alert),
        $container: $overlaySliderContainer
      })({ change: sliderPercentTether() })


      const $amount = $editorAmountLabel(
        $crumbTrail([{ label: 'Swap' }]),
        $row(spacing.small, style({ alignItems: 'center' }))($field, $maxButton),
        $alert
      )
      const $topSection = $editorFlowContainer($amount)

      const hidden: IStream<boolean> = start(false, selectingTarget)

      const submitResolved = sampleMap(
        (p: { value: bigint; s: ITokenInputOption; t: ISwapTargetOption | null; route: ISelectedRoute; dis: boolean; fee: bigint | null }) => p,
        combine({ value, s: source, t: target, route: selectedRoute, dis: disabled, fee: relayFee }),
        submitTrigger
      )
      const changeDraft: IStream<IDepositDraft> = op(
        submitResolved,
        filter(p => !p.dis && p.t !== null && p.fee !== null && p.route.plan !== null),
        map((p): IDepositDraft => {
          const signed = p.route.plan!
          return {
            kind: 'deposit',
            id: `deposit:${account}`,
            source: 'account',
            toEscrow: false,
            deposit: {
              chainId: p.s.chainId,
              inputToken: providerToken(p.s.token, p.s.chainId),
              outputToken: signed.outputToken,
              inputAmount: p.value,
              routeInput: signed.inputAmount,
              outputAmount: signed.outputAmount,
              destinationChainId: BigInt(p.t!.chainId),
              route: signed.route,
              fillDeadline: signed.fillDeadline
            },
            nativeValue: 0n,
            expectedOutput: signed.expectedOutputAmount
          }
        }),
        multicast
      )

      return [
        $column(spacing.default, style({ width: '394px', maxWidth: '100%' }))(
          $node(style({ display: 'contents' }), styleBehavior(map(h => (h ? { display: 'none' } : { display: 'contents' }), hidden)))(
            $topSection,
            $overlaySliderRow($percentSlider)
          ),
          $DraftSave({
            target: {
              value: target,
              optionList: targetOptions,
              source: just({ chainId: rowBalance.chainId, symbol: symbolOf(rowBalance.chainId, rowBalance.token) })
            },
            request,
            inputFee: map(p => (p.feeMap === null ? null : { gross: p.value, quote: p.feeMap, kind: 'depositAcross' as const }), combine({ value, feeMap })),
            active: map(r => r !== null, request),
            alert,
            disabled
          })({ select: pickTargetTether(), selecting: selectingTargetTether(), selectRoute: selectedRouteTether(), save: clickAddDraftTether() })
        ),
        { changeDraft }
      ]
    }
  )
