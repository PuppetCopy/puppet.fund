import { PRECISION, PROTOCOL } from '@puppet/contracts/const'
import { predictDepositRoute } from '@puppet/sdk/account'
import { formatThrownError } from '@puppet/sdk/compact'
import { CHAIN_LIST, type ChainId } from '@puppet/sdk/const'
import {
  getRegisteredTokenDescription,
  readableTokenAmount,
  readableTokenAmountLabel,
  readableUnitAmount
} from '@puppet/sdk/core'
import { USD_PRICE_DECIMALS } from '@puppet/sdk/evaluate'
import {
  type ITokenRegistryMap,
  nativeSymbolOf,
  symbolByAddress,
  tokenInfoFor,
  wrappedNativeAddressOf
} from '@puppet/sdk/state'
import {
  combine,
  constant,
  debounce,
  empty,
  filter,
  fromPromise,
  type IStream,
  just,
  map,
  merge,
  op,
  sample,
  sampleMap,
  skipRepeats,
  skipRepeatsWith,
  start,
  switchLatest,
  switchMap,
  switchPromises
} from 'aelea/stream'
import { type IBehavior, multicast, state } from 'aelea/stream-extended'
import { $element, $node, $text, attr, component, type I$Node, type INode, nodeEvent, style } from 'aelea/ui'
import { $column, $Popover, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { type Address, formatUnits, getAddress, type Hex, isAddressEqual } from 'viem'
import {
  $amountDisplay,
  $ButtonSecondary,
  $DropSelect,
  $defaultDropdownContainer,
  $defaultMiniButtonSecondary,
  $defaultSliderContainer,
  $labeledValue,
  $noteTooltip,
  $popoverCaret,
  $Slider,
  $TokenAmountInput,
  NOTE_TOOLTIP_HEIGHT,
  text
} from '@/ui-components'
import { $chainIcon, $chainLabel, $tokenWithChainBadge, chainName } from '../../common/$chain.js'
import { fetchLifiSwapQuote } from '../../io/bridge/lifiSwap.js'
import { fetchSwapQuote } from '../../io/bridge/swapQuote.js'
import { displayRelayFeeMap } from '../../io/context.js'
import { formatUsd, priceFor } from '../../io/gmx/priceFeed.js'
import { $tokenIconBySymbol } from './$tokenOption.js'
import type { IFundSwapDraft } from './draft.js'
import { createFocusState } from './editorUtils.js'

export interface IFundHolding {
  chainId: number
  token: Hex
  balance: bigint
}

export interface I$SwapEditor {
  hideBalances: IStream<boolean>
  fundAddress: Address
  holdings: IFundHolding[]
  tokenRegistry: ITokenRegistryMap
  swapDraftList: IStream<IFundSwapDraft[]>
}

interface ISource {
  chainId: number
  token: Hex
  address: Address
  symbol: string
  decimals: number
  balance: bigint
}

// Receive-token option: the id plus its per-chain display symbol (the native marker resolves to MON/ETH by chain).
interface ITargetOption {
  id: Hex
  symbol: string
}

// Per-holding fund rebalance popover: swap one token the fund holds (signed balance) into another registered token, on
// the same chain (single guarded FundGate.swap, fromRoute=false) or to a destination chain (swap-bridge then a
// destination recognize). Opened from a holding row's Swap button; the TO + chain pickers choose the destination.
// Native rules: native is NOT a valid swap INPUT (the gate has no wrap leg for the codeless marker), but IS a valid
// SAME-CHAIN output (the local branch forwards native via CallLib.payout and credits the marker balance); cross-chain
// native output stays excluded (the bridge delivers the wrapped ERC-20 and the SDK rejects it).
export const $SwapEditor = ({ hideBalances, fundAddress, holdings, tokenRegistry, swapDraftList }: I$SwapEditor) =>
  component(
    (
      [popEditor, popEditorTether]: IBehavior<PointerEvent, ISource>,
      [clickSave, clickSaveTether]: IBehavior<PointerEvent>,
      [selectTarget, selectTargetTether]: IBehavior<ITargetOption, Hex>,
      [selectChain, selectChainTether]: IBehavior<number>,
      [inputAmount, inputAmountTether]: IBehavior<bigint>,
      [focusEvt, focusEvtTether]: IBehavior<FocusEvent>,
      [blurEvt, blurEvtTether]: IBehavior<FocusEvent>,
      [sliderPercent, sliderPercentTether]: IBehavior<number>,
      [clickMax, clickMaxTether]: IBehavior<INode<HTMLButtonElement>, MouseEvent>,
      [enterPress, enterPressTether]: IBehavior<KeyboardEvent>
    ) => {
      const isNativeId = (id: Hex): boolean => isAddressEqual(getAddress(id), PROTOCOL.nativeToken)
      // Every holding with a signed balance is a swap source, except a raw-native (marker) balance: the gate's swap path
      // has no wrap leg, so it cannot approve/transferFrom the codeless native marker. Wrapped-native holdings (WETH/WMON,
      // registered under their own ERC-20 address) are ordinary sources and stay in.
      const toSource = (h: IFundHolding): ISource => {
        const desc = getRegisteredTokenDescription(h.token)
        return {
          chainId: h.chainId,
          token: h.token,
          address: tokenInfoFor(tokenRegistry, h.chainId as ChainId, h.token).token,
          symbol: desc.symbol,
          decimals: desc.decimals,
          balance: h.balance
        }
      }
      const sources: ISource[] = holdings.filter(h => !isNativeId(h.token)).map(toSource)
      const hasSources = sources.length > 0
      // A stable placeholder keeps the editor's streams well-typed when the fund holds only native (no swappable source);
      // the Swap button is disabled in that case, so this is never the active input.
      const initialSource: ISource = hasSources
        ? sources[0]
        : { chainId: holdings[0]?.chainId ?? 0, token: PROTOCOL.nativeToken, address: PROTOCOL.nativeToken, symbol: '', decimals: 18, balance: 0n }

      const destChainIds = CHAIN_LIST.map(c => c.id).filter(id => (tokenRegistry.get(id as ChainId)?.size ?? 0) > 0)
      const isDestChainId = (id: number): boolean => destChainIds.includes(id)
      // Same-chain swap can target any registered token but the input itself, INCLUDING native: FundGate.swap's local
      // branch forwards native via CallLib.payout's native branch and credits the marker signed balance. Cross-chain
      // native output is excluded (the bridge delivers the wrapped ERC-20 and the SDK rejects it), and native is never a
      // swap INPUT (the gate has no wrap leg for the codeless marker).
      const targetIdsAt = (dc: number, input: ISource): Hex[] =>
        [...(tokenRegistry.get(dc as ChainId)?.keys() ?? [])].filter(t => {
          if (isNativeId(t)) return dc === input.chainId
          return dc === input.chainId ? t !== input.token : true
        })
      const targetTokenOn = (dc: number, id: Hex): Address => tokenInfoFor(tokenRegistry, dc as ChainId, id).token
      // The native marker is the same address on every chain, so its CEX symbol is per-chain (MON vs ETH) — resolve it
      // through nativeSymbolOf, not the address-keyed symbolByAddress. Pricing routes through the wrapped-native ERC-20
      // (1:1 with the gas coin), since the bare marker isn't priceable.
      const displaySymbol = (chainId: number, id: Hex): string =>
        isNativeId(id) ? nativeSymbolOf(chainId as ChainId) : symbolByAddress(id)
      const priceAddrOf = (chainId: number, id: Hex): Address =>
        isNativeId(id)
          ? wrappedNativeAddressOf(chainId as ChainId)
          : tokenInfoFor(tokenRegistry, chainId as ChainId, id).token
      const targetPrice = (dc: number, id: Hex) => priceFor(priceAddrOf(dc, id))
      // Default the target to a non-native token (the common rebalance); native output is an explicit opt-in.
      const defaultTargetFor = (dc: number, input: ISource): Hex => {
        const ids = targetIdsAt(dc, input)
        return ids.find(id => !isNativeId(id)) ?? ids[0] ?? input.token
      }

      // ---- selected input (FROM) ----------------------------------------------------------------------------------
      // The active input IS the holding whose inline Swap button opened the popover (popEditor carries its source) — no
      // in-editor FROM picker, since the user already chose by clicking a row. The amount and destination chain reset on
      // each such change so reopening a different holding never carries over a stale amount/chain.
      const inputChange: IStream<ISource> = popEditor
      const selectedInput: IStream<ISource> = state(initialSource, inputChange)

      // ---- destination chain ---------------------------------------------------------------------------------------
      // Picking a new input resets the destination back to that input's local chain (the cheap same-chain default);
      // the user can then pick a remote destination. draft hydration restores a saved cross-chain destination.
      const existingDraft: IStream<IFundSwapDraft | null> = op(
        combine({ list: swapDraftList, input: selectedInput }),
        map(
          p =>
            p.list.find(
              d => d.account === fundAddress && d.chainId === p.input.chainId && d.tokenIn === p.input.token
            ) ?? null
        ),
        multicast
      )
      const draftDestChain: IStream<number> = op(
        existingDraft,
        filter((d): d is IFundSwapDraft => d !== null && isDestChainId(d.destinationChainId ?? d.chainId)),
        map(d => d.destinationChainId ?? d.chainId)
      )
      const destChain: IStream<number> = state(
        initialSource.chainId,
        merge(map(s => s.chainId, inputChange), filter(isDestChainId, selectChain), draftDestChain)
      )

      // ---- target token (TO) ---------------------------------------------------------------------------------------
      // Options carry the per-chain symbol so the native marker shows the destination chain's gas-coin symbol (MON/ETH)
      // rather than the ambiguous address-keyed one.
      const targetOptions: IStream<readonly ITargetOption[]> = map(
        p => targetIdsAt(p.dc, p.input).map(id => ({ id, symbol: displaySymbol(p.dc, id) })),
        combine({ dc: destChain, input: selectedInput })
      )
      const draftTarget: IStream<Hex> = op(
        existingDraft,
        filter((d): d is IFundSwapDraft => d !== null),
        map(d => d.tokenOut as Hex)
      )
      // The target self-heals on input/chain change: targetSelection below falls back to the (dc, input) default whenever
      // the retained rawTarget isn't a valid candidate for the current pair, so no explicit reset stream is needed.
      const rawTarget: IStream<Hex> = state(
        defaultTargetFor(initialSource.chainId, initialSource),
        merge(selectTarget, draftTarget)
      )
      // One always-consistent route triple. Validating the retained target against the CURRENT (dc, input) INSIDE a single
      // combine is what prevents a diamond glitch: if `dc` and `target` were combined independently at each consumer, a
      // chain change would momentarily pair the new chain with a target only registered on the old one, and
      // targetTokenOn -> tokenInfoFor would throw Intent__TokenNotRegistered. Every consumer that crosses dc with target
      // (quote, fee, draft) reads this triple, so the two can never disagree.
      const route: IStream<{ input: ISource; dc: number; target: Hex }> = map(
        p => ({
          input: p.input,
          dc: p.dc,
          target: targetIdsAt(p.dc, p.input).includes(p.t) ? p.t : defaultTargetFor(p.dc, p.input)
        }),
        combine({ input: selectedInput, dc: destChain, t: rawTarget })
      )
      const targetValue: IStream<ITargetOption> = map(
        r => ({ id: r.target, symbol: displaySymbol(r.dc, r.target) }),
        route
      )

      // ---- amount --------------------------------------------------------------------------------------------------
      const balanceStream: IStream<bigint> = map(s => s.balance, selectedInput)
      const inputPrice: IStream<bigint | null> = op(
        selectedInput,
        skipRepeatsWith((a, b) => a.address === b.address),
        switchMap(s => priceFor(s.address))
      )
      // Relay fee for THIS input token's FundGate.swap (paid in the input token, deducted from the swapped amount on
      // chain). null = unpriceable (oracle has no rate) -> the min-input guard and the fee row read '-' / block.
      const inputRelayFee: IStream<bigint | null> = op(
        selectedInput,
        skipRepeatsWith((a, b) => a.token === b.token),
        switchMap((s): IStream<bigint | null> => map(fm => (fm === null ? null : fm.swap.relayFee), fromPromise(displayRelayFeeMap(s.token)))),
        state(null)
      )

      const sliderAmount: IStream<bigint> = sampleMap(
        (bal, pct) => {
          const clamped = Math.max(0, Math.min(1, pct))
          return clamped >= 1 ? bal : (bal * BigInt(Math.round(clamped * 10000))) / 10000n
        },
        balanceStream,
        sliderPercent
      )
      // The relay fee is taken OUT of the swapped amount on-chain (DEX receives inputAmount - fee), so a full-balance
      // swap is valid — Max is the whole balance, not netted. The min-input guard below catches amounts too small to
      // keep the fee within maxRelayFeeBps.
      const maxAmount: IStream<bigint> = sampleMap(bal => bal, balanceStream, clickMax)
      const draftAmountHydration: IStream<bigint> = map(d => (d ? d.amountIn : 0n), existingDraft)
      // Reset the raw amount when the input token changes: a bigint typed for one token's decimals would be reinterpreted
      // under the next token's decimals (mirrors $DepositEditor/$FundEditor's constant(0n, selectSource)).
      const amountValue: IStream<bigint> = state(
        0n,
        merge(inputAmount, sliderAmount, maxAmount, draftAmountHydration, constant(0n, inputChange))
      )
      const focused = createFocusState(focusEvt, blurEvt)

      // ---- quote ---------------------------------------------------------------------------------------------------
      interface IQuote {
        inputAmount: bigint
        outputAmount: bigint
        tool: string
        isAmountTooLow: boolean
        // The (amount, target, dc) this quote was fetched for; consumers compare against the live route to ignore a
        // quote that still lags a just-changed amount or output token (quoteQuery holds the prior value while refetching).
        forTarget: Hex
        forDc: number
      }
      type QuoteStatus = { status: 'idle'; quote: IQuote | null } | { status: 'error'; quote: null; message: string }
      const quoteTrigger = op(
        combine({ amount: amountValue, route }),
        skipRepeatsWith(
          (a, b) =>
            a.amount === b.amount &&
            a.route.target === b.route.target &&
            a.route.dc === b.route.dc &&
            a.route.input.chainId === b.route.input.chainId &&
            a.route.input.token === b.route.input.token
        )
      )
      const quoteFetch: IStream<Promise<QuoteStatus>> = op(
        debounce(300, quoteTrigger),
        map(async ({ amount, route: { input, dc, target } }): Promise<QuoteStatus> => {
          const isLocal = dc === input.chainId
          if (amount === 0n || (isLocal && target === input.token)) {
            return { status: 'idle', quote: null }
          }
          try {
            const outputToken = targetTokenOn(dc, target)
            const quote = isLocal
              ? await fetchLifiSwapQuote({
                  chainId: input.chainId,
                  inputToken: input.address,
                  outputToken,
                  inputAmount: amount,
                  fromAddress: fundAddress,
                  toAddress: fundAddress
                })
              : await fetchSwapQuote({
                  originChainId: input.chainId,
                  destinationChainId: dc,
                  inputToken: input.address,
                  outputToken,
                  inputAmount: amount,
                  route: predictDepositRoute(fundAddress),
                  crossToken: symbolByAddress(input.token) !== symbolByAddress(target)
                })
            const tool = 'tool' in quote ? quote.tool : quote.provider
            return {
              status: 'idle',
              quote: {
                inputAmount: amount,
                outputAmount: quote.outputAmount,
                tool,
                isAmountTooLow: quote.isAmountTooLow,
                forTarget: target,
                forDc: dc
              }
            }
          } catch (err) {
            console.error('[$SwapEditor.quoteFetch] quote failed', err)
            return { status: 'error', quote: null, message: formatThrownError(err) }
          }
        }),
        state()
      )
      const quoteQuery: IStream<QuoteStatus> = multicast(switchPromises(quoteFetch))

      // Smallest input that keeps the relay fee within maxRelayFeeBps of the swapped amount (mirrors $FundEditor's
      // bridge-ratio floor); below it the on-chain verifyRelayFeeRatio reverts, so the editor blocks with a hint.
      const minInputStream: IStream<bigint | null> = map(
        fee => (fee === null ? null : (fee * PRECISION.basisPoints + PROTOCOL.maxRelayFeeBps - 1n) / PROTOCOL.maxRelayFeeBps),
        inputRelayFee
      )

      const alert: IStream<string | null> = op(
        combine({ amount: amountValue, q: quoteQuery, balance: balanceStream, input: selectedInput, minInput: minInputStream }),
        map(p => {
          const desc = { decimals: p.input.decimals, symbol: p.input.symbol }
          if (p.amount > p.balance) return `Exceeds balance ${readableTokenAmountLabel(desc, p.balance)}`
          if (p.amount > 0n && p.minInput !== null && p.amount < p.minInput) {
            const add = p.minInput - p.amount
            return `Add at least ${readableTokenAmountLabel(desc, add)}: a smaller swap makes the relay fee exceed ${Number(PROTOCOL.maxRelayFeeBps) / 100}% of the amount`
          }
          if (p.q.status === 'error') return p.q.message
          if (p.q.quote?.isAmountTooLow) return 'No route available for this amount'
          return null
        }),
        state(null)
      )

      const disabled = op(
        combine({ amount: amountValue, q: quoteQuery, alert, route }),
        map(p => {
          if (p.amount === 0n || p.alert !== null) return true
          // Block Save until the quote is for the CURRENT amount and output route; otherwise the draft's minOut would be
          // baked from a stale quote (the same lag the fee row shows as '…').
          if (p.q.quote === null || p.q.quote.inputAmount !== p.amount) return true
          if (p.q.quote.forTarget !== p.route.target || p.q.quote.forDc !== p.route.dc) return true
          return p.q.quote.outputAmount === 0n
        }),
        state(true)
      )

      const submitTrigger: IStream<unknown> = merge(
        op(
          sampleMap((dis: boolean, evt: PointerEvent) => ({ dis, evt }), disabled, clickSave),
          filter(p => !p.dis)
        ),
        op(
          sampleMap((dis: boolean, evt: KeyboardEvent) => ({ dis, evt }), disabled, enterPress),
          filter(p => !p.dis)
        )
      )

      // ---- input field + slider + max ------------------------------------------------------------------------------
      const valueToShow: IStream<string> = map(
        (p: { amt: bigint; focused: boolean; input: ISource }) =>
          p.amt === 0n ? '' : readableTokenAmount(p.input.decimals, p.amt),
        filter(
          (p: { amt: bigint; focused: boolean; input: ISource }) => !p.focused,
          combine({ amt: amountValue, focused, input: selectedInput })
        )
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
          op(
            selectedInput,
            map(s => s.decimals),
            skipRepeats
          )
        )
      )

      const sliderValue: IStream<number> = map(
        p => (p.bal <= 0n ? 0 : Math.min(1, Number((p.amt * 10000n) / p.bal) / 10000)),
        combine({ amt: amountValue, bal: balanceStream })
      )
      const $percentSlider = $Slider({
        value: sliderValue,
        step: 0.01,
        orientation: 'horizontal',
        ariaLabel: 'Amount percentage',
        disabled: map(b => b === 0n, balanceStream),
        error: map(a => a !== null, alert),
        motion: { stiffness: 800, damping: 58 },
        $container: $defaultSliderContainer(style({ height: '14px', width: '100%', margin: '-26px 0', flexShrink: '0' }))
      })({ change: sliderPercentTether() })

      const amountUsd: IStream<string> = map(
        p => (p.amt === 0n ? '' : formatUsd(p.amt, p.price)),
        combine({ amt: amountValue, price: inputPrice })
      )
      const $alert = $node(style({ height: NOTE_TOOLTIP_HEIGHT, display: 'flex', alignItems: 'center' }))(
        switchMap(
          p =>
            p.msg
              ? $noteTooltip($text(p.msg))
              : $node(style({ color: palette.foreground, fontSize: text.xs }))($text(p.usd)),
          combine({ msg: alert, usd: start('', amountUsd) })
        )
      )

      const $maxButton = switchMap(
        p => {
          if (p.amt !== 0n) return empty
          const ready = p.bal > 0n
          return $element('button')(
            attr({ type: 'button', disabled: ready ? null : 'true' }),
            style({
              background: 'transparent',
              border: `1px solid ${colorShade(palette.foreground, 25)}`,
              borderRadius: '8px',
              padding: '2px 8px',
              fontSize: text.xs,
              fontWeight: '600',
              color: palette.foreground,
              cursor: ready ? 'pointer' : 'not-allowed',
              opacity: ready ? '1' : '0.4',
              alignSelf: 'center',
              flexShrink: '0'
            }),
            clickMaxTether(nodeEvent('click'))
          )($text('Max'))
        },
        combine({ amt: amountValue, bal: balanceStream })
      )

      // ---- input label (read-only; the holding was chosen by the row that opened this popover) ----------------------
      const $inputLabel: I$Node = switchLatest(
        map(
          s =>
            $node(style({ color: palette.foreground, fontSize: text.sm, fontWeight: '500' }))(
              $text(`Swap ${s.symbol}`)
            ),
          selectedInput
        )
      )

      // ---- TO / chain pickers --------------------------------------------------------------------------------------
      const $tokenLabelContent = (symbol: string, hint: string | null): I$Node =>
        $row(spacing.small, style({ alignItems: 'center', ...(hint ? {} : { padding: '8px 10px' }) }))(
          $tokenIconBySymbol(symbol),
          hint
            ? $column(style({ gap: '0' }))(
                $node(style({ fontWeight: '600', fontSize: text.base }))($text(symbol)),
                $node(style({ color: palette.foreground, fontSize: text.xs }))($text(hint))
              )
            : $text(symbol)
        )
      const $receiveControl = $DropSelect({
        $container: $defaultDropdownContainer(style({ alignItems: 'flex-end', flexShrink: '0' })),
        value: targetValue,
        optionList: targetOptions,
        $valueLabel: map((o: ITargetOption) => $tokenLabelContent(o.symbol, 'Receive')),
        $$option: map((o: ITargetOption) => $tokenLabelContent(o.symbol, null))
      })({ select: selectTargetTether(map(o => o.id)) })

      const $chainOption = (id: number) => $node(style({ display: 'flex', padding: '8px 10px' }))($chainLabel(id, 20))
      const $chainControl = $DropSelect({
        $container: $defaultDropdownContainer(style({ alignItems: 'flex-end', flexShrink: '0' })),
        value: destChain,
        optionList: destChainIds,
        $valueLabel: map((id: number) =>
          $row(spacing.small, style({ alignItems: 'center' }))(
            $chainIcon(id, 24),
            $column(style({ gap: '0' }))(
              $node(style({ fontWeight: '600', fontSize: text.sm }))($text(chainName(id))),
              $node(style({ color: palette.foreground, fontSize: text.xs }))($text('Receive on'))
            )
          )
        ),
        $$option: map((id: number) => $chainOption(id))
      })({ select: selectChainTether() })

      // Output-token USD price for the selected route (native resolves to its wrapped-native price); the fee row's out side.
      const outPriceStream: IStream<bigint | null> = switchLatest(map(r => targetPrice(r.dc, r.target), route))

      // ---- swap fee row (route cost): high-cut warning + third-party-router disclaimer (ported from $DepositEditor) --
      const HIGH_SWAP_FEE_PCT = 1
      const feeMeta: IStream<{ text: string; high: boolean }> = switchLatest(
        map(
          p => {
            if (p.amt === 0n || !p.q.quote || p.q.quote.outputAmount === 0n || p.inPrice === null || p.outPrice === null) {
              return just({ text: '-', high: false })
            }
            // Pair the live amount with a quote fetched for the SAME amount AND output route, or the cut balloons / prices
            // the wrong token while the 300ms-debounced quote lags — show '…' until it catches up.
            if (
              p.q.quote.inputAmount !== p.amt ||
              p.q.quote.forTarget !== p.route.target ||
              p.q.quote.forDc !== p.route.dc
            )
              return just({ text: '…', high: false })
            const inUsd = Number(formatUnits(p.q.quote.inputAmount * p.inPrice, USD_PRICE_DECIMALS))
            const outUsd = Number(formatUnits(p.q.quote.outputAmount * p.outPrice, USD_PRICE_DECIMALS))
            const fee = inUsd - outUsd
            const feeText = fee <= 0 ? '$0.00' : `$${readableUnitAmount(fee)}`
            const pct = inUsd > 0 ? (fee / inUsd) * 100 : 0
            const high = pct > HIGH_SWAP_FEE_PCT
            return just({ text: `${feeText}${high ? ` (${pct.toFixed(1)}%)` : ''} via ${p.q.quote.tool}`, high })
          },
          combine({ amt: amountValue, q: quoteQuery, inPrice: inputPrice, outPrice: outPriceStream, route })
        )
      )
      const $routeFeeValue = switchLatest(
        map(
          (m: { text: string; high: boolean }) => {
            if (m.text === '-' || m.text === '…') return $node(style({ color: palette.foreground }))($text(m.text))
            const i = m.text.indexOf(' via ')
            const value = i >= 0 ? m.text.slice(0, i) : m.text
            const vendor = i >= 0 ? m.text.slice(i) : ''
            return $row(spacing.tiny, style({ alignItems: 'baseline' }))(
              $node(style(m.high ? { color: palette.negative } : { color: palette.message }))($text(value)),
              vendor ? $node(style({ color: palette.foreground, fontSize: text.xs }))($text(vendor)) : empty
            )
          },
          start({ text: '-', high: false }, feeMeta)
        )
      )
      const $routeFeeTooltip = $node(style({ maxWidth: '240px', lineHeight: '1.4', fontSize: text.sm }))(
        $text(
          'All-in cost of converting through the route shown: what you send minus the guaranteed minimum you receive (aggregator routing fee + slippage). This goes to the third-party router (such as LI.FI), not to Puppet.'
        )
      )

      // ---- editor body (header + slider + Swap-fee row, matching $DepositEditor / $FundEditor) ----------------------
      const $editor = $column(spacing.default, style({ minWidth: '380px' }))(
        $row(
          style({
            padding: '18px 28px',
            borderRadius: '22px 22px 0 0',
            background: palette.background,
            margin: '-28px -28px 0px',
            width: '450px',
            gap: '12px',
            alignItems: 'center'
          })
        )(
          $element('label')(
            style({ display: 'flex', flexDirection: 'column', cursor: 'text', flex: '1', minWidth: '0', gap: '4px' })
          )(
            $inputLabel,
            $row(spacing.small, style({ alignItems: 'center' }))($field, $maxButton),
            $alert
          ),
          $column(spacing.small, style({ alignItems: 'flex-end' }))($receiveControl, $chainControl)
        ),
        $node(style({ margin: '0 -26px', display: 'flex' }))($percentSlider),
        $row(spacing.default, style({ alignItems: 'center', fontSize: text.sm }))(
          $labeledValue('Swap fee', $routeFeeValue, $routeFeeTooltip),
          $node(style({ flex: 1 }))(),
          $ButtonSecondary({ disabled, $content: $text('Save') })({ click: clickSaveTether() })
        )
      )

      // ---- draft + holdings display --------------------------------------------------------------------------------
      const previewDraft: IStream<IFundSwapDraft> = map(
        (params): IFundSwapDraft => {
          const { input, dc, target } = params.route
          const isLocal = dc === input.chainId
          return {
            kind: 'fundSwap',
            id: `fundSwap:${fundAddress}:${input.chainId}:${input.token}`,
            account: fundAddress,
            title: 'Swap',
            alert: null,
            chainId: input.chainId,
            destinationChainId: isLocal ? undefined : dc,
            tokenIn: input.token,
            tokenOut: targetTokenOn(dc, target),
            amountIn: params.amount,
            minOut: params.q.quote?.outputAmount ?? 0n
          }
        },
        combine({ amount: amountValue, q: quoteQuery, route })
      )
      const changeDraft: IStream<IFundSwapDraft> = multicast(sample(previewDraft, submitTrigger))

      // Net pending change for a holding across queued swaps: a draft debits (chain, tokenIn) and credits its output on
      // (destinationChainId ?? chainId, tokenOut). Both legs are matched so a cross-chain swap's credit lands on the
      // destination-chain holding, not the source row.
      const deltaFor = (chainId: number, token: Hex, list: IFundSwapDraft[]): bigint =>
        list.reduce((acc, d) => {
          if (d.account !== fundAddress) return acc
          let v = acc
          if (d.chainId === chainId && isAddressEqual(d.tokenIn, token)) v -= d.amountIn
          const outChain = d.destinationChainId ?? d.chainId
          if (outChain === chainId && isAddressEqual(d.tokenOut, token)) v += d.minOut
          return v
        }, 0n)

      const $holdingRow = (h: IFundHolding): I$Node => {
        // Native marker rows (a swap's native output credit) carry the chain's gas-coin symbol and price off the
        // wrapped-native ERC-20; the marker itself isn't in the token-description/price maps.
        const desc = isNativeId(h.token)
          ? { decimals: 18, symbol: nativeSymbolOf(h.chainId as ChainId) }
          : getRegisteredTokenDescription(h.token)
        const price = priceFor(priceAddrOf(h.chainId, h.token))
        const delta = map(list => deltaFor(h.chainId, h.token, list), swapDraftList)
        // A raw-native holding can't be a swap input (no gate wrap leg) and an incoming-only row has nothing to swap yet
        // (balance 0), so their Swap button is disabled; for every other holding the button opens the shared editor
        // preselected to this holding (popEditor carries its source).
        const swappable = !isNativeId(h.token) && h.balance > 0n
        const source: ISource = swappable ? toSource(h) : initialSource
        return $row(spacing.default, style({ alignItems: 'center', flex: 1 }))(
          $row(spacing.small, style({ alignItems: 'center' }))(
            $tokenWithChainBadge($tokenIconBySymbol(desc.symbol, '32px'), h.chainId, 32, 14),
            $text(desc.symbol),
            $ButtonSecondary({
              $container: $defaultMiniButtonSecondary,
              $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Swap'), $popoverCaret()),
              disabled: just(!swappable)
            })({ click: popEditorTether(constant(source)) })
          ),
          $node(style({ flex: 1 }))(),
          $amountDisplay({
            hideBalances,
            usd: map(p => formatUsd(h.balance, p), price),
            amount: readableTokenAmountLabel(desc, h.balance),
            change: map(
              p =>
                p.d === 0n
                  ? null
                  : {
                      usd: formatUsd(h.balance + p.d, p.price),
                      amount: readableTokenAmountLabel(desc, h.balance + p.d)
                    },
              combine({ d: delta, price })
            ),
            color: map(d => (d > 0n ? palette.positive : d < 0n ? palette.negative : undefined), delta),
            align: 'flex-end'
          })
        )
      }

      // A pending swap whose output token the fund doesn't hold yet has no balance row, so its incoming credit would be
      // invisible (only the input's debit shows). Append a zero-balance row per such output (destinationChainId ?? chainId,
      // tokenOut) so the credit displays as 0.00 → +X, mirroring the Pending Actions preview. Held outputs already show
      // their credit on the existing row via deltaFor.
      const heldKey = (chainId: number, token: Hex): string => `${chainId}:${getAddress(token)}`
      const heldKeys = new Set(holdings.map(h => heldKey(h.chainId, h.token)))
      const $incomingRows = switchLatest(
        map(list => {
          const seen = new Set<string>()
          const incoming: IFundHolding[] = []
          for (const d of list) {
            if (d.account !== fundAddress) continue
            const outChain = d.destinationChainId ?? d.chainId
            const key = heldKey(outChain, d.tokenOut as Hex)
            if (heldKeys.has(key) || seen.has(key)) continue
            seen.add(key)
            incoming.push({ chainId: outChain, token: d.tokenOut as Hex, balance: 0n })
          }
          return incoming.length === 0 ? empty : $column(spacing.small)(...incoming.map($holdingRow))
        }, swapDraftList)
      )

      const $body = $Popover({
        $target: $column(spacing.small, style({ flex: 1 }))(...holdings.map($holdingRow), $incomingRows),
        $open: constant($editor, popEditor),
        dismiss: changeDraft
      })({})

      return [$body, { changeDraft }]
    }
  )
