import { HUB_CHAIN_ID, PRECISION, PROTOCOL } from '@puppet/contracts/const'
import DEPLOYMENTS from '@puppet/contracts/deployments'
import type { IAccountLib__AccountInitParams, IFundAccountLib__FundAccountInitParams } from '@puppet/contracts/types'
import { predictDepositRoute, predictFundAccount, predictPuppetAccount, predictShareToken } from '@puppet/sdk/account'
import type { IDepositRoute, ISwapInput } from '@puppet/sdk/attestation'
import {
  ADDRESS_ZERO,
  BYTES32_ZERO,
  CHAIN_LIST,
  type ChainId,
  IntervalTime
} from '@puppet/sdk/const'
import {
  applyFactor,
  getAccountExplorerUrl,
  getChainTokenDescription,
  readableAddress,
  readablePnl,
  readableTokenAmount,
  readableTokenAmountLabel,
  sharesFor
} from '@puppet/sdk/core'
import { USD_PRICE_DECIMALS } from '@puppet/sdk/evaluate'
import type { IFund, IFundPosition } from '@puppet/sdk/schema'
import {
  fetchDepositRouteBalance,
  type ISubaccountState,
  type ITokenRegistryMap,
  nativeSymbolOf,
  randomNonce,
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
  sampleMap,
  skipRepeats,
  skipRepeatsWith,
  start,
  switchLatest,
  switchMap,
} from 'aelea/stream'
import { type IBehavior, multicast, state } from 'aelea/stream-extended'
import { $element, $node, $text, attr, component, type I$Node, type INode, nodeEvent, style, styleBehavior } from 'aelea/ui'
import { $column, $defaultPopoverContentContainer, $Popover, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { type Address, formatUnits, getAddress, type Hex, isAddressEqual } from 'viem'
import {
  $amountDisplay,
  $anchor,
  $ButtonPrimary,
  $ButtonPrimaryOutline,
  $ButtonToggle,
  $defaultMiniButtonPrimary,
  $fundCompositionGauge,
  $labeledDivider,
  $navLink,
  $popoverCaret,
  $TokenAmountInput,
  text
} from '@/ui-components'
import { uiStorage } from '@/ui-storage'
import { depositSourceKey, type IDepositSource } from '../../app/localStoreSchema.js'
import { routeSchema } from '../../app/routeSchema.js'
import { chainFor } from '../../common/$contract.js'
import type { ISwapQuote, ISwapRequest } from '../../io/bridge/swapQuote.js'
import { fetchTokenBalances } from '../../io/chain/balances.js'
import context, { relayFeeFor } from '../../io/context.js'
import { fetchFundAccountMetricList, fetchPuppetUsers } from '../../io/datastore/query.js'
import { liveFundPool, liveRedeemPosition } from '../../io/live.js'
import { formatUsd, priceFor } from '../../io/price.js'
import { homePublicClient, type IConnectedWallet, publicClientMap } from '../../wallet/index.js'
import { $fundProfile, $profileDisplay } from '../$AccountProfile.js'
import { $FulfillEditor } from './$FulfillEditor.js'
import { $fundAllocations, $fundBalances, $fundPositions } from './$fundHoldings.js'
import { $SwapProviderFeeEditor, type ISelectedRoute } from './$SwapProviderFeeEditor.js'
import { $tokenSourcePicker, decorateOptionList, type ITokenInputOption } from './$tokenOption.js'
import type { IAllocateDraft, IClaimDraft, IClaimRouteDraft, IFundSwapDraft, IRecognizeFundDraft, IRedeemDraft, ISellDraft } from './draft.js'
import {
  $editorPercentSlider,
  $maxAmountButton,
  $statRow,
  $surplusAlertSlot,
  amountUsdLabel,
  createFocusState,
  scaleByPercent
} from './editorUtils.js'
import { DEFAULT_DEADLINE_SEC, walletClientForChain } from './runner/_shared.js'
import { gatherMatched } from './runner/allocate.js'

export interface I$FundEditor {
  hideBalances: IStream<boolean>
  account: IStream<ISubaccountState>
  walletAccount: IConnectedWallet
  tokenRegistry: ITokenRegistryMap
  fund: IStream<IFundAccountLib__FundAccountInitParams>
  draft?: IStream<IAllocateDraft | null>
  redeemDraft?: IStream<IRedeemDraft | null>
  swapDraftList?: IStream<IFundSwapDraft[]>
}

type IFundView = 'balances' | 'positions' | 'allocations'

export const $FundEditor = ({
  hideBalances,
  account,
  walletAccount,
  tokenRegistry,
  fund,
  draft,
  redeemDraft,
  swapDraftList
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
      [changeFulfillDraft, changeFulfillDraftTether]: IBehavior<IRedeemDraft | IRecognizeFundDraft>,
      [changeSwapDraft, changeSwapDraftTether]: IBehavior<IFundSwapDraft>,
      [changeClaimDraft, changeClaimDraftTether]: IBehavior<PointerEvent, IClaimRouteDraft>,
      [selectOption, selectOptionTether]: IBehavior<ITokenInputOption>,
      [selectView, selectViewTether]: IBehavior<IFundView>,
      [selectedRoute, selectedRouteTether]: IBehavior<ISelectedRoute>
    ) => {
      type ISelSource = { chainId: number; isNative: boolean; token: Hex | null }
      const needsBridge = (sel: { chainId: number; token: Hex | null }, bid: Hex): boolean => {
        // Native (token === the native marker) into a fund whose base IS the hub's wrapped-native is a WRAP, not a
        // swap: the native deposit path (depositWnt) wraps the value 1:1 on the hub. Only the exact hub WNT base
        // qualifies — any other base genuinely needs a swap/bridge.
        if (
          sel.token === PROTOCOL.nativeToken &&
          sel.chainId === HUB_CHAIN_ID &&
          isAddressEqual(bid as Address, wrappedNativeAddressOf(HUB_CHAIN_ID))
        )
          return false
        return (sel.token ?? bid) !== bid || sel.chainId !== HUB_CHAIN_ID
      }
      // null fee (unpriceable / not yet known) -> null sizing ("not ready"); never substitute 0 for a fee.
      const bridgeSizing = (
        value: bigint,
        allocFee: bigint | null,
        bridgeFee: bigint | null,
        bridges: boolean,
        originSurplus: bigint
      ) => {
        if (allocFee === null) return null
        const extra = bridges ? bridgeFee : 0n
        if (extra === null) return null
        const topUp = allocFee + extra
        const transferAmount = value === 0n ? 0n : value + topUp
        return { topUp, transferAmount, bridgedAmount: transferAmount + originSurplus }
      }
      const selectSource: IStream<ISelSource> = op(
        selectOption,
        map(opt => {
          void walletClientForChain(walletAccount.walletClient, opt.chainId).catch(err =>
            console.error('[master fund] wallet chain switch failed', err)
          )
          return { chainId: opt.chainId, isNative: opt.address === ADDRESS_ZERO, token: opt.token }
        })
      )
      const storedToSel = (s: IDepositSource): ISelSource | null => {
        if (s.address === ADDRESS_ZERO) return { chainId: s.chainId, isNative: true, token: PROTOCOL.nativeToken }
        const chainMap = tokenRegistry.get(s.chainId as ChainId)
        if (!chainMap) return null
        for (const [tid, info] of chainMap) {
          if (isAddressEqual(info.token, s.address)) return { chainId: s.chainId, isNative: false, token: tid }
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
        { chainId: HUB_CHAIN_ID, isNative: false, token: null },
        merge(selectSource, savedSel)
      )

      const fundRowQuery: IStream<IFund | undefined> = op(
        account,
        map(a => ({
          address: a.account,
          owned: a.funds.find(f => isAddressEqual(f.fund as Address, a.account)),
          deployed: a.chains.has(HUB_CHAIN_ID)
        })),
        skipRepeatsWith((a, b) => a.address === b.address && a.owned === b.owned && a.deployed === b.deployed),
        switchMap(({ address, owned, deployed }) => {
          // Owned funds flow from the optimistic rootState (applyWalletAttest nudges supply on the ACK), so they reflect
          // the action immediately and stick; a public fund this wallet doesn't master is queried once.
          if (owned) return just(owned)
          if (!deployed) return just(undefined)
          return liveFundPool(getAddress(address))
        }),
        state(undefined)
      )
      const fundMatch: IStream<{ row: IFund | undefined; fresh: boolean }> = op(
        combine({ row: fundRowQuery, identity: fund }),
        map(p => {
          if (!p.row) return { row: p.row, fresh: false }
          return getAddress(p.row.shareToken) === predictShareToken(p.identity)
            ? { row: p.row, fresh: false }
            : { row: undefined, fresh: true }
        }),
        state()
      )
      const fundQuery: IStream<IFund | undefined> = map(m => m.row, fundMatch)
      const freshPreview: IStream<boolean> = op(
        fundMatch,
        map(m => m.fresh),
        skipRepeats,
        state()
      )
      const baseToken: IStream<Hex> = op(
        combine({ row: fundQuery, identity: fund }),
        map(p => (p.row?.baseToken as Hex | undefined) ?? p.identity.baseToken),
        skipRepeats,
        state()
      )

      const fundNameHex: IStream<Hex> = op(
        combine({ row: fundQuery, identity: fund }),
        map(p => (p.row?.name as Hex | undefined) ?? p.identity.name),
        state(BYTES32_ZERO)
      )

      const $profile: I$Node = switchLatest(
        map(
          p =>
            $navLink({
              route: routeSchema.fund.detail,
              params: { address: predictFundAccount(p.identity) },
              $content: $fundProfile(p.identity, 48, p.row)
            }),
          combine({ identity: fund, row: fundQuery })
        )
      )

      const balanceQuery = op(
        baseToken,
        filter((bid): bid is Hex => bid !== null),
        switchMap(() =>
          fromPromise(
            fetchTokenBalances(
              walletAccount.address,
              CHAIN_LIST.flatMap(chain => {
                const chainMap = tokenRegistry.get(chain.id as ChainId)
                if (!chainMap) return []
                return [...chainMap.values()].map(info => ({
                  chainId: chain.id,
                  tokenAddress: info.token === PROTOCOL.nativeToken ? ADDRESS_ZERO : info.token
                }))
              }),
              walletAccount.walletClient
            )
          )
        ),
        state()
      )

      const balanceValue: IStream<bigint> = op(
        combine({ list: balanceQuery, sel: sourceSel, bid: baseToken }),
        map(p => {
          if (p.bid === null) return 0n
          const token = p.sel.token ?? p.bid
          const addr = p.sel.isNative
            ? ADDRESS_ZERO
            : (tokenRegistry.get(p.sel.chainId as ChainId)?.get(token)?.token ?? null)
          if (addr === null) return 0n
          return p.list.find(b => b.chainId === p.sel.chainId && b.tokenAddress === addr)?.balance ?? 0n
        }),
        state(0n)
      )
      // null = fee not yet known: no base selected, or the relay fee is unpriceable (oracle has no rate). Never 0 -
      // a 0 reads as "free" and zeroes the signed ceiling; the Save gate disables and the row shows '-' while null.
      const inputBridgeFee: IStream<bigint | null> = op(
        combine({ sel: sourceSel, bid: baseToken }),
        switchMap((p): IStream<bigint | null> => {
          const token = p.sel.token ?? p.bid
          if (token === null) return just(null)
          return map(fm => (fm === null ? null : fm.swap.relayFee), relayFeeFor(token))
        }),
        skipRepeats,
        state(null)
      )
      const inputAllocateFee: IStream<bigint | null> = op(
        combine({ sel: sourceSel, bid: baseToken, fund: fundQuery }),
        switchMap((p): IStream<bigint | null> => {
          const token = p.sel.token ?? p.bid
          if (token === null) return just(null)
          // Allocate deploys the fund clone on first use (Allocate.sol), so its relay fee
          // covers both the seeded top-up and the first-time fund creation.
          return map(fm => (fm === null ? null : fm.allocate.relayFee), relayFeeFor(token))
        }),
        skipRepeats,
        state(null)
      )
      const spendableValue: IStream<bigint> = op(
        combine({
          balance: balanceValue,
          sel: sourceSel,
          bid: baseToken,
          allocFee: inputAllocateFee,
          bridgeFee: inputBridgeFee
        }),
        map(p => {
          const needsQuote = needsBridge(p.sel, p.bid)
          const extra = needsQuote ? p.bridgeFee : 0n
          // Fee not yet known -> 0 spendable (can't subtract an unknown fee); the Save gate blocks anyway.
          if (p.allocFee === null || extra === null) return 0n
          const topUp = p.allocFee + extra
          return p.balance > topUp ? p.balance - topUp : 0n
        }),
        state(0n)
      )
      const sliderAmount: IStream<bigint> = sampleMap(scaleByPercent, spendableValue, sliderPercent)
      const maxAmount: IStream<bigint> = sampleMap(bal => bal, spendableValue, clickMax)
      const draftValue: IStream<IAllocateDraft | null> = draft ?? just(null)
      const draftHydration: IStream<bigint> = map(d => d?.masterAmount ?? 0n, draftValue)
      const valueHydration: IStream<bigint> = map(d => d?.inputAmount ?? 0n, draftValue)
      // Reset the raw amount when the source token changes: a bigint typed for one token's decimals would otherwise be
      // reinterpreted under the new token's decimals (e.g. 1 USDC at 6-dec read as dust WETH at 18-dec), mis-sizing the
      // signed transfer. Matches $DepositEditor's constant(0n, selectSource).
      const value: IStream<bigint> = op(
        merge(inputAmount, sliderAmount, maxAmount, valueHydration, constant(0n, selectOption)),
        state(0n)
      )

      const originSurplus: IStream<bigint> = op(
        combine({ acc: account, sel: sourceSel }),
        switchMap(async p => {
          if (p.sel.token === null || p.sel.chainId === HUB_CHAIN_ID) return 0n
          const client = publicClientMap[p.sel.chainId]
          if (!client) return 0n
          const srcId = p.sel.isNative ? wrappedNativeAddressOf(p.sel.chainId as ChainId) : p.sel.token
          const token = tokenInfoFor(tokenRegistry, p.sel.chainId as ChainId, srcId).token
          try {
            const newLocal = await fetchDepositRouteBalance(client, token, p.acc.signer)
            return newLocal
          } catch {
            return 0n
          }
        }),
        state(0n)
      )

      // The allocate sweep reads predictDepositRoute(master PA); quote the bridge delivery to THAT route, derived
      // from the same {user, signer} pair the runner binds (a.account/a.signer alone can drift from it).
      const quoteRouteAccount: IStream<Address> = op(
        account,
        // user is optional on ISubaccountState (unresolved session); no user => no PA to derive, hold the quote.
        filter(a => a.user !== undefined),
        map(a => predictPuppetAccount({ user: a.user as Address, signer: a.signer })),
        skipRepeats
      )
      // Plain combine, never sample: a late fee/routeAccount arrival re-derives the request instead of being dropped
      // by a sample gate that nothing re-triggers. $SwapProviderFeeEditor owns debounce + sameRequest dedupe.
      const quoteParams = combine({
        sel: sourceSel,
        bid: baseToken,
        amount: value,
        surplus: originSurplus,
        allocFee: inputAllocateFee,
        routeAccount: quoteRouteAccount,
        bridgeFee: inputBridgeFee
      })
      const request: IStream<ISwapRequest | null> = multicast(
        map(p => {
          if (p.bid === null) return null
          const token = p.sel.isNative ? wrappedNativeAddressOf(p.sel.chainId as ChainId) : (p.sel.token ?? p.bid)
          if (!needsBridge(p.sel, p.bid) || p.amount + p.surplus === 0n) return null
          const inputToken = tokenRegistry.get(p.sel.chainId as ChainId)?.get(token)?.token
          if (!inputToken) return null
          if (p.allocFee === null || p.bridgeFee === null) return null
          const input =
            p.amount === 0n
              ? p.surplus > p.bridgeFee
                ? p.surplus - p.bridgeFee
                : 0n
              : p.amount + p.allocFee + p.surplus
          if (input === 0n) return null
          return {
            originChainId: p.sel.chainId,
            destinationChainId: HUB_CHAIN_ID,
            inputToken,
            outputToken: tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, p.bid).token,
            inputAmount: input,
            route: predictDepositRoute(p.routeAccount),
            crossToken: token !== p.bid
          }
        }, quoteParams)
      )

      const effectiveBase: IStream<bigint> = op(
        combine({ sel: sourceSel, bid: baseToken, route: selectedRoute, value }),
        map(p => {
          if (p.bid === null) return 0n
          const needsQuote = needsBridge(p.sel, p.bid)
          if (!needsQuote) return p.value
          return p.route.quote?.outputAmount ?? 0n
        }),
        state(0n)
      )
      const settledValue: IStream<bigint> = debounce(160, effectiveBase)

      const emptyMatched = {
        puppetList: [] as Address[],
        bodyList: [] as Hex[],
        mandateList: [] as Hex[],
        allocatedAmountList: [] as bigint[],
        totalAllocated: 0n
      }
      // A failed/429 route-balance read must still EMIT (seeded 0n) so the projection combine below can fire; otherwise a
      // single RPC rejection would stall the whole allocation projection for the editor session. Mirrors originSurplus.
      const surplusQuery: IStream<bigint> = op(
        combine({ acc: account, bid: baseToken }),
        switchMap(async p => {
          if (p.bid === null) return 0n
          const baseId = p.bid === PROTOCOL.nativeToken ? wrappedNativeAddressOf(HUB_CHAIN_ID) : p.bid
          const baseToken = tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, baseId).token
          try {
            return await fetchDepositRouteBalance(homePublicClient, baseToken, p.acc.signer)
          } catch {
            return 0n
          }
        }),
        state(0n)
      )
      const projection = op(
        combine({
          health: fromPromise(context.getChainLiveness()),
          acc: account,
          bid: baseToken,
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
            const gathered = await gatherMatched(tokenRegistry, p.health, p.acc.account, baseToken, total)
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
            // Only the match-gather failed; keep the already-fetched route surplus (folded into masterAmount and the
            // signed draft) rather than dropping it to 0n and silently under-allocating. The matched-puppet list is
            // display-only here (the runner re-gathers at sign time) and self-heals on the next projection emit.
            return {
              masterAmount: p.masterAmount + p.surplus,
              surplus: p.surplus,
              matched: emptyMatched,
              totalPuppets: 0,
              userByPuppet: emptyUsers
            }
          }
        }),
        state()
      )

      const relayFeeRaw: IStream<bigint | null> = op(
        combine({ fund: fundQuery, bid: baseToken }),
        switchMap((p): IStream<bigint | null> =>
          p.bid === null
            ? just(null)
            : map(fm => (fm === null ? null : fm.allocate.relayFee), relayFeeFor(p.bid))
        ),
        state(null)
      )
      const allocationFloor: IStream<bigint | null> = op(
        relayFeeRaw,
        map(allocFee => (allocFee === null ? null : allocFee * 10n)),
        state(null)
      )
      const totalAllocation: IStream<bigint> = op(
        projection,
        map(p => p.masterAmount + p.matched.totalAllocated),
        state(0n)
      )

      const nameOk: IStream<boolean> = op(
        combine({ fund: fundQuery, name: fundNameHex }),
        map(p => (p.fund?.seeded ?? false) || p.name !== BYTES32_ZERO),
        state(false)
      )

      const canSubmit: IStream<boolean> = map(
        p => {
          // Relay fee / floor not yet priced -> can't validate or sign; block Save until it prices.
          if (p.floor === null) return false
          const needsQuote = needsBridge(p.src, p.bid)
          const sizing = bridgeSizing(p.value, p.allocFee, p.bridgeFee, needsQuote, p.originSurplus)
          if (sizing === null) return false
          const { transferAmount, bridgedAmount } = sizing
          const bridgeRatioOk =
            !needsQuote ||
            bridgedAmount === 0n ||
            (p.bridgeFee !== null && bridgedAmount * PROTOCOL.maxRelayFeeBps >= p.bridgeFee * PRECISION.basisPoints)
          const balanceOk = p.value === 0n || transferAmount <= p.balance
          const meetsFloor = p.value === 0n ? p.total > (p.relayFee ?? p.floor) : p.total >= p.floor
          const needsRoute = p.bid !== null && needsBridge(p.src, p.bid) && p.value + p.originSurplus > 0n
          return balanceOk && bridgeRatioOk && p.total > 0n && meetsFloor && p.nameOk && (!needsRoute || p.route.ready)
        },
        combine({
          value,
          balance: balanceValue,
          total: totalAllocation,
          floor: allocationFloor,
          relayFee: relayFeeRaw,
          nameOk,
          route: selectedRoute,
          src: sourceSel,
          bid: baseToken,
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
        inputToken: Hex,
        amount: bigint,
        src: { chainId: number; isNative: boolean },
        walletBalance: bigint,
        quote: ISwapQuote | null,
        bridgeFee: bigint,
        srcDeployed: boolean,
        originSurplus: bigint
      ): { wallet: IDepositRoute | null; swap: ISwapInput | null } => {
        const srcChain = src.chainId
        const deadline = BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC)
        const token = tokenInfoFor(tokenRegistry, srcChain as ChainId, inputToken).token
        const wallet: IDepositRoute | null =
          amount === 0n
            ? null
            : src.isNative
              ? { chainId: srcChain, params, token: inputToken, mode: 'native', amount, walletBalance }
              : {
                  chainId: srcChain,
                  params,
                  token: inputToken,
                  mode: 'erc20Gate',
                  amount,
                  walletBalance,
                  spender: DEPLOYMENTS[`Deposit:${HUB_CHAIN_ID}`].address
                }
        if ((inputToken === bid && srcChain === HUB_CHAIN_ID) || quote === null || quote.route.kind === 'composed') {
          return { wallet, swap: null }
        }
        const swap: ISwapInput = {
          params,
          inputToken,
          // The leg's true output is the fund BASE on the hub (what the quote was fetched for), not the input echoed
          // back: a local hub swap forwards/caps swap.outputToken on-chain, and the runner's identity re-quote
          // (rebindSwapLeg) derives the route from it.
          outputToken: bid,
          blockNumber: 0n,
          deadline,
          acceptableRelayFee: bridgeFee,
          nonce: randomNonce(),
          chainId: BigInt(srcChain),
          inputAmount: amount + originSurplus,
          destinationChainId: BigInt(HUB_CHAIN_ID),
          route: quote.route,
          outputAmount: quote.outputAmount,
          fillDeadline: quote.fillDeadline,
          userDeploySig: '0x',
          userSignerProof: '0x'
        }
        return { wallet, swap }
      }

      const changeDraft: IStream<IAllocateDraft> = op(
        sampleMap(
          (p): IAllocateDraft | null => {
            if (p.bid === null || p.acc.user === undefined) return null
            const token = p.src.token ?? p.bid
            const needsQuote = needsBridge(p.src, p.bid)
            // Fail closed: never build a draft to be signed against an unpriceable/unknown relay fee.
            if (p.allocFee === null || p.fee === null || p.hubFee === null) return null
            // The signed bridge step bakes in q.quote.outputAmount as its on-chain output floor, so the quote MUST be
            // for the exact input being bridged (same liveInput the 'Swap fee' row checks). Block signing a quote that
            // still lags a just-changed amount/surplus.
            const expectedInput =
              p.amount === 0n
                ? p.originSurplus > p.fee
                  ? p.originSurplus - p.fee
                  : 0n
                : p.amount + p.allocFee + p.originSurplus
            if (needsQuote && p.amount + p.originSurplus > 0n && !p.route.ready) {
              return null
            }
            const params: IAccountLib__AccountInitParams = { user: p.acc.user, signer: p.acc.signer }
            const baseToken = tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, p.bid).token
            const master = p.acc.account
            const quoteOut = p.route.quote?.outputAmount ?? 0n
            const netQuoteOut = quoteOut > p.hubFee ? quoteOut - p.hubFee : 0n
            const masterAmount = (needsQuote ? netQuoteOut : p.amount) + p.proj.surplus
            const sizing = bridgeSizing(p.amount, p.allocFee, p.fee, needsQuote, p.originSurplus)
            if (sizing === null) return null
            const { transferAmount } = sizing
            const { wallet, swap } =
              p.amount === 0n && p.originSurplus === 0n
                ? { wallet: null, swap: null }
                : buildFundSteps(
                    params,
                    p.bid,
                    token,
                    transferAmount,
                    p.src,
                    p.balance,
                    needsQuote ? p.route.quote : null,
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
              name: p.name,
              masterAmount,
              inputAmount: p.amount,
              sourceChainId: p.src.chainId,
              wallet,
              swap
            }
          },
          combine({
            acc: account,
            amount: value,
            src: sourceSel,
            balance: balanceValue,
            bid: baseToken,
            name: fundNameHex,
            route: selectedRoute,
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

      // Rebuild the card on (fund, base) change AND on the undeployed->deployed transition: the fund address is
      // deterministic (predicted before it exists), so a first allocation that creates the fund changes only chains/funds,
      // not the address. Without the hub-deployed flag here the switchMap below would keep its frozen `initial` and the
      // card would stay on "Fund will be created" at $0.00 after the create settles.
      const accountIdentity: IStream<{ acc: ISubaccountState; bid: Hex }> = skipRepeatsWith(
        (a, b) =>
          a.acc.account === b.acc.account &&
          a.bid === b.bid &&
          a.acc.chains.has(HUB_CHAIN_ID) === b.acc.chains.has(HUB_CHAIN_ID),
        combine({ acc: account, bid: baseToken })
      )

      return [
        switchMap(({ acc: initial, bid }: { acc: ISubaccountState; bid: Hex }) => {
          const baseToken = tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, bid).token
          const desc = getChainTokenDescription(HUB_CHAIN_ID, baseToken)
          const masterAccount = initial.account
          const deployed = initial.chains.has(HUB_CHAIN_ID)
          const tokenPrice = priceFor(baseToken)

          type SourceRef = { chainId: number; address: Address; symbol: string; token: Hex; decimals: number }
          const sources: SourceRef[] = CHAIN_LIST.flatMap(chain => {
            const chainMap = tokenRegistry.get(chain.id as ChainId)
            if (!chainMap) return []
            // Every registered token on every chain is a valid deposit source. The native marker is presented as the
            // chain's gas coin (ADDRESS_ZERO signals a native value transfer downstream; symbol per-chain MON/ETH);
            // all other registered tokens describe from their own registry metadata.
            return [...chainMap.values()].map((info): SourceRef => {
              if (info.token === PROTOCOL.nativeToken) {
                return {
                  chainId: chain.id,
                  address: ADDRESS_ZERO,
                  symbol: nativeSymbolOf(chain.id as ChainId),
                  token: PROTOCOL.nativeToken,
                  decimals: 18
                }
              }
              const srcDesc = getChainTokenDescription(chain.id as ChainId, info.token)
              return {
                chainId: chain.id,
                address: info.token,
                symbol: srcDesc.symbol,
                token: info.token,
                decimals: srcDesc.decimals
              }
            })
          })
          // A native source carries address=ADDRESS_ZERO (the deposit signal), which isn't a priceable token — price
          // it off its wrapped-native ERC-20 (1:1 with the gas coin) so MON/ETH native rows show a USD value.
          const priceAddressOf = (chainId: number, address: Address): Address =>
            address === ADDRESS_ZERO ? wrappedNativeAddressOf(chainId as ChainId) : address
          const usdText = (src: SourceRef, balance: bigint | null): IStream<string> =>
            balance === null
              ? just('-')
              : map(price => formatUsd(balance, price), priceFor(priceAddressOf(src.chainId, src.address)))
          const toOption = (src: SourceRef, balance: bigint | null): ITokenInputOption => ({
            symbol: src.symbol,
            chainId: src.chainId,
            address: src.address,
            token: src.token,
            balance,
            decimals: src.decimals,
            usdValue: usdText(src, balance)
          })
          const sourceSelection: IStream<SourceRef> = map(
            sel =>
              sources.find(
                s =>
                  s.chainId === sel.chainId &&
                  s.token === (sel.token ?? bid) &&
                  (s.address === ADDRESS_ZERO) === sel.isNative
              ) ??
              sources.find(s => s.chainId === HUB_CHAIN_ID && s.token === bid) ??
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
                opt => p.prices[priceAddressOf(opt.chainId, opt.address)] ?? null,
                bid
              ),
            combine({
              sel: sourceSelection,
              list: balanceQuery,
              prices: combine(
                Object.fromEntries(
                  [...new Set(sources.map(s => priceAddressOf(s.chainId, s.address)))].map(a => [a, priceFor(a)])
                )
              )
            })
          )

          // Dedupe by the PRICE key, never the token id: every chain's native source shares the SAME 0xEeee marker
          // as its token id, so a token-keyed dedupe swallowed ETH-native -> MON-native switches and kept pricing
          // MON input at the ETH rate (999 MON rendered as $1.7M on 2026-07-03).
          const inputPrice: IStream<bigint | null> = op(
            sourceSelection,
            skipRepeatsWith((a, b) => priceAddressOf(a.chainId, a.address) === priceAddressOf(b.chainId, b.address)),
            switchMap(src => priceFor(priceAddressOf(src.chainId, src.address)))
          )
          const amountUsd: IStream<string> = amountUsdLabel(value, inputPrice)
          const $swapResolution: I$Node = $SwapProviderFeeEditor({
            active: map(sel => needsBridge(sel, bid), sourceSel),
            request
          })({ selectRoute: selectedRouteTether() })
          const pendingAllocate: IStream<bigint> = draftHydration
          const pendingRedeem: IStream<IRedeemDraft | null> = op(redeemDraft ?? just(null), start(null))
          const fundValues = op(
            fundQuery,
            map(f => {
              const supply = f?.totalShareSupply ?? 0n
              const nav = f?.navPerShare ?? PRECISION.floatPrecisionExp / PRECISION.sharePrecisionExp
              return {
                nav,
                aum: (supply * nav) / PRECISION.floatPrecisionExp,
                pending: ((f?.queuedShares ?? 0n) * nav) / PRECISION.floatPrecisionExp,
                totalShareSupply: supply,
                totalAllocated: f?.totalAllocated ?? 0n,
                liquidationRate: f?.liquidationRate ?? 0n,
                queuedShares: f?.queuedShares ?? 0n
              }
            })
          )
          // Live off the account stream, not a frozen `initial` snapshot: the card's accountIdentity skip-key is
          // {account, bid, hub-deployed} and does NOT include positions/shares, so a redeem/sell that settles (changing
          // sharesHeld but not the identity) would leave a frozen value stale and the Redeem button's enabled state
          // wrong. Each account re-emission (settlement) re-reads the row. The master's share position is keyed
          // holder = the MASTER PA (this fund-state's `signer`), NOT the fund — the fund's own subaccount positions
          // (holder = fund) never contain it, so reading account.positions here always found nothing and kept Redeem
          // disabled for every multi-fund PA.
          const redeemPosition: IStream<IFundPosition | undefined> = op(
            account,
            switchMap(() => liveRedeemPosition(getAddress(initial.signer), getAddress(masterAccount))),
            state()
          )
          const $valueBlock = (amount: bigint, amountColor: string = palette.foreground): I$Node =>
            $amountDisplay({
              hideBalances,
              usd: map(price => formatUsd(amount, price), tokenPrice),
              amount: readableTokenAmountLabel(desc, amount),
              amountColor: just(amountColor),
              usdFontSize: text.sm,
              align: 'flex-end'
            })

          const aumValue = map(v => v.aum, fundValues)
          const fundPnl: IStream<bigint> = deployed
            ? op(
                fromPromise(
                  fetchFundAccountMetricList({
                    fund: masterAccount,
                    activityTimeframe: IntervalTime.YEAR,
                    collateralTokenList: []
                  })
                ),
                map(rows => rows.reduce((acc, r) => acc + r.realisedPnl + r.openPnl, 0n)),
                state(0n)
              )
            : just(0n)
          const pnlColor = map(
            p => (p > 0n ? palette.positive : p < 0n ? palette.negative : palette.foreground),
            fundPnl
          )
          const $aumDisplay = $amountDisplay({
            hideBalances,
            usd: map(p => formatUsd(p.v, p.price), combine({ v: aumValue, price: tokenPrice })),
            amount: map(p => readablePnl(p), fundPnl),
            amountColor: pnlColor,
            usdFontSize: text.xl,
            align: 'flex-end',
            $between: switchLatest(
              map(
                v =>
                  $fundCompositionGauge({
                    utilized: v.totalAllocated,
                    liquid: v.aum - v.totalAllocated - v.pending,
                    redemptions: v.pending
                  }),
                fundValues
              )
            ),
            change: map(
              p => {
                if (p.pending === 0n && p.redeem === null) return null
                if (p.allocFee === null) return null
                // Shares mint on the deposit NET of the relay fee, which the fund pays out (on-chain Allocate fee-split);
                // the first mint (supply 0) mints on the gross, matching the contract's `_remainingFee == 0` branch.
                const fee = p.pending > p.allocFee ? p.allocFee : p.pending
                const netIn = p.pending - fee
                const mintBasis = p.v.totalShareSupply === 0n ? p.pending : netIn
                const drained = p.redeem === null ? 0n : p.redeem.liquidate ? p.aum : p.redeem.assetsOut
                const next = p.aum + netIn - (drained < p.aum ? drained : p.aum)
                const minted = sharesFor(p.v.totalShareSupply, p.v.aum, mintBasis)
                let queued = p.v.queuedShares
                let supply = p.v.totalShareSupply + minted
                if (p.redeem !== null && !p.redeem.liquidate) {
                  const retired = p.v.aum === 0n ? 0n : (p.redeem.assetsOut * p.v.totalShareSupply) / p.v.aum
                  const queuedAfter = queued + p.redeem.sharesOut - retired
                  queued = queuedAfter > 0n ? queuedAfter : 0n
                  supply = supply > retired ? supply - retired : 0n
                }
                const projRedemptions = p.redeem?.liquidate || supply === 0n ? 0n : (queued * next) / supply
                const projUtilized = p.v.totalAllocated + p.pending
                return {
                  usd: formatUsd(next, p.price),
                  amount: readablePnl(p.pnl),
                  $between: $fundCompositionGauge({
                    utilized: projUtilized,
                    liquid: next - projUtilized - projRedemptions,
                    redemptions: projRedemptions
                  })
                }
              },
              combine({
                pending: pendingAllocate,
                redeem: pendingRedeem,
                aum: aumValue,
                v: fundValues,
                price: tokenPrice,
                pnl: fundPnl,
                allocFee: inputAllocateFee
              })
            ),
            color: map(
              p => (p.redeem !== null && p.pending === 0n ? palette.negative : palette.positive),
              combine({ pending: pendingAllocate, redeem: pendingRedeem })
            )
          })

          const focused = createFocusState(focusEvt, blurEvt)

          const alert: IStream<string | null> = op(
            combine({
              value,
              balance: balanceValue,
              total: totalAllocation,
              floor: allocationFloor,
              nameOk,
              route: selectedRoute,
              sel: sourceSelection,
              bid: just(bid),
              allocFee: inputAllocateFee,
              bridgeFee: inputBridgeFee,
              originSurplus,
              v: fundValues
            }),
            map(p => {
              if (p.v.liquidationRate !== 0n && p.value > 0n)
                return 'Fund is liquidated: every share converts at the liquidation price. Pick a new name to start a fresh fund.'
              if (p.value > p.balance)
                return `Exceeds available ${readableTokenAmountLabel({ decimals: p.sel.decimals, symbol: p.sel.symbol }, p.balance)}`
              if (p.value > 0n && p.route.error) return p.route.error
              if (p.value > 0n && p.route.limitError) return p.route.limitError
              // Fee null = unpriceable: skip the fee-ratio/floor checks (the Save gate already blocks); don't fabricate.
              const sizing = needsBridge(p.sel, p.bid)
                ? bridgeSizing(p.value, p.allocFee, p.bridgeFee, true, p.originSurplus)
                : null
              if (sizing !== null && p.bridgeFee !== null) {
                const { bridgedAmount } = sizing
                const minInput =
                  (p.bridgeFee * PRECISION.basisPoints + PROTOCOL.maxRelayFeeBps - 1n) / PROTOCOL.maxRelayFeeBps
                if (bridgedAmount > 0n && bridgedAmount < minInput) {
                  const add = minInput - bridgedAmount
                  return `Add at least ${readableTokenAmountLabel({ decimals: p.sel.decimals, symbol: p.sel.symbol }, add)}: bridging less makes the relay fee exceed ${Number(PROTOCOL.maxRelayFeeBps) / 100}% of the transfer`
                }
              }
              if (p.floor !== null && p.total > 0n && p.total < p.floor)
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

          // Read the thumb off the SAME denominator the slider writes from (spendableValue, balance net of fees), or a
          // drag to 100% sets value = spendable yet renders below 100% and visibly snaps back when fees are non-zero.
          const sliderValue: IStream<number> = map(
            p => (p.bal > 0n ? Number((p.amt * 10000n) / p.bal) / 10000 : 0),
            combine({ amt: value, bal: spendableValue })
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

          const $maxButton = $maxAmountButton(value, balanceValue, clickMaxTether(nodeEvent('click')))

          const $percentSlider = $editorPercentSlider({
            value: sliderValue,
            ariaLabel: 'Allocation percentage',
            disabled: sliderDisabled,
            error: hasError
          })({ change: sliderPercentTether() })

          const srcPriceStream: IStream<bigint | null> = op(
            sourceSel,
            map(sel => {
              const srcId = sel.isNative ? wrappedNativeAddressOf(sel.chainId as ChainId) : sel.token
              if (srcId === null) return baseToken
              return tokenInfoFor(tokenRegistry, sel.chainId as ChainId, srcId).token
            }),
            skipRepeats,
            switchMap(addr => priceFor(addr))
          )
          const surplusInfo: IStream<{
            usd: string
            legs: Array<{ chainId: number; amount: bigint; decimals: number; symbol: string }>
          }> = map(
            p => {
              const legs: Array<{ chainId: number; amount: bigint; decimals: number; symbol: string }> = []
              if (p.hub > 0n) {
                legs.push({ chainId: HUB_CHAIN_ID, amount: p.hub, decimals: desc.decimals, symbol: desc.symbol })
              }
              if (p.origin > 0n && p.sel.token !== null && p.sel.chainId !== HUB_CHAIN_ID) {
                const srcId = p.sel.isNative ? wrappedNativeAddressOf(p.sel.chainId as ChainId) : p.sel.token
                const srcDesc = getChainTokenDescription(p.sel.chainId as ChainId, tokenInfoFor(tokenRegistry, p.sel.chainId as ChainId, srcId).token)
                legs.push({ chainId: p.sel.chainId, amount: p.origin, decimals: srcDesc.decimals, symbol: srcDesc.symbol })
              }
              const usdProduct =
                (p.basePrice === null ? 0n : p.hub * p.basePrice) + (p.srcPrice === null ? 0n : p.origin * p.srcPrice)
              const num = Number(formatUnits(usdProduct, USD_PRICE_DECIMALS))
              const usd = usdProduct === 0n ? '' : num > 0 && num < 0.01 ? '< $0.01' : `$${num.toFixed(2)}`
              return { usd, legs }
            },
            combine({
              hub: start(
                0n,
                map(x => x.surplus, projection)
              ),
              origin: originSurplus,
              sel: sourceSel,
              basePrice: tokenPrice,
              srcPrice: srcPriceStream
            })
          )
          const surplusRoute = predictDepositRoute(initial.signer)
          const $alertSlot = $surplusAlertSlot({
            alert,
            amountUsd,
            surplus: surplusInfo,
            $note: $legs =>
              $column(spacing.small)(
                $node(
                  $text(
                    `An earlier deposit arrived at your fund but was never counted into its balance. It is recovered into the fund alongside this input.`
                  )
                ),
                $legs
              ),
            $legAddress: leg =>
              $anchor(
                attr({
                  href: getAccountExplorerUrl(surplusRoute, chainFor(leg.chainId)),
                  target: '_blank'
                })
              )($text(readableAddress(surplusRoute)))
          })

          const $picker = $tokenSourcePicker({ hideBalances, value: selectedOption, optionList })({
            select: selectOptionTether()
          })

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
          const $allocatedRow = switchMap(
            p =>
              $row(spacing.small, style({ alignItems: 'center' }))(
                $row(spacing.small, style({ alignItems: 'baseline' }))(
                  $node(style({ fontSize: text.lg, fontWeight: '600', color: palette.message }))($text('Allocated')),
                  $node(style({ fontSize: text.xs, color: palette.foreground }))(
                    $text(`${p.matched.puppetList.length} / ${p.totalPuppets} puppets`)
                  )
                ),
                $node(style({ flex: 1 }))(),
                $valueBlock(p.matched.totalAllocated)
              ),
            projectionValue
          )
          const $puppetRows = switchMap(p => {
            if (p.matched.puppetList.length === 0) return empty
            return $column(spacing.small)(
              ...p.matched.puppetList.map((puppet, i) => {
                const user = p.userByPuppet.get(puppet) ?? puppet
                const amount = p.matched.allocatedAmountList[i] ?? 0n
                return $row(spacing.small, style({ alignItems: 'center', fontSize: text.sm }))(
                  $profileDisplay({ address: user, isFund: false, profileSize: 20 }),
                  $node(style({ flex: 1 }))(),
                  $valueBlock(amount)
                )
              })
            )
          }, projectionValue)

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
            $column(spacing.small)(
              $node(style({ margin: '0 -26px', display: 'flex' }))($percentSlider),
              $puppetRows,
              $allocatedRow
            ),
            $row(spacing.small, style({ alignItems: 'center', fontSize: text.sm }))(
              // Visibility toggle, NEVER a mount toggle: `alert` combines the route this component's own tether
              // feeds, so unmounting it on alert would kill the route stream, flip the alert, and remount forever.
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
              )($swapResolution),
              $node(style({ flex: 1 }))(),
              $ButtonPrimaryOutline({ disabled, $content: $text('Save') })({ click: clickSaveTether() })
            )
          )

          const $fulfillEditor = $FulfillEditor({
            master: initial.signer,
            masterAccount,
            baseToken,
            tokenRegistry
          })({ changeDraft: changeFulfillDraftTether() })

          const fulfillDisabled: IStream<boolean> = op(
            combine({
              v: fundValues,
              pos: redeemPosition,
              fresh: freshPreview
            }),
            map(p => p.fresh || p.v.liquidationRate !== 0n || p.v.queuedShares + (p.pos?.sharesHeld ?? 0n) === 0n),
            start(true)
          )

          const settleTrigger = op(
            account,
            skipRepeatsWith((a, b) => a.lastTransactionHash === b.lastTransactionHash),
            map(a => a.lastSettled)
          )
          const fundAddr = op(
            account,
            map(a => a.account),
            skipRepeats
          )
          const $balancesView = switchLatest(
            map(
              addr =>
                $fundBalances(
                  hideBalances,
                  addr,
                  tokenRegistry,
                  swapDraftList ?? just([]),
                  changeSwapDraftTether,
                  changeClaimDraftTether,
                  settleTrigger
                ),
              fundAddr
            )
          )
          const $positionsView = switchLatest(map(addr => $fundPositions(addr, settleTrigger), fundAddr))
          const allocIdentity = op(
            account,
            map(a => ({ fund: a.account, master: a.signer })),
            skipRepeatsWith((x, y) => x.fund === y.fund && x.master === y.master)
          )
          const $allocationsView = switchLatest(
            map(p => $fundAllocations(hideBalances, p.fund, p.master, settleTrigger), allocIdentity)
          )
          const viewState: IStream<IFundView> = state('balances', selectView)
          const viewLabel: Record<IFundView, string> = {
            balances: 'Balances',
            positions: 'Positions',
            allocations: 'Allocations'
          }
          const $viewToggle = $ButtonToggle({
            value: viewState,
            optionList: ['balances', 'positions', 'allocations'] as IFundView[],
            $$option: map((v: IFundView) => $node($text(viewLabel[v])))
          })({ select: selectViewTether() })
          const $viewPane = (view: IFundView, $content: I$Node): I$Node =>
            $node(
              style({ width: '100%' }),
              styleBehavior(map(v => (v === view ? null : { display: 'none' }), viewState))
            )($content)
          const $viewContent = $column(style({ width: '100%' }))(
            $viewPane('balances', $balancesView),
            $viewPane('positions', $positionsView),
            $viewPane('allocations', $allocationsView)
          )

          // A liquidated fund cannot raise more funding (every share converts at the liquidation price); the only
          // way forward is a fresh fund under a new name, so the Fund action is disabled here.
          const fundDisabled: IStream<boolean> = op(
            fundValues,
            map(v => v.liquidationRate !== 0n),
            skipRepeats,
            start(false)
          )
          const $fundButton = $ButtonPrimary({
            $container: $defaultMiniButtonPrimary(style({ alignSelf: 'flex-end' })),
            disabled: fundDisabled,
            $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Fund'), $popoverCaret())
          })({ click: popEditorTether(constant('allocate')) })
          const $redeemButton = $ButtonPrimary({
            $container: $defaultMiniButtonPrimary,
            disabled: fulfillDisabled,
            $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Redeem'), $popoverCaret())
          })({ click: popEditorTether(constant('fulfill')) })
          const $fundHeader = $row(spacing.big, style({ alignItems: 'center', width: '100%' }))(
            $column(spacing.small, style({ alignItems: 'flex-start', minWidth: '0' }))($profile),
            $row(spacing.small, style({ alignItems: 'center', justifyContent: 'flex-end', flex: '1' }))(
              $column(spacing.small, style({ alignItems: 'flex-end' }))($fundButton, $redeemButton),
              $column(style({ gap: '2px', alignItems: 'flex-end' }))(
                $node(style({ color: palette.foreground, fontSize: text.xs }))($text('AUM')),
                $aumDisplay
              )
            )
          )

          return $Popover({
            $container: $node(style({ flex: 1, display: 'flex' })),
            $contentContainer: $defaultPopoverContentContainer(style({ width: '450px' })),
            dismiss: merge(changeDraft, changeRedeemDraft, changeFulfillDraft),
            $target: $column(spacing.big, style({ padding: '4px', borderRadius: '4px', flex: 1 }))(
              $fundHeader,
              ...(deployed
                ? [
                    $labeledDivider($viewToggle),
                    $viewContent,
                    switchLatest(
                      map(
                        v =>
                          v.liquidationRate === 0n
                            ? empty
                            : $column(spacing.small)(
                                $node(style({ color: palette.foreground, fontSize: text.sm, lineHeight: '1.5' }))(
                                  $text(
                                    `Fund liquidated at ${readableTokenAmount(desc, applyFactor(v.liquidationRate, 10n ** BigInt(PRECISION.shareTokenDecimals)))} ${desc.symbol} per share. Every share converts at this price; outstanding claims stay open.`
                                  )
                                ),
                                $statRow(
                                  'Outstanding claims',
                                  `${readableTokenAmount(desc, applyFactor(v.liquidationRate, v.totalShareSupply))} ${desc.symbol}`
                                )
                              ),
                        op(
                          fundValues,
                          skipRepeatsWith(
                            (a, b) =>
                              a.liquidationRate === b.liquidationRate && a.totalShareSupply === b.totalShareSupply
                          )
                        )
                      )
                    )
                  ]
                : [
                    $node(style({ color: palette.foreground, fontSize: text.xs, textAlign: 'center' }))(
                      $text('Fund will be created on initial allocation')
                    )
                  ])
            ),
            $open: map(which => (which === 'allocate' ? $editor : $fulfillEditor), popEditor)
          })({})
        }, accountIdentity),
        { changeDraft, changeRedeemDraft, changeFulfillDraft, changeSwapDraft, changeClaimDraft }
      ]
    }
  )
