import { PUPPET_CONTRACT_MAP } from '@puppet/contracts'
import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import { symbolForBaseTokenId } from '@puppet/sdk/account'
import {
  type IBridgeHubInput,
  type IWalletDepositRoute,
  type IWalletDepositWntRoute,
  resolveDispatchChainId,
  resolveDispatchNetwork
} from '@puppet/sdk/attestation'
import { formatThrownError } from '@puppet/sdk/compact'
import { ADDRESS_ZERO, CHAIN_LIST, type ChainId } from '@puppet/sdk/const'
import { getMappedValueFallback, readableTokenAmount, readableTokenAmountLabel } from '@puppet/sdk/core'
import { getTokenDescription } from '@puppet/sdk/gmx'
import {
  fetchTransientRouteBalance,
  type ISubaccountState,
  type ITokenRegistryMap,
  indexerBlock,
  type RelayFeeMap,
  type RelayMethod,
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
  periodic,
  sample,
  sampleMap,
  start,
  switchMap,
  switchPromises
} from 'aelea/stream'
import { type IBehavior, multicast, state } from 'aelea/stream-extended'
import {
  $element,
  $node,
  $text,
  attr,
  component,
  type I$Node,
  type INode,
  nodeEvent,
  style,
  stylePseudo
} from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { type Address, erc20Abi } from 'viem'
import { readContract } from 'viem/actions'
import {
  $ButtonSecondary,
  $DropSelect,
  $defaultDropdownContainer,
  $defaultDropSelectAnchor,
  $defaultSliderContainer,
  $icon,
  $intermediateText,
  $labeledValue,
  $noteTooltip,
  $Slider,
  $TokenAmountInput,
  $tokenIconMap,
  $unknown,
  $wallet,
  NOTE_TOOLTIP_HEIGHT,
  text
} from '@/ui-components'
import { uiStorage } from '@/ui-storage'
import { depositSourceKey, type IDepositSource } from '../../app/localStoreSchema.js'
import { $tokenWithChainBadge, chainName } from '../../common/$chain.js'
import { type AcrossQuote, fetchAcrossQuote } from '../../io/bridge/across.js'
import { fetchTokenBalances } from '../../io/chain/balances.js'
import * as context from '../../io/context.js'
import { formatUsd, priceFor } from '../../io/gmx/priceFeed.js'
import { homePublicClient, type IConnectedWallet, wagmi } from '../../wallet/index.js'
import type { IDepositDraft, IDepositStep } from './draft.js'
import { DEFAULT_DEADLINE_SEC, walletClientForChain } from './runner/_shared.js'

interface ITokenInputOption {
  symbol: string
  chainId: number
  address: Address
  balance: bigint | null
  decimals: number
  usdValue?: IStream<string>
}

const $tokenIconBySymbol = (sym: string, size = '28px'): I$Node =>
  $icon({
    $content: getMappedValueFallback($tokenIconMap, sym, $unknown),
    size,
    fill: palette.message,
    svgOps: style({ borderRadius: '50%' }),
    viewBox: '0 0 32 32'
  })

const $optionRow = (opt: ITokenInputOption): I$Node => {
  const balanceText = opt.balance && opt.balance > 0n ? readableTokenAmount(opt.decimals, opt.balance) : '-'
  return $row(
    spacing.default,
    style({
      alignItems: 'center',
      justifyContent: 'space-between',
      flex: 1,
      padding: '8px',
      minWidth: '280px',
      gap: '16px'
    })
  )(
    $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))(
      $tokenWithChainBadge($tokenIconBySymbol(opt.symbol, '40px'), opt.chainId, 40, 18),
      $column(style({ gap: '1px', minWidth: '0' }))(
        $node(style({ fontWeight: '600', fontSize: text.base, color: palette.message }))($text(opt.symbol)),
        $node(style({ fontSize: text.xs, color: palette.foreground }))($text(chainName(opt.chainId)))
      )
    ),
    $column(style({ alignItems: 'flex-end', gap: '1px' }))(
      $node(style({ fontWeight: '600', fontSize: text.sm, color: palette.message }))(
        $text(opt.usdValue ?? balanceText)
      ),
      opt.usdValue ? $node(style({ color: palette.foreground, fontSize: text.xs }))($text(balanceText)) : $node()
    )
  )
}

export interface I$DepositEditor {
  accountState: ISubaccountState
  tokenRegistry: ITokenRegistryMap
  walletAccount: IConnectedWallet
  lateBindDerivation?: Omit<IAccountLib__AccountInitParams, 'signer'>
  existingDraft: IStream<IDepositDraft | null>
}

export const $DepositEditor = ({
  accountState,
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
      const baseTokenId = accountState.baseTokenId
      const outputToken = tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, baseTokenId).token
      const symbol = symbolForBaseTokenId(baseTokenId) ?? getTokenDescription(outputToken).symbol
      const recipient = accountState.account
      const outputTokenDesc = getTokenDescription(outputToken)
      const relayFeeMapQuery: IStream<RelayFeeMap> = context.relayFeeMapForToken(baseTokenId)

      type SourceRef = { chainId: number; address: Address; symbol: string }
      const sources: SourceRef[] = CHAIN_LIST.flatMap(chain => {
        const ercAddr = tokenRegistry.get(chain.id as ChainId)?.get(baseTokenId)?.token
        if (!ercAddr) return []
        const entries: SourceRef[] = [{ chainId: chain.id, address: ercAddr, symbol }]
        if (symbol === `W${chain.nativeCurrency.symbol}`) {
          entries.push({ chainId: chain.id, address: ADDRESS_ZERO, symbol: chain.nativeCurrency.symbol })
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
        const bridge = d.inputSteps.find(s => s.kind === 'bridgeHub')
        if (bridge && bridge.kind === 'bridgeHub') {
          const chainId = Number(bridge.input.chainId)
          const erc = tokenRegistry.get(chainId as ChainId)?.get(baseTokenId)?.token
          return erc ? { chainId, address: erc } : null
        }
        return null
      }

      const selectSource: IStream<IDepositSource> = map(opt => {
        void walletClientForChain(walletAccount.walletClient, opt.chainId).catch(err =>
          console.error('[deposit] wallet chain switch failed', err)
        )
        return { chainId: opt.chainId, address: opt.address }
      }, selectOption)
      const isValidSource = (s: IDepositSource): boolean =>
        sources.some(src => src.chainId === s.chainId && src.address === s.address)

      const persistedSource: IStream<IDepositSource | null> = uiStorage.replayWrite(
        depositSourceKey(walletAccount.address),
        filter(isValidSource, selectSource)
      )
      const walletChainId = walletAccount.walletClient.chain?.id
      const walletChainSource =
        walletChainId !== undefined ? (sources.find(s => s.chainId === walletChainId) ?? null) : null
      const fallbackSource: IDepositSource = walletChainSource
        ? { chainId: walletChainSource.chainId, address: walletChainSource.address }
        : { chainId: sources[0].chainId, address: sources[0].address }
      const initialSource: IStream<IDepositSource> = op(
        combine({ saved: persistedSource, balances: balanceQuery }),
        map(p => {
          if (walletChainSource) return { chainId: walletChainSource.chainId, address: walletChainSource.address }
          if (p.saved !== null && isValidSource(p.saved)) return p.saved
          if (p.balances === null) return fallbackSource
          const top = [...p.balances].sort((a, b) => (b.balance > a.balance ? 1 : b.balance < a.balance ? -1 : 0))[0]
          const match = top ? sources.find(s => s.chainId === top.chainId && s.address === top.tokenAddress) : null
          return match ? { chainId: match.chainId, address: match.address } : fallbackSource
        })
      )
      const draftSourceStream: IStream<IDepositSource> = op(
        draftStream,
        map(d => (d ? draftSource(d) : null)),
        filter((s): s is IDepositSource => s !== null && isValidSource(s))
      )
      const sourceSelection: IStream<IDepositSource> = state(
        fallbackSource,
        merge(selectSource, initialSource, draftSourceStream)
      )
      const chainSelection: IStream<number> = op(
        sourceSelection,
        map(s => s.chainId)
      )

      const selectedBalance: IStream<bigint | null> = op(
        combine({ list: balanceQuery, sel: sourceSelection }),
        map(p => {
          if (p.list === null) return null
          return p.list.find(b => b.chainId === p.sel.chainId && b.tokenAddress === p.sel.address)?.balance ?? 0n
        }),
        state()
      )

      const tokenDecimals = outputTokenDesc.decimals
      const tokenPrice = priceFor(outputToken)
      const usdText = (balance: bigint | null): IStream<string> =>
        balance === null ? just('-') : map(price => formatUsd(balance, price), tokenPrice)

      const relayFee: IStream<bigint> = map(
        p => {
          const method: RelayMethod = p.chainId === HUB_CHAIN_ID ? 'signTransientRouteBalance' : 'bridgeHub'
          return p.feeMap[method].relayFee
        },
        combine({ chainId: chainSelection, feeMap: relayFeeMapQuery })
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
            return await fetchTransientRouteBalance(publicClient, token, recipient)
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
        combine({ raw: transientRouteBalance, price: tokenPrice })
      )

      const toOption = (source: SourceRef, balance: bigint | null): ITokenInputOption => ({
        symbol: source.symbol,
        chainId: source.chainId,
        address: source.address,
        balance,
        decimals: tokenDecimals,
        usdValue: usdText(balance)
      })
      const selectedOption: IStream<ITokenInputOption> = map(
        p => {
          const source = sources.find(s => s.chainId === p.sel.chainId && s.address === p.sel.address) ?? sources[0]
          return toOption(source, p.balance)
        },
        combine({ sel: sourceSelection, balance: selectedBalance })
      )

      const optionList: IStream<readonly ITokenInputOption[]> = map(
        p =>
          sources
            .filter(source => !(source.chainId === p.sel.chainId && source.address === p.sel.address))
            .map(source =>
              toOption(
                source,
                p.list === null
                  ? null
                  : (p.list.find(b => b.chainId === source.chainId && b.tokenAddress === source.address)?.balance ?? 0n)
              )
            ),
        combine({ list: balanceQuery, sel: sourceSelection })
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
        | { status: 'idle'; quote: AcrossQuote | null }
        | { status: 'error'; quote: null; message: string }

      // Single source of truth for the origin→home bridge input amount.
      // Must equal post-walletDeposit TR balance so nothing dust-lingers:
      //   sweep (value=0): TR = surplus
      //   value>0: TR = surplus + topUp where topUp = value + recognizeFee
      const bridgeAmountStream: IStream<bigint> = map(
        p => {
          if (p.value === 0n) return p.surplus
          const recognizeFee = p.feeMap.signTransientRouteBalance.relayFee
          return p.surplus + p.value + recognizeFee
        },
        combine({ value, surplus: depositSurplus, feeMap: relayFeeMapQuery })
      )

      // Across locks `bridgeAmount - relayFee` (the router pays the relayer out of
      // the input before depositing to the SpokePool), so the quote must be for
      // that net amount — quoting the gross bridgeAmount overstates outputAmount
      // and underflows the signed bridgeFee = acrossInput - outputAmount.
      const acrossInputStream: IStream<bigint> = map(
        p => {
          const fee = p.feeMap.bridgeHub.relayFee
          return p.amount > fee ? p.amount - fee : 0n
        },
        combine({ amount: bridgeAmountStream, feeMap: relayFeeMapQuery })
      )

      const quoteRefreshTick: IStream<number> = start(0, periodic(60_000))
      const quoteParams = debounce(
        200,
        combine({
          chainId: chainSelection,
          acrossInput: acrossInputStream,
          _: quoteRefreshTick
        })
      )
      const quoteFetch: IStream<Promise<QuoteStatus>> = multicast(
        map(async (params): Promise<QuoteStatus> => {
          if (params.chainId === HUB_CHAIN_ID) return { status: 'idle', quote: null }
          const acrossInput = params.acrossInput
          if (acrossInput <= 0n) return { status: 'idle', quote: null }
          const input = tokenInfoFor(tokenRegistry, params.chainId as ChainId, baseTokenId).token
          try {
            const quote = await fetchAcrossQuote({
              originChainId: params.chainId,
              destinationChainId: HUB_CHAIN_ID,
              inputToken: input,
              outputToken,
              inputAmount: acrossInput,
              recipient
            })
            return { status: 'idle', quote }
          } catch (err) {
            console.error('[$DepositEditor.quoteFetch] fetchAcrossQuote failed', err)
            return { status: 'error', quote: null, message: formatThrownError(err) }
          }
        }, quoteParams)
      )
      const quoteQuery: IStream<QuoteStatus> = multicast(switchPromises(quoteFetch))

      const accountParams: IAccountLib__AccountInitParams = {
        user: accountState.user,
        signer: accountState.signer,
        name: accountState.name,
        baseTokenId: accountState.baseTokenId
      }

      // Leaf-local validation only: input-shape concerns the parent has no view into.
      // Protocol-level checks (verifyTokenAndCap, verifyRelayFee, verifyBridgeHubInput, etc.)
      // run in $TokenBalanceEditor against the live preview and arrive via parentAlert.
      const validation: IStream<Promise<string | null>> = map(
        async (params): Promise<string | null> => {
          if (params.value + params.surplus === 0n) return null
          if (walletChainId !== params.chainId) {
            return `Switch your wallet to ${chainName(params.chainId)}`
          }
          if (params.balance !== null && params.value > params.balance) {
            return `Exceeds wallet balance ${readableTokenAmountLabel(outputTokenDesc, params.balance)}`
          }
          const bridgeAmount = params.bridgeAmount
          if (params.chainId !== HUB_CHAIN_ID && bridgeAmount > 0n && params.q.status === 'error') {
            return params.q.message
          }
          if (params.chainId !== HUB_CHAIN_ID && bridgeAmount > 0n && params.q.quote) {
            if (params.q.quote.isAmountTooLow) {
              return `Below Across minimum ${readableTokenAmount(outputTokenDesc, params.q.quote.limits.minDeposit)}`
            }
            if (bridgeAmount > params.q.quote.limits.maxDeposit) {
              return `Exceeds Across max ${readableTokenAmount(outputTokenDesc, params.q.quote.limits.maxDeposit)}`
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
          bridgeAmount: bridgeAmountStream
        })
      )

      const alert: IStream<string | null> = op(validation, awaitPromises, state(null))

      const bridgeFeeText: IStream<Promise<string>> = switchMap(
        p => {
          const total = p.value + p.surplus
          if (total === 0n) return just(Promise.resolve('-'))
          return map(async pQuote => {
            const s = await pQuote
            if (!s.quote) return '-'
            return formatUsd(total - s.quote.outputAmount, p.price)
          }, quoteFetch)
        },
        combine({ value, surplus: depositSurplus, price: tokenPrice })
      )

      const relayFeeText: IStream<string> = map(
        ({ fee, price }) => formatUsd(fee, price),
        combine({ fee: relayFee, price: tokenPrice })
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
        chainId =>
          chainId === HUB_CHAIN_ID
            ? $column(spacing.small)($labeledValue('Relay fee', $relayFeeNode), $surplusInline)
            : $column(spacing.small)(
                $labeledValue('Bridge fee', $intermediateText(bridgeFeeText)),
                $labeledValue('Relay fee', $relayFeeNode),
                $surplusInline
              ),
        chainSelection
      )

      const disabled: IStream<boolean> = op(
        combine({
          alert,
          value,
          q: quoteQuery,
          chainId: chainSelection,
          existing: draftStream,
          surplus: depositSurplus,
          feeMap: relayFeeMapQuery
        }),
        map(p => {
          if (p.alert !== null) return true
          if (p.value + p.surplus === 0n) return true
          if (p.value === 0n && p.chainId === HUB_CHAIN_ID && p.surplus <= p.feeMap.signTransientRouteBalance.relayFee)
            return true
          if (
            p.existing &&
            p.existing.inputAmount.amount === p.value &&
            (draftSource(p.existing)?.chainId ?? HUB_CHAIN_ID) === p.chainId
          ) {
            return true
          }
          if (p.chainId === HUB_CHAIN_ID) return false
          return p.q.quote === null
        }),
        state(true)
      )

      const valueToShow: IStream<string> = map(
        (p: { amt: bigint; dec: number; focused: boolean }) => (p.amt === 0n ? '' : readableTokenAmount(p.dec, p.amt)),
        filter(
          (p: { amt: bigint; dec: number; focused: boolean }) => !p.focused,
          combine({ amt: value, dec: just(tokenDecimals), focused })
        )
      )

      const submitTrigger: IStream<unknown> = merge(
        clickAddDraft,
        op(
          sampleMap((dis: boolean, evt: KeyboardEvent) => ({ dis, evt }), disabled, enterPress),
          filter(p => !p.dis)
        )
      )

      const $field = $TokenAmountInput({ decimals: tokenDecimals, valueToShow })({
        inputAmount: inputAmountTether(),
        focus: focusEvtTether(),
        blur: blurEvtTether(),
        enter: enterPressTether()
      })

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
        $container: $defaultDropdownContainer(style({ alignItems: 'flex-end', minWidth: '160px', flexShrink: '0' })),
        $anchor: $defaultDropSelectAnchor(stylePseudo(':hover', { borderColor: colorShade(palette.foreground, 40) })),
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
                $text(opt.usdValue ?? (opt.balance === null ? '-' : readableTokenAmount(opt.decimals, opt.balance)))
              )
            )
          )
        ),
        $$option: map((opt: ITokenInputOption) => $optionRow(opt)),
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
      })({ select: selectOptionTether() })

      const amountUsd: IStream<string> = map(
        p => (p.amt === 0n ? '' : formatUsd(p.amt, p.price)),
        combine({ amt: value, price: tokenPrice })
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
              const recognizeFee = params.feeMap.signTransientRouteBalance.relayFee
              const deployFee = params.feeMap.createPuppetAccount.relayFee
              const bridgeFee = params.feeMap.bridgeHub.relayFee
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
              const topUp = params.value > 0n ? params.value + homeRecognizeFee : 0n
              const inputToken = isHome
                ? outputToken
                : tokenInfoFor(tokenRegistry, originChainId as ChainId, baseTokenId).token

              const walletStep:
                | { kind: 'walletDeposit'; input: IWalletDepositRoute }
                | { kind: 'walletDepositWnt'; input: IWalletDepositWntRoute }
                | null =
                topUp === 0n
                  ? null
                  : params.source.address === ADDRESS_ZERO
                    ? {
                        kind: 'walletDepositWnt',
                        input: {
                          chainId: originChainId,
                          params: accountParams,
                          amount: topUp,
                          router: PUPPET_CONTRACT_MAP.CoreGate.address,
                          walletBalance: params.balance ?? 0n
                        }
                      }
                    : {
                        kind: 'walletDeposit',
                        input: {
                          chainId: originChainId,
                          params: accountParams,
                          token: inputToken,
                          amount: topUp,
                          router: PUPPET_CONTRACT_MAP.CoreGate.address,
                          spender: PUPPET_CONTRACT_MAP.WalletDepositModule.address,
                          walletBalance: params.balance ?? 0n,
                          walletAllowance: params.allowance
                        }
                      }

              const recognizeAmount = topUp + params.surplus
              const homeStep: IDepositStep = homeDeployed
                ? {
                    kind: 'signTransientRouteBalance',
                    input: {
                      params: accountParams,
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
              const bridgeStep: { kind: 'bridgeHub'; input: IBridgeHubInput } = {
                kind: 'bridgeHub',
                input: {
                  params: accountParams,
                  blockNumber: originBlockNumber,
                  deadline,
                  acceptableRelayFee: bridgeFee,
                  nonce: randomNonce(),
                  chainId: BigInt(originChainId),
                  fromTransientRoute: true,
                  inputAmount: params.bridgeAmount,
                  destinationChainId: BigInt(HUB_CHAIN_ID),
                  exclusiveRelayer: quote?.exclusiveRelayer ?? '0x0000000000000000000000000000000000000000',
                  quoteTimestamp: quote?.quoteTimestamp ?? 0,
                  fillDeadline: quote?.fillDeadline ?? 0,
                  exclusivityDeadline: quote?.exclusivityDeadline ?? 0,
                  outputAmount: quote?.outputAmount ?? 0n
                }
              }
              const bridgeOutputAmount = quote?.outputAmount ?? params.bridgeAmount
              const bridgeHomeStep: IDepositStep = homeDeployed
                ? {
                    kind: 'signTransientRouteBalance',
                    input: {
                      params: accountParams,
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
              source: sourceSelection,
              q: quoteQuery,
              surplus: depositSurplus,
              bridgeAmount: bridgeAmountStream,
              feeMap: relayFeeMapQuery,
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
