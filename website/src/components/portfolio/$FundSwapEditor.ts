import { CHAIN_TOKEN_MAP, PRECISION, PROTOCOL } from '@puppet/contracts/const'
import { predictDepositRoute } from '@puppet/sdk/account'
import { CHAIN_LIST, type ChainId } from '@puppet/sdk/const'
import {
  getChainTokenDescription,
  readableTokenAmount,
  readableTokenAmountLabel,
} from '@puppet/sdk/core'
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
  empty,
  filter,
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
} from 'aelea/stream'
import { type IBehavior, multicast, state } from 'aelea/stream-extended'
import { $element, $node, $text, component, type I$Node, type INode, nodeEvent, style, styleBehavior } from 'aelea/ui'
import { $column, $Popover, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { type Address, getAddress, type Hex, isAddressEqual } from 'viem'
import {
  $ButtonPrimary,
  $ButtonPrimaryOutline,
  $DropSelect,
  $defaultMiniButtonPrimary,
  $noteTooltip,
  $popoverCaret,
  $TokenAmountInput,
  text
} from '@/ui-components'
import { $chainIcon, $chainLabel, chainName } from '../../common/$chain.js'
import { fundSwapQuoteAttempts, type ISwapRequest } from '../../io/bridge/swapQuote.js'
import { relayFeeFor } from '../../io/context.js'
import { formatUsd, priceFor } from '../../io/price.js'
import { $SwapProviderFeeEditor, type ISelectedRoute } from './$SwapProviderFeeEditor.js'
import { $tokenBalanceRow, $tokenIconBySymbol } from './$tokenOption.js'
import type { IFundSwapDraft } from './draft.js'
import {
  $editorDropdownContainer,
  $editorPercentSlider,
  $maxAmountButton,
  $noteSlot,
  amountUsdLabel,
  createFocusState,
  scaleByPercent
} from './editorUtils.js'

export interface IFundHolding {
  chainId: number
  token: Hex
  balance: bigint
}

export interface I$FundSwapEditor {
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
export const $FundSwapEditor = ({ hideBalances, fundAddress, holdings, tokenRegistry, swapDraftList }: I$FundSwapEditor) =>
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
      [enterPress, enterPressTether]: IBehavior<KeyboardEvent>,
      [selectedRoute, selectedRouteTether]: IBehavior<ISelectedRoute>
    ) => {
      const isNativeId = (id: Hex): boolean => isAddressEqual(getAddress(id), PROTOCOL.nativeToken)
      // Every holding with a signed balance is a swap source, except a raw-native (marker) balance: the gate's swap path
      // A raw-native holding is quoted + swapped through its wrapped-native ERC-20 (the DEX can't pull the codeless
      // marker); the runner prepends a 1:1 wrap (native -> WMON) before the swap. Wrapped-native holdings (WETH/WMON,
      // registered under their own ERC-20 address) are ordinary sources.
      const toSource = (h: IFundHolding): ISource => {
        const native = isNativeId(h.token)
        const desc = getChainTokenDescription(h.chainId as ChainId, h.token)
        return {
          chainId: h.chainId,
          // token = the SOURCE identity the draft carries (native marker for native, so the runner wraps first); address
          // = the ERC-20 the DEX actually swaps (the wrapped-native token for native), which quoting + pricing use.
          token: h.token,
          address: native
            ? wrappedNativeAddressOf(h.chainId as ChainId)
            : tokenInfoFor(tokenRegistry, h.chainId as ChainId, h.token).token,
          symbol: native ? nativeSymbolOf(h.chainId as ChainId) : desc.symbol,
          decimals: desc.decimals,
          balance: h.balance
        }
      }
      const sources: ISource[] = holdings.map(toSource)
      const hasSources = sources.length > 0
      // A stable placeholder keeps the editor's streams well-typed when the fund holds only native (no swappable source);
      // the Swap button is disabled in that case, so this is never the active input.
      const initialSource: ISource = hasSources
        ? sources[0]
        : { chainId: holdings[0]?.chainId ?? 0, token: PROTOCOL.nativeToken, address: PROTOCOL.nativeToken, symbol: '', decimals: 18, balance: 0n }

      const destChainIds = CHAIN_LIST.map(c => c.id).filter(id => (tokenRegistry.get(id as ChainId)?.size ?? 0) > 0)
      const isDestChainId = (id: number): boolean => destChainIds.includes(id)
      // Same-chain swap can target any registered token but the input itself. Native OUTPUT is allowed for a NON-native
      // local input (FundGate.swap's local branch forwards native via CallLib.payout, crediting the marker balance);
      // cross-chain native output is excluded (the bridge delivers the wrapped ERC-20). A NATIVE input is wrapped to its
      // twin before swapping, so both the native marker (no MON->MON self-swap) and that wrapped twin (the effective
      // input) are excluded as targets — its options are the OTHER assets.
      const targetIdsAt = (dc: number, input: ISource): Hex[] => {
        const inputNative = isNativeId(input.token)
        return [...(tokenRegistry.get(dc as ChainId)?.keys() ?? [])].filter(t => {
          // No MON->MON self-swap. A native input keeps its wrapped twin as a target (MON->WMON = wrap to base); native
          // OUTPUT stays available for a non-native local input (the gate forwards native on delivery).
          if (isNativeId(t)) return dc === input.chainId && !inputNative
          return dc === input.chainId ? t !== input.token : true
        })
      }
      // A native input targeting its own wrapped twin on the same chain is a pure WRAP (1:1), not a DEX swap: no quote,
      // no swap fee, no slippage floor. The runner executes it as the wrap leg alone.
      // A local native<->wrapped-native pair (MON->WMON wrap OR WMON->MON unwrap): a 1:1 FundGate.wrap, not a DEX swap.
      const isWrapPair = (input: ISource, dc: number, target: Hex): boolean => {
        if (dc !== input.chainId) return false
        const wnt = getAddress(wrappedNativeAddressOf(input.chainId as ChainId))
        return isNativeId(input.token)
          ? isAddressEqual(getAddress(targetTokenOn(dc, target)), wnt)
          : isNativeId(target) && isAddressEqual(getAddress(input.address), wnt)
      }
      const targetTokenOn = (dc: number, id: Hex): Address => tokenInfoFor(tokenRegistry, dc as ChainId, id).token
      // The asset identity for cross-asset detection: chain-aware for the native marker (MON on Monad, ETH elsewhere),
      // since address-keyed symbolByAddress collapses the shared native marker to a single symbol AND resolves every
      // wrapped-ETH (WETH) to "ETH" — so a native-in / WETH-out swap would otherwise read same-asset and skip the route.
      const assetSymbol = (chainId: number, token: Hex): string =>
        isNativeId(token) ? nativeSymbolOf(chainId as ChainId) : symbolByAddress(token)
      // The native marker is the same address on every chain, so its CEX symbol is per-chain (MON vs ETH) — resolve it
      // through nativeSymbolOf, not the address-keyed symbolByAddress. Pricing routes through the wrapped-native ERC-20
      // (1:1 with the gas coin), since the bare marker isn't priceable.
      const displaySymbol = (chainId: number, id: Hex): string =>
        getChainTokenDescription(chainId as ChainId, id).symbol
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
      // The input asset's TWIN on another chain (its const-table key mapped onto dc), when that twin is a valid target
      // there — the default receive for a fresh CROSS-CHAIN swap, so it opens as a plain same-asset bridge. Null when the
      // input has no twin on dc (e.g. native MON, Monad-only), leaving the receive genuinely unselected for the user.
      const constKeyOf = (chainId: number, token: Hex): string | null => {
        const map = CHAIN_TOKEN_MAP[chainId as keyof typeof CHAIN_TOKEN_MAP] as Record<string, Hex> | undefined
        return map ? (Object.keys(map).find(k => isAddressEqual(getAddress(map[k]!), getAddress(token))) ?? null) : null
      }
      const sameAssetTwin = (dc: number, input: ISource): Hex | null => {
        const key = constKeyOf(input.chainId, input.token)
        const twin = key
          ? (CHAIN_TOKEN_MAP[dc as keyof typeof CHAIN_TOKEN_MAP] as Record<string, Hex> | undefined)?.[key]
          : undefined
        return twin && targetIdsAt(dc, input).some(id => isAddressEqual(getAddress(id), getAddress(twin)))
          ? getAddress(twin)
          : null
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
      // The receive token starts UNSELECTED (null): the user picks a chain first. rawTarget holds only an EXPLICIT pick
      // (or a hydrated draft); the effective target is derived in `route` below.
      const rawTarget: IStream<Hex | null> = state(null, merge(selectTarget, draftTarget))
      // One always-consistent route triple. Validating the retained target against the CURRENT (dc, input) INSIDE a single
      // combine is what prevents a diamond glitch: if `dc` and `target` were combined independently at each consumer, a
      // chain change would momentarily pair the new chain with a target only registered on the old one, and
      // targetTokenOn -> tokenInfoFor would throw Intent__TokenNotRegistered. Every consumer that crosses dc with target
      // (quote, fee, draft) reads this triple, so the two can never disagree.
      // Effective target: an explicit valid pick wins; otherwise a CROSS-CHAIN pair defaults to the input's same-asset
      // twin (a plain bridge) and a SAME-CHAIN pair stays null (unselected — the user must choose an asset to swap into).
      const route: IStream<{ input: ISource; dc: number; target: Hex | null }> = map(
        p => {
          const valid = p.t !== null && targetIdsAt(p.dc, p.input).includes(p.t)
          const target = valid ? p.t : p.dc !== p.input.chainId ? sameAssetTwin(p.dc, p.input) : null
          return { input: p.input, dc: p.dc, target }
        },
        combine({ input: selectedInput, dc: destChain, t: rawTarget })
      )
      // MON -> WMON is a 1:1 wrap, not a DEX route: gates below skip the quote/fee/floor when this is set.
      const wrapStream: IStream<boolean> = map(
        ({ input, dc, target }) => target !== null && isWrapPair(input, dc, target),
        route
      )
      const targetValue: IStream<ITargetOption | null> = map(
        r => (r.target === null ? null : { id: r.target, symbol: displaySymbol(r.dc, r.target) }),
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
        skipRepeatsWith((a, b) => a.address === b.address),
        switchMap((s): IStream<bigint | null> => map(fm => (fm === null ? null : fm.swap.relayFee), relayFeeFor(s.address))),
        state(null)
      )

      const sliderAmount: IStream<bigint> = sampleMap(
        (bal, pct) => (Math.max(0, Math.min(1, pct)) >= 1 ? bal : scaleByPercent(bal, pct)),
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
      const request: IStream<ISwapRequest | null> = multicast(
        map(({ amount, route: { input, dc, target } }) => {
          const isLocal = dc === input.chainId
          if (amount === 0n || target === null || (isLocal && target === input.token) || isWrapPair(input, dc, target))
            return null
          return {
            originChainId: input.chainId,
            destinationChainId: dc,
            inputToken: input.address,
            outputToken: targetTokenOn(dc, target),
            inputAmount: amount,
            route: isLocal ? fundAddress : predictDepositRoute(fundAddress),
            crossToken: assetSymbol(input.chainId, input.token) !== assetSymbol(dc, targetTokenOn(dc, target))
          }
        }, quoteTrigger)
      )

      // Smallest input that keeps the relay fee within maxRelayFeeBps of the swapped amount (mirrors $FundEditor's
      // bridge-ratio floor); below it the on-chain verifyRelayFeeRatio reverts, so the editor blocks with a hint.
      const minInputStream: IStream<bigint | null> = map(
        fee => (fee === null ? null : (fee * PRECISION.basisPoints + PROTOCOL.maxRelayFeeBps - 1n) / PROTOCOL.maxRelayFeeBps),
        inputRelayFee
      )

      const alert: IStream<string | null> = op(
        combine({
          amount: amountValue,
          route: selectedRoute,
          balance: balanceStream,
          input: selectedInput,
          minInput: minInputStream,
          isWrap: wrapStream
        }),
        map(p => {
          const desc = { decimals: p.input.decimals, symbol: p.input.symbol }
          if (p.amount > p.balance) return `Exceeds balance ${readableTokenAmountLabel(desc, p.balance)}`
          if (p.isWrap) return null
          if (p.amount > 0n && p.minInput !== null && p.amount < p.minInput) {
            const add = p.minInput - p.amount
            return `Add at least ${readableTokenAmountLabel(desc, add)}: a smaller swap makes the relay fee exceed ${Number(PROTOCOL.maxRelayFeeBps) / 100}% of the amount`
          }
          if (p.route.error) return p.route.error
          if (p.route.quote?.isAmountTooLow) return 'No route available for this amount'
          return null
        }),
        state(null)
      )

      const disabled = op(
        combine({ amount: amountValue, route: selectedRoute, alert, isWrap: wrapStream }),
        map(p => {
          if (p.amount === 0n || p.alert !== null) return true
          // A wrap needs no quote (1:1); anything else needs route.ready = a fresh quote for the LIVE request (amount +
          // target + chain), non-zero output, within limits, so no stale minOut is baked into the draft.
          return p.isWrap ? false : !p.route.ready
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
      const $percentSlider = $editorPercentSlider({
        value: sliderValue,
        ariaLabel: 'Amount percentage',
        disabled: map(b => b === 0n, balanceStream),
        error: map(a => a !== null, alert)
      })({ change: sliderPercentTether() })

      const amountUsd: IStream<string> = amountUsdLabel(amountValue, inputPrice)
      const $alert = $noteSlot(
        switchMap(
          p =>
            p.msg
              ? $noteTooltip($text(p.msg))
              : $node(style({ color: palette.foreground, fontSize: text.xs }))($text(p.usd)),
          combine({ msg: alert, usd: start('', amountUsd) })
        )
      )

      const $maxButton = $maxAmountButton(amountValue, balanceStream, clickMaxTether(nodeEvent('click')))

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
        $container: $editorDropdownContainer,
        value: targetValue,
        optionList: targetOptions,
        $valueLabel: map((o: ITargetOption | null) =>
          o === null
            ? $node(style({ padding: '8px 12px', color: palette.foreground }))($text('Select token'))
            : $tokenLabelContent(o.symbol, 'Receive')
        ),
        $$option: map((o: ITargetOption) => $tokenLabelContent(o.symbol, null))
      })({ select: selectTargetTether(map(o => o.id)) })

      const $chainOption = (id: number) => $node(style({ display: 'flex', padding: '8px 10px' }))($chainLabel(id, 20))
      const $chainControl = $DropSelect({
        $container: $editorDropdownContainer,
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

      const $routeFee = $SwapProviderFeeEditor({
        active: map(r => r.target !== null && !(r.dc === r.input.chainId && r.target === r.input.token), route),
        request,
        attempts: fundSwapQuoteAttempts
      })({ selectRoute: selectedRouteTether() })

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
          $column(spacing.small, style({ alignItems: 'flex-end' }))($chainControl, $receiveControl)
        ),
        $node(style({ margin: '0 -26px', display: 'flex' }))($percentSlider),
        $row(spacing.default, style({ alignItems: 'center', fontSize: text.sm }))(
          // Swap fee shares the Save row: hidden when a blocking alert shows (the alert already displays under the
          // input), dimmed when there's no route to quote (initial / wrap). Visibility only, never a mount toggle.
          $node(
            style({ display: 'flex' }),
            styleBehavior(
              map(
                p =>
                  p.a !== null
                    ? { display: 'none' }
                    : p.req === null
                      ? { opacity: '.45', pointerEvents: 'none' }
                      : { opacity: '1', pointerEvents: 'auto' },
                combine({ a: alert, req: request })
              )
            )
          )($routeFee),
          $node(style({ flex: 1 }))(),
          $ButtonPrimaryOutline({ disabled, $content: $text('Save') })({ click: clickSaveTether() })
        )
      )

      // ---- draft + holdings display --------------------------------------------------------------------------------
      const previewDraft: IStream<IFundSwapDraft | null> = map(
        (params): IFundSwapDraft | null => {
          const { input, dc, target } = params.route
          if (target === null) return null
          const isLocal = dc === input.chainId
          const wrap = isWrapPair(input, dc, target)
          return {
            kind: 'fundSwap',
            id: `fundSwap:${fundAddress}:${input.chainId}:${input.token}`,
            account: fundAddress,
            title: wrap ? (isNativeId(input.token) ? 'Wrap' : 'Unwrap') : 'Swap',
            alert: null,
            chainId: input.chainId,
            destinationChainId: isLocal ? undefined : dc,
            tokenIn: input.token,
            tokenOut: targetTokenOn(dc, target),
            amountIn: params.amount,
            // A wrap is 1:1, so the whole input is the floor; a swap floors on its reviewed quote output.
            minOut: wrap ? params.amount : (params.sel.quote?.outputAmount ?? 0n),
            // Carry the composed route's chosen bridge asset so the runner executes the SAME intermediate priced here.
            bridgeToken:
              params.sel.quote && 'hubToken' in params.sel.quote ? params.sel.quote.hubToken : undefined
          }
        },
        combine({ amount: amountValue, sel: selectedRoute, route })
      )
      const changeDraft: IStream<IFundSwapDraft> = multicast(
        filter((d): d is IFundSwapDraft => d !== null, sample(previewDraft, submitTrigger))
      )

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
        const desc = getChainTokenDescription(h.chainId as ChainId, h.token)
        const price = priceFor(priceAddrOf(h.chainId, h.token))
        const delta = map(list => deltaFor(h.chainId, h.token, list), swapDraftList)
        // An incoming-only row has nothing to swap yet (balance 0), so its Swap button is disabled; every holding with a
        // balance (including raw native, which the runner wraps first) opens the shared editor preselected to it.
        const swappable = h.balance > 0n
        const source: ISource = swappable ? toSource(h) : initialSource
        const $rowNode = $tokenBalanceRow({
          symbol: desc.symbol,
          chainId: h.chainId,
          iconSize: 34,
          hideBalances,
          amount: readableTokenAmountLabel(desc, h.balance),
          usd: map(p => formatUsd(h.balance, p), price),
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
          $action: $ButtonPrimary({
            $container: $defaultMiniButtonPrimary,
            $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Swap'), $popoverCaret()),
            disabled: just(!swappable)
          })({ click: popEditorTether(constant(source)) })
        })
        if (!swappable) return $rowNode
        // Each swappable row owns its popover ANCHORED TO THAT ROW (the backdrop cuts out the row's rect, not the whole
        // list). One editor exists; its $open fires only for the clicked row (backdrop-dismiss keeps one open at a time).
        return $Popover({
          $target: $rowNode,
          $open: constant(
            $editor,
            filter((sel: ISource) => sel.chainId === h.chainId && isAddressEqual(sel.token as Address, h.token as Address), popEditor)
          ),
          dismiss: changeDraft
        })({})
      }

      // A pending swap whose output token the fund doesn't hold yet has no balance row, so its incoming credit would be
      // invisible (only the input's debit shows). Append a zero-balance row per such output (destinationChainId ?? chainId,
      // tokenOut) so the credit displays as 0.00 → +X, mirroring the Pending Actions preview. Held outputs already show
      // their credit on the existing row via deltaFor.
      const $divider = (): I$Node =>
        $node(style({ height: '1px', backgroundColor: colorShade(palette.foreground, 15) }))()
      const withDividers = (rows: I$Node[], leadDivider = false): I$Node[] =>
        rows.flatMap((row, i) => (i === 0 && !leadDivider ? [row] : [$divider(), row]))

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
          return incoming.length === 0
            ? empty
            : $column(spacing.small)(...withDividers(incoming.map($holdingRow), holdings.length > 0))
        }, swapDraftList)
      )

      const $body = $column(spacing.small, style({ flex: 1 }))(
        ...withDividers(holdings.map($holdingRow)),
        $incomingRows
      )

      return [$body, { changeDraft }]
    }
  )
