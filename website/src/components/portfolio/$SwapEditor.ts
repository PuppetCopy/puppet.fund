import { formatThrownError } from '@puppet/sdk/compact'
import { ADDRESS_ZERO, CHAIN_LIST, type ChainId, MAX_UINT256 } from '@puppet/sdk/const'
import { readableTokenAmount, readableTokenAmountLabel, readableUnitAmount } from '@puppet/sdk/core'
import { getTokenDescription } from '@puppet/sdk/gmx'
import { type ITokenRegistryMap, tokenInfoFor } from '@puppet/sdk/state'
import {
  combine,
  constant,
  debounce,
  empty,
  filter,
  type IStream,
  just,
  map,
  merge,
  op,
  sample,
  sampleMap,
  skipRepeatsWith,
  start,
  switchLatest,
  switchMap,
  switchPromises,
  tap
} from 'aelea/stream'
import { type IBehavior, multicast, state } from 'aelea/stream-extended'
import { $element, $node, $text, attr, component, type I$Node, type INode, nodeEvent, style } from 'aelea/ui'
import { $column, $Popover, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { type Address, formatUnits, type Hex } from 'viem'
import {
  $amountDisplay,
  $ButtonSecondary,
  $DropSelect,
  $defaultDropdownContainer,
  $defaultMiniButtonSecondary,
  $defaultSliderContainer,
  $labeledValue,
  $loadingValue,
  $noteTooltip,
  $popoverCaret,
  $Slider,
  $TokenAmountInput,
  NOTE_TOOLTIP_HEIGHT,
  text
} from '@/ui-components'
import { uiStorage } from '@/ui-storage'
import { swapTargetKey } from '../../app/localStoreSchema.js'
import { $chainIcon, $tokenWithChainBadge, chainName } from '../../common/$chain.js'
import { fetchAcrossBridgeQuote } from '../../io/bridge/across.js'
import { fetchLifiSwapQuote } from '../../io/bridge/lifiSwap.js'
import * as context from '../../io/context.js'
import { formatUsd, priceFor } from '../../io/gmx/priceFeed.js'
import { $tokenIconBySymbol } from './$tokenOption.js'
import type { ISwapDraft } from './draft.js'

export interface I$SwapEditor {
  fundAddress: Address
  chainId: number
  tokenId: Hex
  balance: bigint
  tokenRegistry: ITokenRegistryMap
  swapDraftList: IStream<ISwapDraft[]>
}

export const $SwapEditor = ({ fundAddress, chainId, tokenId, balance, tokenRegistry, swapDraftList }: I$SwapEditor) =>
  component(
    (
      [popEditor, popEditorTether]: IBehavior<PointerEvent>,
      [clickSave, clickSaveTether]: IBehavior<PointerEvent>,
      [selectTarget, selectTargetTether]: IBehavior<Hex>,
      [selectChain, selectChainTether]: IBehavior<number>,
      [inputAmount, inputAmountTether]: IBehavior<bigint>,
      [focusEvt, focusEvtTether]: IBehavior<FocusEvent>,
      [blurEvt, blurEvtTether]: IBehavior<FocusEvent>,
      [sliderPercent, sliderPercentTether]: IBehavior<number>,
      [clickMax, clickMaxTether]: IBehavior<INode<HTMLButtonElement>, MouseEvent>,
      [enterPress, enterPressTether]: IBehavior<KeyboardEvent>
    ) => {
      const info = tokenInfoFor(tokenRegistry, chainId as ChainId, tokenId)
      const token = info.token
      const tokenDescription = getTokenDescription(token === ADDRESS_ZERO ? token : info.hubToken)
      const tokenPrice = priceFor(token === ADDRESS_ZERO ? token : info.hubToken)
      const usdValue: IStream<string> = map(price => formatUsd(balance, price), tokenPrice)

      const targetIds = [...(tokenRegistry.get(chainId as ChainId)?.keys() ?? [])].filter(t => t !== tokenId)
      const targetInfo = (id: Hex) => tokenInfoFor(tokenRegistry, chainId as ChainId, id)
      const targetPrice = (id: Hex) => {
        const t = targetInfo(id)
        return priceFor(t.token === ADDRESS_ZERO ? t.token : t.hubToken)
      }
      const destChainIds =
        token === ADDRESS_ZERO
          ? [chainId]
          : CHAIN_LIST.map(c => c.id as number).filter(
              id => id === chainId || !!tokenRegistry.get(id as ChainId)?.get(tokenId)
            )

      const existingDraft: IStream<ISwapDraft | null> = op(
        swapDraftList,
        map(
          list => list.find(d => d.account === fundAddress && d.chainId === chainId && d.tokenInId === tokenId) ?? null
        ),
        multicast
      )

      const pendingDelta: IStream<bigint> = op(
        swapDraftList,
        map(list =>
          list
            .filter(d => d.account === fundAddress)
            .reduce(
              (acc, d) =>
                acc +
                (d.tokenInId === tokenId && d.chainId === chainId ? -d.amountIn : 0n) +
                (d.tokenOutId === tokenId && d.destinationChainId === chainId ? d.minOut : 0n),
              0n
            )
        ),
        multicast
      )
      const adjustmentColor = map(
        amount => (amount > 0n ? palette.positive : amount < 0n ? palette.negative : undefined),
        pendingDelta
      )
      const adjustmentChange = map(
        p =>
          p.delta === 0n
            ? null
            : {
                usd: formatUsd(balance + p.delta, p.price),
                amount: readableTokenAmountLabel(tokenDescription, balance + p.delta)
              },
        combine({ delta: pendingDelta, price: tokenPrice })
      )

      let targetTouched = false
      const touch = <T>(src: IStream<T>): IStream<T> =>
        tap(() => {
          targetTouched = true
        }, src)
      const draftTarget: IStream<Hex> = touch(
        op(
          existingDraft,
          filter((d): d is ISwapDraft => d !== null && d.destinationChainId === d.chainId),
          map(d => d.tokenOutId)
        )
      )
      const userTarget: IStream<Hex> = touch(selectTarget)
      const persistedTarget: IStream<Hex | null> = uiStorage.replayWrite(
        swapTargetKey(tokenId),
        filter(t => targetIds.includes(t), selectTarget)
      )
      const initialTarget: IStream<Hex> = op(
        persistedTarget,
        filter((saved): saved is Hex => !targetTouched && saved !== null && targetIds.includes(saved))
      )
      const defaultTarget = targetIds.find(id => targetInfo(id).token === ADDRESS_ZERO) ?? targetIds[0] ?? tokenId
      const targetSelection: IStream<Hex> = state(
        defaultTarget,
        merge(userTarget, draftTarget, initialTarget)
      )

      const draftChain: IStream<number> = op(
        existingDraft,
        filter((d): d is ISwapDraft => d !== null && destChainIds.includes(d.destinationChainId)),
        map(d => d.destinationChainId)
      )
      const chainSelection: IStream<number> = state(chainId, merge(selectChain, draftChain))

      const sliderAmount: IStream<bigint> = map(pct => {
        const clamped = Math.max(0, Math.min(1, pct))
        return clamped >= 1 ? balance : (balance * BigInt(Math.round(clamped * 10000))) / 10000n
      }, sliderPercent)
      const maxAmount: IStream<bigint> = constant(balance, clickMax)
      const draftAmountHydration: IStream<bigint> = map(d => (d ? d.amountIn : 0n), existingDraft)
      const amountValue: IStream<bigint> = state(0n, merge(inputAmount, sliderAmount, maxAmount, draftAmountHydration))
      const focused: IStream<boolean> = state(false, merge(constant(true, focusEvt), constant(false, blurEvt)))

      interface IQuote {
        outputAmount: bigint
        tool: string
        isAmountTooLow: boolean
        minDeposit: bigint
        maxDeposit: bigint
      }
      type QuoteStatus = { status: 'idle'; quote: IQuote | null } | { status: 'error'; quote: null; message: string }
      const quoteTrigger = op(
        combine({ amount: amountValue, target: targetSelection, dest: chainSelection }),
        skipRepeatsWith((a, b) => a.amount === b.amount && a.target === b.target && a.dest === b.dest)
      )
      const quoteFetch: IStream<Promise<QuoteStatus>> = op(
        debounce(300, quoteTrigger),
        map(async (params): Promise<QuoteStatus> => {
          const isBridge = params.dest !== chainId
          if (params.amount === 0n || (!isBridge && params.target === tokenId)) return { status: 'idle', quote: null }
          try {
            if (isBridge) {
              const quote = await fetchAcrossBridgeQuote({
                originChainId: chainId,
                destinationChainId: params.dest,
                inputToken: token,
                outputToken: tokenInfoFor(tokenRegistry, params.dest as ChainId, tokenId).token,
                inputAmount: params.amount,
                recipient: fundAddress
              })
              return {
                status: 'idle',
                quote: {
                  outputAmount: quote.outputAmount,
                  tool: 'Across',
                  isAmountTooLow: quote.isAmountTooLow,
                  minDeposit: quote.limits.minDeposit,
                  maxDeposit: quote.limits.maxDeposit
                }
              }
            }
            const quote = await fetchLifiSwapQuote({
              chainId,
              inputToken: token,
              outputToken: targetInfo(params.target).token,
              inputAmount: params.amount,
              fromAddress: fundAddress,
              toAddress: fundAddress
            })
            return {
              status: 'idle',
              quote: {
                outputAmount: quote.outputAmount,
                tool: quote.tool,
                isAmountTooLow: quote.isAmountTooLow,
                minDeposit: 0n,
                maxDeposit: MAX_UINT256
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

      const relayFee: IStream<bigint> = map(feeMap => feeMap.operate.relayFee, context.relayFeeMapForToken(tokenId))

      const alert: IStream<string | null> = op(
        combine({ amount: amountValue, q: quoteQuery }),
        map(p => {
          if (p.amount > balance) return `Exceeds balance ${readableTokenAmount(tokenDescription, balance)}`
          if (p.q.status === 'error') return p.q.message
          if (p.q.quote?.isAmountTooLow)
            return p.q.quote.minDeposit > 0n
              ? `Below the route minimum ${readableTokenAmount(tokenDescription, p.q.quote.minDeposit)}`
              : 'No route available for this amount'
          if (p.q.quote && p.amount > p.q.quote.maxDeposit)
            return `Exceeds the route maximum ${readableTokenAmount(tokenDescription, p.q.quote.maxDeposit)}`
          return null
        }),
        state(null)
      )

      const disabled = op(
        combine({ amount: amountValue, q: quoteQuery, alert }),
        map(p => p.amount === 0n || p.alert !== null || p.q.quote === null || p.q.quote.outputAmount === 0n),
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

      const valueToShow: IStream<string> = map(
        (p: { amt: bigint; focused: boolean }) => (p.amt === 0n ? '' : readableTokenAmount(tokenDescription, p.amt)),
        filter((p: { amt: bigint; focused: boolean }) => !p.focused, combine({ amt: amountValue, focused }))
      )
      const $field = $TokenAmountInput({ decimals: tokenDescription.decimals, valueToShow })({
        inputAmount: inputAmountTether(),
        focus: focusEvtTether(),
        blur: blurEvtTether(),
        enter: enterPressTether()
      })

      const sliderValue: IStream<number> = map(
        amt => (balance <= 0n ? 0 : Math.min(1, Number((amt * 10000n) / balance) / 10000)),
        amountValue
      )
      const $percentSlider = $Slider({
        value: sliderValue,
        step: 0.01,
        orientation: 'horizontal',
        ariaLabel: 'Amount percentage',
        disabled: just(balance === 0n),
        error: map(a => a !== null, alert),
        motion: { stiffness: 800, damping: 58 },
        $container: $defaultSliderContainer(
          style({ height: '14px', width: '100%', margin: '-26px 0', flexShrink: '0' })
        )
      })({ change: sliderPercentTether() })

      const amountUsd: IStream<string> = map(
        p => (p.amt === 0n ? '' : formatUsd(p.amt, p.price)),
        combine({ amt: amountValue, price: tokenPrice })
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

      const $maxButton = switchMap(amt => {
        if (amt !== 0n) return empty
        const ready = balance > 0n
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
      }, amountValue)

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
      const targetSymbol = (id: Hex): string => {
        const t = targetInfo(id)
        return getTokenDescription(t.token === ADDRESS_ZERO ? t.token : t.hubToken).symbol
      }

      const $receiveControl = switchLatest(
        map(
          dest =>
            dest !== chainId
              ? $tokenLabelContent(tokenDescription.symbol, 'Receive')
              : $DropSelect({
                  $container: $defaultDropdownContainer(style({ alignItems: 'flex-end', flexShrink: '0' })),
                  value: targetSelection,
                  optionList: targetIds,
                  $valueLabel: map((id: Hex) => $tokenLabelContent(targetSymbol(id), 'Receive')),
                  $$option: map((id: Hex) => $tokenLabelContent(targetSymbol(id), null))
                })({ select: selectTargetTether() }),
          chainSelection
        )
      )

      const $chainOption = (id: number, hint: string | null): I$Node =>
        $row(spacing.small, style({ alignItems: 'center', ...(hint ? {} : { padding: '8px 10px' }) }))(
          $chainIcon(id, hint ? 20 : 18),
          hint
            ? $column(style({ gap: '0' }))(
                $node(style({ fontWeight: '600', fontSize: text.sm }))($text(chainName(id))),
                $node(style({ color: palette.foreground, fontSize: text.xs }))($text(hint))
              )
            : $node(style({ fontSize: text.sm }))($text(chainName(id)))
        )
      const $chainControl =
        destChainIds.length > 1
          ? $DropSelect({
              $container: $defaultDropdownContainer(style({ alignItems: 'flex-end', flexShrink: '0' })),
              value: chainSelection,
              optionList: destChainIds,
              $valueLabel: map((id: number) => $chainOption(id, 'Receive at')),
              $$option: map((id: number) => $chainOption(id, null))
            })({ select: selectChainTether() })
          : empty

      const routeFeeText: IStream<string> = switchMap(
        sel =>
          map(
            p => {
              if (p.amt === 0n || !p.q.quote || p.q.quote.outputAmount === 0n) return '-'
              if (p.inPrice === null || p.outPrice === null) return '-'
              const feeUsd =
                Number(formatUnits(p.amt * p.inPrice, 30)) -
                Number(formatUnits(p.q.quote.outputAmount * p.outPrice, 30))
              return `${feeUsd <= 0 ? '$0.00' : `$${readableUnitAmount(feeUsd)}`} via ${p.q.quote.tool}`
            },
            combine({
              amt: amountValue,
              q: quoteQuery,
              inPrice: tokenPrice,
              outPrice: sel.dest !== chainId ? tokenPrice : targetPrice(sel.target)
            })
          ),
        combine({ dest: chainSelection, target: targetSelection })
      )
      const routeFeeLabel: IStream<string> = map(dest => (dest !== chainId ? 'Bridge fee' : 'Swap fee'), chainSelection)

      const relayFeeText: IStream<string> = map(
        ({ fee, price }) => formatUsd(fee, price),
        combine({ fee: relayFee, price: tokenPrice })
      )

      const $feeTip = (copy: string): I$Node => $node(style({ fontSize: text.sm }))($text(copy))
      const $relayFeeTooltip = $feeTip(
        'Paid to the relayer that submits this transaction on-chain for you. Deducted from this token balance and covers network gas plus dispatch.'
      )
      const $routeFeeTooltip = switchLatest(
        map(
          dest =>
            $feeTip(
              dest !== chainId
                ? 'All-in cost of moving funds to the destination chain through the route shown: what you send minus the guaranteed minimum received, covering bridge, relayer and price slippage.'
                : 'All-in cost of converting through the route shown: what you send minus the guaranteed minimum you receive, covering the aggregator routing fee and price slippage.'
            ),
          chainSelection
        )
      )

      const $routeFeeValue = switchLatest(
        map(
          hasInput =>
            hasInput
              ? switchLatest(
                  map((s: string) => {
                    if (s === '-') return $node(style({ color: palette.foreground }))($text('-'))
                    const i = s.indexOf(' via ')
                    const value = i >= 0 ? s.slice(0, i) : s
                    const vendor = i >= 0 ? s.slice(i) : ''
                    return $row(spacing.tiny, style({ alignItems: 'baseline' }))(
                      $node(style({ color: palette.message }))($text(value)),
                      vendor
                        ? $node(style({ color: palette.foreground, fontSize: text.xs }))($text(vendor))
                        : empty
                    )
                  }, start('-', routeFeeText))
                )
              : $node(style({ color: palette.foreground }))($text('-')),
          op(
            amountValue,
            map(a => a > 0n),
            skipRepeatsWith((a, b) => a === b)
          )
        )
      )

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
            style({
              display: 'flex',
              flexDirection: 'column',
              cursor: 'text',
              flex: '1',
              minWidth: '0',
              gap: '4px'
            })
          )(
            $node(style({ color: palette.foreground, fontSize: text.sm, fontWeight: '500' }))(
              $text(`Swap ${tokenDescription.symbol}`)
            ),
            $row(spacing.small, style({ alignItems: 'center' }))($field, $maxButton),
            $alert
          ),
          $column(spacing.small, style({ alignItems: 'flex-end' }))($receiveControl, $chainControl)
        ),
        $node(style({ margin: '0 -26px', display: 'flex' }))($percentSlider),
        $row(spacing.default, style({ alignItems: 'center', fontSize: text.sm }))(
          $column(spacing.small)(
            $labeledValue($node($text(routeFeeLabel)), $routeFeeValue, $routeFeeTooltip),
            $labeledValue('Relay fee', $loadingValue(start('-', relayFeeText)), $relayFeeTooltip)
          ),
          $node(style({ flex: 1 }))(),
          $ButtonSecondary({ disabled, $content: $text('Save') })({ click: clickSaveTether() })
        )
      )

      const previewDraft: IStream<ISwapDraft> = map(
        (params): ISwapDraft => {
          const isBridge = params.dest !== chainId
          return {
            kind: 'swap',
            id: `swap:${fundAddress}:${chainId}:${tokenId}`,
            account: fundAddress,
            title: isBridge ? 'Bridge' : 'Swap',
            alert: null,
            chainId,
            destinationChainId: params.dest,
            tokenInId: tokenId,
            tokenIn: token,
            tokenOutId: isBridge ? tokenId : params.target,
            tokenOut: isBridge
              ? tokenInfoFor(tokenRegistry, params.dest as ChainId, tokenId).token
              : targetInfo(params.target).token,
            amountIn: params.amount,
            minOut: params.q.quote?.outputAmount ?? 0n
          }
        },
        combine({ amount: amountValue, target: targetSelection, dest: chainSelection, q: quoteQuery })
      )
      const changeDraft: IStream<ISwapDraft> = multicast(sample(previewDraft, submitTrigger))

      const $body = $Popover({
        $target: $row(spacing.default, style({ padding: '4px', borderRadius: '4px', alignItems: 'center', flex: 1 }))(
          $row(spacing.small, style({ alignItems: 'center' }))(
            $tokenWithChainBadge($tokenIconBySymbol(tokenDescription.symbol, '32px'), chainId, 32, 14),
            $text(tokenDescription.symbol)
          ),
          $ButtonSecondary({
            $container: $defaultMiniButtonSecondary,
            $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Swap'), $popoverCaret()),
            disabled: just(balance === 0n || (targetIds.length === 0 && destChainIds.length <= 1))
          })({ click: popEditorTether() }),
          $node(style({ flex: 1 }))(),
          $amountDisplay({
            usd: usdValue,
            amount: readableTokenAmountLabel(tokenDescription, balance),
            change: adjustmentChange,
            color: adjustmentColor,
            align: 'flex-end'
          })
        ),
        $open: constant($editor, popEditor),
        dismiss: changeDraft
      })({})

      return [$body, { changeDraft }]
    }
  )
