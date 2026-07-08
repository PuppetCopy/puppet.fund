import { HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import DEPLOYMENTS from '@puppet/contracts/deployments'
import type { IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import { predictDepositRoute, predictPuppetAccount } from '@puppet/sdk/account'
import { type IDepositRoute, resolveDispatchChainId } from '@puppet/sdk/attestation'
import { ADDRESS_ZERO, CHAIN_LIST, type ChainId } from '@puppet/sdk/const'
import { getChainTokenDescription, readableTokenAmount, readableTokenAmountLabel } from '@puppet/sdk/core'
import { USD_PRICE_DECIMALS } from '@puppet/sdk/evaluate'
import {
  chainHeadBlock,
  fetchDepositRouteBalance,
  type ISubaccountState,
  type ITokenRegistryMap,
  nativeSymbolOf,
  type RelayFeeMap,
  randomNonce,
  tokenInfoFor,
  wrappedNativeAddressOf
} from '@puppet/sdk/state'
import { getPublicClient } from '@wagmi/core'
import {
  awaitPromises,
  combine,
  constant,
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
  take,
  until
} from 'aelea/stream'
import { type IBehavior, multicast, state } from 'aelea/stream-extended'
import { $element, $node, $text, component, type INode, nodeEvent, style, styleBehavior } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { type Address, erc20Abi, formatUnits, getAddress, type Hex, isAddressEqual } from 'viem'
import { readContract } from 'viem/actions'
import {
  $ButtonPrimaryOutline,
  $TokenAmountInput,
  text
} from '@/ui-components'
import { uiStorage } from '@/ui-storage'
import { depositSourceKey, type IDepositSource } from '../../app/localStoreSchema.js'
import { chainName } from '../../common/$chain.js'
import { $contractIdentity } from '../../common/$contract.js'
import { depositSwapQuoteAttempts, type ISwapRequest, isExecutableSwapRoute } from '../../io/bridge/swapQuote.js'
import { fetchTokenBalances } from '../../io/chain/balances.js'
import context, { relayFeeFor } from '../../io/context.js'
import { formatUsd, priceFor } from '../../io/price.js'
import { homePublicClient, type IConnectedWallet, wagmi } from '../../wallet/index.js'
import { walletChainId as walletChainIdStream } from '../../wallet/state.js'
import { $SwapProviderFeeEditor, type ISelectedRoute } from './$SwapProviderFeeEditor.js'
import { $TokenSelectFlow, decorateOptionList, type ITokenInputOption } from './$tokenOption.js'
import type { IDepositDraft } from './draft.js'
import {
  $editorPercentSlider,
  $maxAmountButton,
  $surplusAlertSlot,
  amountUsdLabel,
  createFocusState,
  scaleByPercent
} from './editorUtils.js'
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
  tokenRegistry,
  walletAccount,
  existingDraft
}: I$DepositEditor) =>
  component(
    (
      [clickAddDraft, clickAddDraftTether]: IBehavior<PointerEvent>,
      [selectOption, selectOptionTether]: IBehavior<ITokenInputOption>,
      [selectingSource, selectingSourceTether]: IBehavior<boolean>,
      [inputAmount, inputAmountTether]: IBehavior<bigint>,
      [focusEvt, focusEvtTether]: IBehavior<FocusEvent>,
      [blurEvt, blurEvtTether]: IBehavior<FocusEvent>,
      [sliderPercent, sliderPercentTether]: IBehavior<number>,
      [clickMax, clickMaxTether]: IBehavior<INode<HTMLButtonElement>, MouseEvent>,
      [enterPress, enterPressTether]: IBehavior<KeyboardEvent>,
      [selectedRoute, selectedRouteTether]: IBehavior<ISelectedRoute>
    ) => {
      const outputToken = tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, token).token
      // The delivery route MUST derive from the same {user, signer} identity the signed intent binds (the runner
      // watches predictDepositRoute(predictPuppetAccount(params))). accountState.account can drift from that pair
      // (a pre-session stub once fabricated signer=wallet, quoting delivery to a phantom PA's route) — deriving
      // locally makes quote target and runner watcher consistent by construction.
      const accountParams: IAccountLib__AccountInitParams = {
        user: accountState.user ?? walletAccount.address,
        signer: accountState.signer
      }
      const recipient = predictPuppetAccount(accountParams)
      // Pre-session the signer is the zero-address sentinel: that placeholder PA can never hold funds, so its route
      // reads are skipped as trivially empty. Every source stays open for exploration — quotes are estimates for the
      // placeholder and the runner re-quotes the swap leg for the live session at submit (rebindSwapLeg).
      const placeholderIdentity = isAddressEqual(accountParams.signer, ADDRESS_ZERO)
      const outputTokenDesc = getChainTokenDescription(HUB_CHAIN_ID, outputToken)
      const relayFeeMapQuery: IStream<RelayFeeMap | null> = relayFeeFor(token)

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
          const desc = getChainTokenDescription(chain.id as ChainId, info.token)
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
        switchMap(s => relayFeeFor(s.routeTokenId)),
        state()
      )
      const feeMapByTokenId: IStream<Record<string, RelayFeeMap | null>> = combine(
        Object.fromEntries([...new Set(sources.map(s => s.routeTokenId))].map(addr => [addr, relayFeeFor(addr)]))
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
          if (placeholderIdentity) return 0n
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
          if (placeholderIdentity || sel.chainId === HUB_CHAIN_ID) return 0n
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
      // A cross-chain SWAP whose DESTINATION leg reverts (e.g. thin hub-DEX liquidity) has Across deliver the INPUT
      // token to the hub route instead of the base. hubRouteBalance only watches the base, so that stranded input sits
      // unseen. Watch the input token on the hub too (cross-token deposits only; a same-asset bridge lands as the base
      // and is already covered above), so it surfaces as recoverable surplus.
      // The hub-chain SourceRef carrying the same asset as the selected cross-chain source (the registry is keyed by
      // per-chain ADDRESS, so resolve by SYMBOL; isSwap excludes the base — a same-asset landing is the base, already
      // covered by hubRouteBalance). This is both the watcher target and the recovery identity: a hub-stranded input
      // surplus is recovered by an ordinary hub-source swap deposit of this ref.
      const hubInputSource: IStream<SourceRef | null> = op(
        selectedSourceRef,
        map(sel => {
          if (sel.chainId === HUB_CHAIN_ID || !sel.isSwap) return null
          return sources.find(s => s.chainId === HUB_CHAIN_ID && !s.isNative && s.isSwap && s.symbol === sel.symbol) ?? null
        }),
        state()
      )
      const hubInputRouteBalance: IStream<bigint> = op(
        hubInputSource,
        switchMap(async src => {
          if (placeholderIdentity || src === null) return 0n
          try {
            return await fetchDepositRouteBalance(homePublicClient, src.routeToken, recipient)
          } catch {
            return 0n
          }
        }),
        state()
      )
      const hubInputSurplus: IStream<bigint> = map(
        p => {
          if (p.raw === 0n || p.price === null) return 0n
          return p.raw * p.price < DUST_USD_30DEC ? 0n : p.raw
        },
        combine({ raw: hubInputRouteBalance, price: inputPrice })
      )
      const hubInputFeeMap: IStream<RelayFeeMap | null> = op(
        hubInputSource,
        switchMap((src): IStream<RelayFeeMap | null> => (src === null ? just(null) : relayFeeFor(src.routeTokenId))),
        state()
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
        (opt, pct) => scaleByPercent(opt.balance ?? 0n, pct),
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

      // Declarative request derivation: a plain combine, never sample. A sample gate here silently DROPPED the trigger
      // whenever the async fee side hadn't resolved yet and nothing ever re-fired (fee arrival was not a trigger) —
      // the "no quote fetched, fee row stuck at -" dead-end. With combine, a late fee/surplus arrival re-derives the
      // request naturally; $SwapProviderFeeEditor owns debounce + sameRequest dedupe so unrelated re-emissions don't refetch.
      const request: IStream<ISwapRequest | null> = multicast(
        map(params => {
          const source = params.source
          if (source.chainId === HUB_CHAIN_ID && !source.isSwap) return null
          const bridgeInput = params.bridgeInput
          if (bridgeInput !== null && bridgeInput > 0n) {
            return {
              originChainId: source.chainId,
              destinationChainId: HUB_CHAIN_ID,
              inputToken: source.routeToken,
              outputToken,
              inputAmount: bridgeInput,
              route: predictDepositRoute(recipient),
              crossToken: source.isSwap
            }
          }
          // Nothing on the origin side: quote the recovery of a symbol-matched input surplus stranded on the HUB
          // route (a failed destination swap delivered the input token there) as a hub-LOCAL swap to the base.
          if (params.value !== 0n || params.surplus !== 0n) return null
          if (params.hubSrc === null || params.hubInput === 0n || params.hubFee === null) return null
          const fee = params.hubFee.swap.relayFee
          if (params.hubInput <= fee) return null
          return {
            originChainId: HUB_CHAIN_ID,
            destinationChainId: HUB_CHAIN_ID,
            inputToken: params.hubSrc.routeToken,
            outputToken,
            inputAmount: params.hubInput - fee,
            route: predictDepositRoute(recipient),
            crossToken: true
          }
        }, combine({
          source: selectedSourceRef,
          bridgeInput: bridgeQuoteInput,
          value,
          surplus: depositSurplus,
          hubSrc: hubInputSource,
          hubInput: hubInputSurplus,
          hubFee: hubInputFeeMap
        }))
      )

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
            if (params.route.error) return params.route.error
            if (params.route.limitError) return params.route.limitError
          }
          return null
        },
        combine({
          balance: selectedBalance,
          value,
          route: selectedRoute,
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

      const $swapFeeDisclaimer = $node(style({ maxWidth: '240px', lineHeight: '1.4' }))(
        $text(
          'The all-in cost of converting your deposit: what you send minus the guaranteed minimum received (routing fee + slippage). It goes to the third-party route, not to Puppet — deposit the base token directly to skip it. Each route shows its estimated arrival; without an estimate a cross-chain transfer can take up to its fill deadline (the ≤ time shown) before it is treated as failed and the funds surface back as recoverable balance.'
        )
      )

      const $swapProviderFee = $SwapProviderFeeEditor({
        active: map(s => !(s.chainId === HUB_CHAIN_ID && !s.isSwap), selectedSourceRef),
        request,
        attempts: depositSwapQuoteAttempts,
        $disclaimer: $swapFeeDisclaimer
      })({ selectRoute: selectedRouteTether() })

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
          if (p.sel.chainId !== HUB_CHAIN_ID && p.hubInput > 0n) {
            legs.push({ chainId: HUB_CHAIN_ID, amount: p.hubInput, decimals: p.sel.decimals, symbol: p.sel.symbol })
          }
          const usdProduct =
            (p.inPrice === null ? 0n : p.source * p.inPrice) +
            (p.sel.chainId === HUB_CHAIN_ID || p.outPrice === null ? 0n : p.hub * p.outPrice) +
            (p.sel.chainId === HUB_CHAIN_ID || p.inPrice === null ? 0n : p.hubInput * p.inPrice)
          const num = Number(formatUnits(usdProduct, USD_PRICE_DECIMALS))
          const usd = usdProduct === 0n ? '' : num > 0 && num < 0.01 ? '< $0.01' : `$${num.toFixed(2)}`
          return { usd, legs }
        },
        combine({
          source: depositSurplus,
          hub: hubSurplus,
          hubInput: hubInputSurplus,
          sel: selectedSourceRef,
          inPrice: inputPrice,
          outPrice: tokenPrice
        })
      )

      const disabled: IStream<boolean> = op(
        combine({
          alert,
          value,
          route: selectedRoute,
          sel: sourceSelection,
          existing: draftStream,
          surplus: depositSurplus,
          hubSurplus,
          hubInput: hubInputSurplus,
          feeMap: relayFeeMapQuery,
          isSwap: isSwapStream
        }),
        map(p => {
          if (p.alert !== null) return true
          if (p.value + p.surplus + p.hubSurplus + p.hubInput === 0n) return true
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
          // route.ready = a fresh quote matching the LIVE request (not one lagging a just-changed amount/source),
          // within bridge limits — the one gate that prevents baking a stale output floor into the signed intent.
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
        route: ISelectedRoute
        surplus: bigint
        hubSurplus: bigint
        hubSrc: SourceRef | null
        hubInput: bigint
        bridgeAmount: bigint
        balance: bigint | null
        allowance: bigint
      }> = combine({
        value,
        source: selectedSourceRef,
        route: selectedRoute,
        surplus: depositSurplus,
        hubSurplus,
        hubSrc: hubInputSource,
        hubInput: hubInputSurplus,
        bridgeAmount: bridgeAmountStream,
        balance: selectedBalance,
        allowance: walletAllowance
      })
      // Snapshot the inputs on a Save click. Every quote-needing path gates Save on route.ready, so the snapshot
      // already carries the quote it will bake (hub-only deposits and the recognize-only recovery carry none).
      const submitResolved = multicast(
        op(
          sample(submitParams, submitTrigger),
          map(base => ({ base, quote: base.route.quote }))
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
      const $percentSlider = $editorPercentSlider({
        value: sliderValue,
        ariaLabel: 'Deposit percentage',
        disabled: sliderDisabled,
        error: hasError
      })({ change: sliderPercentTether() })


      const amountUsd: IStream<string> = amountUsdLabel(value, inputPrice)
      const $alert = $surplusAlertSlot({
        alert,
        amountUsd,
        surplus: surplusInfo,
        $note: $legs =>
          $column(spacing.small, style({ maxWidth: '260px', whiteSpace: 'normal' }))(
            $node(
              $text(
                'An earlier deposit reached your route but was never recognized. It is recovered into your account alongside this input.'
              )
            ),
            $legs
          ),
        $legAddress: leg =>
          $contractIdentity({
            address: surplusRoute,
            chainId: leg.chainId,
            name: 'Deposit route',
            showAddress: true
          })
      })

      const $maxButton = $maxAmountButton(value, selectedBalance, clickMaxTether(nodeEvent('click')))

      const $topSection = $TokenSelectFlow({
        hideBalances,
        value: selectedOption,
        optionList,
        $container: $row(
          style({
            padding: '18px 28px',
            borderRadius: '22px 22px 0 0',
            background: palette.background,
            margin: '-28px -28px 0px',
            width: '450px',
            gap: '12px',
            alignItems: 'center'
          })
        ),
        $inputContent: $anchor =>
          $node(style({ display: 'contents' }))(
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
            $anchor
          )
      })({ select: selectOptionTether(), selecting: selectingSourceTether() })

      return [
        $column(spacing.default, style({ minWidth: '380px' }))(
          $topSection,
          // The selection list owns the WHOLE popover: everything below the top section hides while selecting.
          // Visibility only, never a mount toggle — the fee editor's route stream is tethered in here.
          $node(
            style({ display: 'contents' }),
            styleBehavior(map(s => (s ? { display: 'none' } : { display: 'contents' }), selectingSource))
          )(
          $node(style({ margin: '0 -28px', display: 'flex' }))($percentSlider),

          $row(spacing.small, style({ alignItems: 'center', fontSize: text.sm }))(
            // Swap fee shares the Save row: hidden when a blocking alert shows (the alert already displays under the
            // input), dimmed when there's no route to quote. Visibility only, never a mount toggle.
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
            )($swapProviderFee),
            $node(style({ flex: 1 }))(),
            $ButtonPrimaryOutline({
              disabled: map(p => p.d || p.s, combine({ d: disabled, s: saving })),
              $content: $text(map(s => (s ? 'Saving…' : 'Save'), saving))
            })({ click: clickAddDraftTether() })
          )
          )
        ),
        (() => {
          const changeDraft: IStream<IDepositDraft> = op(
            submitResolved,
            map(async ({ base, quote }): Promise<IDepositDraft> => {
              // Hub-local recovery pivot: nothing on the origin side, but a symbol-matched input surplus sits on the
              // HUB route (a failed destination swap delivered the input token there). Substituting the hub source
              // makes the ordinary swap-deposit build below produce the hub-local recovery swap — no wallet leg
              // (value is 0), the swap consumes the stranded route surplus.
              const pivotToHub =
                base.value === 0n &&
                base.surplus === 0n &&
                base.hubInput > 0n &&
                base.hubSrc !== null &&
                base.source.isSwap &&
                base.source.chainId !== HUB_CHAIN_ID
              const source = pivotToHub && base.hubSrc !== null ? base.hubSrc : base.source
              const surplus = pivotToHub ? base.hubInput : base.surplus
              const [feeMap, inputFeeMap, chainLiveness] = await Promise.all([
                context.getRelayFeeMap(HUB_CHAIN_ID, token),
                context.getRelayFeeMap(HUB_CHAIN_ID, source.routeTokenId),
                context.getChainLiveness()
              ])
              const originChainId = source.chainId
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

              if (source.isSwap) {
                const swapToken = source.routeToken
                // Wallet sends only the new amount; the swap consumes that plus any
                // unprocessed input-token surplus already sitting on the route.
                const walletSend = base.value
                const swapInput = base.value + surplus
                // Composed route: leg 1 is the SAME-ASSET bridge (an ordinary swap intent delivering the input's
                // hub twin to the route); leg 2 converts it to the base locally on the hub, signed at execution.
                const composed = quote !== null && quote.provider === 'Composed' ? quote : null
                const legQuote = composed !== null ? composed.bridge : quote
                const swapOutputAmount = quote?.outputAmount ?? 0n
                const swapRelayFee =
                  base.route.forInput !== null ? swapInput - base.route.forInput : inputFeeMap.swap.relayFee
                const originBlockNumber = chainHeadBlock(chainLiveness, resolveDispatchChainId(originChainId))
                const swapWalletStep: { kind: 'walletTransfer'; input: IDepositRoute } | null =
                  walletSend === 0n
                    ? null
                    : source.isNative
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
                  inputAmount: { amount: swapInput, baseToken: source.routeTokenId },
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
                    inputToken: source.routeTokenId,
                    outputToken: composed !== null ? composed.hubToken : token,
                    blockNumber: originBlockNumber,
                    deadline,
                    acceptableRelayFee: swapRelayFee,
                    nonce: randomNonce(),
                    chainId: BigInt(originChainId),
                    inputAmount: swapInput,
                    destinationChainId: BigInt(HUB_CHAIN_ID),
                    route:
                      legQuote !== null && isExecutableSwapRoute(legQuote.route)
                        ? legQuote.route
                        : { kind: 'swap', provider: ADDRESS_ZERO, providerCallData: '0x' },
                    outputAmount: legQuote?.outputAmount ?? 0n,
                    fillDeadline: legQuote?.fillDeadline ?? 0,
                    userDeploySig: '0x',
                    userSignerProof: '0x'
                  },
                  hubSwap: composed !== null ? { inputToken: composed.hubToken, estimateOut: composed.outputAmount } : null,
                  surplus
                }
              }

              const topUp = base.value > 0n ? base.value + homeRecognizeFee : 0n
              const inputToken = source.routeToken

              const walletStep: { kind: 'walletTransfer'; input: IDepositRoute } | null =
                topUp === 0n
                  ? null
                  : source.isNative
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

              const recognizeAmount = topUp + surplus

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
                  route:
                    quote !== null && isExecutableSwapRoute(quote.route)
                      ? quote.route
                      : {
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
