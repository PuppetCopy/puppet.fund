import { HUB_CHAIN_ID, PRECISION, PROTOCOL } from '@puppet/contracts/const'
import { predictUserAccount } from '@puppet/sdk/account'
import { formatThrownError } from '@puppet/sdk/compact'
import { type ChainId, resolveDispatchChainId } from '@puppet/sdk/const'
import { getTokenDescription, readableTokenAmount, readableTokenAmountLabel } from '@puppet/sdk/core'
import { routeCalldataBytes } from '@puppet/sdk/intent'
import { type IRelayFeeQuote, type ITokenRegistryMap, providerToken, symbolOf, tokenInfoFor, tokenKeyOf } from '@puppet/sdk/state'
import { combine, filter, type IStream, just, map, merge, op, sampleMap, skipRepeats, skipRepeatsWith, start, switchLatest, switchMap } from 'aelea/stream'
import { type IBehavior, multicast, type PromiseState, PromiseStatus, promiseState, state } from 'aelea/stream-extended'
import { $node, $text, component, type INode, nodeEvent, style, styleBehavior } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { type Hex, isAddressEqual } from 'viem'
import { $ButtonPrimaryOutline, $noteTooltip, $TokenAmountInput, text } from '@/ui-components'
import type { ISwapRequest } from '../../io/bridge/swapQuote.js'
import context, { DISPLAY_QUOTE_TTL_MS } from '../../io/context.js'
import { formatUsd, priceFor } from '../../io/price.js'
import type { IAccountBalance, IRootState } from '../../wallet/index.js'
import { $crumbTrail } from './$InlineSwitchView.js'
import { $SwapProviderFeeEditor, type ISelectedRoute } from './$SwapProviderFeeEditor.js'
import { $SwapTargetFlow, type ISwapTargetOption } from './$SwapTargetFlow.js'
import type { ITokenInputOption } from './$tokenOption.js'
import type { IDepositDraft } from './draft.js'
import { $editorAmountLabel, $editorFlowContainer, $editorPercentSlider, $maxAmountButton, $noteSlot, $overlaySliderContainer, amountUsdLabel, createFocusState, scaleByPercent } from './editorUtils.js'

export interface I$AccountSwapEditor {
  accountState: IRootState
  chainId: ChainId
  token: Hex
  tokenRegistry: ITokenRegistryMap
  existingDraft: IStream<IDepositDraft | null>
}

export const $AccountSwapEditor = ({ accountState, chainId, token, tokenRegistry, existingDraft }: I$AccountSwapEditor) =>
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
      const held: IAccountBalance[] = accountState.balances.filter(b => b.balance > 0n)
      const sourceOf = (b: IAccountBalance): ITokenInputOption => {
        const desc = getTokenDescription(b.chainId, b.token)
        return {
          symbol: desc.symbol,
          chainId: b.chainId,
          address: b.token,
          token: b.token,
          balance: b.balance,
          decimals: desc.decimals,
          usdValue: map(price => formatUsd(b.balance, price), priceFor(b.chainId, b.token))
        }
      }
      const sources = held.map(sourceOf)
      const rowSource = sources.find(s => s.chainId === chainId && isAddressEqual(s.token, token))
      if (rowSource === undefined) throw new Error(`the account holds no ${symbolOf(chainId, token)} on chain ${chainId} to swap`)
      const source: IStream<ITokenInputOption> = just(rowSource)
      const decimals: IStream<number> = op(source, map(s => s.decimals), skipRepeats)
      const balance: IStream<bigint> = map(s => s.balance ?? 0n, source)
      const sourcePrice: IStream<bigint | null> = op(source, switchMap(s => priceFor(s.chainId, s.token)), state())

      const targetsFor = (s: ITokenInputOption): ISwapTargetOption[] =>
        [...(tokenRegistry.get(HUB_CHAIN_ID)?.keys() ?? [])]
          .filter(id => !isAddressEqual(id, PROTOCOL.nativeToken) && !(s.chainId === HUB_CHAIN_ID && isAddressEqual(id, s.token)))
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
      const target: IStream<ISwapTargetOption | null> = op(
        combine({ s: source, picked: state(null as ISwapTargetOption | null, merge(pickTarget, draftTarget)) }),
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
        map(r => (r.plan === null ? 0n : routeCalldataBytes(r.plan[0].route))),
        skipRepeats,
        start(0n)
      )
      const relayFee: IStream<bigint | null> = op(
        combine({ feeMap, calldata: routeCalldataLength }),
        map(p => (p.feeMap === null ? null : p.feeMap('depositAcross', false, 0n, 0n, p.calldata))),
        state()
      )
      const minInput: IStream<bigint | null> = map(
        fee => (fee === null ? null : (fee * PRECISION.basisPoints + PROTOCOL.maxRelayFeeBps - 1n) / PROTOCOL.maxRelayFeeBps),
        relayFee
      )

      const sliderAmount: IStream<bigint> = sampleMap((bal, pct) => scaleByPercent(bal, pct), balance, sliderPercent)
      const maxAmount: IStream<bigint> = sampleMap(bal => bal, balance, clickMax)
      const draftAmount: IStream<bigint> = map(d => (d === null ? 0n : d.deposit.inputAmount), existingDraft)
      const value: IStream<bigint> = state(0n, merge(inputAmount, sliderAmount, maxAmount, draftAmount))
      const focused = createFocusState(focusEvt, blurEvt)

      const request: IStream<ISwapRequest | null> = op(
        combine({ s: source, t: target, value, fee: relayFee }),
        map(p => {
          if (p.t === null || p.fee === null || p.value <= p.fee) return null
          return {
            originChainId: resolveDispatchChainId(p.s.chainId),
            destinationChainId: resolveDispatchChainId(p.t.chainId),
            inputToken: providerToken(p.s.token, p.s.chainId),
            outputToken: tokenInfoFor(tokenRegistry, p.t.chainId, p.t.id).token,
            inputAmount: p.value - p.fee,
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
          if (p.value === 0n) return null
          const desc = { decimals: p.s.decimals, symbol: p.s.symbol }
          if (p.feeQuote.status === PromiseStatus.ERROR) return `Relay fee unavailable: ${formatThrownError(p.feeQuote.error)}`
          if (p.value > p.balance) return `Exceeds balance ${readableTokenAmountLabel(desc, p.balance)}`
          if (p.minInput !== null && p.value < p.minInput) {
            return `Add at least ${readableTokenAmountLabel(desc, p.minInput - p.value)}: a smaller swap makes the relay fee exceed ${Number(PROTOCOL.maxRelayFeeBps) / 100}% of the amount`
          }
          if (p.t === null) return 'Pick a token to receive'
          if (p.route.error) return p.route.error
          if (p.route.limitError) return p.route.limitError
          return null
        }),
        state(null)
      )
      const disabled: IStream<boolean> = op(
        combine({ alert, value, route: selectedRoute, existing: existingDraft, s: source, t: target }),
        map(p => {
          if (p.value === 0n || p.alert !== null || p.t === null) return true
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
      const amountUsd: IStream<string> = amountUsdLabel(value, sourcePrice)
      const $alert = $noteSlot(
        switchMap(
          msg => (msg ? $noteTooltip($text(msg)) : $node(style({ color: palette.foreground, fontSize: text.xs }))($text(amountUsd))),
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

      const $swapProviderFee = $SwapProviderFeeEditor({ active: map(r => r !== null, request), request, maxLegs: 1 })({ selectRoute: selectedRouteTether() })

      const $amount = $editorAmountLabel(
        $crumbTrail([{ label: 'Swap' }]),
        $row(spacing.small, style({ alignItems: 'center' }))($field, $maxButton),
        $alert
      )
      const $topSection = $editorFlowContainer($amount)

      const hidden: IStream<boolean> = start(false, selectingTarget)

      const $receive = $SwapTargetFlow({
        value: target,
        optionList: targetOptions,
        source: just({ chainId: rowSource.chainId, symbol: symbolOf(rowSource.chainId, rowSource.token) }),
        $container: $row(
          style({ margin: '0 -28px', padding: '0 28px', gap: '12px', alignItems: 'center', fontSize: text.sm }),
          styleBehavior(map(h => (h ? { background: palette.background, padding: '20px 28px' } : null), hidden))
        ),
        $inputContent: $anchor =>
          $node(style({ display: 'contents' }))(
            $node(style({ color: palette.foreground, fontWeight: '500', whiteSpace: 'nowrap' }))($text('Receive')),
            $anchor
          )
      })({ select: pickTargetTether(), selecting: selectingTargetTether() })

      const submitResolved = sampleMap(
        (p: { value: bigint; s: ITokenInputOption; t: ISwapTargetOption | null; route: ISelectedRoute; dis: boolean; fee: bigint | null }) => p,
        combine({ value, s: source, t: target, route: selectedRoute, dis: disabled, fee: relayFee }),
        submitTrigger
      )
      const changeDraft: IStream<IDepositDraft> = op(
        submitResolved,
        filter(p => !p.dis && p.t !== null && p.fee !== null && p.route.plan !== null),
        map((p): IDepositDraft => {
          const signed = p.route.plan![0]
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
            $node(style({ margin: '0 -28px', display: 'flex' }))($percentSlider)
          ),
          $receive,
          $node(style({ display: 'contents' }), styleBehavior(map(h => (h ? { display: 'none' } : { display: 'contents' }), hidden)))(
            $row(spacing.small, style({ alignItems: 'center', fontSize: text.sm }))(
              $node(
                style({ display: 'flex' }),
                styleBehavior(map(p => (p.a !== null ? { display: 'none' } : p.req === null ? { opacity: '.45', pointerEvents: 'none' } : { opacity: '1', pointerEvents: 'auto' }), combine({ a: alert, req: request })))
              )($swapProviderFee),
              $node(style({ flex: 1 }))(),
              $ButtonPrimaryOutline({ disabled, $content: $text('Save') })({ click: clickAddDraftTether() })
            )
          )
        ),
        { changeDraft }
      ]
    }
  )
