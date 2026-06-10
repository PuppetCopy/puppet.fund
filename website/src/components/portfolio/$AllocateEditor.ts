import { FLOAT_PRECISION, HUB_CHAIN_ID, TOKEN_ID } from '@puppet/contracts/const'
import type { IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import type { IFund } from '@puppet/indexer-graphql/entities'
import { predictDepositRoute, symbolForBaseTokenId } from '@puppet/sdk/account'
import { formatThrownError } from '@puppet/sdk/compact'
import { ADDRESS_ZERO, BYTES32_ZERO, CHAIN_LIST, type ChainId } from '@puppet/sdk/const'
import { readableAddress, readableTokenAmount, readableTokenAmountLabel } from '@puppet/sdk/core'
import { getTokenDescription } from '@puppet/sdk/gmx'
import {
  computeClaimable,
  fetchDepositRouteBalance,
  getPuppetRedeemPosition,
  type ISubaccountState,
  type ITokenRegistryMap,
  livePuppetRedeemPosition,
  liveSelect,
  randomNonce,
  tokenInfoFor
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
  sampleMap,
  skipRepeats,
  skipRepeatsWith,
  start,
  switchLatest,
  switchMap,
  switchPromises
} from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $element, $node, $text, attr, component, type I$Node, type INode, nodeEvent, style } from 'aelea/ui'
import { $column, $defaultPopoverContentContainer, $Popover, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { type Address, formatUnits, getAddress, type Hex, isAddressEqual, toHex } from 'viem'
import {
  $amountDisplay,
  $ButtonSecondary,
  $DropSelect,
  $defaultDropdownContainer,
  $defaultMiniButtonSecondary,
  $defaultSliderContainer,
  $icon,
  $infoTooltip,
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
import { $tokenWithChainBadge } from '../../common/$chain.js'
import { fetchSwapQuote, type ISwapQuote } from '../../io/bridge/swapQuote.js'
import { fetchTokenBalances } from '../../io/chain/balances.js'
import * as context from '../../io/context.js'
import { formatUsd, latestPriceMap, priceFor } from '../../io/gmx/priceFeed.js'
import { sqlClient } from '../../io/indexer/sql.js'
import { homePublicClient, type IConnectedWallet } from '../../wallet/index.js'
import { $FulfillEditor } from './$FulfillEditor.js'
import { $ClaimEditor, $RedeemEditor } from './$RedeemEditor.js'
import { $optionRow, $tokenIconBySymbol, decorateOptionList, type ITokenInputOption } from './$tokenOption.js'
import type { IAllocateDraft, IClaimDraft, IFulfillDraft, IMasterFundStep, ISellDraft } from './draft.js'
import { DEFAULT_DEADLINE_SEC, walletClientForChain } from './runner/_shared.js'
import { gatherMatched } from './runner/allocate.js'

export interface I$AllocateEditor {
  account: IStream<ISubaccountState>
  walletAccount: IConnectedWallet
  tokenRegistry: ITokenRegistryMap
  initialBaseTokenId?: IStream<Hex>
  fundName?: IStream<string>
  draft?: IStream<IAllocateDraft | null>
  $profile?: I$Node
}

export const $AllocateEditor = ({
  account,
  walletAccount,
  tokenRegistry,
  initialBaseTokenId,
  fundName,
  draft,
  $profile
}: I$AllocateEditor) =>
  component(
    (
      [popEditor, popEditorTether]: IBehavior<PointerEvent, 'allocate' | 'redeem' | 'claim' | 'fulfill'>,
      [clickSave, clickSaveTether]: IBehavior<PointerEvent>,
      [inputAmount, inputAmountTether]: IBehavior<bigint>,
      [focusEvt, focusEvtTether]: IBehavior<FocusEvent>,
      [blurEvt, blurEvtTether]: IBehavior<FocusEvent>,
      [sliderPercent, sliderPercentTether]: IBehavior<number>,
      [clickMax, clickMaxTether]: IBehavior<INode<HTMLButtonElement>, MouseEvent>,
      [enterPress, enterPressTether]: IBehavior<KeyboardEvent>,
      [changeRedeemDraft, changeRedeemDraftTether]: IBehavior<ISellDraft | IClaimDraft>,
      [changeFulfillDraft, changeFulfillDraftTether]: IBehavior<IFulfillDraft>,
      [selectOption, selectOptionTether]: IBehavior<ITokenInputOption>
    ) => {
      type ISelSource = { chainId: number; isNative: boolean; tokenId: Hex | null }
      const selectSource: IStream<ISelSource> = op(
        selectOption,
        map(opt => {
          void walletClientForChain(walletAccount.walletClient, opt.chainId).catch(err =>
            console.error('[master fund] wallet chain switch failed', err)
          )
          return { chainId: opt.chainId, isNative: opt.address === ADDRESS_ZERO, tokenId: opt.tokenId }
        })
      )
      const storedToSel = (s: IDepositSource): ISelSource | null => {
        if (s.address === ADDRESS_ZERO) return { chainId: s.chainId, isNative: true, tokenId: TOKEN_ID.WETH }
        const chainMap = tokenRegistry.get(s.chainId as ChainId)
        if (!chainMap) return null
        for (const [tid, info] of chainMap) {
          if (isAddressEqual(info.token, s.address)) return { chainId: s.chainId, isNative: false, tokenId: tid }
        }
        return null
      }
      // Shares the deposit editor's persisted funding-source preference: it is the user's
      // wallet-domain choice, so picking a token in either editor carries over to both.
      // Merged into the selection state so the write half stays subscribed for the
      // editor's whole life.
      const persistedSource: IStream<IDepositSource | null> = uiStorage.replayWrite(
        depositSourceKey(walletAccount.address),
        map(opt => ({ chainId: opt.chainId, address: opt.address }), selectOption)
      )
      const savedSel: IStream<ISelSource> = op(
        persistedSource,
        map(s => (s === null ? null : storedToSel(s))),
        filter((s): s is ISelSource => s !== null)
      )
      const sourceSel: IStream<ISelSource> = state(
        { chainId: HUB_CHAIN_ID, isNative: false, tokenId: null },
        merge(selectSource, savedSel)
      )

      const fundQuery: IStream<IFund | undefined> = op(
        account,
        map(a => a.account),
        skipRepeatsWith((a, b) => a === b),
        switchMap(fundAddress =>
          op(
            liveSelect(sqlClient, 'Fund', { where: { id: { _eq: getAddress(fundAddress) } } }),
            map(rows => rows[0])
          )
        ),
        state(undefined)
      )
      const baseTokenId: IStream<Hex | null> = op(
        combine({ fund: fundQuery, initial: initialBaseTokenId ?? just(null) }),
        map(p => p.fund?.baseTokenId ?? p.initial),
        skipRepeatsWith((a, b) => a === b),
        state(null)
      )

      // Every allocate carries the fund's REAL name: the contract re-derives the
      // ShareToken from (baseTokenId, name) and the attestor pins it, so a seeded fund
      // uses its indexed creation name and only an unseeded one takes the typed name.
      const fundNameHex: IStream<Hex> = op(
        combine({ fund: fundQuery, raw: fundName ?? just('') }),
        map(p => {
          if (p.fund?.name) return p.fund.name as Hex
          const raw = p.raw.trim()
          return raw ? toHex(raw, { size: 32 }) : BYTES32_ZERO
        }),
        state(BYTES32_ZERO)
      )

      const balanceQuery = op(
        baseTokenId,
        filter((bid): bid is Hex => bid !== null),
        switchMap(bid => {
          const sym = symbolForBaseTokenId(bid)
          return fromPromise(
            fetchTokenBalances(
              walletAccount.address,
              CHAIN_LIST.flatMap(chain => {
                const chainMap = tokenRegistry.get(chain.id as ChainId)
                if (!chainMap) return []
                const out = [...chainMap.values()].map(info => ({ chainId: chain.id, tokenAddress: info.token }))
                if (chain.nativeCurrency.symbol === 'ETH' && chainMap.has(TOKEN_ID.WETH)) {
                  out.push({ chainId: chain.id, tokenAddress: ADDRESS_ZERO })
                }
                return out
              }),
              walletAccount.walletClient
            )
          )
        }),
        state()
      )

      const balanceValue: IStream<bigint> = op(
        combine({ list: balanceQuery, sel: sourceSel, bid: baseTokenId }),
        map(p => {
          if (p.bid === null) return 0n
          const tokenId = p.sel.tokenId ?? p.bid
          const addr = p.sel.isNative
            ? ADDRESS_ZERO
            : (tokenRegistry.get(p.sel.chainId as ChainId)?.get(tokenId)?.token ?? null)
          if (addr === null) return 0n
          return p.list.find(b => b.chainId === p.sel.chainId && b.tokenAddress === addr)?.balance ?? 0n
        }),
        state(0n)
      )
      const sliderAmount: IStream<bigint> = sampleMap(
        (bal, pct) => {
          const bp = BigInt(Math.round(Math.max(0, Math.min(1, pct)) * 10000))
          return (bal * bp) / 10000n
        },
        balanceValue,
        sliderPercent
      )
      const maxAmount: IStream<bigint> = sampleMap(bal => bal, balanceValue, clickMax)
      const draftValue: IStream<IAllocateDraft | null> = draft ?? just(null)
      const draftHydration: IStream<bigint> = map(d => d?.masterAmount ?? 0n, draftValue)
      const value: IStream<bigint> = op(merge(inputAmount, sliderAmount, maxAmount, draftHydration), state(0n))

      const inputBridgeFee: IStream<bigint> = op(
        combine({ sel: sourceSel, bid: baseTokenId }),
        switchMap(p => {
          const tokenId = p.sel.tokenId ?? p.bid
          if (tokenId === null) return just(0n)
          return map(fm => fm.bridge.relayFee, context.relayFeeMapForToken(tokenId))
        }),
        skipRepeats,
        state(0n)
      )

      type IQuoteStatus =
        | { status: 'idle'; quote: ISwapQuote | null }
        | { status: 'error'; quote: null; message: string }
      const quoteSigner: IStream<Address> = op(
        account,
        map(a => a.signer),
        skipRepeatsWith((a, b) => a === b)
      )
      // Quotes fire only on user-driven changes (source, base token, amount); the relay fee
      // and signer are SAMPLED at trigger time as a snapshot, so gas movement alone never
      // re-fetches a quote.
      const quoteTrigger = op(
        combine({ sel: sourceSel, bid: baseTokenId, amount: value }),
        skipRepeatsWith(
          (a, b) =>
            a.bid === b.bid &&
            a.amount === b.amount &&
            a.sel.chainId === b.sel.chainId &&
            a.sel.tokenId === b.sel.tokenId &&
            a.sel.isNative === b.sel.isNative
        )
      )
      const quoteParams = debounce(
        200,
        sampleMap(
          (snap, t) => ({ ...t, fee: snap.fee, signer: snap.signer }),
          combine({ fee: inputBridgeFee, signer: quoteSigner }),
          quoteTrigger
        )
      )
      const quoteFetch: IStream<Promise<IQuoteStatus>> = op(
        quoteParams,
        map(async (p): Promise<IQuoteStatus> => {
          if (p.bid === null) return { status: 'idle', quote: null }
          const tokenId = p.sel.tokenId ?? p.bid
          const needsQuote = tokenId !== p.bid || p.sel.chainId !== HUB_CHAIN_ID
          if (!needsQuote || p.amount === 0n) return { status: 'idle', quote: null }
          const inputToken = tokenRegistry.get(p.sel.chainId as ChainId)?.get(tokenId)?.token
          if (!inputToken) return { status: 'idle', quote: null }
          const input = p.amount > p.fee ? p.amount - p.fee : 0n
          if (input === 0n) return { status: 'idle', quote: null }
          try {
            const quote = await fetchSwapQuote({
              originChainId: p.sel.chainId,
              destinationChainId: HUB_CHAIN_ID,
              inputToken,
              outputToken: tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, p.bid).token,
              inputAmount: input,
              route: predictDepositRoute(p.signer)
            })
            return { status: 'idle', quote }
          } catch (err) {
            console.error('[$AllocateEditor.quoteFetch] quote failed', err)
            return { status: 'error', quote: null, message: formatThrownError(err) }
          }
        }),
        state()
      )
      const quoteQuery: IStream<IQuoteStatus> = op(
        quoteFetch,
        switchPromises,
        state({ status: 'idle', quote: null } as IQuoteStatus)
      )

      const effectiveBase: IStream<bigint> = op(
        combine({ sel: sourceSel, bid: baseTokenId, q: quoteQuery, value }),
        map(p => {
          if (p.bid === null) return 0n
          const tokenId = p.sel.tokenId ?? p.bid
          const needsQuote = tokenId !== p.bid || p.sel.chainId !== HUB_CHAIN_ID
          if (!needsQuote) return p.value
          return p.q.status === 'idle' ? (p.q.quote?.outputAmount ?? 0n) : 0n
        }),
        state(0n)
      )
      const settledValue: IStream<bigint> = debounce(160, effectiveBase)

      const emptyMatched = {
        puppetList: [] as Address[],
        bodyList: [] as Hex[],
        mandateList: [] as Hex[],
        matchedAmountList: [] as bigint[],
        totalMatched: 0n
      }
      const projection = op(
        sampleMap(
          (env, masterAmount) => ({ ...env, masterAmount }),
          combine({ health: context.indexerHealth, acc: account, bid: baseTokenId }),
          settledValue
        ),
        switchMap(async p => {
          if (p.bid === null)
            return { masterAmount: p.masterAmount, surplus: 0n, matched: emptyMatched, totalPuppets: 0 }
          try {
            const baseToken = tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, p.bid).token
            const surplus = await fetchDepositRouteBalance(homePublicClient, baseToken, p.acc.signer)
            const total = p.masterAmount + surplus
            const gathered = await gatherMatched(sqlClient, p.health, p.acc.account, baseToken, p.bid, total, p.acc)
            return {
              masterAmount: total,
              surplus,
              matched: gathered.matched,
              totalPuppets: gathered.totalPuppets
            }
          } catch (err) {
            console.error('allocation projection failed', err)
            return { masterAmount: p.masterAmount, surplus: 0n, matched: emptyMatched, totalPuppets: 0 }
          }
        }),
        state()
      )

      const relayFeeRaw: IStream<bigint> = op(
        combine({ fund: fundQuery, bid: baseTokenId }),
        switchMap(p =>
          p.bid === null
            ? just(0n)
            : map(
                fm => (p.fund?.seeded ? fm.allocate : fm.createFundAccount).relayFee,
                context.relayFeeMapForToken(p.bid)
              )
        ),
        state(0n)
      )
      const allocationFloor: IStream<bigint> = op(
        combine({ fund: fundQuery, fee: relayFeeRaw }),
        map(p => (p.fund?.seeded ? 1n : p.fee * 10n)),
        state(1n)
      )
      const totalAllocation: IStream<bigint> = op(
        projection,
        map(p => p.masterAmount + p.matched.totalMatched),
        state(0n)
      )

      const nameOk: IStream<boolean> = op(
        combine({ fund: fundQuery, name: fundNameHex }),
        map(p => (p.fund?.seeded ?? false) || p.name !== BYTES32_ZERO),
        state(false)
      )

      const canSubmit: IStream<boolean> = map(
        p => p.value <= p.balance && p.total > 0n && p.total >= p.floor && p.nameOk && p.q.status !== 'error',
        combine({ value, balance: balanceValue, total: totalAllocation, floor: allocationFloor, nameOk, q: quoteQuery })
      )
      const enterSubmit: IStream<unknown> = op(
        sampleMap((can, _evt) => can, canSubmit, enterPress),
        filter(Boolean)
      )

      const buildFundSteps = (
        params: IAccountLib__AccountInitParams,
        bid: Hex,
        inputTokenId: Hex,
        amount: bigint,
        src: { chainId: number; isNative: boolean },
        walletBalance: bigint,
        quote: ISwapQuote | null,
        bridgeFee: bigint
      ): IMasterFundStep[] => {
        const srcChain = src.chainId
        const deadline = BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC)
        const token = tokenInfoFor(tokenRegistry, srcChain as ChainId, inputTokenId).token
        const fund: IMasterFundStep = src.isNative
          ? {
              kind: 'transferToMasterWnt',
              input: { chainId: srcChain, params, tokenId: inputTokenId, mode: 'native', token, amount, walletBalance }
            }
          : {
              kind: 'transferToMaster',
              input: {
                chainId: srcChain,
                params,
                tokenId: inputTokenId,
                mode: 'erc20Transfer',
                token,
                amount,
                walletBalance
              }
            }
        if ((inputTokenId === bid && srcChain === HUB_CHAIN_ID) || quote === null) return [fund]
        return [
          fund,
          {
            kind: 'bridge',
            input: {
              params,
              tokenId: inputTokenId,
              blockNumber: 0n,
              deadline,
              acceptableRelayFee: bridgeFee,
              nonce: randomNonce(),
              chainId: BigInt(srcChain),
              inputAmount: amount,
              destinationChainId: BigInt(HUB_CHAIN_ID),
              route: quote.route,
              outputAmount: quote.outputAmount,
              expires: quote.expires,
              fillDeadline: quote.fillDeadline
            }
          }
        ]
      }

      const changeDraft: IStream<IAllocateDraft> = op(
        sampleMap(
          (p): IAllocateDraft | null => {
            if (p.bid === null || p.acc.user === undefined) return null
            const tokenId = p.src.tokenId ?? p.bid
            const needsQuote = tokenId !== p.bid || p.src.chainId !== HUB_CHAIN_ID
            if (needsQuote && p.amount > 0n && (p.q.status !== 'idle' || !p.q.quote)) return null
            const params: IAccountLib__AccountInitParams = { user: p.acc.user, signer: p.acc.signer }
            const baseToken = tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, p.bid).token
            const master = p.acc.account
            const masterAmount = needsQuote ? (p.q.quote?.outputAmount ?? 0n) : p.amount
            const inputSteps =
              p.amount === 0n
                ? []
                : buildFundSteps(
                    params,
                    p.bid,
                    tokenId,
                    p.amount,
                    p.src,
                    p.balance,
                    needsQuote && p.q.status === 'idle' ? p.q.quote : null,
                    p.fee
                  )
            return {
              kind: 'allocate',
              id: `allocate:${master}`,
              account: master,
              title: 'Allocate',
              alert: null,
              master,
              masterSigner: p.acc.signer,
              baseToken,
              baseTokenId: p.bid,
              name: p.name,
              masterAmount,
              sourceChainId: p.src.chainId,
              inputSteps
            }
          },
          combine({
            acc: account,
            amount: value,
            src: sourceSel,
            balance: balanceValue,
            bid: baseTokenId,
            name: fundNameHex,
            q: quoteQuery,
            fee: inputBridgeFee
          }),
          merge(clickSave, enterSubmit)
        ),
        filter((draft): draft is IAllocateDraft => draft !== null)
      )

      const accountIdentity: IStream<{ acc: ISubaccountState; fund: IFund | undefined; bid: Hex | null }> =
        skipRepeatsWith(
          (a, b) => a.acc.account === b.acc.account && a.bid === b.bid,
          combine({ acc: account, fund: fundQuery, bid: baseTokenId })
        )

      return [
        switchMap(
          ({ acc: initial, fund, bid }: { acc: ISubaccountState; fund: IFund | undefined; bid: Hex | null }) => {
            if (bid === null) return empty
            const initialBaseTokenId = bid
            const baseToken = tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, initialBaseTokenId).token
            const desc = getTokenDescription(baseToken)
            const masterAccount = initial.account
            const tokenPrice = priceFor(baseToken)
            const symbol = symbolForBaseTokenId(initialBaseTokenId) ?? desc.symbol

            type SourceRef = { chainId: number; address: Address; symbol: string; tokenId: Hex; decimals: number }
            const sources: SourceRef[] = CHAIN_LIST.flatMap(chain => {
              const chainMap = tokenRegistry.get(chain.id as ChainId)
              if (!chainMap) return []
              const entries: SourceRef[] = []
              for (const [tid, info] of chainMap) {
                if (tid !== initialBaseTokenId && (chain.id === HUB_CHAIN_ID || !context.relayFeeMapByToken.has(tid)))
                  continue
                const srcDesc = getTokenDescription(info.hubToken)
                entries.push({
                  chainId: chain.id,
                  address: info.token,
                  symbol: srcDesc.symbol,
                  tokenId: tid,
                  decimals: srcDesc.decimals
                })
              }
              if (chain.nativeCurrency.symbol === 'ETH' && chainMap.has(TOKEN_ID.WETH)) {
                if (TOKEN_ID.WETH === initialBaseTokenId || context.relayFeeMapByToken.has(TOKEN_ID.WETH)) {
                  entries.push({
                    chainId: chain.id,
                    address: ADDRESS_ZERO,
                    symbol: chain.nativeCurrency.symbol,
                    tokenId: TOKEN_ID.WETH,
                    decimals: 18
                  })
                }
              }
              return entries
            })
            const hubTokenOf = (tokenId: Hex): Address =>
              tokenRegistry.get(HUB_CHAIN_ID)?.get(tokenId)?.token ?? baseToken
            const usdText = (src: SourceRef, balance: bigint | null): IStream<string> =>
              balance === null ? just('-') : map(price => formatUsd(balance, price), priceFor(hubTokenOf(src.tokenId)))
            const toOption = (src: SourceRef, balance: bigint | null): ITokenInputOption => ({
              symbol: src.symbol,
              chainId: src.chainId,
              address: src.address,
              tokenId: src.tokenId,
              balance,
              decimals: src.decimals,
              usdValue: usdText(src, balance)
            })
            const sourceSelection: IStream<SourceRef> = map(
              sel =>
                sources.find(
                  s =>
                    s.chainId === sel.chainId &&
                    s.tokenId === (sel.tokenId ?? initialBaseTokenId) &&
                    (s.address === ADDRESS_ZERO) === sel.isNative
                ) ??
                sources.find(s => s.chainId === HUB_CHAIN_ID && s.tokenId === initialBaseTokenId) ??
                sources[0],
              sourceSel
            )
            const selectedOption: IStream<ITokenInputOption> = map(
              p =>
                toOption(
                  p.sel,
                  p.list.find(b => b.chainId === p.sel.chainId && b.tokenAddress === p.sel.address)?.balance ?? null
                ),
              combine({ sel: sourceSelection, list: balanceQuery })
            )
            const optionList: IStream<readonly ITokenInputOption[]> = map(
              p =>
                decorateOptionList(
                  sources.map(s =>
                    toOption(
                      s,
                      p.list.find(b => b.chainId === s.chainId && b.tokenAddress === s.address)?.balance ?? null
                    )
                  ),
                  p.sel,
                  opt => p.prices[hubTokenOf(opt.tokenId)]?.price ?? null,
                  initialBaseTokenId
                ),
              combine({ sel: sourceSelection, list: balanceQuery, prices: latestPriceMap })
            )

            const inputPrice: IStream<bigint | null> = op(
              sourceSelection,
              skipRepeatsWith((a, b) => a.tokenId === b.tokenId),
              switchMap(src => priceFor(hubTokenOf(src.tokenId)))
            )
            const amountUsd: IStream<string> = map(
              p => (p.amt === 0n ? '' : formatUsd(p.amt, p.price)),
              combine({ amt: value, price: inputPrice })
            )
            const seeded = fund?.seeded ?? false
            const relayFeeText: IStream<string> = map(
              p => formatUsd((seeded ? p.fm.allocate : p.fm.createFundAccount).relayFee, p.price),
              combine({ fm: context.relayFeeMapForToken(initialBaseTokenId), price: tokenPrice })
            )
            const swapFeeText: IStream<Promise<string>> = switchMap(
              p =>
                map(async q => {
                  const s = await q
                  if (s.status !== 'idle' || s.quote === null || p.inPrice === null || p.outPrice === null) return '-'
                  const feeUsd =
                    Number(formatUnits(p.amt * p.inPrice, 30)) -
                    Number(formatUnits(s.quote.outputAmount * p.outPrice, 30))
                  const feeText = feeUsd <= 0 ? '$0.00' : feeUsd < 0.01 ? '< $0.01' : `$${feeUsd.toFixed(2)}`
                  return `${feeText} via ${s.quote.provider}`
                }, quoteFetch),
              combine({ amt: value, inPrice: inputPrice, outPrice: tokenPrice })
            )
            // The row mounts as soon as the SOURCE needs a swap, with a loading dash until the
            // quote resolves, so the editor body does not jump when the fee arrives.
            const $swapResolution: I$Node = switchLatest(
              map(
                p => {
                  const tokenId = p.sel.tokenId ?? initialBaseTokenId
                  const needsQuote = tokenId !== initialBaseTokenId || p.sel.chainId !== HUB_CHAIN_ID
                  if (!needsQuote) return empty
                  return $labeledValue('Swap fee', p.amt === 0n ? $node($text('-')) : $intermediateText(swapFeeText))
                },
                combine({ sel: sourceSel, amt: value })
              )
            )
            const pendingAllocate: IStream<bigint> = draftHydration
            const fundValues = op(
              fundQuery,
              map(f => {
                const nav = f?.navPerShare ?? FLOAT_PRECISION
                return {
                  nav,
                  aum: ((f?.totalShareSupply ?? 0n) * nav) / FLOAT_PRECISION,
                  pending: ((f?.queuedShares ?? 0n) * nav) / FLOAT_PRECISION,
                  totalShareSupply: f?.totalShareSupply ?? 0n,
                  draining: (f?.seeded ?? false) && (f?.totalShareSupply ?? 0n) === 0n && (f?.totalStake ?? 0n) > 0n,
                  queuedShares: f?.queuedShares ?? 0n
                }
              })
            )
            const masterValue: IStream<bigint> = op(
              combine({ pos: livePuppetRedeemPosition(sqlClient, initial.signer, masterAccount), v: fundValues }),
              map(p => (p.pos.sharesHeld * p.v.nav) / FLOAT_PRECISION),
              state(0n)
            )
            const $allocated = $amountDisplay({
              usd: map(p => formatUsd(p.bal, p.price), combine({ bal: masterValue, price: tokenPrice })),
              amount: map(bal => readableTokenAmount(desc, bal), masterValue),
              change: map(
                p =>
                  p.pending === 0n
                    ? null
                    : {
                        usd: formatUsd(p.bal + p.pending, p.price),
                        amount: readableTokenAmount(desc, p.bal + p.pending)
                      },
                combine({ pending: pendingAllocate, bal: masterValue, price: tokenPrice })
              ),
              color: just(palette.positive),
              align: 'flex-end'
            })

            const $usdAmount = (valueSrc: IStream<bigint>): I$Node =>
              $amountDisplay({
                usd: map(p => formatUsd(p.v, p.price), combine({ v: valueSrc, price: tokenPrice })),
                amount: map(v => readableTokenAmount(desc, v), valueSrc),
                usdFontSize: text.sm,
                align: 'flex-end'
              })

            const aumValue = map(v => v.aum, fundValues)
            const pendingFulfillValue = map(v => v.pending, fundValues)
            const $aumDisplay = $amountDisplay({
              usd: map(p => formatUsd(p.v, p.price), combine({ v: aumValue, price: tokenPrice })),
              amount: map(v => readableTokenAmount(desc, v), aumValue),
              usdFontSize: text.sm,
              align: 'flex-end',
              change: map(
                p =>
                  p.pending === 0n
                    ? null
                    : {
                        usd: formatUsd(p.v + p.pending, p.price),
                        amount: readableTokenAmount(desc, p.v + p.pending)
                      },
                combine({ pending: pendingAllocate, v: aumValue, price: tokenPrice })
              ),
              color: just(palette.positive)
            })

            const liquidValue: IStream<bigint> = map(
              acc => acc.balances.get(initialBaseTokenId)?.signedBalance ?? 0n,
              account
            )
            const $stateBar: I$Node = switchLatest(
              map(
                p => {
                  const liquid = p.liquid
                  const awaiting = p.v.pending > p.v.aum ? p.v.aum : p.v.pending
                  const liquidClamped = liquid < 0n ? 0n : liquid > p.v.aum - awaiting ? p.v.aum - awaiting : liquid
                  const utilized = p.v.aum - liquidClamped - awaiting
                  const total = liquidClamped + utilized + awaiting
                  const $segment = (amount: bigint, color: string, label: string) =>
                    amount === 0n
                      ? empty
                      : $node(
                          attr({ title: `${label} ${readableTokenAmount(desc, amount)}` }),
                          style({
                            flex: String(Number((amount * 10000n) / total) / 10000),
                            backgroundColor: color,
                            height: '100%'
                          })
                        )()
                  return $row(
                    style({
                      height: '6px',
                      borderRadius: '3px',
                      overflow: 'hidden',
                      gap: '1px',
                      flex: 1,
                      alignSelf: 'center',
                      backgroundColor: colorShade(palette.foreground, 10)
                    })
                  )(
                    ...(total === 0n
                      ? []
                      : [
                          $segment(liquidClamped, palette.positive, 'Liquid'),
                          $segment(utilized, palette.indeterminate, 'Utilized'),
                          $segment(awaiting, colorShade(palette.foreground, 50), 'Awaiting redemption')
                        ])
                  )
                },
                combine({ liquid: liquidValue, v: fundValues })
              )
            )

            const focused: IStream<boolean> = state(false, merge(constant(true, focusEvt), constant(false, blurEvt)))

            const alert: IStream<string | null> = op(
              combine({
                value,
                balance: balanceValue,
                total: totalAllocation,
                floor: allocationFloor,
                nameOk,
                q: quoteQuery,
                sel: sourceSelection,
                v: fundValues
              }),
              map(p => {
                if (p.v.draining && p.value > 0n)
                  return 'Fund is draining: queued sellers must claim their proceeds before it can reopen'
                if (p.value > p.balance)
                  return `Exceeds available ${readableTokenAmountLabel({ decimals: p.sel.decimals, symbol: p.sel.symbol }, p.balance)}`
                if (p.value > 0n && p.q.status === 'error') return p.q.message
                if (p.value > 0n && p.q.quote) {
                  if (p.q.quote.isAmountTooLow)
                    return `Below bridge minimum ${readableTokenAmount(desc, p.q.quote.limits.minDeposit)}`
                  if (p.value > p.q.quote.limits.maxDeposit) return 'Amount exceeds the bridge maximum'
                }
                if (p.total > 0n && p.total < p.floor)
                  return `Pool funding must be at least ${readableTokenAmountLabel(desc, p.floor)} (10x the relay fee)`
                if (p.total > 0n && !p.nameOk) return 'Name your fund to create it'
                return null
              }),
              state(null)
            )

            const disabled: IStream<boolean> = op(
              combine({ alert, can: canSubmit }),
              map(p => p.alert !== null || !p.can),
              state(true)
            )

            const valueToShow: IStream<string> = map(
              (p: { amt: bigint; focused: boolean; sel: SourceRef }) =>
                p.amt === 0n ? '' : readableTokenAmount(p.sel.decimals, p.amt),
              filter(
                (p: { amt: bigint; focused: boolean; sel: SourceRef }) => !p.focused,
                combine({ amt: value, focused, sel: sourceSelection })
              )
            )

            const sliderValue: IStream<number> = map(
              p => (p.bal > 0n ? Number((p.amt * 10000n) / p.bal) / 10000 : 0),
              combine({ amt: value, bal: balanceValue })
            )
            const sliderDisabled: IStream<boolean> = map(b => b === 0n, balanceValue)
            const hasError: IStream<boolean> = map(a => a !== null, alert)

            const $field = switchLatest(
              map(
                src =>
                  $TokenAmountInput({ decimals: src.decimals, valueToShow })({
                    inputAmount: inputAmountTether(),
                    focus: focusEvtTether(),
                    blur: blurEvtTether(),
                    enter: enterPressTether()
                  }),
                op(
                  sourceSelection,
                  skipRepeatsWith((a, b) => a.decimals === b.decimals)
                )
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
              combine({ amt: value, bal: balanceValue })
            )

            const $percentSlider = $Slider({
              value: sliderValue,
              step: 0.01,
              orientation: 'horizontal',
              ariaLabel: 'Allocation percentage',
              disabled: sliderDisabled,
              error: hasError,
              motion: { stiffness: 800, damping: 58 },
              $container: $defaultSliderContainer(
                style({ height: '14px', width: '100%', margin: '-26px 0', flexShrink: '0' })
              )
            })({ change: sliderPercentTether() })

            const $alertSlot = $node(style({ height: NOTE_TOOLTIP_HEIGHT, display: 'flex', alignItems: 'center' }))(
              switchMap(
                p =>
                  p.msg
                    ? $noteTooltip($text(p.msg))
                    : $node(style({ color: palette.foreground, fontSize: text.xs }))($text(p.usd)),
                combine({ msg: alert, usd: start('', amountUsd) })
              )
            )

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

            // The base structure mounts immediately and async results FILL the slots: only
            // the variable-length parts (puppet rows, surplus) switch, so resolving queries
            // never shove the surrounding rows around.
            const projectionValue = start(
              { masterAmount: 0n, surplus: 0n, matched: emptyMatched, totalPuppets: 0 },
              projection
            )
            const $puppetRows = switchMap(p => {
              if (p.matched.puppetList.length === 0) return empty
              return $column(spacing.small)(
                ...p.matched.puppetList.map((puppet, i) =>
                  $row(spacing.small, style({ alignItems: 'center', fontSize: text.sm }))(
                    $node(style({ color: palette.foreground, fontFamily: 'monospace' }))(
                      $text(readableAddress(puppet))
                    ),
                    $node(style({ flex: 1 }))(),
                    $node(style({ color: palette.message }))(
                      $text(readableTokenAmount(desc, p.matched.matchedAmountList[i] ?? 0n))
                    )
                  )
                )
              )
            }, projectionValue)
            const $surplusRow = switchMap(
              p =>
                p.surplus > 0n ? $labeledValue('Carried surplus', $text(readableTokenAmount(desc, p.surplus))) : empty,
              projectionValue
            )
            const $projectionRows = $column(spacing.small)(
              $labeledValue(
                $text(
                  map(p => `Matched (${p.matched.puppetList.length} / ${p.totalPuppets} puppets)`, projectionValue)
                ),
                $text(map(p => readableTokenAmount(desc, p.matched.totalMatched), projectionValue))
              ),
              $puppetRows,
              $surplusRow,
              $labeledValue('Relay fee', $text(start('-', relayFeeText))),
              $swapResolution
            )

            const $editor = $column(spacing.default, style({ minWidth: '380px' }))(
              $row(
                style({
                  padding: '18px 28px',
                  borderRadius: '22px 22px 0 0',
                  background: palette.background,
                  margin: '-28px -28px 0px',
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
                  $node(style({ color: palette.foreground, fontSize: text.sm, fontWeight: '500' }))($text('Fund')),
                  $row(spacing.small, style({ alignItems: 'center' }))($field, $maxButton),
                  $alertSlot
                ),
                $picker
              ),
              $node(style({ margin: '0 -26px', display: 'flex' }))($percentSlider),
              $projectionRows,
              $row(spacing.small, style({ alignItems: 'center' }))(
                $node(style({ flex: 1 }))(),
                $ButtonSecondary({ disabled, $content: $text('Save') })({ click: clickSaveTether() })
              )
            )

            const $redeemEditor = $RedeemEditor({
              puppet: initial.signer,
              masterAccount,
              baseToken,
              baseTokenId: initialBaseTokenId,
              tokenRegistry
            })({ changeDraft: changeRedeemDraftTether() })

            const $claimEditor = $ClaimEditor({
              puppet: initial.signer,
              masterAccount,
              baseToken,
              baseTokenId: initialBaseTokenId,
              tokenRegistry
            })({ changeDraft: changeRedeemDraftTether() })

            const $fulfillEditor = $FulfillEditor({
              master: masterAccount,
              masterAccount,
              account,
              baseToken,
              baseTokenId: initialBaseTokenId,
              tokenRegistry
            })({ changeDraft: changeFulfillDraftTether() })

            const redeemPositionQuery = op(
              fromPromise(getPuppetRedeemPosition(sqlClient, initial.signer, masterAccount)),
              state()
            )
            const redeemDisabled: IStream<boolean> = op(
              redeemPositionQuery,
              map(p => p.sharesHeld === 0n),
              start(true)
            )
            const claimDisabled: IStream<boolean> = op(
              redeemPositionQuery,
              map(p => computeClaimable(p) === 0n),
              start(true)
            )
            // Fulfill can retire poolShares - 1 normally, or the ENTIRE pool when the store
            // holds the whole supply (full unwind), so 1 queued wei-share is only
            // fulfillable when it IS the supply.
            const fulfillDisabled: IStream<boolean> = op(
              fundValues,
              map(v => !(v.queuedShares >= 2n || (v.queuedShares > 0n && v.queuedShares === v.totalShareSupply))),
              start(true)
            )

            const $fulfillSlot = $ButtonSecondary({
              $container: $defaultMiniButtonSecondary,
              disabled: fulfillDisabled,
              $content: $text('Fulfill')
            })({ click: popEditorTether(constant('fulfill')) })

            const claimableValue: IStream<bigint> = op(
              redeemPositionQuery,
              map(p => computeClaimable(p)),
              start(0n)
            )

            const $groupLabel = (label: string): I$Node =>
              $node(style({ color: palette.foreground, fontSize: text.lg, fontWeight: '500', letterSpacing: '0.5px' }))(
                $text(label)
              )

            const $actionRow = ($button: I$Node, label: string, tooltip: string, $value: I$Node): I$Node =>
              $row(spacing.default, style({ alignItems: 'center' }))(
                $node(style({ minWidth: '180px', display: 'flex' }))($labeledValue(label, '', $node($text(tooltip)))),
                $button,
                $node(style({ flex: 1 }))(),
                $value
              )

            return $Popover({
              $container: $node(style({ flex: 1, display: 'flex' })),
              $contentContainer: $defaultPopoverContentContainer(style({ width: '450px' })),
              dismiss: merge(changeDraft, changeRedeemDraft, changeFulfillDraft),
              $target: $column(spacing.big, style({ padding: '4px', borderRadius: '4px', flex: 1 }))(
                $row(spacing.default, style({ alignItems: 'center' }))(
                  ...($profile ? [$profile] : []),
                  $ButtonSecondary({
                    $container: $defaultMiniButtonSecondary,
                    $content: $row(spacing.tiny, style({ alignItems: 'center' }))(
                      $tokenIconBySymbol(symbol, '18px'),
                      $node(style({ color: palette.foreground }))($text(symbol)),
                      $text('Fund')
                    )
                  })({ click: popEditorTether(constant('allocate')) }),
                  $node(style({ flex: 1 }))(),
                  $aumDisplay
                ),
                $column(spacing.small)(
                  $row(spacing.big, style({ alignItems: 'center' }))(
                    $row(spacing.tiny, style({ alignItems: 'center' }))(
                      $groupLabel('Redeem'),
                      $infoTooltip(
                        $node(style({ display: 'block', maxWidth: '280px', whiteSpace: 'normal', fontSize: text.sm }))(
                          $text(
                            'Exiting a fund happens in three steps. Sell queues your shares for redemption. Fulfill retires the queued shares by paying base currency out of the fund at the current share value, split across everyone in the queue. Claim then withdraws your accrued payout to your balance. The bar shows how much of the fund is liquid, utilized in positions, or awaiting redemption.'
                          )
                        ),
                        colorShade(palette.foreground, 60),
                        '20px'
                      )
                    ),
                    $stateBar
                  ),
                  $actionRow(
                    $ButtonSecondary({
                      $container: $defaultMiniButtonSecondary,
                      disabled: redeemDisabled,
                      $content: $text('Sell')
                    })({ click: popEditorTether(constant('redeem')) }),
                    'Your stake',
                    'Your share of the fund. Selling queues shares for redemption, and the fund buys them back at the next fulfillment.',
                    $allocated
                  ),
                  $actionRow(
                    $fulfillSlot,
                    'Awaiting redemption',
                    'Queued shares waiting to be bought back. Fulfilling pays base from the fund to retire them at the current value.',
                    $usdAmount(pendingFulfillValue)
                  ),
                  $actionRow(
                    $ButtonSecondary({
                      $container: $defaultMiniButtonSecondary,
                      disabled: claimDisabled,
                      $content: $text('Claim')
                    })({ click: popEditorTether(constant('claim')) }),
                    'Claimable',
                    'Base currency accrued to you from past fulfillments, ready to withdraw to your balance.',
                    $usdAmount(claimableValue)
                  )
                )
              ),
              $open: map(
                which =>
                  which === 'allocate'
                    ? $editor
                    : which === 'redeem'
                      ? $redeemEditor
                      : which === 'claim'
                        ? $claimEditor
                        : $fulfillEditor,
                popEditor
              )
            })({})
          },
          accountIdentity
        ),
        { changeDraft, changeRedeemDraft, changeFulfillDraft }
      ]
    }
  )
