import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import { type IWithdrawInput, resolveDispatchChainId } from '@puppet/sdk/attestation'
import { formatThrownError } from '@puppet/sdk/compact'
import { ADDRESS_ZERO, CHAIN_LIST, type ChainId } from '@puppet/sdk/const'
import { getRegisteredTokenDescription, readableTokenAmount, readableTokenAmountLabel } from '@puppet/sdk/core'
import {
  chainHeadBlock,
  type IChainLiveness,
  type ISubaccountState,
  type ITokenRegistryMap,
  type RelayFeeMap,
  type RelayMethod,
  randomNonce,
  tokenInfoFor
} from '@puppet/sdk/state'
import {
  awaitPromises,
  combine,
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
  switchMap,
  switchPromises
} from 'aelea/stream'
import { type IBehavior, multicast, state } from 'aelea/stream-extended'
import { $element, $node, $text, attr, component, type INode, nodeEvent, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import type { Hex } from 'viem'
import {
  $ButtonSecondary,
  $DropSelect,
  $defaultDropdownContainer,
  $defaultSliderContainer,
  $intermediateText,
  $labeledValue,
  $noteTooltip,
  $Slider,
  $TokenAmountInput,
  NOTE_TOOLTIP_HEIGHT,
  text
} from '@/ui-components'
import { uiStorage } from '@/ui-storage'
import { originChainKey } from '../../app/localStoreSchema.js'
import { $chainIcon, $chainLabel, chainName } from '../../common/$chain.js'
import { type AcrossBridgeQuote, fetchAcrossBridgeQuote } from '../../io/bridge/across.js'
import context, { displayRelayFeeMap } from '../../io/context.js'
import { formatUsd, priceFor } from '../../io/gmx/priceFeed.js'
import type { IConnectedWallet } from '../../wallet/index.js'
import type { IWithdrawDraft } from './draft.js'
import { createFocusState } from './editorUtils.js'
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
      [selectChain, selectChainTether]: IBehavior<number>,
      [inputAmount, inputAmountTether]: IBehavior<bigint>,
      [focusEvt, focusEvtTether]: IBehavior<FocusEvent>,
      [blurEvt, blurEvtTether]: IBehavior<FocusEvent>,
      [sliderPercent, sliderPercentTether]: IBehavior<number>,
      [clickMax, clickMaxTether]: IBehavior<INode<HTMLButtonElement>, MouseEvent>,
      [enterPress, enterPressTether]: IBehavior<KeyboardEvent>
    ) => {
      const { accountState, token, tokenRegistry, walletAccount, existingDraft } = config
      const from = accountState.account
      const to = accountState.user ?? walletAccount.address
      const tokenDescription = getRegisteredTokenDescription(token)
      const decimals = tokenDescription.decimals
      const relayFeeMapQuery: IStream<RelayFeeMap | null> = fromPromise(displayRelayFeeMap(token))

      const balance: IStream<bigint | null> = just(accountState.balances.get(token)?.signedBalance ?? 0n)

      const destChainIds = CHAIN_LIST.map(c => c.id).filter(id => !!tokenRegistry.get(id as ChainId)?.get(token))
      const isDestChainId = (id: number): boolean => (destChainIds as readonly number[]).includes(id)
      const walletChainId = walletAccount.walletClient.chain?.id
      const defaultChainId = walletChainId !== undefined && isDestChainId(walletChainId) ? walletChainId : HUB_CHAIN_ID
      const userChain: IStream<number> = map(chainId => {
        void walletClientForChain(walletAccount.walletClient, chainId).catch(err =>
          console.error('[withdraw] wallet chain switch failed', err)
        )
        return chainId
      }, selectChain)
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
          const clamped = Math.max(0, Math.min(1, pct))
          if (clamped >= 1) return bal
          if (s.fee === null) return 0n
          const available = bal > s.fee ? bal - s.fee : 0n
          const bp = BigInt(Math.round(clamped * 10000))
          return (available * bp) / 10000n
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

      type QuoteStatus =
        | { status: 'idle'; quote: AcrossBridgeQuote | null; forAmount?: bigint; inputAmount?: bigint }
        | { status: 'error'; quote: null; message: string }
      // Quotes fire only on user-driven changes (destination chain, amount); the relay fee
      // is SAMPLED at trigger time as a gas snapshot.
      const quoteTrigger = op(
        combine({ balance, chainId: chainSelection, draft: draftAmount, raw: amountValue }),
        skipRepeatsWith(
          (a, b) => a.chainId === b.chainId && a.draft === b.draft && a.raw === b.raw && a.balance === b.balance
        )
      )
      const quoteParams = debounce(
        200,
        sampleMap((fee, t) => ({ ...t, fee }), relayFee, quoteTrigger)
      )
      const acrossQuoteFetch: IStream<Promise<QuoteStatus>> = op(
        map(async (params): Promise<QuoteStatus> => {
          if (params.chainId === HUB_CHAIN_ID) return { status: 'idle', quote: null }
          if (params.raw === 0n) return { status: 'idle', quote: null }
          if (params.balance === null) return { status: 'idle', quote: null }
          if (params.fee === null) return { status: 'idle', quote: null }
          const input = params.draft === 0n ? params.balance - params.fee : params.draft
          if (input <= 0n) return { status: 'idle', quote: null }
          const outputToken = tokenInfoFor(tokenRegistry, params.chainId as ChainId, token).token
          try {
            const quote = await fetchAcrossBridgeQuote({
              originChainId: HUB_CHAIN_ID,
              destinationChainId: params.chainId,
              inputToken: token,
              outputToken,
              inputAmount: input,
              recipient: to
            })
            return { status: 'idle', quote, forAmount: params.raw, inputAmount: input }
          } catch (err) {
            console.error('[$WithdrawEditor.acrossQuoteFetch] fetchAcrossBridgeQuote failed', err)
            return { status: 'error', quote: null, message: formatThrownError(err) }
          }
        }, quoteParams),
        state()
      )
      const acrossQuoteQuery: IStream<QuoteStatus> = multicast(switchPromises(acrossQuoteFetch))

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
          // The amount actually sent to the bridge: the net partial, or balance - fee on a sweep (matches the quote
          // input at acrossQuoteFetch). Validate the bridge limits against THIS, not the full balance.
          const bridged = params.amount === 0n ? params.balance - fee : params.amount
          if (params.chainId !== HUB_CHAIN_ID) {
            if (params.q.status === 'error') return params.q.message
            if (params.q.quote) {
              if (params.q.quote.isAmountTooLow) {
                return `Below bridge minimum ${readableTokenAmount(tokenDescription, params.q.quote.limits.minDeposit)}`
              }
              if (bridged > params.q.quote.limits.maxDeposit) {
                return `Exceeds bridge max ${readableTokenAmount(tokenDescription, params.q.quote.limits.maxDeposit)}`
              }
            }
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
          chainId: chainSelection,
          q: acrossQuoteQuery,
          amount: draftAmount
        })
      )

      const alert: IStream<string | null> = op(validation, awaitPromises, state(null))

      const disabled = op(
        combine({
          alert,
          balance,
          q: acrossQuoteQuery,
          chainId: chainSelection,
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
          if (p.chainId === HUB_CHAIN_ID) return false
          // The Across quote must be present AND computed for the CURRENT amount; a quote that still lags a just-typed
          // amount (forAmount !== rawAmount) would sign an output floor for a different input. Block until it catches up.
          if (p.q.status !== 'idle' || p.q.quote === null) return true
          return p.q.forAmount !== p.rawAmount
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

      const $chainOption = (id: number) => $node(style({ display: 'flex', padding: '8px 10px' }))($chainLabel(id, 20))

      const tokenPrice = priceFor(token)

      const bridgeFeeText: IStream<Promise<string>> = switchMap(
        p => {
          if (p.raw === 0n) return just(Promise.resolve('-'))
          return map(async pQuote => {
            const status = await pQuote
            if (status.status === 'error') return 'unavailable'
            if (!status.quote) return '-'
            if (status.forAmount !== p.raw) return '…'
            // Subtract against the amount the quote was actually fetched for (= balance - fee on a sweep), not the raw
            // balance, so the relay fee is not double-counted on top of the separate 'Relay fee' row.
            const quotedInput = status.inputAmount ?? p.raw
            return formatUsd(quotedInput - status.quote.outputAmount, p.price)
          }, acrossQuoteFetch)
        },
        combine({ raw: amountValue, price: tokenPrice })
      )

      const $bridgeFeeRow = switchMap(
        chainId => (chainId === HUB_CHAIN_ID ? empty : $labeledValue('Bridge Fee', $intermediateText(bridgeFeeText))),
        chainSelection
      )

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
      const $percentSlider = $Slider({
        value: sliderValue,
        step: 0.01,
        orientation: 'horizontal',
        ariaLabel: 'Amount percentage',
        disabled: sliderDisabled,
        error: hasError,
        motion: { stiffness: 800, damping: 58 },
        $container: $defaultSliderContainer(
          style({ height: '14px', width: '100%', margin: '-26px 0', flexShrink: '0' })
        )
      })({ change: sliderPercentTether() })

      const $alert = $node(style({ height: NOTE_TOOLTIP_HEIGHT, display: 'flex', alignItems: 'center' }))(
        switchMap(msg => (msg ? $noteTooltip($text(msg)) : empty), alert)
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
        combine({ amt: amountValue, bal: balance })
      )

      const $picker = $DropSelect({
        $container: $defaultDropdownContainer(style({ alignItems: 'flex-end', flexShrink: '0' })),
        value: chainSelection,
        optionList: destChainIds,
        $valueLabel: map((id: number) =>
          $row(spacing.small, style({ alignItems: 'center' }))(
            $chainIcon(id, 28),
            $column(style({ gap: '0' }))(
              $node(style({ fontWeight: '600', fontSize: text.base }))($text(chainName(id))),
              $node(style({ color: palette.foreground, fontSize: text.xs }))($text('Receive at'))
            )
          )
        ),
        $$option: map((id: number) => $chainOption(id))
      })({ select: selectChainTether() })

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
              $node(style({ color: palette.foreground, fontSize: text.sm, fontWeight: '500' }))($text('Withdraw')),
              $row(spacing.small, style({ alignItems: 'center' }))($field, $maxButton),
              $alert
            ),
            $picker
          ),
          $node(style({ margin: '0 -26px', display: 'flex' }))($percentSlider),

          $row(spacing.default, style({ alignItems: 'center', fontSize: text.sm }))(
            $bridgeFeeRow,
            $node(style({ flex: 1 }))(),
            $ButtonSecondary({ disabled, $content: $text('Save') })({ click: clickAddDraftTether() })
          )
        ),
        (() => {
          type IDraftSnapshot = {
            balance: bigint | null
            chainId: number
            amount: bigint
            q: QuoteStatus
            existing: IWithdrawDraft | null
          }
          const buildDraft = (params: IDraftSnapshot & { fee: bigint; chainLiveness: IChainLiveness }): IWithdrawDraft => {
              const isHome = params.chainId === HUB_CHAIN_ID
              const liveBalance = params.balance ?? 0n
              const isSweep = params.amount === 0n
              const dispatchChainId = resolveDispatchChainId(undefined)
              const blockNumber = chainHeadBlock(params.chainLiveness, dispatchChainId)
              const deadline = BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC)
              const existingNonce = params.existing?.input.nonce
              const nonce = existingNonce ?? randomNonce()

              const id = `withdraw:${from}`
              const account = from

              if (isHome) {
                const grossAmount = isSweep ? liveBalance : params.amount + params.fee
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

              const grossAmount = isSweep ? liveBalance : params.amount + params.fee
              const quote = params.q.quote
              const input: IWithdrawInput = {
                params: accountParams,
                inputToken: token,
                outputToken: token,
                blockNumber,
                deadline,
                acceptableRelayFee: params.fee,
                nonce,
                chainId: BigInt(HUB_CHAIN_ID),
                inputAmount: grossAmount,
                outputAmount: quote?.outputAmount ?? 0n,
                destinationChainId: BigInt(params.chainId),
                route: quote?.route ?? {
                  kind: 'across',
                  exclusiveRelayer: ADDRESS_ZERO,
                  quoteTimestamp: 0,
                  exclusivityParameter: 0
                },
                expires: quote?.expires ?? 0,
                fillDeadline: quote?.fillDeadline ?? 0
              }
              return {
                kind: 'withdraw',
                id,
                account,
                title: 'Bridge Withdraw',
                alert: null,
                inputAmount: { amount: grossAmount, baseToken: token },
                output: {
                  receiver: to,
                  chainId: params.chainId,
                  amount: quote?.outputAmount ?? grossAmount,
                  baseToken: token,
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
                chainId: chainSelection,
                amount: draftAmount,
                q: acrossQuoteQuery,
                existing: existingDraft
              }),
              submitTrigger
            ),
            map(async (snap): Promise<IWithdrawDraft> => {
              const [feeMap, chainLiveness] = await Promise.all([
                context.getRelayFeeMap(token),
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
