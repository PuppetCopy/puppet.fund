import { PUPPET_CONTRACT_MAP } from '@puppet/contracts'
import {
  BASIS_POINTS,
  FLOAT_PRECISION,
  HUB_CHAIN_ID,
  PROTOCOL_CONFIG,
  SHARE_DECIMALS,
  TOKEN_ID
} from '@puppet/contracts/const'
import type { IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import type { IFund } from '@puppet/indexer-graphql/entities'
import { predictDepositRoute, predictShareToken, symbolForBaseTokenId } from '@puppet/sdk/account'
import { formatThrownError } from '@puppet/sdk/compact'
import { ADDRESS_ZERO, BYTES32_ZERO, CHAIN_LIST, CHAIN_MAP, type ChainId, HUB_CHAIN } from '@puppet/sdk/const'
import {
  applyFactor,
  getAccountExplorerUrl,
  readableAddress,
  readableTokenAmount,
  readableTokenAmountLabel,
  readableUnitAmount,
  SHARE_PRECISION,
  sharesFor
} from '@puppet/sdk/core'
import { getTokenDescription } from '@puppet/sdk/gmx'
import {
  computeClaimable,
  computeQueuedShares,
  fetchDepositRouteBalance,
  getPuppetRedeemPosition,
  type ISubaccountState,
  type ITokenRegistryMap,
  livePuppetRedeemPosition,
  liveSelect,
  randomNonce,
  select,
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
import { type Address, formatUnits, getAddress, type Hex, isAddressEqual } from 'viem'
import {
  $amountDisplay,
  $anchor,
  $ButtonSecondary,
  $ButtonToggle,
  $DropSelect,
  $defaultButtonToggleContainer,
  $defaultDropdownContainer,
  $defaultMiniButtonPrimary,
  $defaultMiniButtonSecondary,
  $defaultSliderContainer,
  $icon,
  $infoTooltip,
  $intermediateText,
  $labeledValue,
  $loadingValue,
  $noteTooltip,
  $popoverCaret,
  $redemptionGauge,
  $Slider,
  $TokenAmountInput,
  $wallet,
  NOTE_TOOLTIP_HEIGHT,
  text
} from '@/ui-components'
import { uiStorage } from '@/ui-storage'
import { $labeledDivider } from '../../common/elements/$common.js'
import { depositSourceKey, type IDepositSource } from '../../app/localStoreSchema.js'
import { $jazzicon } from '../../common/$avatar.js'
import { $chainIcon, $tokenWithChainBadge } from '../../common/$chain.js'
import { fetchSwapQuote, type ISwapQuote } from '../../io/bridge/swapQuote.js'
import { fetchTokenBalances } from '../../io/chain/balances.js'
import * as context from '../../io/context.js'
import { formatUsd, latestPriceMap, priceFor } from '../../io/gmx/priceFeed.js'
import { fetchPuppetUsers } from '../../io/indexer/query.js'
import { sqlClient } from '../../io/indexer/sql.js'
import { homePublicClient, type IConnectedWallet, publicClientMap } from '../../wallet/index.js'
import { accountNameToHex } from '../$AccountProfile.js'
import { $FulfillEditor } from './$FulfillEditor.js'
import { $fundBalances, $fundPositions } from './$fundHoldings.js'
import { $optionRow, $tokenIconBySymbol, decorateOptionList, type ITokenInputOption } from './$tokenOption.js'
import type { IAllocateDraft, IClaimDraft, IMasterFundStep, IRedeemDraft, ISellDraft, ISwapDraft } from './draft.js'
import { DEFAULT_DEADLINE_SEC, walletClientForChain } from './runner/_shared.js'
import { gatherMatched } from './runner/allocate.js'

export interface I$FundEditor {
  account: IStream<ISubaccountState>
  walletAccount: IConnectedWallet
  tokenRegistry: ITokenRegistryMap
  initialBaseTokenId?: IStream<Hex>
  fundName?: IStream<string>
  draft?: IStream<IAllocateDraft | null>
  $profile?: I$Node
  redeemDraft?: IStream<IRedeemDraft | null>
  swapDraftList?: IStream<ISwapDraft[]>
  $stubAnchor?: ($aumDisplay: I$Node, $depositButton: I$Node, $withdrawButton: I$Node, $stakeDisplay: I$Node) => I$Node
}

type IFundView = 'balances' | 'positions'

export const $FundEditor = ({
  account,
  walletAccount,
  tokenRegistry,
  initialBaseTokenId,
  fundName,
  draft,
  redeemDraft,
  swapDraftList,
  $profile,
  $stubAnchor
}: I$FundEditor) =>
  component(
    (
      [popEditor, popEditorTether]: IBehavior<any, 'allocate' | 'fulfill'>,
      [clickSave, clickSaveTether]: IBehavior<PointerEvent>,
      [inputAmount, inputAmountTether]: IBehavior<bigint>,
      [focusEvt, focusEvtTether]: IBehavior<FocusEvent>,
      [blurEvt, blurEvtTether]: IBehavior<FocusEvent>,
      [sliderPercent, sliderPercentTether]: IBehavior<number>,
      [clickMax, clickMaxTether]: IBehavior<INode<HTMLButtonElement>, MouseEvent>,
      [enterPress, enterPressTether]: IBehavior<KeyboardEvent>,
      [changeRedeemDraft, changeRedeemDraftTether]: IBehavior<ISellDraft | IClaimDraft>,
      [changeFulfillDraft, changeFulfillDraftTether]: IBehavior<IRedeemDraft>,
      [selectOption, selectOptionTether]: IBehavior<ITokenInputOption>,
      [selectView, selectViewTether]: IBehavior<IFundView>,
      [changeSwapDraft, changeSwapDraftTether]: IBehavior<ISwapDraft>
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

      const fundRowQuery: IStream<IFund | undefined> = op(
        account,
        map(a => ({ address: a.account, tx: a.lastTransactionHash })),
        skipRepeatsWith((a, b) => a.address === b.address && a.tx === b.tx),
        switchMap(({ address }) => {
          const fundArgs = { where: { id: { _eq: getAddress(address) } } }
          return op(
            merge(fromPromise(select(sqlClient, 'Fund', fundArgs)), liveSelect(sqlClient, 'Fund', fundArgs)),
            map(rows => rows[0])
          )
        }),
        state(undefined)
      )
      const fundMatch: IStream<{ row: IFund | undefined; fresh: boolean }> =
        fundName && initialBaseTokenId
          ? op(
              combine({ row: fundRowQuery, name: fundName, bid: initialBaseTokenId, acc: account }),
              map(p => {
                const raw = p.name.trim()
                if (!p.row || !raw) return { row: p.row, fresh: false }
                const expected = predictShareToken(getAddress(p.acc.signer), p.bid, accountNameToHex(raw))
                return getAddress(p.row.shareToken) === expected
                  ? { row: p.row, fresh: false }
                  : { row: undefined, fresh: true }
              }),
              state()
            )
          : op(
              fundRowQuery,
              map(row => ({ row, fresh: false }))
            )
      const fundQuery: IStream<IFund | undefined> = map(m => m.row, fundMatch)
      const freshPreview: IStream<boolean> = op(
        fundMatch,
        map(m => m.fresh),
        skipRepeats,
        state()
      )
      const baseTokenId: IStream<Hex | null> = op(
        combine({ fund: fundQuery, initial: initialBaseTokenId ?? just(null) }),
        map(p => p.fund?.baseTokenId ?? p.initial),
        skipRepeatsWith((a, b) => a === b),
        state()
      )

      const fundNameHex: IStream<Hex> = op(
        combine({ fund: fundQuery, raw: fundName ?? just('') }),
        map(p => {
          if (p.fund?.name) return p.fund.name as Hex
          const raw = p.raw.trim()
          return accountNameToHex(raw)
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
      const inputAllocateFee: IStream<bigint> = op(
        combine({ sel: sourceSel, bid: baseTokenId, fund: fundQuery }),
        switchMap(p => {
          const tokenId = p.sel.tokenId ?? p.bid
          if (tokenId === null) return just(0n)
          return map(
            fm => (p.fund?.seeded ? fm.allocate : fm.createFundAccount).relayFee,
            context.relayFeeMapForToken(tokenId)
          )
        }),
        skipRepeats,
        state(0n)
      )
      const spendableValue: IStream<bigint> = op(
        combine({
          balance: balanceValue,
          sel: sourceSel,
          bid: baseTokenId,
          allocFee: inputAllocateFee,
          bridgeFee: inputBridgeFee
        }),
        map(p => {
          const tokenId = p.sel.tokenId ?? p.bid
          const needsQuote = tokenId !== p.bid || p.sel.chainId !== HUB_CHAIN_ID
          const topUp = p.allocFee + (needsQuote ? p.bridgeFee : 0n)
          return p.balance > topUp ? p.balance - topUp : 0n
        }),
        state(0n)
      )
      const sliderAmount: IStream<bigint> = sampleMap(
        (bal, pct) => {
          const bp = BigInt(Math.round(Math.max(0, Math.min(1, pct)) * 10000))
          return (bal * bp) / 10000n
        },
        spendableValue,
        sliderPercent
      )
      const maxAmount: IStream<bigint> = sampleMap(bal => bal, spendableValue, clickMax)
      const draftValue: IStream<IAllocateDraft | null> = draft ?? just(null)
      const draftHydration: IStream<bigint> = map(d => d?.masterAmount ?? 0n, draftValue)
      const valueHydration: IStream<bigint> = map(d => d?.inputAmount ?? 0n, draftValue)
      const value: IStream<bigint> = op(merge(inputAmount, sliderAmount, maxAmount, valueHydration), state(0n))

      const originSurplus: IStream<bigint> = op(
        combine({ acc: account, bid: baseTokenId, sel: sourceSel }),
        switchMap(async p => {
          if (p.bid === null) return 0n
          const tokenId = p.sel.tokenId ?? p.bid
          if (tokenId !== p.bid || p.sel.chainId === HUB_CHAIN_ID) return 0n
          const client = publicClientMap[p.sel.chainId]
          if (!client) return 0n
          const token = tokenInfoFor(tokenRegistry, p.sel.chainId as ChainId, p.bid).token
          try {
            return await fetchDepositRouteBalance(client, token, p.acc.signer)
          } catch {
            return 0n
          }
        }),
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
      const quoteTrigger = op(
        combine({ sel: sourceSel, bid: baseTokenId, amount: value, surplus: originSurplus }),
        skipRepeatsWith(
          (a, b) =>
            a.bid === b.bid &&
            a.amount === b.amount &&
            a.surplus === b.surplus &&
            a.sel.chainId === b.sel.chainId &&
            a.sel.tokenId === b.sel.tokenId &&
            a.sel.isNative === b.sel.isNative
        )
      )
      const quoteParams = debounce(
        200,
        sampleMap(
          (snap, t) => ({ ...t, allocFee: snap.allocFee, signer: snap.signer, bridgeFee: snap.bridgeFee }),
          combine({ allocFee: inputAllocateFee, signer: quoteSigner, bridgeFee: inputBridgeFee }),
          quoteTrigger
        )
      )
      const quoteFetch: IStream<Promise<IQuoteStatus>> = op(
        quoteParams,
        map(async (p): Promise<IQuoteStatus> => {
          if (p.bid === null) return { status: 'idle', quote: null }
          const tokenId = p.sel.tokenId ?? p.bid
          const needsQuote = tokenId !== p.bid || p.sel.chainId !== HUB_CHAIN_ID
          if (!needsQuote || p.amount + p.surplus === 0n) return { status: 'idle', quote: null }
          const inputToken = tokenRegistry.get(p.sel.chainId as ChainId)?.get(tokenId)?.token
          if (!inputToken) return { status: 'idle', quote: null }
          const input =
            p.amount === 0n
              ? p.surplus > p.bridgeFee
                ? p.surplus - p.bridgeFee
                : 0n
              : p.amount + p.allocFee + p.surplus
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
            console.error('[$FundEditor.quoteFetch] quote failed', err)
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
      const surplusQuery: IStream<bigint> = op(
        combine({ acc: account, bid: baseTokenId }),
        switchMap(async p => {
          if (p.bid === null) return 0n
          const baseToken = tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, p.bid).token
          return fetchDepositRouteBalance(homePublicClient, baseToken, p.acc.signer)
        }),
        state()
      )
      const projection = op(
        combine({
          health: context.indexerHealth,
          acc: account,
          bid: baseTokenId,
          surplus: surplusQuery,
          masterAmount: settledValue
        }),
        skipRepeatsWith(
          (a, b) =>
            a.masterAmount === b.masterAmount &&
            a.surplus === b.surplus &&
            a.acc.account === b.acc.account &&
            a.bid === b.bid
        ),
        switchMap(async p => {
          const emptyUsers = new Map<Address, Address>()
          if (p.bid === null)
            return {
              masterAmount: p.masterAmount,
              surplus: 0n,
              matched: emptyMatched,
              totalPuppets: 0,
              userByPuppet: emptyUsers
            }
          try {
            const baseToken = tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, p.bid).token
            const total = p.masterAmount + p.surplus
            const gathered = await gatherMatched(sqlClient, p.health, p.acc.account, baseToken, p.bid, total, p.acc)
            const userByPuppet = await fetchPuppetUsers(gathered.matched.puppetList)
            return {
              masterAmount: total,
              surplus: p.surplus,
              matched: gathered.matched,
              totalPuppets: gathered.totalPuppets,
              userByPuppet
            }
          } catch (err) {
            console.error('allocation projection failed', err)
            return {
              masterAmount: p.masterAmount,
              surplus: 0n,
              matched: emptyMatched,
              totalPuppets: 0,
              userByPuppet: emptyUsers
            }
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
        relayFeeRaw,
        map(fee => fee * 10n),
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
        p => {
          const tokenId = p.src.tokenId ?? p.bid
          const needsQuote = tokenId !== p.bid || p.src.chainId !== HUB_CHAIN_ID
          const topUp = p.allocFee + (needsQuote ? p.bridgeFee : 0n)
          const transferAmount = p.value === 0n ? 0n : p.value + topUp
          const bridgedAmount = transferAmount + p.originSurplus
          const bridgeRatioOk =
            !needsQuote ||
            bridgedAmount === 0n ||
            bridgedAmount * PROTOCOL_CONFIG.maxRelayFeeBps >= p.bridgeFee * BASIS_POINTS
          const balanceOk = p.value === 0n || transferAmount <= p.balance
          return balanceOk && bridgeRatioOk && p.total > 0n && p.total >= p.floor && p.nameOk && p.q.status !== 'error'
        },
        combine({
          value,
          balance: balanceValue,
          total: totalAllocation,
          floor: allocationFloor,
          nameOk,
          q: quoteQuery,
          src: sourceSel,
          bid: baseTokenId,
          allocFee: inputAllocateFee,
          bridgeFee: inputBridgeFee,
          originSurplus
        })
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
        bridgeFee: bigint,
        srcDeployed: boolean,
        originSurplus: bigint
      ): IMasterFundStep[] => {
        const srcChain = src.chainId
        const deadline = BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC)
        const token = tokenInfoFor(tokenRegistry, srcChain as ChainId, inputTokenId).token
        const fund: IMasterFundStep | null =
          amount === 0n
            ? null
            : src.isNative
              ? {
                  kind: 'transferToMasterWnt',
                  input: {
                    chainId: srcChain,
                    params,
                    tokenId: inputTokenId,
                    mode: 'native',
                    token,
                    amount,
                    walletBalance
                  }
                }
              : {
                  kind: 'transferToMaster',
                  input: {
                    chainId: srcChain,
                    params,
                    tokenId: inputTokenId,
                    mode: 'erc20Gate',
                    token,
                    amount,
                    walletBalance,
                    spender: PUPPET_CONTRACT_MAP.Deposit.address
                  }
                }
        if ((inputTokenId === bid && srcChain === HUB_CHAIN_ID) || quote === null) return fund ? [fund] : []
        const deployOrigin: IMasterFundStep | null =
          srcChain === HUB_CHAIN_ID || srcDeployed
            ? null
            : {
                kind: 'createPuppetAccount',
                input: {
                  chainId: BigInt(srcChain),
                  params,
                  tokenId: inputTokenId,
                  blockNumber: 0n,
                  deadline,
                  nonce: randomNonce(),
                  acceptableRelayFee: 0n,
                  initialDepositAmount: 0n,
                  userDeploySig: '0x',
                  userSignerProof: '0x'
                }
              }
        const bridge: IMasterFundStep = {
          kind: 'bridge',
          input: {
            params,
            tokenId: inputTokenId,
            blockNumber: 0n,
            deadline,
            acceptableRelayFee: bridgeFee,
            nonce: randomNonce(),
            chainId: BigInt(srcChain),
            inputAmount: amount + originSurplus,
            destinationChainId: BigInt(HUB_CHAIN_ID),
            route: quote.route,
            outputAmount: quote.outputAmount,
            expires: quote.expires,
            fillDeadline: quote.fillDeadline
          }
        }
        const steps: Array<IMasterFundStep | null> = [fund, deployOrigin, bridge]
        return steps.filter((s): s is IMasterFundStep => s !== null)
      }

      const changeDraft: IStream<IAllocateDraft> = op(
        sampleMap(
          (p): IAllocateDraft | null => {
            if (p.bid === null || p.acc.user === undefined) return null
            const tokenId = p.src.tokenId ?? p.bid
            const needsQuote = tokenId !== p.bid || p.src.chainId !== HUB_CHAIN_ID
            if (needsQuote && p.amount + p.originSurplus > 0n && (p.q.status !== 'idle' || !p.q.quote)) return null
            const params: IAccountLib__AccountInitParams = { user: p.acc.user, signer: p.acc.signer }
            const baseToken = tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, p.bid).token
            const master = p.acc.account
            const quoteOut = p.q.quote?.outputAmount ?? 0n
            const netQuoteOut = quoteOut > p.hubFee ? quoteOut - p.hubFee : 0n
            const masterAmount = (needsQuote ? netQuoteOut : p.amount) + p.proj.surplus
            const topUp = p.allocFee + (needsQuote ? p.fee : 0n)
            const transferAmount = p.amount === 0n ? 0n : p.amount + topUp
            const inputSteps =
              p.amount === 0n && p.originSurplus === 0n
                ? []
                : buildFundSteps(
                    params,
                    p.bid,
                    tokenId,
                    transferAmount,
                    p.src,
                    p.balance,
                    needsQuote && p.q.status === 'idle' ? p.q.quote : null,
                    p.fee,
                    p.acc.chains.has(p.src.chainId),
                    p.originSurplus
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
              inputAmount: p.amount,
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
            fee: inputBridgeFee,
            allocFee: inputAllocateFee,
            hubFee: relayFeeRaw,
            proj: projection,
            originSurplus
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
                if (tid !== initialBaseTokenId && !context.relayFeeMapByToken.has(tid)) continue
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
                    Number(formatUnits((p.amt + p.allocFee) * p.inPrice, 30)) -
                    Number(formatUnits(s.quote.outputAmount * p.outPrice, 30))
                  const feeText = feeUsd <= 0 ? '$0.00' : `$${readableUnitAmount(feeUsd)}`
                  return `${feeText} via ${s.quote.provider}`
                }, quoteFetch),
              combine({ amt: value, allocFee: inputAllocateFee, inPrice: inputPrice, outPrice: tokenPrice })
            )
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
            const pendingRedeem: IStream<IRedeemDraft | null> = op(redeemDraft ?? just(null), start(null))
            const fundValues = op(
              fundQuery,
              map(f => {
                const supply = f?.totalShareSupply ?? 0n
                const nav = f?.navPerShare ?? FLOAT_PRECISION / SHARE_PRECISION
                return {
                  nav,
                  aum: (supply * nav) / FLOAT_PRECISION,
                  pending: ((f?.queuedShares ?? 0n) * nav) / FLOAT_PRECISION,
                  totalShareSupply: supply,
                  closeRate: f?.closeRate ?? 0n,
                  queuedShares: f?.queuedShares ?? 0n
                }
              })
            )
            const redeemPosition = op(
              merge(
                fromPromise(getPuppetRedeemPosition(sqlClient, initial.signer, masterAccount)),
                livePuppetRedeemPosition(sqlClient, initial.signer, masterAccount)
              ),
              state()
            )
            const masterValue: IStream<bigint> = op(
              combine({
                pos: redeemPosition,
                v: fundValues,
                fresh: freshPreview
              }),
              map(p =>
                p.fresh
                  ? 0n
                  : ((p.pos.sharesHeld + computeQueuedShares(p.pos)) * p.v.nav) / FLOAT_PRECISION +
                    computeClaimable(p.pos)
              ),
              state(0n)
            )
            const $allocated = $amountDisplay({
              usd: map(p => formatUsd(p.bal, p.price), combine({ bal: masterValue, price: tokenPrice })),
              amount: map(bal => readableTokenAmountLabel(desc, bal), masterValue),
              change: map(
                p => {
                  if (p.pending === 0n && p.redeem === null) return null
                  const heldValue = p.fresh
                    ? 0n
                    : ((p.pos.sharesHeld + computeQueuedShares(p.pos)) * p.v.nav) / FLOAT_PRECISION +
                      computeClaimable(p.pos)
                  let next = heldValue + p.pending
                  if (p.redeem !== null) {
                    if (p.redeem.liquidate) next = 0n
                    else {
                      const queueTotal = p.v.queuedShares + p.redeem.sharesOut
                      const ownPayout = queueTotal === 0n ? 0n : (p.redeem.assetsOut * p.redeem.sharesOut) / queueTotal
                      next = next > ownPayout ? next - ownPayout : 0n
                    }
                  }
                  return {
                    usd: formatUsd(next, p.price),
                    amount: readableTokenAmountLabel(desc, next)
                  }
                },
                combine({
                  pending: pendingAllocate,
                  redeem: pendingRedeem,
                  v: fundValues,
                  pos: redeemPosition,
                  fresh: freshPreview,
                  price: tokenPrice
                })
              ),
              color: map(
                p => (p.redeem !== null && p.pending === 0n ? palette.negative : palette.positive),
                combine({ pending: pendingAllocate, redeem: pendingRedeem })
              ),
              align: 'flex-end'
            })

            const $usdAmount = (valueSrc: IStream<bigint>): I$Node =>
              $amountDisplay({
                usd: map(p => formatUsd(p.v, p.price), combine({ v: valueSrc, price: tokenPrice })),
                amount: map(v => readableTokenAmountLabel(desc, v), valueSrc),
                usdFontSize: text.sm,
                align: 'flex-end'
              })

            const aumValue = map(v => v.aum, fundValues)
            const $aumDisplay = $amountDisplay({
              usd: map(p => formatUsd(p.v, p.price), combine({ v: aumValue, price: tokenPrice })),
              amount: map(v => readableTokenAmountLabel(desc, v), aumValue),
              usdFontSize: text.xl,
              align: 'flex-end',
              $between: switchLatest(
                map(
                  v =>
                    $redemptionGauge(
                      v.totalShareSupply === 0n ? 0 : Number((v.queuedShares * 10000n) / v.totalShareSupply) / 10000
                    ),
                  fundValues
                )
              ),
              change: map(
                p => {
                  if (p.pending === 0n && p.redeem === null) return null
                  const drained = p.redeem === null ? 0n : p.redeem.liquidate ? p.aum : p.redeem.assetsOut
                  const next = p.aum + p.pending - (drained < p.aum ? drained : p.aum)
                  const minted = sharesFor(p.v.totalShareSupply, p.v.aum, p.pending)
                  let queued = p.v.queuedShares
                  let supply = p.v.totalShareSupply + minted
                  if (p.redeem !== null && !p.redeem.liquidate) {
                    const retired = p.v.aum === 0n ? 0n : (p.redeem.assetsOut * p.v.totalShareSupply) / p.v.aum
                    const queuedAfter = queued + p.redeem.sharesOut - retired
                    queued = queuedAfter > 0n ? queuedAfter : 0n
                    supply = supply > retired ? supply - retired : 0n
                  }
                  const projectedRatio =
                    p.redeem?.liquidate || supply === 0n ? 0 : Number((queued * 10000n) / supply) / 10000
                  return {
                    usd: formatUsd(next, p.price),
                    amount: readableTokenAmountLabel(desc, next),
                    $between: $redemptionGauge(projectedRatio)
                  }
                },
                combine({
                  pending: pendingAllocate,
                  redeem: pendingRedeem,
                  aum: aumValue,
                  v: fundValues,
                  price: tokenPrice
                })
              ),
              color: map(
                p => (p.redeem !== null && p.pending === 0n ? palette.negative : palette.positive),
                combine({ pending: pendingAllocate, redeem: pendingRedeem })
              )
            })

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
                bid: baseTokenId,
                allocFee: inputAllocateFee,
                bridgeFee: inputBridgeFee,
                originSurplus,
                v: fundValues
              }),
              map(p => {
                if (p.v.closeRate !== 0n && p.value > 0n)
                  return 'Fund is closed: every share converts at the closing price. Pick a new name to start a fresh fund.'
                if (p.value > p.balance)
                  return `Exceeds available ${readableTokenAmountLabel({ decimals: p.sel.decimals, symbol: p.sel.symbol }, p.balance)}`
                if (p.value > 0n && p.q.status === 'error') return p.q.message
                if (p.value > 0n && p.q.quote) {
                  if (p.q.quote.isAmountTooLow)
                    return `Below bridge minimum ${readableTokenAmount(desc, p.q.quote.limits.minDeposit)}`
                  if (p.value > p.q.quote.limits.maxDeposit) return 'Amount exceeds the bridge maximum'
                }
                const needsQuote = (p.sel.tokenId ?? p.bid) !== p.bid || p.sel.chainId !== HUB_CHAIN_ID
                if (needsQuote) {
                  const topUp = p.allocFee + p.bridgeFee
                  const bridgedAmount = (p.value === 0n ? 0n : p.value + topUp) + p.originSurplus
                  const minInput =
                    (p.bridgeFee * BASIS_POINTS + PROTOCOL_CONFIG.maxRelayFeeBps - 1n) / PROTOCOL_CONFIG.maxRelayFeeBps
                  if (bridgedAmount > 0n && bridgedAmount < minInput) {
                    const add = minInput - bridgedAmount
                    return `Add at least ${readableTokenAmountLabel({ decimals: p.sel.decimals, symbol: p.sel.symbol }, add)}: bridging less makes the relay fee exceed ${Number(PROTOCOL_CONFIG.maxRelayFeeBps) / 100}% of the transfer`
                  }
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

            const surplusInfo: IStream<{ amount: bigint; legs: Array<{ chainId: number; amount: bigint }> }> = map(
              p => {
                const legs: Array<{ chainId: number; amount: bigint }> = []
                if (p.hub > 0n) legs.push({ chainId: HUB_CHAIN_ID, amount: p.hub })
                if (p.origin > 0n) legs.push({ chainId: p.sel.chainId, amount: p.origin })
                return { amount: p.hub + p.origin, legs }
              },
              combine({
                hub: start(
                  0n,
                  map(x => x.surplus, projection)
                ),
                origin: originSurplus,
                sel: sourceSel
              })
            )
            const surplusRoute = predictDepositRoute(initial.signer)
            const $alertSlot = $node(style({ height: NOTE_TOOLTIP_HEIGHT, display: 'flex', alignItems: 'center' }))(
              switchMap(
                p =>
                  p.msg
                    ? $noteTooltip($text(p.msg))
                    : $row(spacing.small, style({ alignItems: 'center' }))(
                        $node(style({ color: palette.foreground, fontSize: text.xs }))($text(p.usd)),
                        ...(p.surplus.amount > 0n
                          ? [
                              $row(spacing.tiny, style({ alignItems: 'center' }))(
                                $node(style({ color: palette.positive, fontSize: text.xs }))(
                                  $text(`+ ${readableTokenAmount(desc, p.surplus.amount)}`)
                                ),
                                $infoTooltip(
                                  $column(spacing.small)(
                                    $node(
                                      $text(
                                        `A prior deposit that reached your fund's route but was never recognized. It is recovered into the fund alongside this input.`
                                      )
                                    ),
                                    $column(spacing.tiny)(
                                      ...p.surplus.legs.map(leg =>
                                        $row(spacing.small, style({ alignItems: 'center' }))(
                                          $chainIcon(leg.chainId, 14),
                                          $node(style({ color: palette.positive }))(
                                            $text(`+${readableTokenAmount(desc, leg.amount)}`)
                                          ),
                                          $anchor(
                                            attr({
                                              href: getAccountExplorerUrl(
                                                surplusRoute,
                                                CHAIN_MAP[leg.chainId as keyof typeof CHAIN_MAP] ?? HUB_CHAIN
                                              ),
                                              target: '_blank'
                                            })
                                          )($text(readableAddress(surplusRoute)))
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

            const projectionValue = start(
              {
                masterAmount: 0n,
                surplus: 0n,
                matched: emptyMatched,
                totalPuppets: 0,
                userByPuppet: new Map<Address, Address>()
              },
              projection
            )
            const $puppetRows = switchMap(p => {
              if (p.matched.puppetList.length === 0) return empty
              return $column(spacing.small)(
                ...p.matched.puppetList.map((puppet, i) => {
                  const user = p.userByPuppet.get(puppet) ?? puppet
                  return $row(spacing.small, style({ alignItems: 'center', fontSize: text.sm }))(
                    $jazzicon(user, 20),
                    $node(style({ color: palette.foreground, fontFamily: 'monospace' }))($text(readableAddress(user))),
                    $node(style({ flex: 1 }))(),
                    $node(style({ color: palette.positive, fontWeight: 'bold' }))(
                      $text(readableTokenAmount(desc, p.matched.matchedAmountList[i] ?? 0n))
                    )
                  )
                })
              )
            }, projectionValue)
            const $projectionRows = $column(spacing.small)(
              $labeledValue(
                $text(
                  map(p => `Matched (${p.matched.puppetList.length} / ${p.totalPuppets} puppets)`, projectionValue)
                ),
                $text(map(p => readableTokenAmount(desc, p.matched.totalMatched), projectionValue))
              ),
              $puppetRows,
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

            const $fulfillEditor = $FulfillEditor({
              master: initial.signer,
              masterAccount,
              baseToken,
              baseTokenId: initialBaseTokenId,
              tokenRegistry
            })({ changeDraft: changeFulfillDraftTether() })

            const $statRowClosed = (label: string, value: string) =>
              $row(spacing.small, style({ alignItems: 'baseline', justifyContent: 'space-between' }))(
                $node(style({ color: palette.foreground, fontSize: text.xs }))($text(label)),
                $node(style({ color: palette.message, fontWeight: '600' }))($text(value))
              )

            const fulfillDisabled: IStream<boolean> = op(
              combine({
                v: fundValues,
                pos: redeemPosition,
                fresh: freshPreview
              }),
              map(p => p.fresh || p.v.closeRate !== 0n || p.v.queuedShares + p.pos.sharesHeld === 0n),
              start(true)
            )

            const $stakeDisplay = $row(
              spacing.tiny,
              style({ alignItems: 'flex-start', flexShrink: '0', alignSelf: 'flex-start' })
            )(
              $node(style({ marginTop: '3px', display: 'flex' }))(
                $infoTooltip(
                  $column(style({ display: 'flex', maxWidth: '280px', whiteSpace: 'normal', gap: '4px' }))(
                    $node(style({ fontSize: text.sm, color: palette.message }))($text('Your share of the fund')),
                    $node(style({ fontSize: text.xs, color: palette.foreground, lineHeight: '1.5' }))(
                      $text(
                        'Exit alongside investor redemptions from the Redeem editor; your exit is capped by theirs.'
                      )
                    )
                  ),
                  palette.foreground,
                  '20px'
                )
              ),
              $allocated
            )

            const settleTrigger = op(account, map(a => a.lastTransactionHash), skipRepeatsWith((a, b) => a === b))
            const fundAddr = op(account, map(a => a.account), skipRepeatsWith((a, b) => a === b))
            const swapDrafts = swapDraftList ?? just([])
            const $balancesView = switchLatest(
              map(
                addr => $fundBalances(addr, tokenRegistry, swapDrafts, changeSwapDraftTether, settleTrigger),
                fundAddr
              )
            )
            const $positionsView = switchLatest(map(addr => $fundPositions(addr, settleTrigger), fundAddr))
            const viewState: IStream<IFundView> = state('balances', selectView)
            const $viewToggle = $ButtonToggle({
              value: viewState,
              optionList: ['balances', 'positions'] as IFundView[],
              $container: $defaultButtonToggleContainer(style({ backgroundColor: palette.background })),
              $$option: map((v: IFundView) => $node($text(v === 'balances' ? 'Balances' : 'Positions')))
            })({ select: selectViewTether() })
            const $viewContent = switchLatest(
              map((v: IFundView) => (v === 'balances' ? $balancesView : $positionsView), viewState)
            )

            return $Popover({
              $container: $node(style({ flex: 1, display: 'flex' })),
              $contentContainer: $defaultPopoverContentContainer(style({ width: '450px' })),
              dismiss: merge(changeDraft, changeRedeemDraft, changeFulfillDraft),
              $target: $column(spacing.big, style({ padding: '4px', borderRadius: '4px', flex: 1 }))(
                $stubAnchor
                  ? $stubAnchor(
                      $aumDisplay,
                      $defaultMiniButtonPrimary(
                        style({ alignSelf: 'flex-end' }),
                        popEditorTether(nodeEvent('click'), constant('allocate'))
                      )(
                        $row(spacing.tiny, style({ alignItems: 'center' }))($text('Fund'), $popoverCaret())
                      ),
                      $ButtonSecondary({
                        $container: $defaultMiniButtonSecondary,
                        disabled: fulfillDisabled,
                        $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Redeem'), $popoverCaret())
                      })({ click: popEditorTether(constant('fulfill')) }),
                      $stakeDisplay
                    )
                  : $row(spacing.default, style({ alignItems: 'center' }))(
                      ...($profile ? [$profile] : []),
                      $ButtonSecondary({
                        $container: $defaultMiniButtonSecondary,
                        $content: $row(spacing.tiny, style({ alignItems: 'center' }))(
                          $tokenIconBySymbol(symbol, '18px'),
                          $node(style({ color: palette.foreground }))($text(symbol)),
                          $text('Fund'),
                          $popoverCaret()
                        )
                      })({ click: popEditorTether(constant('allocate')) }),
                      $node(style({ flex: 1 }))(),
                      $aumDisplay
                    ),
                ...($stubAnchor ? [$labeledDivider($viewToggle, false), $viewContent] : []),
                switchLatest(
                  map(
                    v =>
                      v.closeRate === 0n
                        ? empty
                        : $column(spacing.small)(
                            $node(style({ color: palette.foreground, fontSize: text.sm, lineHeight: '1.5' }))(
                              $text(
                                `Fund closed at ${readableTokenAmount(desc, applyFactor(v.closeRate, 10n ** BigInt(SHARE_DECIMALS)))} ${desc.symbol} per share. Every share converts at this price; outstanding claims stay open.`
                              )
                            ),
                            $statRowClosed(
                              'Outstanding claims',
                              `${readableTokenAmount(desc, applyFactor(v.closeRate, v.totalShareSupply))} ${desc.symbol}`
                            )
                          ),
                    op(
                      fundValues,
                      skipRepeatsWith(
                        (a, b) => a.closeRate === b.closeRate && a.totalShareSupply === b.totalShareSupply
                      )
                    )
                  )
                )
              ),
              $open: map(which => (which === 'allocate' ? $editor : $fulfillEditor), popEditor)
            })({})
          },
          accountIdentity
        ),
        { changeDraft, changeRedeemDraft, changeFulfillDraft, changeSwapDraft }
      ]
    }
  )
