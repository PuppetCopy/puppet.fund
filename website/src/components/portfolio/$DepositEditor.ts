import { HUB_CANONICAL_TOKEN, HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import { predictUserAccount } from '@puppet/sdk/account'
import type { IArrival, IDepositDraft } from '@puppet/sdk/client'
import { formatThrownError } from '@puppet/sdk/compact'
import { CHAIN_TOKEN_MAP, type ChainId, resolveDispatchChainId, VIEM_CHAINS } from '@puppet/sdk/const'
import { getTokenDescription, readableTokenAmount, readableTokenAmountLabel } from '@puppet/sdk/core'
import { routeCalldataBytes } from '@puppet/sdk/intent'
import {
  type IRelayFeeQuote,
  listedTokensOf,
  nativeSymbolOf,
  routeSubcallGas,
  symbolOf,
  tokenKeyOf,
  TYPICAL_SUBCALL_GAS,
  wrappedNativeAddressOf
} from '@puppet/sdk/state'
import {
  combine,
  combineMap,
  constant,
  filter,
  filterNull,
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
  until
} from 'aelea/stream'
import { type IBehavior, multicast, type PromiseState, type PromiseStateDone, PromiseStatus, promiseState, state } from 'aelea/stream-extended'
import { $node, $text, attr, component, type I$Node, type INode, nodeEvent, style, styleBehavior } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { type Address, getAddress, type Hex, isAddress, isAddressEqual } from 'viem'
import {
  $defaultTokenAmountInput,
  $icon,
  $intermediateText,
  $noteTooltip,
  text,
  $TokenAmountInput,
  $wallet,
  intermediateState
} from '@/ui-components'
import { uiStorage } from '@/ui-storage'
import { editorChoiceKey, type IChainAddress, type IStoredPath } from '../../app/localStoreSchema.js'
import { chainName } from '../../common/$chain.js'
import type { ISwapRequest } from '../../io/bridge/swapQuote.js'
import { type IBalanceRead, type IWalletBalance, walletBalanceOf } from '../../io/chain/balances.js'
import context, { DISPLAY_QUOTE_TTL_MS } from '../../io/context.js'
import { priceFor } from '../../io/price.js'
import type { IConnectedWallet } from '../../wallet/index.js'
import { $DraftSave, type ISelectedRoute } from './$DraftSave.js'
import { $crumbTrail } from './$InlineSwitchView.js'
import type { ISwapTargetOption } from './$SwapTargetFlow.js'
import { $TokenSelectFlow, type ITokenInputOption } from './$tokenOption.js'
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


export interface I$DepositEditor {
  label: string
  $note?: I$Node
  gate?: IStream<boolean>
  raisesAtZero?: IStream<boolean>
  hideBalances: IStream<boolean>
  walletAccount: IConnectedWallet
  walletChainId: IStream<number | null>
  destination: { chainId: ChainId; token: Hex } | { choose: readonly { chainId: ChainId; token: Hex }[]; scope: string } | { inKind: true }
  stakeFloor?: (chainId: ChainId, token: Hex) => bigint
  existingDraft: IStream<IDepositDraft | null>
  preset: { chainId: ChainId; token: Hex; amount: bigint } | null
}

const WALLET_GAS_BUDGET = 2_000_000n

export const $DepositEditor = ({
  label,
  $note,
  gate,
  raisesAtZero,
  hideBalances,
  walletAccount,
  walletChainId,
  destination,
  stakeFloor,
  existingDraft,
  preset
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
        for (const token of listedTokensOf(chain.id)) {
          const desc = getTokenDescription(chain.id, token)
          if (isAddressEqual(token, PROTOCOL.nativeToken)) continue
          if ('inKind' in destination && (CHAIN_TOKEN_MAP[HUB_CHAIN_ID as ChainId] as Record<string, string>)[tokenKeyOf(chain.id, token)] === undefined) continue
          const wrapsNative = isAddressEqual(token, wrappedNativeAddressOf(chain.id))
          pushSource(token, wrapsNative ? nativeSymbolOf(chain.id) : desc.symbol, token, token, desc.decimals)
        }
        return entries
      })

      const balanceKey = (chainId: ChainId, token: Address): string => `${chainId}:${getAddress(token)}`
      const walletBalances = new Map(
        [
          ...new Map(
            sources.flatMap(s => [
              [balanceKey(s.chainId, s.address), { chainId: s.chainId, token: s.address }] as const,
              [balanceKey(s.chainId, PROTOCOL.nativeToken), { chainId: s.chainId, token: PROTOCOL.nativeToken }] as const
            ])
          )
        ].map(([key, at]) => [key, walletBalanceOf(walletAccount.address, at.chainId, at.token)] as const)
      )
      const balanceOf = (chainId: ChainId, token: Address): IWalletBalance => {
        const held = walletBalances.get(balanceKey(chainId, token))
        if (held === undefined) throw new Error(`no wallet balance read was built for ${token} on chain ${chainId}`)
        return held
      }
      const fusedOf = (s: SourceRef): boolean => isAddressEqual(s.address, wrappedNativeAddressOf(s.chainId))
      const spendableOf = (s: SourceRef): Pick<IWalletBalance, 'shown' | 'fresh'> => {
        const own = balanceOf(s.chainId, s.address)
        if (!fusedOf(s)) return own
        const native = balanceOf(s.chainId, PROTOCOL.nativeToken)
        const sum = (a: Promise<bigint>, b: Promise<bigint>): Promise<bigint> => Promise.all([a, b]).then(([x, y]) => x + y)
        return { shown: combineMap(sum, native.shown, own.shown), fresh: combineMap(sum, native.fresh, own.fresh) }
      }
      const storedQuery: IStream<Promise<{ source: SourceRef; balance: bigint | null }[]>> = just(
        Promise.all(
          sources.map(async source => {
            const own = balanceOf(source.chainId, source.address).stored()
            if (!fusedOf(source)) return { source, balance: await own }
            const [native, wrapped] = await Promise.all([balanceOf(source.chainId, PROTOCOL.nativeToken).stored(), own])
            return { source, balance: native === null || wrapped === null ? null : native + wrapped }
          })
        )
      )
      const stored = op(storedQuery, switchPromises, state())

      const draftStream: IStream<IDepositDraft | null> = existingDraft

      const draftSource = (d: IDepositDraft): IChainAddress => ({
        chainId: d.deposit.chainId,
        address: isAddressEqual(d.deposit.inputToken, PROTOCOL.nativeToken) ? wrappedNativeAddressOf(d.deposit.chainId) : d.deposit.inputToken
      })

      const selectSource: IStream<IChainAddress> = op(
        selectOption,
        filter((opt: ITokenInputOption) => !opt.disabled),
        map(opt => ({ chainId: opt.chainId, address: opt.address })),
        multicast
      )
      const isValidSource = (s: IChainAddress): boolean =>
        sources.some(src => src.chainId === s.chainId && src.address === s.address)

      const persistedSource: IStream<IChainAddress | null> = op(
        uiStorage.replayWrite<IChainAddress | null>(editorChoiceKey(walletAccount.address, 'depositSource'), null, filter(isValidSource, selectSource)),
        map(s =>
          s !== null && isAddress(s.address, { strict: false })
            ? { chainId: s.chainId, address: getAddress(s.address) }
            : null
        ),
        state()
      )
      const savedSource: IStream<IChainAddress> = filter(
        (s): s is IChainAddress => s !== null && isValidSource(s),
        persistedSource
      )
      const sourcePrices: Record<string, IStream<Promise<bigint | null>>> = Object.fromEntries(
        [...new Map(sources.map(s => [`${s.chainId}:${s.routeToken}`, s] as const)).values()].map(s => [`${s.chainId}:${s.routeToken}`, priceFor(s.chainId, s.routeToken)])
      )
      const destinations: readonly IDestination[] = 'choose' in destination ? destination.choose : 'inKind' in destination ? [] : [destination]
      const matchesDestination = (s: SourceRef): boolean => destinations.some(d => isPlainTo(s, d))
      const initialSource: IStream<IChainAddress> = op(
        combine({ saved: persistedSource, stored, prices: combine(sourcePrices), walletChain: walletChainId }),
        filter(p => p.saved === null || !isValidSource(p.saved)),
        map(p => {
          const funded = p.stored.flatMap(({ source: s, balance }) =>
            balance === null || balance === 0n ? [] : [{ s, balance, price: p.prices[`${s.chainId}:${s.routeToken}`]! }]
          )
          return Promise.allSettled(funded.map(f => f.price)).then(settled => {
            const top = funded
              .map((f, i) => {
                const at = settled[i]!
                return { s: f.s, usd: at.status === 'fulfilled' && at.value !== null ? f.balance * at.value : null }
              })
              .sort((a, b) => {
                const matched = Number(matchesDestination(b.s)) - Number(matchesDestination(a.s))
                if (matched !== 0) return matched
                const priced = Number(b.usd !== null) - Number(a.usd !== null)
                if (priced !== 0) return priced
                if (a.usd !== null && b.usd !== null && a.usd !== b.usd) return b.usd > a.usd ? 1 : -1
                return Number(b.s.chainId === p.walletChain) - Number(a.s.chainId === p.walletChain)
              })[0]
            if (top !== undefined) return { chainId: top.s.chainId, address: top.s.address }
            const onWalletChain = sources.find(s => s.chainId === p.walletChain)
            const fallback = onWalletChain === undefined ? sources[0] : onWalletChain
            return { chainId: fallback.chainId, address: fallback.address }
          })
        }),
        intermediateState,
        filter((s): s is PromiseStateDone<IChainAddress> => s.status === PromiseStatus.DONE),
        map(s => s.value),
        take(1),
        until(selectOption)
      )
      const draftSourceStream: IStream<IChainAddress> = op(
        draftStream,
        map(d => (d ? draftSource(d) : null)),
        filter((s): s is IChainAddress => s !== null && isValidSource(s))
      )
      const presetRef = preset === null ? undefined : sources.find(s => s.chainId === preset.chainId && isAddressEqual(s.address, preset.token))
      const presetSource: IChainAddress | null = presetRef === undefined ? null : { chainId: presetRef.chainId, address: presetRef.address }
      const sourceSelection: IStream<IChainAddress> = state()(
        presetSource === null ? merge(selectSource, savedSource, initialSource, draftSourceStream) : merge(selectSource, just(presetSource))
      )
      const findSource = (chainId: ChainId, address: Address): SourceRef =>
        sources.find(s => s.chainId === chainId && s.address === address)!
      const priceForSource = (s: SourceRef): IStream<Promise<bigint | null>> => {
        const price = sourcePrices[`${s.chainId}:${s.routeToken}`]
        if (price === undefined) throw new Error(`no price stream was built for ${s.routeToken} on chain ${s.chainId}`)
        return price
      }

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
      const hubWeth: IDestination = { chainId: HUB_CHAIN_ID as ChainId, token: HUB_CANONICAL_TOKEN.WETH }
      const nativeEscrow = (dest: IDestination): boolean => 'inKind' in destination && isAddressEqual(dest.token, PROTOCOL.nativeToken)
      const listedDestination = (d: IDestination): boolean =>
        destinations.some(x => x.chainId === d.chainId && isAddressEqual(x.token, d.token))
      const pickedPath: IStream<IStoredPath | null> = merge(
        constant(null, selectSource),
        sampleMap(
          (s: SourceRef, t: ISwapTargetOption) => ({ source: { chainId: s.chainId, address: s.address }, dest: { chainId: t.chainId, address: t.id } }),
          selectedSourceRef,
          pickDestination
        )
      )
      const persistedPath: IStream<IStoredPath | null> = op(
        uiStorage.replayWrite<IStoredPath | null>(
          editorChoiceKey(walletAccount.address, `depositDestination:${'choose' in destination ? destination.scope : 'fixed'}`), null,
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
      const draftHeldForm: IStream<IDestination> = op(
        draftStream,
        filter((d): d is IDepositDraft => d?.toEscrow === true),
        map(d =>
          BigInt(d.deposit.chainId) === d.deposit.destinationChainId
            ? { chainId: d.deposit.chainId, token: d.deposit.inputToken }
            : { chainId: Number(d.deposit.destinationChainId) as ChainId, token: d.deposit.outputToken }
        )
      )
      const chosenDestination: IStream<IDestination | null> = state()(merge(livePick, savedDestination, draftHeldForm))
      const sourcePlan: IStream<{ source: SourceRef; dest: IDestination }> = op(
        combine({ source: selectedSourceRef, chosen: chosenDestination }),
        map(p => ({
          source: p.source,
          dest:
            'choose' in destination
              ? p.chosen !== null && listedDestination(p.chosen)
                ? p.chosen
                : (destinations.find(d => !isSwapTo(p.source, d)) ?? hubWeth)
              : 'inKind' in destination
                ? { chainId: p.source.chainId, token: p.source.routeToken }
                : { chainId: destination.chainId, token: destination.token }
        })),
        state()
      )
      const inputPrice: IStream<Promise<bigint | null>> = op(selectedSourceRef, switchMap(priceForSource), answerState)
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
      const inputFeeMap: IStream<IRelayFeeQuote | null> = map(
        f => (f.status === PromiseStatus.DONE ? f.value : null),
        inputFeeQuery
      )
      const readOf = (s: PromiseState<bigint>): IBalanceRead | null =>
        s.status === PromiseStatus.DONE ? s.value : s.status === PromiseStatus.ERROR ? { error: s.error } : null
      const spendsNative = (p: { source: SourceRef; dest: IDestination }): boolean =>
        nativeEscrow(p.dest) || isAddressEqual(p.source.address, PROTOCOL.nativeToken) || fusedOf(p.source)
      const selectedReads: IStream<Pick<IWalletBalance, 'shown' | 'fresh'>> = op(
        sourcePlan,
        map(p => (nativeEscrow(p.dest) ? balanceOf(p.source.chainId, PROTOCOL.nativeToken) : spendableOf(p.source))),
        state()
      )
      const selectedBalance: IStream<IBalanceRead | null> = op(
        selectedReads,
        switchMap(read => op(read.fresh, promiseState, map(readOf))),
        state()
      )
      const selectedNative: IStream<IBalanceRead | null> = op(
        sourcePlan,
        switchMap(p => (spendsNative(p) ? op(balanceOf(p.source.chainId, PROTOCOL.nativeToken).fresh, promiseState, map(readOf)) : just(null))),
        state()
      )
      const selectedWrapped: IStream<IBalanceRead | null> = op(
        sourcePlan,
        switchMap(p => (fusedOf(p.source) && !nativeEscrow(p.dest) ? op(balanceOf(p.source.chainId, p.source.address).fresh, promiseState, map(readOf)) : just(null))),
        state()
      )

      const routeCalldataLength: IStream<bigint> = op(
        selectedRoute,
        filter(r => r.plan !== null || r.error !== null),
        map(r => (r.plan === null ? 0n : routeCalldataBytes(r.plan.route))),
        skipRepeats,
        start(0n)
      )
      const relayFee: IStream<bigint | null> = op(
        combine({ sourcePlan, inputFeeMap, calldata: routeCalldataLength }),
        map(p => {
          if (isPlainTo(p.sourcePlan.source, p.sourcePlan.dest)) return 0n
          if (p.inputFeeMap === null) return null
          return p.inputFeeMap('depositAcross', false, 0n, TYPICAL_SUBCALL_GAS, p.calldata)
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
            balance: null,
            shown: p.read.shown,
            decimals: source.decimals,
            price: priceForSource(source)
          }
        },
        combine({ sel: sourceSelection, read: selectedReads })
      )

      const optionList: IStream<readonly ITokenInputOption[]> = map(
        p =>
          p.stored.map(({ source, balance }) => ({
            symbol: source.symbol,
            chainId: source.chainId,
            address: source.address,
            token: source.routeToken,
            balance,
            shown: spendableOf(source).shown,
            decimals: source.decimals,
            price: priceForSource(source),
            selected: source.chainId === p.sel.chainId && isAddressEqual(source.address, p.sel.address)
          })),
        combine({ stored, sel: sourceSelection })
      )

      const sliderAmount: IStream<bigint> = op(
        sampleMap((balance: IBalanceRead | null, pct: number) => (typeof balance !== 'bigint' ? null : scaleByPercent(balance, pct)), selectedBalance, sliderPercent),
        filterNull
      )
      const walletGasPrice: IStream<PromiseState<bigint>> = op(
        selectedSourceRef,
        map(s => resolveDispatchChainId(s.chainId)),
        skipRepeats,
        switchMap(chainId => op(just(context.getChainGasPrice(chainId, DISPLAY_QUOTE_TTL_MS)), promiseState)),
        state()
      )
      const maxAmount: IStream<bigint> = op(
        sampleMap(
          p => {
            if (p.fee === null || typeof p.bal !== 'bigint') return null
            const native = spendsNative(p.sp) ? p.native : 0n
            if (typeof native !== 'bigint') return null
            const budget = p.gas.status === PromiseStatus.DONE ? p.gas.value * WALLET_GAS_BUDGET : native
            const spendable = p.bal - (budget < native ? budget : native)
            return spendable > p.fee ? spendable : 0n
          },
          combine({ bal: selectedBalance, native: selectedNative, fee: relayFee, gas: walletGasPrice, sp: sourcePlan }),
          clickMax
        ),
        filterNull
      )
      const value: IStream<bigint> = op(
        merge(
          inputAmount,
          sliderAmount,
          maxAmount,
          constant(0n, selectSource),
          preset === null || presetSource === null
            ? op(
                draftStream,
                map(d => (d === null ? 0n : d.deposit.inputAmount))
              )
            : just(preset.amount)
        ),
        state(0n)
      )

      const focused = createFocusState(focusEvt, blurEvt)

      const bridgeQuoteInput: IStream<bigint | null> = op(
        combine({ value, sourcePlan, feeMap: inputFeeMap }),
        map(p => {
          if (isPlainTo(p.sourcePlan.source, p.sourcePlan.dest)) return p.value
          if (p.feeMap === null) return null
          const fee = p.feeMap('depositAcross', false, 0n, TYPICAL_SUBCALL_GAS, QUOTE_CALLDATA_BYTES)
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
            outputToken: dest.token,
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
          if (params.balance !== null && typeof params.balance !== 'bigint') {
            return `Wallet ${params.source.symbol} balance on ${chainName(params.source.chainId)} could not be read: ${formatThrownError(params.balance.error)}`
          }
          if (params.feeQuote.status === PromiseStatus.ERROR && !isPlainTo(params.source, params.dest)) return `Relay fee unavailable: ${formatThrownError(params.feeQuote.error)}`
          if (params.value === 0n) return null
          if (typeof params.balance === 'bigint' && params.value > params.balance && nativeEscrow(params.dest)) {
            return `${readableTokenAmountLabel({ decimals: params.source.decimals, symbol: params.source.symbol }, params.balance)} available, held as WETH in escrow. Pick WETH to use your wrapped balance`
          }
          if (typeof params.balance === 'bigint' && params.value > params.balance) {
            return `Exceeds wallet balance ${readableTokenAmountLabel({ decimals: params.source.decimals, symbol: params.source.symbol }, params.balance)}`
          }
          const needsQuote = !isPlainTo(params.source, params.dest)
          const escrowing = 'inKind' in destination
          if (needsQuote) {
            if (params.feeQuote.status === PromiseStatus.DONE) {
              const fee = params.feeQuote.value('depositAcross', false, 0n, TYPICAL_SUBCALL_GAS, QUOTE_CALLDATA_BYTES)
              if (params.value <= fee) {
                return `Too small to cover its ${readableTokenAmountLabel({ decimals: params.source.decimals, symbol: params.source.symbol }, fee)} relay fee`
              }
            }
            if (params.route.error) return params.route.error
            if (params.route.limitError) return params.route.limitError
          }
          const token = getTokenDescription(params.dest.chainId, params.dest.token)
          if (stakeFloor !== undefined) {
            const floor = stakeFloor(params.dest.chainId, params.dest.token)
            const where = escrowing ? 'in escrow' : 'in your account'
            if (!needsQuote) {
              if (params.value < floor) return `A first fund needs at least ${readableTokenAmountLabel(token, floor)} ${where} before its key can sign`
            } else if (params.route.plan !== null && params.route.plan.outputAmount < floor) {
              return `A first fund needs at least ${readableTokenAmountLabel(token, floor)} ${where} before its key can sign, so this route must deliver at least that`
            }
          }
          return null
        },
        combine({
          balance: selectedBalance,
          value,
          route: selectedRoute,
          source: selectedSourceRef,
          dest: map(q => q.dest, sourcePlan),
          feeQuote: inputFeeQuery
        })),
        state(null)
      )



      const disabled: IStream<boolean> = op(
        combine({
          alert,
          value,
          route: selectedRoute,
          sel: sourceSelection,
          existing: draftStream,
          feeMap: inputFeeMap,
          sourcePlan,
          balance: selectedBalance,
          open: gate ?? just(true),
          zero: raisesAtZero ?? just(false)
        }),
        map(p => {
          if (!p.open) return true
          if (p.value === 0n) return !p.zero
          if (typeof p.balance !== 'bigint') return true
          if (p.alert !== null) return true
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
          if (p.feeMap === null) return true
          if (p.value <= p.feeMap('depositAcross', false, 0n, TYPICAL_SUBCALL_GAS, 0n)) return true
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
        balance: IBalanceRead | null
        feeMap: IRelayFeeQuote | null
        wrapped: IBalanceRead | null
      }> = combine({
        value,
        source: map(q => q.source, sourcePlan),
        dest: map(q => q.dest, sourcePlan),
        route: selectedRoute,
        balance: selectedBalance,
        feeMap: inputFeeMap,
        wrapped: selectedWrapped
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
          p => (typeof p.bal === 'bigint' && p.bal > 0n ? Number((p.amt * 10000n) / p.bal) / 10000 : 0),
          combine({ amt: value, bal: selectedBalance })
        )
      )
      const hasError: IStream<boolean> = map(a => a !== null, alert)
      const sliderDisabled: IStream<boolean> = start(true, map(b => typeof b !== 'bigint' || b === 0n, selectedBalance))
      const $percentSlider = $editorPercentSlider({
        value: sliderValue,
        ariaLabel: 'Deposit percentage',
        disabled: sliderDisabled,
        error: hasError,
        $container: $overlaySliderContainer
      })({ change: sliderPercentTether() })

      const amountUsd: IStream<Promise<string> | string> = amountUsdLabel(value, inputPrice)
      const $alert = $noteSlot(
        switchMap(
          msg => (msg ? $noteTooltip($text(msg)) : $node(style({ color: palette.foreground, fontSize: text.xs }))($intermediateText(amountUsd))),
          alert
        )
      )

      const $maxButton = $maxAmountButton(value, map(b => (typeof b === 'bigint' ? b : null), selectedBalance), clickMaxTether(nodeEvent('click')))

      const $topSection = $TokenSelectFlow({
        hideBalances,
        selection: map(
          s => ({
            chainId: s.chainId,
            address: isAddressEqual(s.address, wrappedNativeAddressOf(s.chainId)) ? PROTOCOL.nativeToken : s.address
          }),
          sourceSelection
        ),
        value: selectedOption,
        optionList,
        ...('chainId' in destination ? { destinationChainId: destination.chainId } : {}),
        listLabel: 'Select deposit token',
        $balanceLead: $icon({ $content: $wallet, viewBox: '0 0 32 32', fill: palette.foreground, size: '12px', svgOps: style({ display: 'block' }) }),
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
      const $footer = $DraftSave({
        target:
          'choose' in destination
            ? {
                value: map(p => toTarget(p.dest), sourcePlan),
                optionList: just(destinations.map(toTarget)),
                source: map(s => ({ chainId: s.chainId, symbol: displaySymbolOf(s.chainId, s.routeToken) }), selectedSourceRef)
              }
            : 'inKind' in destination
              ? {
                  value: map(p => toTarget(p.dest), sourcePlan),
                  optionList: map(s => [toTarget({ chainId: s.chainId, token: s.routeToken })], selectedSourceRef),
                  source: map(s => ({ chainId: s.chainId, symbol: displaySymbolOf(s.chainId, s.routeToken) }), selectedSourceRef)
                }
              : null,
        request,
        plainBridge: 'inKind' in destination,
        inputFee: map(p => (p.feeMap === null ? null : { gross: p.value, quote: p.feeMap, kind: 'depositAcross' as const }), combine({ value, feeMap: inputFeeMap })),
        active: map(p => !isPlainTo(p.source, p.dest), sourcePlan),
        alert,
        disabled
      })({ select: pickDestinationTether(), selecting: selectingDestTether(), selectRoute: selectedRouteTether(), save: clickAddDraftTether() })

      const selecting: IStream<boolean> = map(p => p.source || p.dest, combine({ source: selectingSource, dest: start(false, selectingDest) }))
      const hiddenWhile = (flag: IStream<boolean>) =>
        styleBehavior(map(s => (s ? { display: 'none' } : { display: 'contents' }), flag))

      return [
        $column(spacing.default, style({ width: '394px', maxWidth: '100%' }))(
          $node(style({ display: 'contents' }), hiddenWhile(selectingDest))($topSection),
          $node(style({ display: 'contents' }), hiddenWhile(selecting))(
            $overlaySliderRow($percentSlider)
          ),
          ...($note === undefined ? [] : [$node(style({ display: 'contents' }), hiddenWhile(selecting))($note)]),
          $node(style({ display: 'contents' }), hiddenWhile(selectingSource))($footer)
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
              const destToken = dest.token
              if (base.value === 0n) {
                return {
                  kind: 'deposit',
                  id: 'deposit',
                  source: 'wallet',
                  deposit: {
                    chainId,
                    inputToken: plain ? destToken : source.routeToken,
                    outputToken: nativeEscrow(dest) ? wrappedNativeAddressOf(chainId) : destToken,
                    inputAmount: 0n,
                    destinationChainId: BigInt(dest.chainId),
                    routeInput: 0n,
                    outputAmount: 0n,
                    route: null,
                    fillDeadline: 0
                  },
                  nativeValue: 0n,
                  expectedOutput: 0n,
                  toEscrow: 'inKind' in destination
                }
              }
              const signed = plan === null || plain ? null : plan
              const route = signed === null ? null : signed.route
              const wnt = wrappedNativeAddressOf(chainId)
              const fused = isAddressEqual(source.address, wnt)
              const walletWrapped = nativeEscrow(dest) ? 0n : fused ? base.wrapped : base.value
              if (walletWrapped === null) throw new Error(`the wallet's wrapped balance on chain ${chainId} is unknown; refresh and retry`)
              if (typeof walletWrapped !== 'bigint') throw new Error(`the wallet's wrapped balance on chain ${chainId} could not be read: ${formatThrownError(walletWrapped.error)}`)
              const walletPull = walletWrapped < base.value ? walletWrapped : base.value
              const relayFee =
                route === null || base.feeMap === null ? 0n : base.feeMap('depositAcross', false, 0n, routeSubcallGas(route), routeCalldataBytes(route))
              if (base.value <= relayFee) {
                throw new Error(
                  `this deposit of ${base.value} does not cover its ${relayFee} relay fee; raise the amount`
                )
              }
              const common = {
                chainId,
                inputToken: plain ? destToken : source.routeToken,
                outputToken: signed === null ? (nativeEscrow(dest) ? wrappedNativeAddressOf(chainId) : destToken) : signed.outputToken,
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
                expectedOutput: plan === null || route === null ? base.value : plan.expectedOutputAmount,
                toEscrow: 'inKind' in destination
              }
            })
          )
          const arrival: IStream<IArrival> = map(p => {
            const chainId = p.sp.dest.chainId
            const token = p.sp.dest.token
            if (isPlainTo(p.sp.source, p.sp.dest)) return { chainId, token: nativeEscrow(p.sp.dest) ? wrappedNativeAddressOf(chainId) : token, amount: p.value }
            if (p.route.plan === null) return { chainId, token, amount: 0n }
            return { chainId, token: p.route.plan.outputToken, amount: p.route.plan.expectedOutputAmount }
          }, combine({ value, sp: sourcePlan, route: selectedRoute }))
          return { changeDraft, arrival }
        })()
      ]
    }
  )
