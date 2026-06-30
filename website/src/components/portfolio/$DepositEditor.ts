import { HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import DEPLOYMENTS from '@puppet/contracts/deployments'
import type { IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import { predictDepositRoute } from '@puppet/sdk/account'
import { type IDepositRoute, resolveDispatchChainId } from '@puppet/sdk/attestation'
import { formatThrownError } from '@puppet/sdk/compact'
import { ADDRESS_ZERO, CHAIN_LIST, type ChainId } from '@puppet/sdk/const'
import { getRegisteredTokenDescription, readableTokenAmount, readableTokenAmountLabel } from '@puppet/sdk/core'
import { USD_PRICE_DECIMALS } from '@puppet/sdk/evaluate'
import {
  chainHeadBlock,
  fetchDepositRouteBalance,
  type ISubaccountState,
  type ITokenRegistryMap,
  type RelayFeeMap,
  nativeSymbolOf,
  randomNonce,
  tokenInfoFor,
  wrappedNativeAddressOf
} from '@puppet/sdk/state'
import { getPublicClient } from '@wagmi/core'
import {
  awaitPromises,
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
  switchPromises,
  take,
  until
} from 'aelea/stream'
import { type IBehavior, multicast, state } from 'aelea/stream-extended'
import { $element, $node, $text, attr, component, type INode, nodeEvent, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { type Address, erc20Abi, formatUnits, getAddress, type Hex, isAddressEqual } from 'viem'
import { readContract } from 'viem/actions'
import {
  $ButtonSecondary,
  $DropSelect,
  $defaultDropdownContainer,
  $defaultSliderContainer,
  $icon,
  $infoTooltip,
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
import { $chainIcon, $tokenWithChainBadge, chainName } from '../../common/$chain.js'
import { $contractIdentity } from '../../common/$contract.js'
import { fetchSwapQuote, type ISwapQuote } from '../../io/bridge/swapQuote.js'
import { fetchTokenBalances } from '../../io/chain/balances.js'
import context, { displayRelayFeeMap } from '../../io/context.js'
import { formatUsd, priceFor } from '../../io/gmx/priceFeed.js'
import { homePublicClient, type IConnectedWallet, wagmi } from '../../wallet/index.js'
import { walletChainId as walletChainIdStream } from '../../wallet/state.js'
import { $optionRow, $tokenIconBySymbol, decorateOptionList, type ITokenInputOption } from './$tokenOption.js'
import type { IDepositDraft } from './draft.js'
import { createFocusState } from './editorUtils.js'
import { DEFAULT_DEADLINE_SEC, walletClientForChain } from './runner/_shared.js'

export interface I$DepositEditor {
  hideBalances: IStream<boolean>
  accountState: ISubaccountState
  token: Hex
  tokenRegistry: ITokenRegistryMap
  walletAccount: IConnectedWallet
  existingDraft: IStream<IDepositDraft | null>
}

export const $DepositEditor = ({
  hideBalances,
  accountState,
  token,
  tokenRegistry: _tokenRegistry,
  walletAccount,
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
      const outputToken = tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, token).token
      const recipient = accountState.account
      const outputTokenDesc = getRegisteredTokenDescription(outputToken)
      const relayFeeMapQuery: IStream<RelayFeeMap | null> = fromPromise(displayRelayFeeMap(token))

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
          // Every registered token is a valid deposit source (any cross-token deposit swaps to the fund base, and the
          // relay fee is quoted per route token below). No fee-token whitelist.
          entries.push({
            chainId: chain.id,
            address,
            symbol: sym,
            routeTokenId,
            routeToken,
            decimals,
            isNative,
            // Address-equal (not raw !==): a native source routes through its wrapped-native (routeTokenId = WMON/WETH),
            // so depositing native into a fund whose base IS that wrapped token is a WRAP (depositWnt), not a swap.
            isSwap: !isAddressEqual(routeTokenId as Address, token as Address)
          })
        }
        for (const info of chainMap.values()) {
          // The native gas coin routes through the chain's wrapped-native ERC-20 (ADDRESS_ZERO signals a native
          // value transfer; the route + fee are denominated in WMON/WETH).
          if (info.token === PROTOCOL.nativeToken) {
            const wrapped = wrappedNativeAddressOf(chain.id as ChainId)
            pushSource(ADDRESS_ZERO, nativeSymbolOf(chain.id as ChainId), wrapped, wrapped, 18, true)
            continue
          }
          const desc = getRegisteredTokenDescription(info.token)
          pushSource(info.token, desc.symbol, info.token, info.token, desc.decimals, false)
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
        if (d.wallet) {
          const address = d.wallet.mode === 'native' ? ADDRESS_ZERO : d.wallet.token
          return { chainId: d.wallet.chainId, address }
        }
        if (d.swap) {
          const chainId = Number(d.swap.chainId)
          const erc = tokenRegistry.get(chainId as ChainId)?.get(token)?.token
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
          const top = [...p.balances].sort((a, b) => {
            const av = a.balance ?? 0n
            const bv = b.balance ?? 0n
            return bv > av ? 1 : bv < av ? -1 : 0
          })[0]
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
      const priceForSource = (s: SourceRef): IStream<bigint | null> => priceFor(getAddress(s.routeToken))

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
      const inputFeeMap: IStream<RelayFeeMap | null> = op(
        selectedSourceRef,
        switchMap(s => fromPromise(displayRelayFeeMap(s.routeTokenId))),
        state()
      )
      const feeMapByTokenId: IStream<Record<string, RelayFeeMap | null>> = combine(
        Object.fromEntries(
          [...new Set(sources.map(s => s.routeTokenId))].map(addr => [addr, fromPromise(displayRelayFeeMap(addr))])
        )
      )
      // null = the route token's relay fee is unpriceable (oracle has no rate yet) -> the option/action is gated, not
      // a fabricated 0 (a 0 reads as "free" and would zero the signed ceiling).
      const sourceRelayFee = (s: SourceRef, fees: Record<string, RelayFeeMap | null>): bigint | null => {
        const feeMap = fees[s.routeTokenId]
        if (!feeMap) return null
        return s.chainId === HUB_CHAIN_ID && !s.isSwap ? feeMap.recognize.relayFee : feeMap.swap.relayFee
      }

      const selectedBalance: IStream<bigint | null> = op(
        combine({ list: balanceQuery, sel: sourceSelection }),
        map(p => {
          if (p.list === null) return null
          return p.list.find(b => b.chainId === p.sel.chainId && b.tokenAddress === p.sel.address)?.balance ?? null
        }),
        state()
      )

      const tokenPrice = priceFor(outputToken)
      const usdText = (s: SourceRef, balance: bigint | null): IStream<string> =>
        balance === null ? just('-') : map(price => formatUsd(balance, price), priceForSource(s))

      const relayFee: IStream<bigint | null> = map(p => {
        const fm = p.chainId === HUB_CHAIN_ID && !p.isSwap ? p.baseFeeMap : p.inputFeeMap
        if (fm === null) return null
        return p.chainId === HUB_CHAIN_ID && !p.isSwap ? fm.recognize.relayFee : fm.swap.relayFee
      }, combine({ chainId: chainSelection, baseFeeMap: relayFeeMapQuery, inputFeeMap, isSwap: isSwapStream }))

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
              args: [walletAccount.address, DEPLOYMENTS[`Deposit:${HUB_CHAIN_ID}`].address]
            })
          } catch {
            return 0n
          }
        }),
        state()
      )

      const DUST_USD_30DEC = 10n ** 28n
      const transientRouteBalance: IStream<bigint> = op(
        selectedSourceRef,
        switchMap(async sel => {
          const token = tokenInfoFor(tokenRegistry, sel.chainId as ChainId, sel.routeTokenId).token
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
          if (p.raw === 0n || p.price === null) return 0n
          return p.raw * p.price < DUST_USD_30DEC ? 0n : p.raw
        },
        combine({ raw: transientRouteBalance, price: inputPrice })
      )
      const hubRouteBalance: IStream<bigint> = op(
        selectedSourceRef,
        switchMap(async sel => {
          if (sel.chainId === HUB_CHAIN_ID) return 0n
          try {
            return await fetchDepositRouteBalance(homePublicClient, outputToken, recipient)
          } catch {
            return 0n
          }
        }),
        state()
      )
      const hubSurplus: IStream<bigint> = map(
        p => {
          if (p.raw === 0n || p.price === null) return 0n
          return p.raw * p.price < DUST_USD_30DEC ? 0n : p.raw
        },
        combine({ raw: hubRouteBalance, price: tokenPrice })
      )

      const toOption = (source: SourceRef, balance: bigint | null): ITokenInputOption => ({
        symbol: source.symbol,
        chainId: source.chainId,
        address: source.address,
        token: source.routeTokenId,
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
                  : (p.list.find(b => b.chainId === source.chainId && b.tokenAddress === source.address)?.balance ?? null)
              const srcFee = sourceRelayFee(source, p.fees)
              const disabled = balance !== null && srcFee !== null && balance <= srcFee
              return { ...toOption(source, balance), disabled }
            }),
            p.sel,
            opt => p.prices[getAddress(opt.token)] ?? null,
            token
          ),
        combine({
          list: balanceQuery,
          sel: sourceSelection,
          fees: feeMapByTokenId,
          prices: combine(
            Object.fromEntries(
              [
                ...new Set(sources.map(s => getAddress(s.routeToken)))
              ].map(a => [a, priceFor(a)])
            )
          )
        })
      )

      const sliderAmount: IStream<bigint> = sampleMap(
        (opt, pct) => {
          const bp = BigInt(Math.round(Math.max(0, Math.min(1, pct)) * 10000))
          return ((opt.balance ?? 0n) * bp) / 10000n
        },
        selectedOption,
        sliderPercent
      )
      const maxAmount: IStream<bigint> = sampleMap(
        p => {
          // Fee unpriceable -> no max-out amount (can't safely subtract an unknown fee); the submit gate blocks anyway.
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
            map(d => (d ? d.inputAmount.amount : 0n))
          )
        ),
        state(0n)
      )

      const focused = createFocusState(focusEvt, blurEvt)

      type QuoteStatus =
        | { status: 'idle'; quote: ISwapQuote | null; forInput?: bigint }
        | { status: 'error'; quote: null; message: string }

      // null = "not ready": a non-swap top-up needs the recognize fee, and an unpriceable fee must not be substituted
      // with 0 (that would size the bridge/sign against a fake fee). The submit gate disables while this is null.
      const bridgeAmountStream: IStream<bigint | null> = map(
        p => {
          if (p.isSwap) return p.surplus + p.value
          if (p.value === 0n) return p.surplus
          if (p.feeMap === null) return null
          return p.surplus + p.value + p.feeMap.recognize.relayFee
        },
        combine({ value, surplus: depositSurplus, feeMap: relayFeeMapQuery, isSwap: isSwapStream })
      )

      const bridgeQuoteInput: IStream<bigint | null> = op(
        combine({ amount: bridgeAmountStream, feeMap: relayFeeMapQuery, inputFeeMap, isSwap: isSwapStream }),
        map(p => {
          const fm = p.isSwap ? p.inputFeeMap : p.feeMap
          if (p.amount === null || fm === null) return null
          const fee = fm.swap.relayFee
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
          // Quote whenever there is anything to bridge (value OR a carried surplus): a cross-chain surplus must be bridged
          // to recover it, which incurs a real swap cost, so it gets a quote and a shown fee. A hub source returns idle
          // above (no swap). bridgeInput already folds in the surplus.
          const bridgeInput = params.bridgeInput
          // null bridgeInput = relay fee unpriceable -> nothing to quote yet (submit is gated on the same null).
          if (bridgeInput === null || bridgeInput <= 0n) return { status: 'idle', quote: null }
          try {
            const quote = await fetchSwapQuote({
              originChainId: source.chainId,
              destinationChainId: HUB_CHAIN_ID,
              inputToken: source.routeToken,
              outputToken,
              inputAmount: bridgeInput,
              route: predictDepositRoute(recipient),
              crossToken: source.isSwap
            })
            return { status: 'idle', quote, forInput: bridgeInput }
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
          if (params.value > 0n && params.walletChain !== params.chainId) {
            return `Switch your wallet to ${chainName(params.chainId)}`
          }
          if (params.balance !== null && params.value > params.balance) {
            return `Exceeds wallet balance ${readableTokenAmountLabel({ decimals: params.source.decimals, symbol: params.source.symbol }, params.balance)}`
          }
          const bridgeAmount = params.bridgeAmount
          const needsQuote = params.chainId !== HUB_CHAIN_ID || params.source.isSwap
          // bridgeAmount null = relay fee unpriceable: nothing to bridge-validate (the submit gate already blocks).
          if (needsQuote && bridgeAmount !== null && bridgeAmount > 0n) {
            if (params.q.status === 'error') return params.q.message
            if (params.q.quote) {
              if (params.q.quote.isAmountTooLow) {
                return `Below bridge minimum ${readableTokenAmount(outputTokenDesc, params.q.quote.limits.minDeposit)}`
              }
              if (bridgeAmount > params.q.quote.limits.maxDeposit) {
                return `Exceeds bridge max ${readableTokenAmount(outputTokenDesc, params.q.quote.limits.maxDeposit)}`
              }
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

      // The swap/bridge cost = value lost from input to output (USD), plus its share of the input so an outsized cut can
      // be flagged. This is the routing provider's fee (e.g. LI.FI), never Puppet's.
      const HIGH_SWAP_FEE_PCT = 1
      const swapFeeMeta: IStream<Promise<{ text: string; high: boolean }>> = switchMap(
        p => {
          const total = p.value + p.surplus
          // Recovering a carried CROSS-CHAIN surplus bridges it, which incurs a real swap cost — so show the fee whenever
          // there is anything to bridge, not only on a freshly typed amount. The $quoteInline wrapper already limits this
          // row to a cross-chain/swap source; a hub surplus needs no swap.
          if (total === 0n) return just(Promise.resolve({ text: '-', high: false }))
          return map(async pQuote => {
            const s = await pQuote
            if (!s.quote || p.inPrice === null || p.outPrice === null) return { text: '-', high: false }
            if (s.forInput !== p.qInput) return { text: '…', high: false }
            const inUsd = Number(formatUnits(total * p.inPrice, USD_PRICE_DECIMALS))
            const outUsd = Number(formatUnits(s.quote.outputAmount * p.outPrice, USD_PRICE_DECIMALS))
            const fee = inUsd - outUsd
            const feeText = fee <= 0 ? '$0.00' : fee < 0.01 ? '< $0.01' : `$${fee.toFixed(2)}`
            const pct = inUsd > 0 ? (fee / inUsd) * 100 : 0
            const high = pct > HIGH_SWAP_FEE_PCT
            return { text: `${feeText}${high ? ` (${pct.toFixed(1)}%)` : ''} via ${s.quote.provider}`, high }
          }, quoteFetch)
        },
        combine({ value, surplus: depositSurplus, inPrice: inputPrice, outPrice: tokenPrice, qInput: bridgeQuoteInput })
      )

      // Value node: red when the cut exceeds the threshold, otherwise the default inline color (unchanged appearance).
      const $swapFeeValue = switchLatest(
        map(
          (pMeta: Promise<{ text: string; high: boolean }>) =>
            switchLatest(
              map(
                (m: { text: string; high: boolean }) =>
                  $node(style(m.high ? { color: palette.negative } : {}))($text(m.text)),
                start({ text: '…', high: false }, fromPromise(pMeta))
              )
            ),
          swapFeeMeta
        )
      )

      // Always-on disclaimer on the label: the cut belongs to the third-party router, never Puppet, and depositing the
      // base token directly avoids the swap.
      const $swapFeeDisclaimer = $node(style({ maxWidth: '240px', lineHeight: '1.4' }))(
        $text(
          'This swap fee goes to the third-party router (such as LI.FI), not to Puppet. Consider finding a better rate, or deposit the base token directly to skip the swap.'
        )
      )

      const $quoteInline = switchMap(
        s => (s.chainId === HUB_CHAIN_ID && !s.isSwap ? empty : $labeledValue('Swap fee', $swapFeeValue, $swapFeeDisclaimer)),
        selectedSourceRef
      )

      const surplusRoute = predictDepositRoute(recipient)
      const surplusInfo: IStream<{
        usd: string
        legs: Array<{ chainId: number; amount: bigint; decimals: number; symbol: string }>
      }> = map(
        p => {
          const legs: Array<{ chainId: number; amount: bigint; decimals: number; symbol: string }> = []
          if (p.source > 0n) {
            legs.push({ chainId: p.sel.chainId, amount: p.source, decimals: p.sel.decimals, symbol: p.sel.symbol })
          }
          if (p.sel.chainId !== HUB_CHAIN_ID && p.hub > 0n) {
            legs.push({
              chainId: HUB_CHAIN_ID,
              amount: p.hub,
              decimals: outputTokenDesc.decimals,
              symbol: outputTokenDesc.symbol
            })
          }
          const usdProduct =
            (p.inPrice === null ? 0n : p.source * p.inPrice) +
            (p.sel.chainId === HUB_CHAIN_ID || p.outPrice === null ? 0n : p.hub * p.outPrice)
          const num = Number(formatUnits(usdProduct, USD_PRICE_DECIMALS))
          const usd = usdProduct === 0n ? '' : num > 0 && num < 0.01 ? '< $0.01' : `$${num.toFixed(2)}`
          return { usd, legs }
        },
        combine({
          source: depositSurplus,
          hub: hubSurplus,
          sel: selectedSourceRef,
          inPrice: inputPrice,
          outPrice: tokenPrice
        })
      )

      const disabled: IStream<boolean> = op(
        combine({
          alert,
          value,
          q: quoteQuery,
          sel: sourceSelection,
          existing: draftStream,
          surplus: depositSurplus,
          hubSurplus,
          feeMap: relayFeeMapQuery,
          isSwap: isSwapStream,
          qInput: bridgeQuoteInput
        }),
        map(p => {
          if (p.alert !== null) return true
          if (p.value + p.surplus + p.hubSurplus === 0n) return true
          // Relay fee unpriceable (oracle has no rate yet) -> can't size/sign the deposit; block until it prices.
          if (p.feeMap === null) return true
          // A prior cross-chain deposit whose output already landed on the HUB route (bridge done, source route empty):
          // recover it with a plain recognize, no swap — so enable without a quote once it clears the recognize fee.
          if (p.value === 0n && p.surplus === 0n && p.hubSurplus > p.feeMap.recognize.relayFee) return false
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
          // The bridge/swap quote must be present AND computed for the CURRENT input; a quote still lagging the live
          // input (forInput !== qInput, the same staleness the 'Swap fee' row shows as '…') would bake an output floor
          // for a different amount into the signed intent. Block submit until it catches up.
          if (p.q.status !== 'idle' || p.q.quote === null) return true
          return p.q.forInput !== p.qInput
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
        q: QuoteStatus
        surplus: bigint
        hubSurplus: bigint
        bridgeAmount: bigint
        balance: bigint | null
        allowance: bigint
      }> = combine({
        value,
        source: selectedSourceRef,
        q: quoteQuery,
        surplus: depositSurplus,
        hubSurplus,
        bridgeAmount: bridgeAmountStream,
        balance: selectedBalance,
        allowance: walletAllowance
      })
      // Snapshot the inputs on a Save click and resolve the bridge quote ONCE here. When the user typed an amount the
      // editor already fired the quote (base.q.quote present); when recovering a carried surplus with no new input the
      // editor stayed quiet, so it is fetched now, on Save. multicast so `saving` and `changeDraft` share this single
      // resolution (one fetch). The runner does not re-quote the cross-chain deposit path, so this route must be real.
      const submitResolved = multicast(
        op(
          sample(submitParams, submitTrigger),
          map(async base => {
            if (base.q.quote || base.source.chainId === HUB_CHAIN_ID) return { base, quote: base.q.quote }
            const inputAmount = base.source.isSwap ? base.value + base.surplus : base.bridgeAmount
            if (inputAmount <= 0n) return { base, quote: null as ISwapQuote | null }
            const quote = await fetchSwapQuote({
              originChainId: base.source.chainId,
              destinationChainId: HUB_CHAIN_ID,
              inputToken: base.source.routeToken,
              outputToken,
              inputAmount,
              route: predictDepositRoute(recipient),
              crossToken: base.source.isSwap
            })
            return { base, quote }
          }),
          awaitPromises
        )
      )
      // Pending from the Save click until that resolution (incl. the on-demand quote, the slow part) completes —
      // declarative, no imperative signal; the next click re-arms it.
      const saving: IStream<boolean> = state(
        false,
        merge(constant(true, submitTrigger), constant(false, submitResolved))
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
        $$option: map((opt: ITokenInputOption) => $optionRow(hideBalances, opt))
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
              : $row(spacing.small, style({ alignItems: 'center' }))(
                  $node(style({ color: palette.foreground, fontSize: text.xs }))($text(p.usd)),
                  ...(p.surplus.legs.length > 0
                    ? [
                        $row(spacing.tiny, style({ alignItems: 'center' }))(
                          $node(style({ color: palette.positive, fontSize: text.xs }))($text(`+ ${p.surplus.usd}`)),
                          $infoTooltip(
                            $column(spacing.small, style({ maxWidth: '260px', whiteSpace: 'normal' }))(
                              $node(
                                $text(
                                  'An earlier deposit reached your route but was never recognized. It is recovered into your account alongside this input.'
                                )
                              ),
                              $column(spacing.tiny)(
                                ...p.surplus.legs.map(leg =>
                                  $row(spacing.small, style({ alignItems: 'center' }))(
                                    $chainIcon(leg.chainId, 14),
                                    $node(style({ color: palette.positive }))(
                                      $text(`+${readableTokenAmount(leg.decimals, leg.amount)} ${leg.symbol}`)
                                    ),
                                    $contractIdentity({
                                      address: surplusRoute,
                                      chainId: leg.chainId,
                                      name: 'Deposit route',
                                      showAddress: true
                                    })
                                  )
                                )
                              )
                            ),
                            palette.positive,
                            '16px'
                          )
                        )
                      ]
                    : [])
                ),
          combine({ msg: alert, usd: start('', amountUsd), surplus: surplusInfo })
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
            $ButtonSecondary({
              disabled: map(p => p.d || p.s, combine({ d: disabled, s: saving })),
              $content: $text(map(s => (s ? 'Saving…' : 'Save'), saving))
            })({ click: clickAddDraftTether() })
          )
        ),
        (() => {
          const changeDraft: IStream<IDepositDraft> = op(
            submitResolved,
            map(async ({ base, quote }): Promise<IDepositDraft> => {
              const [feeMap, inputFeeMap, chainLiveness] = await Promise.all([
                context.getRelayFeeMap(token),
                context.getRelayFeeMap(base.source.routeTokenId),
                context.getChainLiveness()
              ])
              const originChainId = base.source.chainId
              const isHome = originChainId === HUB_CHAIN_ID
              const bridgeFee = feeMap.swap.relayFee
              const homeRecognizeFee = feeMap.recognize.relayFee
              const deadline = BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC)
              const id = `deposit:${recipient}`
              const account = recipient

              // Recover a prior cross-chain deposit's output already on the HUB route (bridge done, source route empty):
              // no new send and nothing to bridge, so a plain recognize of the hub balance — no wallet or swap leg.
              if (base.value === 0n && base.surplus === 0n && base.hubSurplus > 0n) {
                return {
                  kind: 'deposit',
                  id,
                  account,
                  params: accountParams,
                  title: 'Recognize',
                  alert: null,
                  inputAmount: { amount: base.hubSurplus, baseToken: token },
                  output: {
                    receiver: recipient,
                    chainId: HUB_CHAIN_ID,
                    amount: base.hubSurplus,
                    baseToken: token,
                    approx: false
                  },
                  wallet: null,
                  swap: null,
                  surplus: 0n
                }
              }

              if (base.source.isSwap) {
                const swapToken = base.source.routeToken
                // Wallet sends only the new amount; the swap consumes that plus any
                // unprocessed input-token surplus already sitting on the route.
                const walletSend = base.value
                const swapInput = base.value + base.surplus
                const swapOutputAmount = quote?.outputAmount ?? 0n
                const swapRelayFee =
                  base.q.status === 'idle' && base.q.forInput !== undefined
                    ? swapInput - base.q.forInput
                    : inputFeeMap.swap.relayFee
                const originBlockNumber = chainHeadBlock(chainLiveness, resolveDispatchChainId(originChainId))
                const swapWalletStep: { kind: 'walletTransfer'; input: IDepositRoute } | null =
                  walletSend === 0n
                    ? null
                    : base.source.isNative
                      ? {
                          kind: 'walletTransfer',
                          input: {
                            chainId: originChainId,
                            params: accountParams,
                            mode: 'native',
                            token: swapToken,
                            amount: walletSend,
                            walletBalance: base.balance ?? 0n
                          }
                        }
                      : {
                          kind: 'walletTransfer',
                          input: {
                            chainId: originChainId,
                            params: accountParams,
                            mode: 'erc20Gate',
                            token: swapToken,
                            amount: walletSend,
                            spender: DEPLOYMENTS[`Deposit:${HUB_CHAIN_ID}`].address,
                            walletBalance: base.balance ?? 0n,
                            walletAllowance: base.allowance
                          }
                        }
                return {
                  kind: 'deposit',
                  id,
                  account,
                  params: accountParams,
                  title: 'Swap & Deposit',
                  alert: null,
                  inputAmount: { amount: swapInput, baseToken: base.source.routeTokenId },
                  output: {
                    receiver: recipient,
                    chainId: HUB_CHAIN_ID,
                    amount: swapOutputAmount,
                    baseToken: token,
                    approx: true
                  },
                  wallet: swapWalletStep?.input ?? null,
                  swap: {
                    params: accountParams,
                    inputToken: base.source.routeTokenId,
                    outputToken: token,
                    blockNumber: originBlockNumber,
                    deadline,
                    acceptableRelayFee: swapRelayFee,
                    nonce: randomNonce(),
                    chainId: BigInt(originChainId),
                    inputAmount: swapInput,
                    destinationChainId: BigInt(HUB_CHAIN_ID),
                    route: quote?.route ?? { kind: 'swap', provider: ADDRESS_ZERO, providerCallData: '0x' },
                    outputAmount: swapOutputAmount,
                    fillDeadline: quote?.fillDeadline ?? 0,
                    userDeploySig: '0x',
                    userSignerProof: '0x'
                  },
                  surplus: base.surplus
                }
              }

              const topUp = base.value > 0n ? base.value + homeRecognizeFee : 0n
              const inputToken = base.source.routeToken

              const walletStep: { kind: 'walletTransfer'; input: IDepositRoute } | null =
                topUp === 0n
                  ? null
                  : base.source.isNative
                    ? {
                        kind: 'walletTransfer',
                        input: {
                          chainId: originChainId,
                          params: accountParams,
                          mode: 'native',
                          token: inputToken,
                          amount: topUp,
                          walletBalance: base.balance ?? 0n
                        }
                      }
                    : {
                        kind: 'walletTransfer',
                        input: {
                          chainId: originChainId,
                          params: accountParams,
                          mode: 'erc20Gate',
                          token: inputToken,
                          amount: topUp,
                          spender: DEPLOYMENTS[`Deposit:${HUB_CHAIN_ID}`].address,
                          walletBalance: base.balance ?? 0n,
                          walletAllowance: base.allowance
                        }
                      }

              const recognizeAmount = topUp + base.surplus

              if (isHome) {
                return {
                  kind: 'deposit',
                  id,
                  account,
                  params: accountParams,
                  title: 'Deposit',
                  alert: null,
                  inputAmount: { amount: base.value, baseToken: token },
                  output: {
                    receiver: recipient,
                    chainId: HUB_CHAIN_ID,
                    amount: recognizeAmount - homeRecognizeFee,
                    baseToken: token,
                    approx: false
                  },
                  wallet: walletStep?.input ?? null,
                  swap: null,
                  surplus: base.surplus
                }
              }

              const originBlockNumber = chainHeadBlock(chainLiveness, resolveDispatchChainId(originChainId))
              return {
                kind: 'deposit',
                id,
                account,
                params: accountParams,
                title: 'Swap Deposit',
                alert: null,
                inputAmount: { amount: base.value, baseToken: token },
                output: {
                  receiver: recipient,
                  chainId: HUB_CHAIN_ID,
                  amount: quote?.outputAmount ?? base.value,
                  baseToken: token,
                  approx: true
                },
                wallet: walletStep?.input ?? null,
                swap: {
                  params: accountParams,
                  inputToken: token,
                  outputToken: token,
                  blockNumber: originBlockNumber,
                  deadline,
                  acceptableRelayFee: bridgeFee,
                  nonce: randomNonce(),
                  chainId: BigInt(originChainId),
                  inputAmount: base.bridgeAmount,
                  destinationChainId: BigInt(HUB_CHAIN_ID),
                  route: quote?.route ?? {
                    kind: 'across',
                    exclusiveRelayer: ADDRESS_ZERO,
                    quoteTimestamp: 0,
                    exclusivityParameter: 0
                  },
                  outputAmount: quote?.outputAmount ?? 0n,
                  fillDeadline: quote?.fillDeadline ?? 0,
                  userDeploySig: '0x',
                  userSignerProof: '0x'
                },
                surplus: base.surplus
              }
            }),
            awaitPromises
          )
          return { changeDraft }
        })()
      ]
    }
  )
