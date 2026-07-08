import { CHAIN_TOKEN_MAP, HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import type { IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import { type IWithdrawInput, resolveDispatchChainId } from '@puppet/sdk/attestation'
import { ADDRESS_ZERO, CHAIN_LIST, type ChainId } from '@puppet/sdk/const'
import { getChainTokenDescription, readableTokenAmount, readableTokenAmountLabel } from '@puppet/sdk/core'
import {
  chainHeadBlock,
  type IChainLiveness,
  type ISubaccountState,
  type ITokenRegistryMap,
  nativeSymbolOf,
  type RelayFeeMap,
  randomNonce,
  tokenMetaByAddress,
  wrappedNativeAddressOf
} from '@puppet/sdk/state'
import {
  awaitPromises,
  combine,
  empty,
  filter,
  type IStream,
  just,
  map,
  merge,
  op,
  sampleMap,
  skipRepeats,
  start,
  switchMap,
} from 'aelea/stream'
import { type IBehavior, multicast, state } from 'aelea/stream-extended'
import { $element, $node, $text, component, type INode, nodeEvent, style, styleBehavior } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { type Address, getAddress, type Hex, isAddressEqual } from 'viem'
import { $ButtonPrimaryOutline, $noteTooltip, $TokenAmountInput, text } from '@/ui-components'
import { uiStorage } from '@/ui-storage'
import { originChainKey } from '../../app/localStoreSchema.js'
import { withdrawSwapQuoteAttempts } from '../../io/bridge/acrossSwap.js'
import type { ISwapRequest } from '../../io/bridge/swapQuote.js'
import context, { relayFeeFor } from '../../io/context.js'
import { priceFor } from '../../io/price.js'
import type { IConnectedWallet } from '../../wallet/index.js'
import { $SwapProviderFeeEditor, type ISelectedRoute } from './$SwapProviderFeeEditor.js'
import { $SwapTargetFlow, type ISwapTargetOption } from './$SwapTargetFlow.js'
import type { IWithdrawDraft } from './draft.js'
import { $editorPercentSlider, $maxAmountButton, $noteSlot, createFocusState, scaleByPercent } from './editorUtils.js'
import { DEFAULT_DEADLINE_SEC, walletClientForChain } from './runner/_shared.js'

export interface I$WithdrawEditor {
  accountState: ISubaccountState
  token: Hex
  tokenRegistry: ITokenRegistryMap
  walletAccount: IConnectedWallet
  existingDraft: IStream<IWithdrawDraft | null>
}

export const $WithdrawEditor = (config: I$WithdrawEditor) =>
  component(
    (
      [clickAddDraft, clickAddDraftTether]: IBehavior<PointerEvent>, //
      [pickReceive, pickReceiveTether]: IBehavior<ISwapTargetOption>,
      [selectingDest, selectingDestTether]: IBehavior<boolean>,
      [inputAmount, inputAmountTether]: IBehavior<bigint>,
      [focusEvt, focusEvtTether]: IBehavior<FocusEvent>,
      [blurEvt, blurEvtTether]: IBehavior<FocusEvent>,
      [sliderPercent, sliderPercentTether]: IBehavior<number>,
      [clickMax, clickMaxTether]: IBehavior<INode<HTMLButtonElement>, MouseEvent>,
      [enterPress, enterPressTether]: IBehavior<KeyboardEvent>,
      [selectedRoute, selectedRouteTether]: IBehavior<ISelectedRoute>
    ) => {
      const { accountState, token, tokenRegistry, walletAccount, existingDraft } = config
      const from = accountState.account
      const to = accountState.user ?? walletAccount.address
      const tokenDescription = getChainTokenDescription(HUB_CHAIN_ID, token)
      const decimals = tokenDescription.decimals
      const relayFeeMapQuery: IStream<RelayFeeMap | null> = relayFeeFor(token)

      const balance: IStream<bigint | null> = just(accountState.balances.get(token)?.signedBalance ?? 0n)

      // Registry rows are keyed by each chain's OWN token address, so the hub address only ever matches the hub —
      // destination lanes resolve through the same-asset twin (by TOKEN key: WETH -> WETH, never the priced symbol).
      const tokenKey = tokenMetaByAddress.get(getAddress(token))?.tokenKey
      const destToken = (id: number): Address | null => {
        const chainTokens = CHAIN_TOKEN_MAP[id as keyof typeof CHAIN_TOKEN_MAP] as Record<string, Address> | undefined
        const twin = tokenKey ? chainTokens?.[tokenKey] : undefined
        return twin ? getAddress(twin) : null
      }
      const destChainIds = CHAIN_LIST.map(c => c.id).filter(
        id => id === HUB_CHAIN_ID || (tokenRegistry.get(id as ChainId)?.size ?? 0) > 0
      )
      const isDestChainId = (id: number): boolean => (destChainIds as readonly number[]).includes(id)

      // What a single withdraw intent can DELIVER: any registered hub token (the local swap-and-deliver branch pays
      // the swapped asset straight to the wallet), the input's same-asset twin cross-chain (the rebuilt Across
      // bridge), or any other registered token cross-chain via the field-pinned fused Across swap. The native marker
      // is excluded everywhere: the quote layer resolves it to wrapped-native, so a "native" quote would silently
      // deliver the ERC-20 instead.
      // Wrapped natives are hidden as receive targets — nobody wants the wrapper ERC-20 in their wallet and the
      // native itself isn't quotable — except WETH (a first-class asset everywhere; cross-chain Across even unwraps
      // it to native ETH for EOA recipients) and the withdrawn token itself (the plain-withdraw row).
      const registeredIds = (chainId: number): Hex[] =>
        [...(tokenRegistry.get(chainId as ChainId)?.keys() ?? [])].filter(id => {
          if (isAddressEqual(id, PROTOCOL.nativeToken)) return false
          if (isAddressEqual(id, getAddress(token))) return true
          return (
            !isAddressEqual(id, wrappedNativeAddressOf(chainId as ChainId)) ||
            tokenMetaByAddress.get(getAddress(id))?.tokenKey === 'WETH'
          )
        }) as Hex[]
      const receiveIdsHub: Address[] = [
        getAddress(token),
        ...registeredIds(HUB_CHAIN_ID).filter(id => !isAddressEqual(getAddress(id), getAddress(token)))
      ]
      const receiveOptions: readonly ISwapTargetOption[] = [
        ...receiveIdsHub.map(id => ({
          chainId: HUB_CHAIN_ID as number,
          id: id as Hex,
          symbol: getChainTokenDescription(HUB_CHAIN_ID, id).symbol
        })),
        ...destChainIds
          .filter(id => id !== HUB_CHAIN_ID)
          .flatMap(chainId =>
            registeredIds(chainId).map(id => ({
              chainId,
              id,
              symbol: receiveSymbol(chainId, id)
            }))
          )
      ]
      const isHubReceiveId = (id: Hex): boolean => receiveIdsHub.some(h => isAddressEqual(h, getAddress(id)))
      // Cross-chain, Across UNWRAPS wrapped-native for EOA recipients, so those rows deliver (and read as) the gas
      // coin: WETH on Arbitrum/Base/... shows as ETH. Hub rows keep the wrapper name — local delivery has no unwrap
      // leg, and showing MON while sending WMON would lie.
      const receiveSymbol = (chainId: number, id: Hex): string =>
        chainId !== HUB_CHAIN_ID && isAddressEqual(getAddress(id), wrappedNativeAddressOf(chainId as ChainId))
          ? nativeSymbolOf(chainId as ChainId)
          : getChainTokenDescription(chainId as ChainId, id).symbol

      const walletChainId = walletAccount.walletClient.chain?.id
      const defaultChainId = walletChainId !== undefined && isDestChainId(walletChainId) ? walletChainId : HUB_CHAIN_ID
      const userChain: IStream<number> = map(o => {
        void walletClientForChain(walletAccount.walletClient, o.chainId).catch(err =>
          console.error('[withdraw] wallet chain switch failed', err)
        )
        return o.chainId
      }, pickReceive)
      const draftChain: IStream<number> = op(
        existingDraft,
        filter((d): d is IWithdrawDraft => d !== null && isDestChainId(d.output.chainId)),
        map(d => d.output.chainId)
      )
      const persistedChain: IStream<number | null> = uiStorage.replayWrite(
        originChainKey(to),
        filter((id: number) => isDestChainId(id), userChain)
      )
      const initialChain: IStream<number> = op(
        persistedChain,
        map(saved => (saved !== null && isDestChainId(saved) ? saved : defaultChainId))
      )
      const chainSelection = state(defaultChainId, merge(userChain, draftChain, initialChain))

      // Receive-token half of the pick; validated against the CURRENT chain inside receiveSel (one combine, so a
      // chain change can never pair with a token only valid elsewhere — same diamond-glitch guard as the swap route).
      const draftReceiveToken: IStream<Hex> = op(
        existingDraft,
        filter((d): d is IWithdrawDraft => d !== null),
        map(d => d.input.outputToken as Hex)
      )
      const rawReceiveToken: IStream<Hex> = state(
        token,
        merge(map(o => o.id, pickReceive), draftReceiveToken)
      )
      const receiveSel: IStream<ISwapTargetOption> = op(
        combine({ chainId: chainSelection, id: rawReceiveToken }),
        map(p => {
          const crossFallback = (): Hex => (destToken(p.chainId) as Hex) ?? registeredIds(p.chainId)[0] ?? token
          const id =
            p.chainId === HUB_CHAIN_ID
              ? isHubReceiveId(p.id)
                ? p.id
                : token
              : registeredIds(p.chainId).some(x => isAddressEqual(getAddress(x), getAddress(p.id)))
                ? p.id
                : crossFallback()
          return { chainId: p.chainId, id, symbol: receiveSymbol(p.chainId, id) }
        }),
        state()
      )
      // A receive differing from the plain hub payout (other asset on the hub, or any cross-chain) needs a quoted route.
      const needsRoute = (sel: ISwapTargetOption): boolean =>
        !(sel.chainId === HUB_CHAIN_ID && isAddressEqual(getAddress(sel.id), getAddress(token)))

      // null = withdraw relay fee unpriceable (oracle has no rate) -> '-' + disable Save; never a fabricated 0.
      const relayFee: IStream<bigint | null> = op(
        combine({ chainId: chainSelection, feeMap: relayFeeMapQuery }),
        map(p => (p.feeMap === null ? null : p.feeMap.withdraw.relayFee)),
        skipRepeats
      )

      const sliderFee: IStream<bigint | null> = start(null, relayFee)
      const sliderAmount: IStream<bigint> = sampleMap(
        (s, pct) => {
          const bal = s.balance ?? 0n
          if (Math.max(0, Math.min(1, pct)) >= 1) return bal
          if (s.fee === null) return 0n
          const available = bal > s.fee ? bal - s.fee : 0n
          return scaleByPercent(available, pct)
        },
        combine({ balance, fee: sliderFee }),
        sliderPercent
      )
      const maxAmount: IStream<bigint> = sampleMap(bal => bal ?? 0n, balance, clickMax)
      const draftAmountHydration: IStream<bigint> = op(
        existingDraft,
        map(d => (d ? d.inputAmount.amount : 0n))
      )
      const amountValue: IStream<bigint> = state(0n, merge(inputAmount, sliderAmount, maxAmount, draftAmountHydration))

      const focused = createFocusState(focusEvt, blurEvt)

      // amount === balance → sweep semantics (amount=0 in the intent); otherwise a partial.
      const draftAmount: IStream<bigint> = map(
        p => (p.balance !== null && p.amount > 0n && p.amount === p.balance ? 0n : p.amount),
        combine({ amount: amountValue, balance })
      )

      // Plain combine, never sample: the relay fee arrives async (retrying relayFeeFor); a late arrival re-derives
      // the request. $SwapProviderFeeEditor owns debounce + dedupe + abort + the periodic re-quote.
      const request: IStream<ISwapRequest | null> = multicast(
        map(params => {
          if (!needsRoute(params.sel)) return null
          if (params.raw === 0n || params.balance === null || params.fee === null) return null
          const input = params.draft === 0n ? params.balance - params.fee : params.draft
          if (input <= 0n) return null
          // Same-chain receives quote as a LOCAL swap (LI.FI, delivered straight to the wallet); cross-chain
          // same-asset as the rebuilt Across bridge; cross-chain CROSS-asset as the field-pinned fused Across swap.
          // withdrawSwapQuoteAttempts dispatches on the chain pair + this flag.
          const twin = params.sel.chainId === HUB_CHAIN_ID ? null : destToken(params.sel.chainId)
          return {
            originChainId: HUB_CHAIN_ID,
            destinationChainId: params.sel.chainId,
            inputToken: token,
            outputToken: getAddress(params.sel.id),
            inputAmount: input,
            route: to,
            crossToken:
              params.sel.chainId !== HUB_CHAIN_ID &&
              (twin === null || !isAddressEqual(twin, getAddress(params.sel.id)))
          }
        }, combine({ balance, sel: receiveSel, draft: draftAmount, raw: amountValue, fee: relayFee }))
      )

      const accountParams: IAccountLib__AccountInitParams = {
        user: to,
        signer: accountState.signer
      }

      // Leaf-local validation only: balance & Across quote bounds.
      // Protocol-level withdraw checks run in $TokenBalanceEditor against the live preview
      // and arrive via parentAlert.
      const validation: IStream<Promise<string | null>> = sampleMap(
        async (sample, params): Promise<string | null> => {
          if (params.balance === null) return null
          const fee = sample.relayFee
          // Fee unpriceable -> no fee-bound validation here; the Save gate disables on the same null.
          if (fee === null) return null
          // The amount actually sent to the route: the net partial, or balance - fee on a sweep (matches the quote
          // input at acrossQuoteFetch). Validate the bridge limits against THIS, not the full balance.
          if (needsRoute(params.sel)) {
            if (params.route.error) return params.route.error
            if (params.route.limitError) return params.route.limitError
          }
          // Balance-must-exceed-fee guards the sweep case too, so it runs BEFORE the amount === 0n (sweep) short-circuit
          // (otherwise a dust sweep with balance <= fee signs a zero-output withdraw).
          if (params.balance <= fee) {
            return `Balance must exceed execution fee ${readableTokenAmountLabel(tokenDescription, fee)}`
          }
          if (params.amount === 0n) return null
          if (params.amount + fee > params.balance) {
            return `Exceeds available ${readableTokenAmount(tokenDescription, params.balance - fee)}`
          }
          return null
        },
        combine({ relayFee }),
        combine({
          balance,
          sel: receiveSel,
          route: selectedRoute,
          amount: draftAmount
        })
      )

      const alert: IStream<string | null> = op(validation, awaitPromises, state(null))

      const disabled = op(
        combine({
          alert,
          balance,
          route: selectedRoute,
          sel: receiveSel,
          amount: draftAmount,
          rawAmount: amountValue,
          feeMap: relayFeeMapQuery
        }),
        map(p => {
          if (p.balance === null) return true
          if (p.rawAmount === 0n) return true
          if (p.alert !== null) return true
          // Withdraw relay fee unpriceable -> can't size/sign; block Save until it prices.
          if (p.feeMap === null) return true
          if (!needsRoute(p.sel)) return false
          // route.ready = a fresh quote matching the LIVE request (amount/receive/fee-netted input), within bridge
          // limits; anything else would sign an output floor for a different input.
          return !p.route.ready
        }),
        state(true)
      )

      const submitTrigger: IStream<unknown> = merge(
        clickAddDraft,
        op(
          sampleMap((dis: boolean, evt: KeyboardEvent) => ({ dis, evt }), disabled, enterPress),
          filter(p => !p.dis)
        )
      )

      const tokenPrice = priceFor(token)

      // HubGate.withdraw accepts any provider route (ISwapRoute, approve+call), not only the Across bridge — the
      // attestation already enforces quote freshness + the output floor for both kinds. So the withdraw races the
      // full provider set like every other editor; same-asset bridging needs no destination call, so routes that
      // are structurally unavailable for cross-asset deposits can still serve withdrawals.
      const $bridgeFeeRow = $SwapProviderFeeEditor({
        active: map(needsRoute, receiveSel),
        request,
        attempts: withdrawSwapQuoteAttempts
      })({ selectRoute: selectedRouteTether() })

      const valueToShow: IStream<string> = map(
        (p: { amt: bigint; focused: boolean }) => (p.amt === 0n ? '' : readableTokenAmount(decimals, p.amt)),
        filter((p: { amt: bigint; focused: boolean }) => !p.focused, combine({ amt: amountValue, focused }))
      )

      const $field = $TokenAmountInput({ decimals, valueToShow })({
        inputAmount: inputAmountTether(),
        focus: focusEvtTether(),
        blur: blurEvtTether(),
        enter: enterPressTether()
      })

      const sliderValue: IStream<number> = map(
        p => {
          const bal = p.bal ?? 0n
          if (p.fee === null) return 0
          const available = bal > p.fee ? bal - p.fee : 0n
          if (available <= 0n) return 0
          return Math.min(1, Number((p.amt * 10000n) / available) / 10000)
        },
        combine({ amt: amountValue, bal: balance, fee: sliderFee })
      )
      const hasError: IStream<boolean> = map(a => a !== null, alert)
      const sliderDisabled: IStream<boolean> = map(b => b === null || b === 0n, balance)
      const $percentSlider = $editorPercentSlider({
        value: sliderValue,
        ariaLabel: 'Amount percentage',
        disabled: sliderDisabled,
        error: hasError
      })({ change: sliderPercentTether() })

      const $alert = $noteSlot(switchMap(msg => (msg ? $noteTooltip($text(msg)) : empty), alert))

      const $maxButton = $maxAmountButton(amountValue, balance, clickMaxTether(nodeEvent('click')))

      const $topSection = $SwapTargetFlow({
        value: receiveSel,
        optionList: just(receiveOptions),
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
              $node(style({ color: palette.foreground, fontSize: text.sm, fontWeight: '500' }))($text('Withdraw')),
              $row(spacing.small, style({ alignItems: 'center' }))($field, $maxButton),
              $alert
            ),
            $anchor
          )
      })({ select: pickReceiveTether(), selecting: selectingDestTether() })

      return [
        $column(spacing.default, style({ minWidth: '380px' }))(
          $topSection,
          // The selection list owns the WHOLE popover: everything below the top section hides while selecting.
          // Visibility only, never a mount toggle — the fee editor's route stream is tethered in here.
          $node(
            style({ display: 'contents' }),
            styleBehavior(map(s => (s ? { display: 'none' } : { display: 'contents' }), selectingDest))
          )(
            $node(style({ margin: '0 -26px', display: 'flex' }))($percentSlider),
            $row(style({ fontSize: text.sm }))($bridgeFeeRow),
            $row(spacing.default, style({ alignItems: 'center' }))(
              $node(style({ flex: 1 }))(),
              $ButtonPrimaryOutline({ disabled, $content: $text('Save') })({ click: clickAddDraftTether() })
            )
          )
        ),
        (() => {
          type IDraftSnapshot = {
            balance: bigint | null
            sel: ISwapTargetOption
            amount: bigint
            route: ISelectedRoute
            existing: IWithdrawDraft | null
          }
          const buildDraft = (params: IDraftSnapshot & { fee: bigint; chainLiveness: IChainLiveness }): IWithdrawDraft => {
              const isHome = params.sel.chainId === HUB_CHAIN_ID
              const liveBalance = params.balance ?? 0n
              const isSweep = params.amount === 0n
              const dispatchChainId = resolveDispatchChainId(undefined)
              const blockNumber = chainHeadBlock(params.chainLiveness, dispatchChainId)
              const deadline = BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC)
              const existingNonce = params.existing?.input.nonce
              const nonce = existingNonce ?? randomNonce()

              const id = `withdraw:${from}`
              const account = from
              const grossAmount = isSweep ? liveBalance : params.amount + params.fee

              if (isHome && !needsRoute(params.sel)) {
                const input: IWithdrawInput = {
                  params: accountParams,
                  inputToken: token,
                  outputToken: token,
                  blockNumber,
                  deadline,
                  nonce,
                  acceptableRelayFee: params.fee,
                  chainId: BigInt(HUB_CHAIN_ID),
                  inputAmount: grossAmount,
                  outputAmount: grossAmount > params.fee ? grossAmount - params.fee : 0n,
                  destinationChainId: BigInt(HUB_CHAIN_ID),
                  route: { kind: 'transfer' },
                  expires: 0,
                  fillDeadline: 0
                }
                return {
                  kind: 'withdraw',
                  id,
                  account,
                  title: 'Withdraw',
                  alert: null,
                  inputAmount: { amount: grossAmount, baseToken: token },
                  output: {
                    receiver: to,
                    chainId: HUB_CHAIN_ID,
                    amount: grossAmount,
                    baseToken: token,
                    approx: false
                  },
                  input
                }
              }

              const quote = params.route.quote
              // Local swap-withdraw: HubGate's swap branch delivers the swapped asset straight to the wallet on the
              // hub, so the route is the LI.FI quote's opaque calldata (kind 'swap' — the only kind the co-signer
              // accepts locally). Cross-chain stays the rebuilt Across bridge; its intent outputToken must be the
              // DESTINATION chain's twin address (registry rows are per-chain keyed; the hub address would fail
              // verifyTokenAndCap at attest).
              const outputToken = getAddress(params.sel.id)
              const input: IWithdrawInput = {
                params: accountParams,
                inputToken: token,
                outputToken,
                blockNumber,
                deadline,
                acceptableRelayFee: params.fee,
                nonce,
                chainId: BigInt(HUB_CHAIN_ID),
                inputAmount: grossAmount,
                outputAmount: quote?.outputAmount ?? 0n,
                destinationChainId: BigInt(params.sel.chainId),
                route:
                  quote !== null && quote.route.kind !== 'composed'
                    ? quote.route
                    : {
                        kind: 'across',
                        exclusiveRelayer: ADDRESS_ZERO,
                        quoteTimestamp: 0,
                        exclusivityParameter: 0
                      },
                expires: Math.floor(quote?.expires ?? 0),
                fillDeadline: Math.floor(quote?.fillDeadline ?? 0)
              }
              return {
                kind: 'withdraw',
                id,
                account,
                title: isHome ? 'Swap Withdraw' : 'Bridge Withdraw',
                alert: null,
                inputAmount: { amount: grossAmount, baseToken: token },
                output: {
                  receiver: to,
                  chainId: params.sel.chainId,
                  amount: quote?.outputAmount ?? grossAmount,
                  baseToken: params.sel.id,
                  approx: true
                },
                input
              }
          }
          const changeDraft: IStream<IWithdrawDraft> = op(
            sampleMap(
              (snap: IDraftSnapshot): IDraftSnapshot => snap,
              combine({
                balance,
                sel: receiveSel,
                amount: draftAmount,
                route: selectedRoute,
                existing: existingDraft
              }),
              submitTrigger
            ),
            map(async (snap): Promise<IWithdrawDraft> => {
              const [feeMap, chainLiveness] = await Promise.all([
                context.getRelayFeeMap(HUB_CHAIN_ID, token),
                context.getChainLiveness()
              ])
              return buildDraft({ ...snap, fee: feeMap.withdraw.relayFee, chainLiveness })
            }),
            awaitPromises
          )
          return { changeDraft }
        })()
      ]
    }
  )
