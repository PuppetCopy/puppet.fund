import { PUPPET_CONTRACT_MAP } from '@puppet/contracts'
import { HUB_CHAIN_ID, TOKEN_ID } from '@puppet/contracts/const'
import type { IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import { predictDepositRoute } from '@puppet/sdk/account'
import {
  type IBridgeInput,
  type IDepositRoute,
  resolveDispatchChainId,
  resolveDispatchNetwork
} from '@puppet/sdk/attestation'
import { formatThrownError } from '@puppet/sdk/compact'
import { ADDRESS_ZERO, CHAIN_LIST, type ChainId } from '@puppet/sdk/const'
import { readableTokenAmount, readableTokenAmountLabel } from '@puppet/sdk/core'
import { getTokenDescription } from '@puppet/sdk/gmx'
import {
  fetchDepositRouteBalance,
  type ISubaccountState,
  type ITokenRegistryMap,
  indexerBlock,
  type RelayFeeMap,
  randomNonce,
  tokenInfoFor
} from '@puppet/sdk/state'
import { getPublicClient } from '@wagmi/core'
import {
  awaitPromises,
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
  skipRepeats,
  skipRepeatsWith,
  start,
  switchLatest,
  switchMap,
  switchPromises,
  take,
  until
} from 'aelea/stream'
import { type IBehavior, multicast, state } from 'aelea/stream-extended'
import { $element, $node, $text, attr, component, type INode, nodeEvent, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { type Address, erc20Abi, formatUnits, type Hex } from 'viem'
import { readContract } from 'viem/actions'
import {
  $ButtonSecondary,
  $DropSelect,
  $defaultDropdownContainer,
  $defaultSliderContainer,
  $icon,
  $intermediateText,
  $labeledValue,
  $loadingValue,
  $noteTooltip,
  $Slider,
  $TokenAmountInput,
  $wallet,
  NOTE_TOOLTIP_HEIGHT,
  text
} from '@/ui-components'
import { uiStorage } from '@/ui-storage'
import { depositSourceKey, type IDepositSource } from '../../app/localStoreSchema.js'
import { $tokenWithChainBadge, chainName } from '../../common/$chain.js'
import { fetchSwapQuote, type ISwapQuote } from '../../io/bridge/swapQuote.js'
import { fetchTokenBalances } from '../../io/chain/balances.js'
import * as context from '../../io/context.js'
import { formatUsd, latestPriceMap, priceFor } from '../../io/gmx/priceFeed.js'
import { homePublicClient, type IConnectedWallet, wagmi } from '../../wallet/index.js'
import { walletChainId as walletChainIdStream } from '../../wallet/state.js'
import { $optionRow, $tokenIconBySymbol, decorateOptionList, type ITokenInputOption } from './$tokenOption.js'
import type { IDepositDraft, IDepositStep } from './draft.js'
import { DEFAULT_DEADLINE_SEC, walletClientForChain } from './runner/_shared.js'

export interface I$DepositEditor {
  accountState: ISubaccountState
  baseTokenId: Hex
  tokenRegistry: ITokenRegistryMap
  walletAccount: IConnectedWallet
  lateBindDerivation?: Omit<IAccountLib__AccountInitParams, 'signer'>
  existingDraft: IStream<IDepositDraft | null>
}

export const $DepositEditor = ({
  accountState,
  baseTokenId,
  tokenRegistry: _tokenRegistry,
  walletAccount,
  lateBindDerivation,
  existingDraft
}: I$DepositEditor) =>
  component(
    (
      [clickAddDraft, clickAddDraftTether]: IBehavior<PointerEvent>,
      [selectOption, selectOptionTether]: IBehavior<ITokenInputOption>,
      [inputAmount, inputAmountTether]: IBehavior<bigint>,
      [focusEvt, focusEvtTether]: IBehavior<FocusEvent>,
      [blurEvt, blurEvtTether]: IBehavior<FocusEvent>,
      [sliderPercent, sliderPercentTether]: IBehavior<number>,
      [clickMax, clickMaxTether]: IBehavior<INode<HTMLButtonElement>, MouseEvent>,
      [enterPress, enterPressTether]: IBehavior<KeyboardEvent>
    ) => {
      const tokenRegistry = _tokenRegistry
      const outputToken = tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, baseTokenId).token
      const recipient = accountState.account
      const outputTokenDesc = getTokenDescription(outputToken)
      const relayFeeMapQuery: IStream<RelayFeeMap> = context.relayFeeMapForToken(baseTokenId)

      type SourceRef = {
        chainId: number
        address: Address
        symbol: string
        routeTokenId: Hex
        routeToken: Address
        decimals: number
        isNative: boolean
        isSwap: boolean
      }
      const sources: SourceRef[] = CHAIN_LIST.flatMap(chain => {
        const chainMap = tokenRegistry.get(chain.id as ChainId)
        if (!chainMap) return []
        const entries: SourceRef[] = []
        const pushSource = (
          address: Address,
          sym: string,
          routeTokenId: Hex,
          routeToken: Address,
          decimals: number,
          isNative: boolean
        ) => {
          const isSwap = routeTokenId !== baseTokenId
          if (isSwap && (chain.id === HUB_CHAIN_ID || !context.relayFeeMapByToken.has(routeTokenId))) return
          entries.push({
            chainId: chain.id,
            address,
            symbol: sym,
            routeTokenId,
            routeToken,
            decimals,
            isNative,
            isSwap
          })
        }
        for (const [tid, info] of chainMap) {
          const desc = getTokenDescription(info.hubToken)
          pushSource(info.token, desc.symbol, tid, info.token, desc.decimals, false)
        }
        if (chain.nativeCurrency.symbol === 'ETH') {
          const weth = chainMap.get(TOKEN_ID.WETH)
          if (weth) pushSource(ADDRESS_ZERO, chain.nativeCurrency.symbol, TOKEN_ID.WETH, weth.token, 18, true)
        }
        return entries
      })

      const balancesFuture = fetchTokenBalances(
        walletAccount.address,
        sources.map(s => ({ chainId: s.chainId, tokenAddress: s.address })),
        walletAccount.walletClient
      )
      const balanceQuery = op(just(balancesFuture), awaitPromises, state())

      const draftStream: IStream<IDepositDraft | null> = existingDraft

      const draftSource = (d: IDepositDraft): IDepositSource | null => {
        const wallet = d.inputSteps.find(s => s.kind === 'walletDeposit' || s.kind === 'walletDepositWnt')
        if (wallet) {
          const address = wallet.kind === 'walletDepositWnt' ? ADDRESS_ZERO : wallet.input.token
          return { chainId: wallet.input.chainId, address }
        }
        const bridge = d.inputSteps.find(s => s.kind === 'bridge')
        if (bridge && bridge.kind === 'bridge') {
          const chainId = Number(bridge.input.chainId)
          const erc = tokenRegistry.get(chainId as ChainId)?.get(baseTokenId)?.token
          return erc ? { chainId, address: erc } : null
        }
        return null
      }

      const selectSource: IStream<IDepositSource> = op(
        selectOption,
        filter((opt: ITokenInputOption) => !opt.disabled),
        map(opt => {
          void walletClientForChain(walletAccount.walletClient, opt.chainId).catch(err =>
            console.error('[deposit] wallet chain switch failed', err)
          )
          return { chainId: opt.chainId, address: opt.address }
        }),
        multicast
      )
      const isValidSource = (s: IDepositSource): boolean =>
        sources.some(src => src.chainId === s.chainId && src.address === s.address)

      // The replayWrite stream must stay subscribed for the editor's whole life (via the
      // savedSource merge below), otherwise its write half is disposed before the user
      // ever selects and the choice never persists.
      const persistedSource: IStream<IDepositSource | null> = uiStorage.replayWrite(
        depositSourceKey(walletAccount.address),
        filter(isValidSource, selectSource)
      )
      const savedSource: IStream<IDepositSource> = filter(
        (s): s is IDepositSource => s !== null && isValidSource(s),
        persistedSource
      )
      // Mount-time chain, used only to pick the initial source default below.
      const mountWalletChainId = walletAccount.walletClient.chain?.id
      const walletChainSource =
        mountWalletChainId !== undefined ? (sources.find(s => s.chainId === mountWalletChainId) ?? null) : null
      const fallbackSource: IDepositSource = walletChainSource
        ? { chainId: walletChainSource.chainId, address: walletChainSource.address }
        : { chainId: sources[0].chainId, address: sources[0].address }
      const initialSource: IStream<IDepositSource> = op(
        combine({ saved: persistedSource, balances: balanceQuery }),
        filter(p => p.saved === null || !isValidSource(p.saved)),
        map(p => {
          if (walletChainSource) return { chainId: walletChainSource.chainId, address: walletChainSource.address }
          if (p.balances === null) return fallbackSource
          const top = [...p.balances].sort((a, b) => (b.balance > a.balance ? 1 : b.balance < a.balance ? -1 : 0))[0]
          const match = top ? sources.find(s => s.chainId === top.chainId && s.address === top.tokenAddress) : null
          return match ? { chainId: match.chainId, address: match.address } : fallbackSource
        }),
        take(1),
        until(selectOption)
      )
      const draftSourceStream: IStream<IDepositSource> = op(
        draftStream,
        map(d => (d ? draftSource(d) : null)),
        filter((s): s is IDepositSource => s !== null && isValidSource(s))
      )
      const sourceSelection: IStream<IDepositSource> = state(
        fallbackSource,
        merge(selectSource, savedSource, initialSource, draftSourceStream)
      )
      const chainSelection: IStream<number> = op(
        sourceSelection,
        map(s => s.chainId)
      )

      const findSource = (chainId: number, address: Address): SourceRef =>
        sources.find(s => s.chainId === chainId && s.address === address) ?? sources[0]
      const priceForSource = (s: SourceRef): IStream<bigint | null> =>
        priceFor(tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, s.routeTokenId).token)

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
      const isSwapStream: IStream<boolean> = map(s => s.isSwap, selectedSourceRef)
      const inputPrice: IStream<bigint | null> = op(selectedSourceRef, switchMap(priceForSource), state())
      const inputFeeMap: IStream<RelayFeeMap> = op(
        selectedSourceRef,
        switchMap(s => context.relayFeeMapForToken(s.routeTokenId)),
        state()
      )
      const feeMapByTokenId: IStream<Record<string, RelayFeeMap>> = combine(
        Object.fromEntries([...context.relayFeeMapByToken.keys()].map(tid => [tid, context.relayFeeMapForToken(tid)]))
      )
      const sourceRelayFee = (s: SourceRef, fees: Record<string, RelayFeeMap>): bigint => {
        const feeMap = fees[s.routeTokenId]
        if (!feeMap) return 0n
        return s.chainId === HUB_CHAIN_ID && !s.isSwap ? feeMap.recognize.relayFee : feeMap.bridge.relayFee
      }

      const selectedBalance: IStream<bigint | null> = op(
        combine({ list: balanceQuery, sel: sourceSelection }),
        map(p => {
          if (p.list === null) return null
          return p.list.find(b => b.chainId === p.sel.chainId && b.tokenAddress === p.sel.address)?.balance ?? 0n
        }),
        state()
      )

      const tokenPrice = priceFor(outputToken)
      const usdText = (s: SourceRef, balance: bigint | null): IStream<string> =>
        balance === null ? just('-') : map(price => formatUsd(balance, price), priceForSource(s))

      const relayFee: IStream<bigint> = map(
        p =>
          p.chainId === HUB_CHAIN_ID && !p.isSwap ? p.baseFeeMap.recognize.relayFee : p.inputFeeMap.bridge.relayFee,
        combine({ chainId: chainSelection, baseFeeMap: relayFeeMapQuery, inputFeeMap, isSwap: isSwapStream })
      )

      const walletAllowance: IStream<bigint> = op(
        sourceSelection,
        switchMap(async sel => {
          if (sel.address === ADDRESS_ZERO) return 0n
          const publicClient =
            sel.chainId === HUB_CHAIN_ID ? homePublicClient : getPublicClient(wagmi, { chainId: sel.chainId })
          if (!publicClient) return 0n
          try {
            return await readContract(publicClient, {
              address: sel.address,
              abi: erc20Abi,
              functionName: 'allowance',
              args: [walletAccount.address, PUPPET_CONTRACT_MAP.WalletDepositModule.address]
            })
          } catch {
            return 0n
          }
        }),
        state()
      )

      const DUST_USD_30DEC = 10n ** 28n
      const transientRouteBalance: IStream<bigint> = op(
        sourceSelection,
        switchMap(async sel => {
          const token = tokenInfoFor(tokenRegistry, sel.chainId as ChainId, baseTokenId).token
          const publicClient =
            sel.chainId === HUB_CHAIN_ID ? homePublicClient : getPublicClient(wagmi, { chainId: sel.chainId })
          if (!publicClient) return 0n
          try {
            return await fetchDepositRouteBalance(publicClient, token, recipient)
          } catch {
            return 0n
          }
        }),
        state()
      )
      const depositSurplus: IStream<bigint> = map(
        p => {
          if (p.isSwap || p.raw === 0n || p.price === null) return 0n
          return p.raw * p.price < DUST_USD_30DEC ? 0n : p.raw
        },
        combine({ raw: transientRouteBalance, price: tokenPrice, isSwap: isSwapStream })
      )

      const toOption = (source: SourceRef, balance: bigint | null): ITokenInputOption => ({
        symbol: source.symbol,
        chainId: source.chainId,
        address: source.address,
        tokenId: source.routeTokenId,
        balance,
        decimals: source.decimals,
        usdValue: usdText(source, balance)
      })
      const selectedOption: IStream<ITokenInputOption> = map(
        p => toOption(findSource(p.sel.chainId, p.sel.address), p.balance),
        combine({ sel: sourceSelection, balance: selectedBalance })
      )

      const optionList: IStream<readonly ITokenInputOption[]> = map(
        p =>
          decorateOptionList(
            sources.map(source => {
              const balance =
                p.list === null
                  ? null
                  : (p.list.find(b => b.chainId === source.chainId && b.tokenAddress === source.address)?.balance ?? 0n)
              const disabled = balance !== null && balance <= sourceRelayFee(source, p.fees)
              return { ...toOption(source, balance), disabled }
            }),
            p.sel,
            opt => p.prices[tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, opt.tokenId).token]?.price ?? null,
            baseTokenId
          ),
        combine({ list: balanceQuery, sel: sourceSelection, fees: feeMapByTokenId, prices: latestPriceMap })
      )

      const sliderAmount: IStream<bigint> = sampleMap(
        (opt, pct) => {
          const bp = BigInt(Math.round(Math.max(0, Math.min(1, pct)) * 10000))
          return ((opt.balance ?? 0n) * bp) / 10000n
        },
        selectedOption,
        sliderPercent
      )
      const maxAmount: IStream<bigint> = sampleMap(opt => opt.balance ?? 0n, selectedOption, clickMax)
      const value: IStream<bigint> = op(
        merge(
          inputAmount,
          sliderAmount,
          maxAmount,
          constant(0n, selectSource),
          op(
            draftStream,
            map(d => (d ? d.inputAmount.amount : 0n))
          )
        ),
        state(0n)
      )

      const focused: IStream<boolean> = state(false, merge(constant(true, focusEvt), constant(false, blurEvt)))

      type QuoteStatus =
        | { status: 'idle'; quote: ISwapQuote | null }
        | { status: 'error'; quote: null; message: string }

      const bridgeAmountStream: IStream<bigint> = map(
        p => {
          if (p.isSwap) return p.value
          if (p.value === 0n) return p.surplus
          return p.surplus + p.value + p.feeMap.recognize.relayFee
        },
        combine({ value, surplus: depositSurplus, feeMap: relayFeeMapQuery, isSwap: isSwapStream })
      )

      const bridgeQuoteInput: IStream<bigint> = op(
        combine({ amount: bridgeAmountStream, feeMap: relayFeeMapQuery, inputFeeMap, isSwap: isSwapStream }),
        map(p => {
          const fee = p.isSwap ? p.inputFeeMap.bridge.relayFee : p.feeMap.bridge.relayFee
          return p.amount > fee ? p.amount - fee : 0n
        }),
        skipRepeats
      )

      // Quotes fire only on user-driven changes (source, amount, sweep surplus); the
      // fee-adjusted bridge input is SAMPLED at trigger time as a gas snapshot.
      const quoteTrigger = op(
        combine({ source: selectedSourceRef, value, surplus: depositSurplus }),
        skipRepeatsWith(
          (a, b) =>
            a.source.chainId === b.source.chainId &&
            a.source.address === b.source.address &&
            a.value === b.value &&
            a.surplus === b.surplus
        )
      )
      const quoteParams = debounce(
        200,
        sampleMap((bridgeInput, t) => ({ source: t.source, bridgeInput }), bridgeQuoteInput, quoteTrigger)
      )
      const quoteFetch: IStream<Promise<QuoteStatus>> = op(
        map(async (params): Promise<QuoteStatus> => {
          const source = params.source
          if (source.chainId === HUB_CHAIN_ID && !source.isSwap) return { status: 'idle', quote: null }
          const bridgeInput = params.bridgeInput
          if (bridgeInput <= 0n) return { status: 'idle', quote: null }
          try {
            const quote = await fetchSwapQuote({
              originChainId: source.chainId,
              destinationChainId: HUB_CHAIN_ID,
              inputToken: source.routeToken,
              outputToken,
              inputAmount: bridgeInput,
              route: predictDepositRoute(recipient)
            })
            return { status: 'idle', quote }
          } catch (err) {
            console.error('[$DepositEditor.quoteFetch] fetchSwapQuote failed', err)
            return { status: 'error', quote: null, message: formatThrownError(err) }
          }
        }, quoteParams),
        state()
      )
      const quoteQuery: IStream<QuoteStatus> = multicast(switchPromises(quoteFetch))

      const accountParams: IAccountLib__AccountInitParams = {
        user: accountState.user ?? walletAccount.address,
        signer: accountState.signer
      }

      // Leaf-local validation only: input-shape concerns the parent has no view into.
      // Protocol-level checks (verifyTokenAndCap, verifyRelayFee, verifyBridgeHubInput, etc.)
      // run in $TokenBalanceEditor against the live preview and arrive via parentAlert.
      const validation: IStream<Promise<string | null>> = map(
        async (params): Promise<string | null> => {
          if (params.value + params.surplus === 0n) return null
          if (params.walletChain !== params.chainId) {
            return `Switch your wallet to ${chainName(params.chainId)}`
          }
          if (params.balance !== null && params.value > params.balance) {
            return `Exceeds wallet balance ${readableTokenAmountLabel({ decimals: params.source.decimals, symbol: params.source.symbol }, params.balance)}`
          }
          const bridgeAmount = params.bridgeAmount
          const needsQuote = params.chainId !== HUB_CHAIN_ID || params.source.isSwap
          if (needsQuote && bridgeAmount > 0n && params.q.status === 'error') {
            return params.q.message
          }
          if (needsQuote && bridgeAmount > 0n && params.q.quote) {
            if (params.q.quote.isAmountTooLow) {
              return `Below bridge minimum ${readableTokenAmount(outputTokenDesc, params.q.quote.limits.minDeposit)}`
            }
            if (bridgeAmount > params.q.quote.limits.maxDeposit) {
              return `Exceeds bridge max ${readableTokenAmount(outputTokenDesc, params.q.quote.limits.maxDeposit)}`
            }
          }
          return null
        },
        combine({
          balance: selectedBalance,
          value,
          q: quoteQuery,
          chainId: chainSelection,
          surplus: depositSurplus,
          bridgeAmount: bridgeAmountStream,
          source: selectedSourceRef,
          // Live wallet chain so "Switch your wallet to X" clears the instant the
          // user switches in their wallet (walletQuery dedupes chain changes out).
          walletChain: start(mountWalletChainId ?? null, walletChainIdStream)
        })
      )

      const alert: IStream<string | null> = op(validation, awaitPromises, state(null))

      const bridgeFeeText: IStream<Promise<string>> = switchMap(
        p => {
          const total = p.value + p.surplus
          if (total === 0n) return just(Promise.resolve('-'))
          return map(async pQuote => {
            const s = await pQuote
            if (!s.quote || p.inPrice === null || p.outPrice === null) return '-'
            const fee =
              Number(formatUnits(total * p.inPrice, 30)) - Number(formatUnits(s.quote.outputAmount * p.outPrice, 30))
            const feeText = fee <= 0 ? '$0.00' : fee < 0.01 ? '< $0.01' : `$${fee.toFixed(2)}`
            return `${feeText} via ${s.quote.provider}`
          }, quoteFetch)
        },
        combine({ value, surplus: depositSurplus, inPrice: inputPrice, outPrice: tokenPrice })
      )

      const relayFeeText: IStream<string> = map(
        ({ fee, price }) => formatUsd(fee, price),
        combine({ fee: relayFee, price: inputPrice })
      )

      const $surplusInline = switchMap(
        p =>
          p.surplus > 0n
            ? $labeledValue(
                'Sweep',
                $node(style({ color: palette.positive }))($text(`+${formatUsd(p.surplus, p.price)}`)),
                $node(style({ maxWidth: '220px', fontSize: text.sm, whiteSpace: 'normal' }))(
                  $text(
                    'An earlier deposit was sent but never finished. This step picks those funds up and credits them to your balance along with the new amount.'
                  )
                )
              )
            : empty,
        combine({ surplus: depositSurplus, price: tokenPrice })
      )

      const $relayFeeNode = $text(start('-', relayFeeText))
      const $quoteInline = switchMap(
        s =>
          s.chainId === HUB_CHAIN_ID && !s.isSwap
            ? $column(spacing.small)($labeledValue('Relay fee', $relayFeeNode), $surplusInline)
            : $column(spacing.small)(
                $labeledValue(
                  'Swap fee',
                  switchLatest(
                    map(
                      p => (p.value + p.surplus === 0n ? $node($text('-')) : $intermediateText(bridgeFeeText)),
                      combine({ value, surplus: depositSurplus })
                    )
                  )
                ),
                $labeledValue('Relay fee', $relayFeeNode),
                $surplusInline
              ),
        selectedSourceRef
      )

      const disabled: IStream<boolean> = op(
        combine({
          alert,
          value,
          q: quoteQuery,
          sel: sourceSelection,
          existing: draftStream,
          surplus: depositSurplus,
          feeMap: relayFeeMapQuery,
          isSwap: isSwapStream
        }),
        map(p => {
          if (p.alert !== null) return true
          if (p.value + p.surplus === 0n) return true
          if (
            p.value === 0n &&
            p.sel.chainId === HUB_CHAIN_ID &&
            !p.isSwap &&
            p.surplus <= p.feeMap.recognize.relayFee
          ) {
            return true
          }
          const existingSource = p.existing ? draftSource(p.existing) : null
          if (
            p.existing &&
            p.existing.inputAmount.amount === p.value &&
            (existingSource?.chainId ?? HUB_CHAIN_ID) === p.sel.chainId &&
            (existingSource?.address ?? p.sel.address) === p.sel.address
          ) {
            return true
          }
          if (p.sel.chainId === HUB_CHAIN_ID && !p.isSwap) return false
          return p.q.quote === null
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

      const $field = switchMap(
        dec =>
          $TokenAmountInput({ decimals: dec, valueToShow })({
            inputAmount: inputAmountTether(),
            focus: focusEvtTether(),
            blur: blurEvtTether(),
            enter: enterPressTether()
          }),
        inputDecimals
      )

      const sliderValue: IStream<number> = map(
        p => (p.opt.balance && p.opt.balance > 0n ? Number((p.amt * 10000n) / p.opt.balance) / 10000 : 0),
        combine({ amt: value, opt: selectedOption })
      )
      const hasError: IStream<boolean> = map(a => a !== null, alert)
      const sliderDisabled: IStream<boolean> = map(b => b === null || b === 0n, selectedBalance)
      const $percentSlider = $Slider({
        value: sliderValue,
        step: 0.01,
        orientation: 'horizontal',
        ariaLabel: 'Deposit percentage',
        disabled: sliderDisabled,
        error: hasError,
        motion: { stiffness: 800, damping: 58 },
        $container: $defaultSliderContainer(
          style({ height: '14px', width: '100%', margin: '-26px 0', flexShrink: '0' })
        )
      })({ change: sliderPercentTether() })

      const $picker = $DropSelect({
        $container: $defaultDropdownContainer(style({ alignItems: 'flex-end', flexShrink: '0' })),
        value: selectedOption,
        optionList,
        $valueLabel: map((opt: ITokenInputOption) =>
          $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))(
            $tokenWithChainBadge($tokenIconBySymbol(opt.symbol, '32px'), opt.chainId, 32, 14),
            $column(style({ gap: '1px', minWidth: '0' }))(
              $node(style({ fontWeight: '600', fontSize: text.base, color: palette.message }))($text(opt.symbol)),
              $row(spacing.small, style({ alignItems: 'center', color: palette.foreground, fontSize: text.xs }))(
                $icon({
                  $content: $wallet,
                  viewBox: '0 0 32 32',
                  fill: palette.foreground,
                  size: '12px',
                  svgOps: style({ display: 'block' })
                }),
                opt.usdValue
                  ? $loadingValue(opt.usdValue)
                  : $text(opt.balance === null ? '-' : readableTokenAmount(opt.decimals, opt.balance))
              )
            )
          )
        ),
        $$option: map((opt: ITokenInputOption) => $optionRow(opt))
      })({ select: selectOptionTether() })

      const amountUsd: IStream<string> = map(
        p => (p.amt === 0n ? '' : formatUsd(p.amt, p.price)),
        combine({ amt: value, price: inputPrice })
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
          const ready = p.bal !== null && p.bal > 0n
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
        combine({ amt: value, bal: selectedBalance })
      )

      return [
        $column(spacing.default, style({ minWidth: '380px' }))(
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
              $node(style({ color: palette.foreground, fontSize: text.sm, fontWeight: '500' }))($text('Deposit')),
              $row(spacing.small, style({ alignItems: 'center' }))($field, $maxButton),
              $alert
            ),
            $picker
          ),
          $node(style({ margin: '0 -28px', display: 'flex' }))($percentSlider),

          $row(spacing.small, style({ alignItems: 'center', fontSize: text.sm }))(
            $quoteInline,
            $node(style({ flex: 1 }))(),
            $ButtonSecondary({ disabled, $content: $text('Save') })({ click: clickAddDraftTether() })
          )
        ),
        (() => {
          const previewDraft: IStream<IDepositDraft> = map(
            (params): IDepositDraft => {
              const originChainId = params.source.chainId
              const isHome = originChainId === HUB_CHAIN_ID
              const homeDeployed = accountState.chains.has(HUB_CHAIN_ID)
              const recognizeFee = params.feeMap.recognize.relayFee
              const deployFee = params.feeMap.createPuppetAccount.relayFee
              const bridgeFee = params.feeMap.bridge.relayFee
              // When the hub puppet isn't deployed yet, the hub-side recognize is folded into
              // `createPuppetAccount` (with `initialDepositAmount`). Use its relay fee for sizing.
              const homeRecognizeFee = homeDeployed ? recognizeFee : deployFee
              const homeBlockNumber = indexerBlock(
                params.indexerHealth,
                resolveDispatchNetwork(resolveDispatchChainId(undefined))
              )
              const deadline = BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC)
              const id = `deposit:${recipient}`
              const account = recipient

              if (params.source.isSwap) {
                const swapToken = params.source.routeToken
                const inputAmount = params.value
                const quote = params.q.quote
                const swapOutputAmount = quote?.outputAmount ?? 0n
                const originBlockNumber = indexerBlock(
                  params.indexerHealth,
                  resolveDispatchNetwork(resolveDispatchChainId(originChainId))
                )
                const swapWalletStep:
                  | { kind: 'walletDeposit'; input: IDepositRoute }
                  | { kind: 'walletDepositWnt'; input: IDepositRoute }
                  | null =
                  inputAmount === 0n
                    ? null
                    : params.source.isNative
                      ? {
                          kind: 'walletDepositWnt',
                          input: {
                            chainId: originChainId,
                            params: accountParams,
                            tokenId: params.source.routeTokenId,
                            mode: 'native',
                            token: swapToken,
                            amount: inputAmount,
                            walletBalance: params.balance ?? 0n
                          }
                        }
                      : {
                          kind: 'walletDeposit',
                          input: {
                            chainId: originChainId,
                            params: accountParams,
                            tokenId: params.source.routeTokenId,
                            mode: 'erc20Gate',
                            token: swapToken,
                            amount: inputAmount,
                            spender: PUPPET_CONTRACT_MAP.WalletDepositModule.address,
                            walletBalance: params.balance ?? 0n,
                            walletAllowance: params.allowance
                          }
                        }
                const swapBridgeStep: { kind: 'bridge'; input: IBridgeInput } = {
                  kind: 'bridge',
                  input: {
                    params: accountParams,
                    tokenId: params.source.routeTokenId,
                    blockNumber: originBlockNumber,
                    deadline,
                    acceptableRelayFee: params.inputFeeMap.bridge.relayFee,
                    nonce: randomNonce(),
                    chainId: BigInt(originChainId),
                    inputAmount,
                    destinationChainId: BigInt(HUB_CHAIN_ID),
                    route: quote?.route ?? { kind: 'swap', provider: ADDRESS_ZERO, providerCallData: '0x' },
                    outputAmount: swapOutputAmount,
                    expires: quote?.expires ?? 0,
                    fillDeadline: quote?.fillDeadline ?? 0
                  }
                }
                const swapHomeStep: IDepositStep = homeDeployed
                  ? {
                      kind: 'recognize',
                      input: {
                        params: accountParams,
                        tokenId: baseTokenId,
                        blockNumber: homeBlockNumber,
                        deadline,
                        acceptableRelayFee: recognizeFee,
                        nonce: randomNonce(),
                        chainId: BigInt(HUB_CHAIN_ID),
                        amount: swapOutputAmount
                      }
                    }
                  : {
                      kind: 'createPuppetAccount',
                      input: {
                        chainId: BigInt(HUB_CHAIN_ID),
                        params: accountParams,
                        tokenId: baseTokenId,
                        blockNumber: homeBlockNumber,
                        deadline,
                        nonce: randomNonce(),
                        acceptableRelayFee: deployFee,
                        initialDepositAmount: swapOutputAmount,
                        userDeploySig: '0x',
                        userSignerProof: '0x'
                      }
                    }
                const swapDeployOriginStep: IDepositStep | null = accountState.chains.has(originChainId)
                  ? null
                  : {
                      kind: 'createPuppetAccount',
                      input: {
                        chainId: BigInt(originChainId),
                        params: accountParams,
                        tokenId: params.source.routeTokenId,
                        blockNumber: originBlockNumber,
                        deadline,
                        nonce: randomNonce(),
                        acceptableRelayFee: 0n,
                        initialDepositAmount: 0n,
                        userDeploySig: '0x',
                        userSignerProof: '0x'
                      }
                    }
                return {
                  kind: 'deposit',
                  id,
                  account,
                  title: 'Swap & Deposit',
                  alert: null,
                  inputAmount: { amount: inputAmount, baseTokenId: params.source.routeTokenId },
                  output: {
                    receiver: recipient,
                    chainId: HUB_CHAIN_ID,
                    amount: swapOutputAmount,
                    baseTokenId,
                    approx: true
                  },
                  inputSteps: [
                    ...(swapWalletStep ? [swapWalletStep] : []),
                    ...(swapDeployOriginStep ? [swapDeployOriginStep] : []),
                    swapBridgeStep,
                    swapHomeStep
                  ],
                  lateBindDerivation
                }
              }

              const topUp = params.value > 0n ? params.value + homeRecognizeFee : 0n
              const inputToken = params.source.routeToken

              const walletStep:
                | { kind: 'walletDeposit'; input: IDepositRoute }
                | { kind: 'walletDepositWnt'; input: IDepositRoute }
                | null =
                topUp === 0n
                  ? null
                  : params.source.isNative
                    ? {
                        kind: 'walletDepositWnt',
                        input: {
                          chainId: originChainId,
                          params: accountParams,
                          tokenId: params.source.routeTokenId,
                          mode: 'native',
                          token: inputToken,
                          amount: topUp,
                          walletBalance: params.balance ?? 0n
                        }
                      }
                    : {
                        kind: 'walletDeposit',
                        input: {
                          chainId: originChainId,
                          params: accountParams,
                          tokenId: params.source.routeTokenId,
                          mode: 'erc20Gate',
                          token: inputToken,
                          amount: topUp,
                          spender: PUPPET_CONTRACT_MAP.WalletDepositModule.address,
                          walletBalance: params.balance ?? 0n,
                          walletAllowance: params.allowance
                        }
                      }

              const recognizeAmount = topUp + params.surplus
              const homeStep: IDepositStep = homeDeployed
                ? {
                    kind: 'recognize',
                    input: {
                      params: accountParams,
                      tokenId: baseTokenId,
                      blockNumber: homeBlockNumber,
                      deadline,
                      acceptableRelayFee: recognizeFee,
                      nonce: randomNonce(),
                      chainId: BigInt(HUB_CHAIN_ID),
                      amount: recognizeAmount
                    }
                  }
                : {
                    kind: 'createPuppetAccount',
                    input: {
                      chainId: BigInt(HUB_CHAIN_ID),
                      params: accountParams,
                      tokenId: baseTokenId,
                      blockNumber: homeBlockNumber,
                      deadline,
                      nonce: randomNonce(),
                      acceptableRelayFee: deployFee,
                      initialDepositAmount: recognizeAmount,
                      userDeploySig: '0x',
                      userSignerProof: '0x'
                    }
                  }

              if (isHome) {
                return {
                  kind: 'deposit',
                  id,
                  account,
                  title: 'Deposit',
                  alert: null,
                  inputAmount: { amount: params.value, baseTokenId },
                  output: {
                    receiver: recipient,
                    chainId: HUB_CHAIN_ID,
                    amount: recognizeAmount,
                    baseTokenId,
                    approx: false
                  },
                  inputSteps: [...(walletStep ? [walletStep] : []), homeStep],
                  lateBindDerivation
                }
              }

              const quote = params.q.quote
              const originBlockNumber = indexerBlock(
                params.indexerHealth,
                resolveDispatchNetwork(resolveDispatchChainId(originChainId))
              )
              const bridgeStep: { kind: 'bridge'; input: IBridgeInput } = {
                kind: 'bridge',
                input: {
                  params: accountParams,
                  tokenId: baseTokenId,
                  blockNumber: originBlockNumber,
                  deadline,
                  acceptableRelayFee: bridgeFee,
                  nonce: randomNonce(),
                  chainId: BigInt(originChainId),
                  inputAmount: params.bridgeAmount,
                  destinationChainId: BigInt(HUB_CHAIN_ID),
                  route: quote?.route ?? {
                    kind: 'across',
                    exclusiveRelayer: ADDRESS_ZERO,
                    quoteTimestamp: 0,
                    exclusivityParameter: 0
                  },
                  outputAmount: quote?.outputAmount ?? 0n,
                  expires: quote?.expires ?? 0,
                  fillDeadline: quote?.fillDeadline ?? 0
                }
              }
              const bridgeOutputAmount = quote?.outputAmount ?? params.bridgeAmount
              const bridgeHomeStep: IDepositStep = homeDeployed
                ? {
                    kind: 'recognize',
                    input: {
                      params: accountParams,
                      tokenId: baseTokenId,
                      blockNumber: homeBlockNumber,
                      deadline,
                      acceptableRelayFee: recognizeFee,
                      nonce: randomNonce(),
                      chainId: BigInt(HUB_CHAIN_ID),
                      amount: bridgeOutputAmount
                    }
                  }
                : {
                    kind: 'createPuppetAccount',
                    input: {
                      chainId: BigInt(HUB_CHAIN_ID),
                      params: accountParams,
                      tokenId: baseTokenId,
                      blockNumber: homeBlockNumber,
                      deadline,
                      nonce: randomNonce(),
                      acceptableRelayFee: deployFee,
                      initialDepositAmount: bridgeOutputAmount,
                      userDeploySig: '0x',
                      userSignerProof: '0x'
                    }
                  }
              const deployOriginStep: IDepositStep | null = accountState.chains.has(originChainId)
                ? null
                : {
                    kind: 'createPuppetAccount',
                    input: {
                      chainId: BigInt(originChainId),
                      params: accountParams,
                      tokenId: baseTokenId,
                      blockNumber: originBlockNumber,
                      deadline,
                      nonce: randomNonce(),
                      acceptableRelayFee: 0n,
                      initialDepositAmount: 0n,
                      userDeploySig: '0x',
                      userSignerProof: '0x'
                    }
                  }
              return {
                kind: 'deposit',
                id,
                account,
                title: 'Bridge Deposit',
                alert: null,
                inputAmount: { amount: params.value, baseTokenId },
                output: {
                  receiver: recipient,
                  chainId: HUB_CHAIN_ID,
                  amount: quote?.outputAmount ?? params.value,
                  baseTokenId,
                  approx: true
                },
                inputSteps: [
                  ...(walletStep ? [walletStep] : []),
                  ...(deployOriginStep ? [deployOriginStep] : []),
                  bridgeStep,
                  bridgeHomeStep
                ],
                lateBindDerivation
              }
            },
            combine({
              value,
              source: selectedSourceRef,
              q: quoteQuery,
              surplus: depositSurplus,
              bridgeAmount: bridgeAmountStream,
              feeMap: relayFeeMapQuery,
              inputFeeMap,
              balance: selectedBalance,
              allowance: walletAllowance,
              indexerHealth: context.indexerHealth
            })
          )
          return { changeDraft: sample(previewDraft, submitTrigger) }
        })()
      ]
    }
  )
