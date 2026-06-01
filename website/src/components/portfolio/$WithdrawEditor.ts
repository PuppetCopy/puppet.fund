import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import {
  type IBridgeToWalletInput,
  type IWithdrawInput,
  resolveDispatchChainId,
  resolveDispatchNetwork
} from '@puppet/sdk/attestation'
import { formatThrownError } from '@puppet/sdk/compact'
import { CHAIN_LIST, type ChainId } from '@puppet/sdk/const'
import { readableTokenAmount, readableTokenAmountLabel } from '@puppet/sdk/core'
import { getTokenDescription } from '@puppet/sdk/gmx'
import {
  type ISubaccountState,
  type ITokenRegistryMap,
  indexerBlock,
  type RelayFeeMap,
  type RelayMethod,
  randomNonce,
  tokenInfoFor
} from '@puppet/sdk/state'
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
  periodic,
  sample,
  sampleMap,
  start,
  switchMap,
  switchPromises
} from 'aelea/stream'
import { type IBehavior, multicast, state } from 'aelea/stream-extended'
import { $element, $node, $text, attr, component, type INode, nodeEvent, style, stylePseudo } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import {
  $ButtonSecondary,
  $DropSelect,
  $defaultDropdownContainer,
  $defaultDropSelectAnchor,
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
import { type AcrossQuote, fetchAcrossQuote } from '../../io/bridge/across.js'
import * as context from '../../io/context.js'
import { formatUsd, priceFor } from '../../io/gmx/priceFeed.js'
import type { IConnectedWallet } from '../../wallet/index.js'
import type { IWithdrawDraft, IWithdrawStep } from './draft.js'
import { DEFAULT_DEADLINE_SEC, walletClientForChain } from './runner/_shared.js'

export interface I$WithdrawEditor {
  accountState: ISubaccountState
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
      const { accountState, tokenRegistry, walletAccount, existingDraft } = config
      const baseTokenId = accountState.baseTokenId
      const token = tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, baseTokenId).token
      const from = accountState.account
      const to = accountState.user
      const tokenDescription = getTokenDescription(token)
      const decimals = tokenDescription.decimals
      const relayFeeMapQuery: IStream<RelayFeeMap> = context.relayFeeMapForToken(baseTokenId)

      const balance: IStream<bigint | null> = just(accountState.chains.get(HUB_CHAIN_ID)?.signedBalance ?? 0n)

      const destChainIds = CHAIN_LIST.map(c => c.id).filter(id => !!tokenRegistry.get(id as ChainId)?.get(baseTokenId))
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

      const relayFee: IStream<bigint> = map(
        p => {
          const method: RelayMethod = p.chainId === HUB_CHAIN_ID ? 'walletWithdraw' : 'bridgeToWallet'
          return p.feeMap[method].relayFee
        },
        combine({ chainId: chainSelection, feeMap: relayFeeMapQuery })
      )

      const sliderAmount: IStream<bigint> = sampleMap(
        (bal, pct) => {
          const bp = BigInt(Math.round(Math.max(0, Math.min(1, pct)) * 10000))
          return ((bal ?? 0n) * bp) / 10000n
        },
        balance,
        sliderPercent
      )
      const maxAmount: IStream<bigint> = sampleMap(bal => bal ?? 0n, balance, clickMax)
      const draftAmountHydration: IStream<bigint> = op(
        existingDraft,
        map(d => (d ? d.inputAmount.amount : 0n))
      )
      const amountValue: IStream<bigint> = state(0n, merge(inputAmount, sliderAmount, maxAmount, draftAmountHydration))

      const focused: IStream<boolean> = state(false, merge(constant(true, focusEvt), constant(false, blurEvt)))

      // amount === balance → sweep semantics (amount=0 in the intent); otherwise a partial.
      const draftAmount: IStream<bigint> = map(
        p => (p.balance !== null && p.amount > 0n && p.amount === p.balance ? 0n : p.amount),
        combine({ amount: amountValue, balance })
      )

      type QuoteStatus =
        | { status: 'idle'; quote: AcrossQuote | null }
        | { status: 'error'; quote: null; message: string }
      const quoteRefreshTick: IStream<number> = start(0, periodic(60_000))
      const quoteParams = debounce(
        200,
        combine({
          balance,
          chainId: chainSelection,
          fee: relayFee,
          draft: draftAmount,
          raw: amountValue,
          _: quoteRefreshTick
        })
      )
      const acrossQuoteFetch: IStream<Promise<QuoteStatus>> = multicast(
        map(async (params): Promise<QuoteStatus> => {
          if (params.chainId === HUB_CHAIN_ID) return { status: 'idle', quote: null }
          if (params.raw === 0n) return { status: 'idle', quote: null }
          if (params.balance === null) return { status: 'idle', quote: null }
          const input = params.draft === 0n ? params.balance - params.fee : params.draft
          if (input <= 0n) return { status: 'idle', quote: null }
          const outputToken = tokenInfoFor(tokenRegistry, params.chainId as ChainId, baseTokenId).token
          try {
            const quote = await fetchAcrossQuote({
              originChainId: HUB_CHAIN_ID,
              destinationChainId: params.chainId,
              inputToken: token,
              outputToken,
              inputAmount: input,
              recipient: to
            })
            return { status: 'idle', quote }
          } catch (err) {
            console.error('[$WithdrawEditor.acrossQuoteFetch] fetchAcrossQuote failed', err)
            return { status: 'error', quote: null, message: formatThrownError(err) }
          }
        }, quoteParams)
      )
      const acrossQuoteQuery: IStream<QuoteStatus> = multicast(switchPromises(acrossQuoteFetch))

      const accountParams: IAccountLib__AccountInitParams = {
        user: accountState.user,
        signer: accountState.signer,
        name: accountState.name,
        baseTokenId: accountState.baseTokenId
      }

      // Leaf-local validation only: balance & Across quote bounds.
      // Protocol-level checks (verifyWithdrawInput / verifyBridgeToWalletInput)
      // run in $TokenBalanceEditor against the live preview and arrive via parentAlert.
      const validation: IStream<Promise<string | null>> = sampleMap(
        async (sample, params): Promise<string | null> => {
          if (params.amount === 0n) return null
          if (params.balance === null) return null
          const fee = sample.relayFee
          if (params.balance <= fee) {
            return `Balance must exceed execution fee ${readableTokenAmountLabel(tokenDescription, fee)}`
          }
          if (params.amount + fee > params.balance) {
            return `Exceeds available ${readableTokenAmount(tokenDescription, params.balance - fee)}`
          }
          if (params.chainId !== HUB_CHAIN_ID) {
            if (params.q.status === 'error') return params.q.message
            if (!params.q.quote) return null
            if (params.q.quote.isAmountTooLow) {
              return `Below Across minimum ${readableTokenAmount(tokenDescription, params.q.quote.limits.minDeposit)}`
            }
            if (params.balance - fee > params.q.quote.limits.maxDeposit) {
              return `Exceeds Across max ${readableTokenAmount(tokenDescription, params.q.quote.limits.maxDeposit)}`
            }
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
          rawAmount: amountValue
        }),
        map(p => {
          if (p.balance === null) return true
          if (p.rawAmount === 0n) return true
          if (p.alert !== null) return true
          if (p.chainId === HUB_CHAIN_ID) return false
          return p.q.quote === null
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

      const $chainOption = (id: number) => $chainLabel(id, 20)

      const tokenPrice = priceFor(token)

      const executionFeeText: IStream<string> = map(
        ({ fee, price }) => formatUsd(fee, price),
        combine({ fee: relayFee, price: tokenPrice })
      )

      const bridgeFeeText: IStream<Promise<string>> = switchMap(
        p => {
          if (p.raw === 0n) return just(Promise.resolve('-'))
          return map(async pQuote => {
            const status = await pQuote
            if (status.status === 'error') return 'unavailable'
            if (!status.quote) return '-'
            return formatUsd(p.raw - status.quote.outputAmount, p.price)
          }, acrossQuoteFetch)
        },
        combine({ raw: amountValue, price: tokenPrice })
      )

      const $bridgeFeeRow = switchMap(
        chainId => (chainId === HUB_CHAIN_ID ? empty : $labeledValue('Bridge Fee ~', $intermediateText(bridgeFeeText))),
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
        p => (p.bal && p.bal > 0n ? Number((p.amt * 10000n) / p.bal) / 10000 : 0),
        combine({ amt: amountValue, bal: balance })
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
        $anchor: $defaultDropSelectAnchor(stylePseudo(':hover', { borderColor: colorShade(palette.foreground, 40) })),
        value: chainSelection,
        optionList: destChainIds,
        $valueLabel: map((id: number) =>
          $row(spacing.small, style({ alignItems: 'center' }))(
            $chainIcon(id, 28),
            $column(style({ gap: '0' }))(
              $node(style({ fontWeight: '600', fontSize: text.base }))($text(chainName(id))),
              $node(style({ color: palette.foreground, fontSize: text.xs }))($text('Send to'))
            )
          )
        ),
        $$option: map((id: number) => $chainOption(id)),
        $optionContainer: $node(
          style({ cursor: 'pointer', padding: '4px 6px', borderRadius: '10px', display: 'block' }),
          stylePseudo(':hover', { backgroundColor: palette.horizon })
        ),
        $dropListContainer: $column(
          style({
            background: palette.background,
            border: `1px solid ${colorShade(palette.foreground, 60)}`,
            borderRadius: '14px',
            padding: '6px',
            gap: '2px',
            boxShadow: `0 8px 24px ${palette.shadow}`,
            minWidth: '260px'
          })
        )
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
            $column(spacing.small)($labeledValue('Relay fee', $text(start('-', executionFeeText))), $bridgeFeeRow),
            $node(style({ flex: 1 }))(),
            $ButtonSecondary({ disabled, $content: $text('Save') })({ click: clickAddDraftTether() })
          )
        ),
        (() => {
          const previewDraft: IStream<IWithdrawDraft> = map(
            (params): IWithdrawDraft => {
              const isHome = params.chainId === HUB_CHAIN_ID
              const liveBalance = params.balance ?? 0n
              const isSweep = params.amount === 0n
              const dispatchChainId = resolveDispatchChainId(undefined)
              const blockNumber = indexerBlock(params.indexerHealth, resolveDispatchNetwork(dispatchChainId))
              const deadline = BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC)
              const existingNonce = params.existing?.inputSteps[0]?.input.nonce
              const nonce = existingNonce ?? randomNonce()

              const id = `withdraw:${from}`
              const account = from
              const deployStep: IWithdrawStep | null = accountState.chains.has(HUB_CHAIN_ID)
                ? null
                : {
                    kind: 'createPuppetAccount',
                    input: {
                      chainId: BigInt(HUB_CHAIN_ID),
                      params: accountParams,
                      blockNumber,
                      deadline,
                      nonce: randomNonce(),
                      acceptableRelayFee: 0n,
                      initialDepositAmount: 0n,
                      userDeploySig: '0x',
                      userSignerProof: '0x'
                    }
                  }

              if (isHome) {
                const grossAmount = isSweep ? liveBalance : params.amount + params.fee
                const input: IWithdrawInput = {
                  params: accountParams,
                  blockNumber,
                  deadline,
                  nonce,
                  acceptableRelayFee: params.fee,
                  chainId: BigInt(HUB_CHAIN_ID),
                  amount: grossAmount
                }
                return {
                  kind: 'withdraw',
                  id,
                  account,
                  title: 'Withdraw',
                  alert: null,
                  inputAmount: { amount: grossAmount, baseTokenId },
                  output: {
                    receiver: to,
                    chainId: HUB_CHAIN_ID,
                    amount: grossAmount,
                    baseTokenId,
                    approx: false
                  },
                  inputSteps: [...(deployStep ? [deployStep] : []), { kind: 'walletWithdraw', input }]
                }
              }

              const intentInputAmount = isSweep ? 0n : params.amount + params.fee
              const grossAmount = isSweep ? liveBalance : params.amount + params.fee
              const quote = params.q.quote
              const input: IBridgeToWalletInput = {
                params: accountParams,
                blockNumber,
                deadline,
                acceptableRelayFee: params.fee,
                nonce,
                inputAmount: intentInputAmount,
                destinationChainId: BigInt(params.chainId),
                exclusiveRelayer: quote?.exclusiveRelayer ?? '0x0000000000000000000000000000000000000000',
                quoteTimestamp: quote?.quoteTimestamp ?? 0,
                fillDeadline: quote?.fillDeadline ?? 0,
                exclusivityDeadline: quote?.exclusivityDeadline ?? 0,
                outputAmount: quote?.outputAmount ?? 0n
              }
              return {
                kind: 'withdraw',
                id,
                account,
                title: 'Bridge Withdraw',
                alert: null,
                inputAmount: { amount: grossAmount, baseTokenId },
                output: {
                  receiver: to,
                  chainId: params.chainId,
                  amount: quote?.outputAmount ?? grossAmount,
                  baseTokenId,
                  approx: true
                },
                inputSteps: [...(deployStep ? [deployStep] : []), { kind: 'bridgeToWallet', input }]
              }
            },
            combine({
              balance,
              chainId: chainSelection,
              amount: draftAmount,
              fee: relayFee,
              q: acrossQuoteQuery,
              indexerHealth: context.indexerHealth,
              existing: existingDraft
            })
          )
          return { changeDraft: sample(previewDraft, submitTrigger) }
        })()
      ]
    }
  )
