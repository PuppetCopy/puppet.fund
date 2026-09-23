import { HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import { predictUserAccount } from '@puppet/sdk/account'
import { formatThrownError } from '@puppet/sdk/compact'
import { type ChainId, resolveDispatchChainId, VIEM_CHAINS } from '@puppet/sdk/const'
import { getTokenDescription, readableTokenAmount, readableTokenAmountLabel } from '@puppet/sdk/core'
import { deliveredLeg, routeCalldataBytes } from '@puppet/sdk/intent'
import {
  bondTokenOf,
  type IRelayFeeQuote,
  type ITokenRegistryMap,
  nativeSymbolOf,
  symbolOf,
  tokenInfoFor,
  tokenKeyOf,
  wrappedNativeAddressOf,
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
  start,
  switchLatest,
  switchMap,
  switchPromises,
  take,
  tap,
  until
} from 'aelea/stream'
import { type IBehavior, multicast, type PromiseState, PromiseStatus, promiseState, state } from 'aelea/stream-extended'
import { $node, $text, attr, component, type I$Node, type INode, nodeEvent, style, styleBehavior } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { type Address, getAddress, type Hex, isAddress, isAddressEqual } from 'viem'
import {
  $ButtonPrimaryOutline,
  $defaultTokenAmountInput,
  $noteTooltip,
  $TokenAmountInput,
  text
} from '@/ui-components'
import { uiStorage } from '@/ui-storage'
import { depositDestinationKey, depositSourceKey, type IDepositPath, type IDepositSource } from '../../app/localStoreSchema.js'
import { chainName } from '../../common/$chain.js'
import type { ISwapRequest } from '../../io/bridge/swapQuote.js'
import { type ChainTokenBalance, ownBalanceFor, spendableBalanceFor, walletBalancesQuery } from '../../io/chain/balances.js'
import context, { DISPLAY_QUOTE_TTL_MS } from '../../io/context.js'
import { formatUsd, priceFor } from '../../io/price.js'
import type { IConnectedWallet } from '../../wallet/index.js'
import { walletChainId as walletChainIdStream } from '../../wallet/state.js'
import { $crumbTrail } from './$InlineSwitchView.js'
import { $SwapProviderFeeEditor, type ISelectedRoute } from './$SwapProviderFeeEditor.js'
import { $SwapTargetFlow, type ISwapTargetOption } from './$SwapTargetFlow.js'
import { $TokenSelectFlow, decorateOptionList, type ITokenInputOption } from './$tokenOption.js'
import type { IArrival, IDepositDraft } from './draft.js'
import {
  $editorAmountLabel,
  $editorFlowContainer,
  $editorPercentSlider,
  $maxAmountButton,
  $noteSlot,
  $overlaySliderContainer,
  amountUsdLabel,
  createFocusState,
  scaleByPercent
} from './editorUtils.js'
import { walletClientForChain } from './runner/_shared.js'

const QUOTE_CALLDATA_BYTES = 8_192n

export interface I$DepositEditor {
  label: string
  $note?: I$Node
  gate?: IStream<boolean>
  hideBalances: IStream<boolean>
  tokenRegistry: ITokenRegistryMap
  walletAccount: IConnectedWallet
  destination: { chainId: ChainId; token: Hex } | { choose: readonly { chainId: ChainId; token: Hex }[]; scope: string }
  stakeFloor?: (chainId: ChainId, token: Hex) => bigint
  existingDraft: IStream<IDepositDraft | null>
}

export const $DepositEditor = ({
  label,
  $note,
  gate,
  hideBalances,
  tokenRegistry,
  walletAccount,
  destination,
  stakeFloor,
  existingDraft
}: I$DepositEditor) =>
  component(
    (
      [clickAddDraft, clickAddDraftTether]: IBehavior<PointerEvent>,
      [selectOption, selectOptionTether]: IBehavior<ITokenInputOption>,
      [selectingSource, selectingSourceTether]: IBehavior<boolean>,
      [pickDestination, pickDestinationTether]: IBehavior<ISwapTargetOption>,
      [selectingDest, selectingDestTether]: IBehavior<boolean>,
      [inputAmount, inputAmountTether]: IBehavior<bigint>,
      [focusEvt, focusEvtTether]: IBehavior<FocusEvent>,
      [blurEvt, blurEvtTether]: IBehavior<FocusEvent>,
      [sliderPercent, sliderPercentTether]: IBehavior<number>,
      [clickMax, clickMaxTether]: IBehavior<INode<HTMLButtonElement>, MouseEvent>,
      [enterPress, enterPressTether]: IBehavior<KeyboardEvent>,
      [selectedRoute, selectedRouteTether]: IBehavior<ISelectedRoute>
    ) => {
      const account = predictUserAccount(walletAccount.address)

      type IDestination = { chainId: ChainId; token: Hex }
      type SourceRef = {
        chainId: ChainId
        address: Address
        symbol: string
        routeTokenId: Hex
        routeToken: Address
        decimals: number
      }
      const displaySymbolOf = (chainId: ChainId, token: Address): string =>
        isAddressEqual(token, wrappedNativeAddressOf(chainId)) ? nativeSymbolOf(chainId) : symbolOf(chainId, token)
      const isSwapTo = (s: SourceRef, dest: IDestination): boolean => symbolOf(s.chainId, s.routeToken) !== symbolOf(dest.chainId, dest.token)
      const isPlainTo = (s: SourceRef, dest: IDestination): boolean => s.chainId === dest.chainId && !isSwapTo(s, dest)
      const sources: SourceRef[] = VIEM_CHAINS.flatMap(chain => {
        const chainMap = tokenRegistry.get(chain.id)
        if (!chainMap) return []
        const entries: SourceRef[] = []
        const pushSource = (address: Address, sym: string, routeTokenId: Hex, routeToken: Address, decimals: number) => {
          entries.push({
            chainId: chain.id,
            address,
            symbol: sym,
            routeTokenId,
            routeToken,
            decimals
          })
        }
        for (const info of chainMap.values()) {
          if (isAddressEqual(info.token, PROTOCOL.nativeToken)) continue
          const desc = getTokenDescription(chain.id, info.token)
          const wrapsNative = isAddressEqual(info.token, wrappedNativeAddressOf(chain.id))
          pushSource(info.token, wrapsNative ? nativeSymbolOf(chain.id) : desc.symbol, info.token, info.token, desc.decimals)
        }
        return entries
      })

      const balanceQuery: IStream<Promise<ChainTokenBalance[]>> = state()(
        just(walletBalancesQuery(tokenRegistry, walletAccount.address, walletAccount.walletClient))
      )
      const balances: IStream<ChainTokenBalance[]> = op(balanceQuery, switchPromises, state())

      const draftStream: IStream<IDepositDraft | null> = existingDraft

      const draftSource = (d: IDepositDraft): IDepositSource => ({
        chainId: d.deposit.chainId,
        address: d.deposit.inputToken
      })

      const selectSource: IStream<IDepositSource> = op(
        selectOption,
        filter((opt: ITokenInputOption) => !opt.disabled),
        map(opt => ({ chainId: opt.chainId, address: opt.address })),
        multicast
      )
      const isValidSource = (s: IDepositSource): boolean =>
        sources.some(src => src.chainId === s.chainId && src.address === s.address)

      const persistedSource: IStream<IDepositSource | null> = op(
        uiStorage.replayWrite(depositSourceKey(walletAccount.address), filter(isValidSource, selectSource)),
        map(s =>
          s !== null && isAddress(s.address, { strict: false })
            ? { chainId: s.chainId, address: getAddress(s.address) }
            : null
        ),
        state()
      )
      const savedSource: IStream<IDepositSource> = filter(
        (s): s is IDepositSource => s !== null && isValidSource(s),
        persistedSource
      )
      const mountWalletChainId = walletAccount.walletClient.chain?.id
      const walletChainSource =
        mountWalletChainId !== undefined ? (sources.find(s => s.chainId === mountWalletChainId) ?? null) : null
      const fallbackSource: IDepositSource = walletChainSource
        ? { chainId: walletChainSource.chainId, address: walletChainSource.address }
        : { chainId: sources[0].chainId, address: sources[0].address }
      const sourcePrices: IStream<Record<string, bigint | null>> = op(
        combine(
          Object.fromEntries(
            [...new Map(sources.map(s => [`${s.chainId}:${s.routeToken}`, s] as const)).values()].map(s => [
              `${s.chainId}:${s.routeToken}`,
              priceFor(s.chainId, s.routeToken)
            ])
          )
        ),
        state()
      )
      const destinations: readonly IDestination[] = 'choose' in destination ? destination.choose : [destination]
      const matchesDestination = (s: SourceRef): boolean => destinations.some(d => isPlainTo(s, d))
      const initialSource: IStream<IDepositSource> = op(
        combine({ saved: persistedSource, balances, prices: sourcePrices }),
        filter(p => p.saved === null || !isValidSource(p.saved)),
        map(p =>
          sources.flatMap(s => {
            const balance = spendableBalanceFor(p.balances, s.chainId, s.address)
            if (balance === null || balance === 0n) return []
            const price = p.prices[`${s.chainId}:${s.routeToken}`]
            return [{ s, usd: price === null || price === undefined ? null : balance * price }]
          })
        ),
        filter((funded): funded is { s: SourceRef; usd: bigint }[] => funded.every(f => f.usd !== null)),
        map(funded => {
          const top = [...funded].sort((a, b) => {
            const matched = Number(matchesDestination(b.s)) - Number(matchesDestination(a.s))
            if (matched !== 0) return matched
            return b.usd > a.usd ? 1 : b.usd < a.usd ? -1 : Number(b.s.chainId === mountWalletChainId) - Number(a.s.chainId === mountWalletChainId)
          })[0]
          return top ? { chainId: top.s.chainId, address: top.s.address } : fallbackSource
        }),
        take(1),
        until(selectOption)
      )
      const draftSourceStream: IStream<IDepositSource> = op(
        draftStream,
        map(d => (d ? draftSource(d) : null)),
        filter((s): s is IDepositSource => s !== null && isValidSource(s))
      )
      const sourceSelection: IStream<IDepositSource> = state()(merge(selectSource, savedSource, initialSource, draftSourceStream))
      const chainSelection: IStream<ChainId> = op(
        sourceSelection,
        map(s => s.chainId),
        skipRepeats,
        tap(chainId => {
          void walletClientForChain(walletAccount.walletClient, chainId).catch(err =>
            console.error('[deposit] wallet chain switch failed', err)
          )
        }),
        multicast
      )

      const findSource = (chainId: ChainId, address: Address): SourceRef =>
        sources.find(s => s.chainId === chainId && s.address === address)!
      const priceForSource = (s: SourceRef): IStream<bigint | null> => priceFor(s.chainId, s.routeToken)

      const selectedSourceRef: IStream<SourceRef> = op(
        sourceSelection,
        map(s => findSource(s.chainId, s.address)),
        state()
      )
      const inputDecimals: IStream<number> = op(
        selectedSourceRef,
        map(s => s.decimals),
        skipRepeats
      )
      const sourceDefault = (s: SourceRef): IDestination =>
        destinations.find(d => isPlainTo(s, d)) ??
        destinations.find(d => d.chainId === s.chainId && isAddressEqual(d.token, bondTokenOf(s.chainId) as Hex)) ??
        destinations.find(d => d.chainId === s.chainId) ?? { chainId: HUB_CHAIN_ID as ChainId, token: bondTokenOf(HUB_CHAIN_ID) as Hex }
      const listedDestination = (d: IDestination): boolean =>
        destinations.some(x => x.chainId === d.chainId && isAddressEqual(x.token, d.token))
      const pickedPath: IStream<IDepositPath | null> = merge(
        constant(null, selectSource),
        sampleMap(
          (s: SourceRef, t: ISwapTargetOption) => ({ source: { chainId: s.chainId, address: s.address }, dest: { chainId: t.chainId, address: t.id } }),
          selectedSourceRef,
          pickDestination
        )
      )
      const persistedPath: IStream<IDepositPath | null> = op(
        uiStorage.replayWrite(
          depositDestinationKey(walletAccount.address, 'choose' in destination ? destination.scope : 'fixed'),
          pickedPath
        ),
        state()
      )
      const savedDestination: IStream<IDestination | null> = op(
        combine({ source: selectedSourceRef, path: persistedPath }),
        map(p =>
          p.path !== null &&
          p.path.source.chainId === p.source.chainId &&
          isAddress(p.path.dest.address, { strict: false }) &&
          isAddressEqual(p.path.source.address, p.source.address)
            ? { chainId: p.path.dest.chainId, token: getAddress(p.path.dest.address) as Hex }
            : null
        ),
        state()
      )
      const livePick: IStream<IDestination> = map(t => ({ chainId: t.chainId, token: t.id }), pickDestination)
      const chosenDestination: IStream<IDestination | null> = state()(merge(livePick, savedDestination))
      const sourcePlan: IStream<{ source: SourceRef; dest: IDestination }> = op(
        combine({ source: selectedSourceRef, chosen: chosenDestination }),
        map(p => ({
          source: p.source,
          dest:
            'choose' in destination
              ? p.chosen !== null && listedDestination(p.chosen)
                ? p.chosen
                : sourceDefault(p.source)
              : { chainId: destination.chainId, token: destination.token }
        })),
        state()
      )
      const inputPrice: IStream<bigint | null> = op(selectedSourceRef, switchMap(priceForSource), state())
      const feeKey = (chainId: ChainId, routeTokenId: Hex): string => `${chainId}|${routeTokenId}`
      const feeQuoteByKey: Record<string, IStream<PromiseState<IRelayFeeQuote>>> = Object.fromEntries(
        [...new Map(sources.map(s => [feeKey(s.chainId, s.routeTokenId), s])).entries()].map(([key, s]) => [
          key,
          op(
            just(s),
            map(src => context.getRelayFeeQuote(src.chainId, src.routeTokenId, DISPLAY_QUOTE_TTL_MS)),
            promiseState,
            state()
          )
        ])
      )
      const inputFeeQuery: IStream<PromiseState<IRelayFeeQuote>> = op(
        selectedSourceRef,
        switchMap(s => feeQuoteByKey[feeKey(s.chainId, s.routeTokenId)]),
        state()
      )
      const escrowFeeQuery: IStream<PromiseState<IRelayFeeQuote>> = op(
        sourcePlan,
        map(q => context.getRelayFeeQuote(q.dest.chainId, q.dest.token, DISPLAY_QUOTE_TTL_MS)),
        promiseState,
        state()
      )
      const inputFeeMap: IStream<IRelayFeeQuote | null> = map(
        f => (f.status === PromiseStatus.DONE ? f.value : null),
        inputFeeQuery
      )
      const feeMapByTokenId: IStream<Record<string, IRelayFeeQuote | null>> = combine(
        Object.fromEntries(
          Object.entries(feeQuoteByKey).map(([key, quote]) => [
            key,
            map(f => (f.status === PromiseStatus.DONE ? f.value : null), quote)
          ])
        )
      )
      const sourceRelayFee = (s: SourceRef, dest: IDestination, fees: Record<string, IRelayFeeQuote | null>): bigint | null => {
        if (isPlainTo(s, dest)) return 0n
        const feeMap = fees[feeKey(s.chainId, s.routeTokenId)]
        if (!feeMap) return null
        return feeMap('depositAcross', false, 0n, 0n, 0n)
      }

      const selectedBalance: IStream<bigint | null> = op(
        combine({ list: balances, sel: sourceSelection }),
        map(p => spendableBalanceFor(p.list, p.sel.chainId, p.sel.address)),
        state()
      )

      const usdText = (s: SourceRef, balance: bigint | null): IStream<string> =>
        balance === null ? just('-') : map(price => formatUsd(balance, price), priceForSource(s))

      // The signed intent charges calldata bytes (see the draft's relayFee below); quoting 0 here made
      // Max reserve less than the submit would actually take, shortest exactly for fat Across routes.
      const routeCalldataLength: IStream<bigint> = op(
        selectedRoute,
        filter(r => r.plan !== null || r.error !== null),
        map(r => (r.plan === null ? 0n : routeCalldataBytes(r.plan[0].route))),
        skipRepeats,
        start(0n)
      )
      const relayFee: IStream<bigint | null> = op(
        combine({ sourcePlan, inputFeeMap, calldata: routeCalldataLength }),
        map(p => {
          if (isPlainTo(p.sourcePlan.source, p.sourcePlan.dest)) return 0n
          if (p.inputFeeMap === null) return null
          return p.inputFeeMap('depositAcross', false, 0n, 0n, p.calldata)
        }),
        state()
      )


      const selectedOption: IStream<ITokenInputOption> = map(
        p => {
          const source = findSource(p.sel.chainId, p.sel.address)
          return {
            symbol: source.symbol,
            chainId: source.chainId,
            address: source.address,
            token: source.routeToken,
            balance: p.balance,
            decimals: source.decimals,
            usdValue: usdText(source, p.balance)
          }
        },
        combine({ sel: sourceSelection, balance: selectedBalance })
      )

      const optionList: IStream<readonly ITokenInputOption[]> = map(
        p =>
          decorateOptionList(
            sources
              .map(source => {
              const balance = spendableBalanceFor(p.list, source.chainId, source.address)
              const srcFee = sourceRelayFee(source, p.dest, p.fees)
              return {
                symbol: source.symbol,
                chainId: source.chainId,
                address: source.address,
                token: source.routeToken,
                balance,
                decimals: source.decimals,
                usdValue: usdText(source, balance),
                disabled: balance !== null && srcFee !== null && balance <= srcFee
              }
            }),
            p.sel,
            opt => p.prices[`${opt.chainId}:${opt.token}`] ?? null
          ),
        combine({
          dest: map(q => q.dest, sourcePlan),
          list: balances,
          sel: sourceSelection,
          fees: feeMapByTokenId,
          prices: sourcePrices
        })
      )

      const sliderAmount: IStream<bigint> = sampleMap(
        (opt, pct) => scaleByPercent(opt.balance ?? 0n, pct),
        selectedOption,
        sliderPercent
      )
      const maxAmount: IStream<bigint> = sampleMap(
        p => {
          if (p.fee === null) return 0n
          const bal = p.opt.balance ?? 0n
          return bal > p.fee ? bal - p.fee : 0n
        },
        combine({ opt: selectedOption, fee: relayFee }),
        clickMax
      )
      const value: IStream<bigint> = op(
        merge(
          inputAmount,
          sliderAmount,
          maxAmount,
          constant(0n, selectSource),
          op(
            draftStream,
            map(d => (d === null ? 0n : d.deposit.inputAmount))
          )
        ),
        state(0n)
      )

      const focused = createFocusState(focusEvt, blurEvt)

      const bridgeQuoteInput: IStream<bigint | null> = op(
        combine({ value, sourcePlan, feeMap: inputFeeMap }),
        map(p => {
          if (isPlainTo(p.sourcePlan.source, p.sourcePlan.dest)) return p.value
          if (p.feeMap === null) return null
          const fee = p.feeMap('depositAcross', false, 0n, 0n, QUOTE_CALLDATA_BYTES)
          return p.value > fee ? p.value - fee : 0n
        }),
        skipRepeats
      )

      const request: IStream<ISwapRequest | null> = op(
        map(params => {
          const source = params.sourcePlan.source
          const dest = params.sourcePlan.dest
          if (isPlainTo(source, dest)) return null
          const bridgeInput = params.bridgeInput
          if (bridgeInput === null || bridgeInput === 0n) return null
          return {
            originChainId: resolveDispatchChainId(source.chainId),
            destinationChainId: dest.chainId,
            inputToken: source.routeToken,
            outputToken: tokenInfoFor(tokenRegistry, dest.chainId, dest.token).token,
            inputAmount: bridgeInput,
            depositor: account,
            recipient: account
          }
        }, combine({
          sourcePlan,
          bridgeInput: bridgeQuoteInput
        })),
        state()
      )

      const alert: IStream<string | null> = op(
        map((params): string | null => {
          if (params.value === 0n) return null
          if (params.feeQuote.status === PromiseStatus.ERROR) return `Relay fee unavailable: ${formatThrownError(params.feeQuote.error)}`
          if (params.value > 0n && params.walletChain !== params.chainId) {
            return `Switch your wallet to ${chainName(params.chainId)}`
          }
          const wnt = wrappedNativeAddressOf(params.source.chainId)
          if (isAddressEqual(params.source.address, wnt) && ownBalanceFor(params.balances, params.source.chainId, wnt) === null) {
            return `Wallet ${getTokenDescription(params.source.chainId, wnt).symbol} balance on ${chainName(params.source.chainId)} could not be read`
          }
          if (params.balance !== null && params.value > params.balance) {
            return `Exceeds wallet balance ${readableTokenAmountLabel({ decimals: params.source.decimals, symbol: params.source.symbol }, params.balance)}`
          }
          const needsQuote = !isPlainTo(params.source, params.dest)
          if (needsQuote) {
            if (params.route.error) return params.route.error
            if (params.route.limitError) return params.route.limitError
          }
          if (stakeFloor !== undefined) {
            const floor = stakeFloor(params.dest.chainId, params.dest.token)
            const token = getTokenDescription(params.dest.chainId, params.dest.token)
            if (!needsQuote) {
              if (params.value < floor) return `A first fund needs at least ${readableTokenAmountLabel(token, floor)} in escrow before its key can sign`
            } else if (params.route.plan !== null) {
              if (params.escrowFee.status === PromiseStatus.ERROR) return `Relay fee unavailable: ${formatThrownError(params.escrowFee.error)}`
              if (params.escrowFee.status === PromiseStatus.DONE) {
                const needed = floor + params.escrowFee.value('escrow', true, 0n, 0n, 0n)
                if (deliveredLeg(params.route.plan).outputAmount < needed) {
                  return `A first fund needs at least ${readableTokenAmountLabel(token, floor)} in escrow before its key can sign, so this route must deliver at least ${readableTokenAmountLabel(token, needed)}`
                }
              }
            }
          }
          return null
        },
        combine({
          balance: selectedBalance,
          balances,
          value,
          route: selectedRoute,
          chainId: chainSelection,
          source: selectedSourceRef,
          dest: map(q => q.dest, sourcePlan),
          feeQuote: inputFeeQuery,
          escrowFee: escrowFeeQuery,
          walletChain: start(mountWalletChainId ?? null, walletChainIdStream)
        })),
        state(null)
      )


      const $swapProviderFee = $SwapProviderFeeEditor({
        active: map(p => !isPlainTo(p.source, p.dest), sourcePlan),
        request,
        maxLegs: 1,
      })({ selectRoute: selectedRouteTether() })

      const disabled: IStream<boolean> = op(
        combine({
          alert,
          value,
          route: selectedRoute,
          sel: sourceSelection,
          existing: draftStream,
          feeMap: inputFeeMap,
          sourcePlan,
          balances,
          open: gate ?? just(true)
        }),
        map(p => {
          if (!p.open) return true
          if (p.value === 0n) return gate === undefined
          if (p.alert !== null) return true
          if (p.feeMap === null) return true
          if (p.value <= p.feeMap('depositAcross', false, 0n, 0n, 0n)) return true
          const existingSource = p.existing ? draftSource(p.existing) : null
          if (
            p.existing &&
            p.existing.deposit.inputAmount === p.value &&
            existingSource !== null &&
            existingSource.chainId === p.sel.chainId &&
            existingSource.address === p.sel.address
          ) {
            return true
          }
          if (isPlainTo(p.sourcePlan.source, p.sourcePlan.dest)) return false
          return !p.route.ready
        }),
        state(true)
      )

      const valueToShow: IStream<string> = map(
        (p: { amt: bigint; dec: number; focused: boolean }) => (p.amt === 0n ? '' : readableTokenAmount(p.dec, p.amt)),
        filter(
          (p: { amt: bigint; dec: number; focused: boolean }) => !p.focused,
          combine({ amt: value, dec: inputDecimals, focused })
        )
      )

      const submitTrigger: IStream<unknown> = merge(
        clickAddDraft,
        op(
          sampleMap((dis: boolean, evt: KeyboardEvent) => ({ dis, evt }), disabled, enterPress),
          filter(p => !p.dis)
        )
      )

      const submitParams: IStream<{
        value: bigint
        source: SourceRef
        dest: IDestination
        route: ISelectedRoute
        balance: bigint | null
        feeMap: IRelayFeeQuote | null
        balances: Awaited<ReturnType<typeof walletBalancesQuery>>
      }> = combine({
        value,
        source: map(q => q.source, sourcePlan),
        dest: map(q => q.dest, sourcePlan),
        route: selectedRoute,
        balance: selectedBalance,
        feeMap: inputFeeMap,
        balances
      })

      const $field = op(
        inputDecimals,
        map(dec =>
          $TokenAmountInput({ decimals: dec, valueToShow })({
            inputAmount: inputAmountTether(),
            focus: focusEvtTether(),
            blur: blurEvtTether(),
            enter: enterPressTether()
          })
        ),
        start($defaultTokenAmountInput(attr({ disabled: '' }))()),
        switchLatest
      )

      const sliderValue: IStream<number> = start(
        0,
        map(
          p => (p.opt.balance && p.opt.balance > 0n ? Number((p.amt * 10000n) / p.opt.balance) / 10000 : 0),
          combine({ amt: value, opt: selectedOption })
        )
      )
      const hasError: IStream<boolean> = map(a => a !== null, alert)
      const sliderDisabled: IStream<boolean> = start(true, map(b => b === null || b === 0n, selectedBalance))
      const $percentSlider = $editorPercentSlider({
        value: sliderValue,
        ariaLabel: 'Deposit percentage',
        disabled: sliderDisabled,
        error: hasError,
        $container: $overlaySliderContainer
      })({ change: sliderPercentTether() })

      const amountUsd: IStream<string> = amountUsdLabel(value, inputPrice)
      const $alert = $noteSlot(
        switchMap(
          msg => (msg ? $noteTooltip($text(msg)) : $node(style({ color: palette.foreground, fontSize: text.xs }))($text(amountUsd))),
          alert
        )
      )

      const $maxButton = $maxAmountButton(value, selectedBalance, clickMaxTether(nodeEvent('click')))

      const $topSection = $TokenSelectFlow({
        hideBalances,
        selection: map(
          s => ({ chainId: s.chainId, address: isAddressEqual(s.address, wrappedNativeAddressOf(s.chainId)) ? PROTOCOL.nativeToken : s.address }),
          sourceSelection
        ),
        balanceQuery,
        value: selectedOption,
        optionList,
        ...('choose' in destination ? {} : { destinationChainId: destination.chainId }),
        $container: $editorFlowContainer,
        $inputContent: $anchor =>
          $node(style({ display: 'contents' }))(
            $editorAmountLabel(
              $crumbTrail([{ label }]),
              $row(spacing.small, style({ alignItems: 'center' }))($field, $maxButton),
              $alert
            ),
            $anchor
          )
      })({ select: selectOptionTether(), selecting: selectingSourceTether() })

      const toTarget = (d: IDestination): ISwapTargetOption => ({ chainId: d.chainId, id: d.token, symbol: tokenKeyOf(d.chainId, d.token) })
      const $save = $ButtonPrimaryOutline({
        disabled,
        $content: $text('Save')
      })({ click: clickAddDraftTether() })
      const $quote = $node(
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
      )($swapProviderFee)
      const $receive =
        'choose' in destination
          ? $SwapTargetFlow({
              value: map(p => toTarget(p.dest), sourcePlan),
              optionList: just(destinations.map(toTarget)),
              source: map(s => ({ chainId: s.chainId, symbol: displaySymbolOf(s.chainId, s.routeToken) }), selectedSourceRef),
              $container: $row(
                style({ margin: '0 -28px', padding: '0 28px', gap: '12px', alignItems: 'center', fontSize: text.sm }),
                styleBehavior(
                  map(s => (s ? { background: palette.background, padding: '20px 28px' } : null), start(false, selectingDest))
                )
              ),
              $inputContent: $anchor =>
                $node(style({ display: 'contents' }))(
                  $node(style({ color: palette.foreground, fontWeight: '500', whiteSpace: 'nowrap' }))($text('Destination')),
                  $anchor
                )
            })({ select: pickDestinationTether(), selecting: selectingDestTether() })
          : empty

      const selecting: IStream<boolean> = map(p => p.source || p.dest, combine({ source: selectingSource, dest: start(false, selectingDest) }))
      const hiddenWhile = (flag: IStream<boolean>) =>
        styleBehavior(map(s => (s ? { display: 'none' } : { display: 'contents' }), flag))

      return [
        $column(spacing.default, style({ width: '394px', maxWidth: '100%' }))(
          $node(style({ display: 'contents' }), hiddenWhile(selectingDest))($topSection),
          $node(style({ display: 'contents' }), hiddenWhile(selecting))(
            $node(style({ margin: '0 -28px', display: 'flex' }))($percentSlider)
          ),
          ...('choose' in destination ? [$node(style({ display: 'contents' }), hiddenWhile(selectingSource))($receive)] : []),
          ...($note === undefined ? [] : [$node(style({ display: 'contents' }), hiddenWhile(selecting))($note)]),
          $node(style({ display: 'contents' }), hiddenWhile(selecting))(
            $row(spacing.small, style({ alignItems: 'center', fontSize: text.sm }))($quote, $node(style({ flex: 1 }))(), $save)
          )
        ),
        (() => {
          const changeDraft: IStream<IDepositDraft> = op(
            sample(submitParams, submitTrigger),
            map((base): IDepositDraft => {
              const plan = base.route.plan
              const source = base.source
              const dest = base.dest
              const chainId = source.chainId
              const plain = isPlainTo(source, dest)
              const destToken = tokenInfoFor(tokenRegistry, dest.chainId, dest.token).token
              if (base.value === 0n) {
                return {
                  kind: 'deposit',
                  id: 'deposit',
                  source: 'wallet',
                  deposit: {
                    chainId,
                    inputToken: plain ? destToken : source.routeToken,
                    outputToken: destToken,
                    inputAmount: 0n,
                    destinationChainId: BigInt(dest.chainId),
                    routeInput: 0n,
                    outputAmount: 0n,
                    route: null,
                    fillDeadline: 0
                  },
                  nativeValue: 0n,
                  expectedOutput: 0n,
                  toEscrow: 'choose' in destination && destination.scope === 'allocate'
                }
              }
              const signed = plan === null || plain ? null : plan[0]
              const route = signed === null ? null : signed.route
              const wnt = wrappedNativeAddressOf(chainId)
              const fused = isAddressEqual(source.address, wnt)
              const walletWrapped = fused ? ownBalanceFor(base.balances, chainId, wnt) : base.value
              if (walletWrapped === null) throw new Error(`the wallet's wrapped balance on chain ${chainId} is unknown; refresh and retry`)
              const walletPull = walletWrapped < base.value ? walletWrapped : base.value
              const relayFee =
                route === null || base.feeMap === null ? 0n : base.feeMap('depositAcross', false, 0n, 0n, routeCalldataBytes(route))
              if (base.value <= relayFee) {
                throw new Error(
                  `this deposit of ${base.value} does not cover its ${relayFee} relay fee; raise the amount`
                )
              }
              const common = {
                chainId,
                inputToken: plain ? destToken : source.routeToken,
                outputToken: signed === null ? destToken : signed.outputToken,
                inputAmount: base.value,
                destinationChainId: BigInt(dest.chainId)
              }
              return {
                kind: 'deposit',
                id: 'deposit',
                source: 'wallet',
                deposit:
                  signed === null
                    ? { ...common, routeInput: base.value, outputAmount: base.value, route: null, fillDeadline: 0 }
                    : {
                        ...common,
                        routeInput: signed.inputAmount,
                        outputAmount: signed.outputAmount,
                        route,
                        fillDeadline: signed.fillDeadline
                      },
                nativeValue: base.value - walletPull,
                expectedOutput: plan === null || route === null ? base.value : deliveredLeg(plan).expectedOutputAmount,
                toEscrow: 'choose' in destination && destination.scope === 'allocate'
              }
            })
          )
          const arrival: IStream<IArrival> = map(p => {
            const chainId = p.sp.dest.chainId
            const token = tokenInfoFor(tokenRegistry, chainId, p.sp.dest.token).token
            if (isPlainTo(p.sp.source, p.sp.dest)) return { chainId, token, amount: p.value }
            if (p.route.plan === null) return { chainId, token, amount: 0n }
            const leg = deliveredLeg(p.route.plan)
            return { chainId, token: leg.outputToken, amount: leg.expectedOutputAmount }
          }, combine({ value, sp: sourcePlan, route: selectedRoute }))
          return { changeDraft, arrival }
        })()
      ]
    }
  )
