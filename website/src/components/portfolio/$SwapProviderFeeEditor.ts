import type { ChainId } from '@puppet/sdk/const'
import { getChainTokenDescription, readableTokenAmountLabel } from '@puppet/sdk/core'
import { USD_PRICE_DECIMALS } from '@puppet/sdk/evaluate'
import {
  combine,
  debounce,
  empty,
  filter,
  fromPromise,
  type IOps,
  type IStream,
  just,
  map,
  merge,
  op,
  periodic,
  reduce,
  skipRepeatsWith,
  start,
  switchMap
} from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import {
  $node,
  $text,
  attr,
  component,
  type I$Node,
  type I$Slottable,
  type INodeCompose,
  style,
  styleBehavior
} from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { type Address, formatUnits, getAddress } from 'viem'
import { $DropSelect, $dropSelectJoinedListContainer, $infoTooltip, $inlineSpinner, text } from '@/ui-components'
import { providerToken } from '../../io/bridge/swapCommon.js'
import {
  type ISwapAttempt,
  type ISwapProvider,
  type ISwapQuote,
  type ISwapRequest,
  swapQuoteAttempts
} from '../../io/bridge/swapQuote.js'
import { priceFor } from '../../io/price.js'

const HIGH_SWAP_FEE_PCT = 1
// Quotes go stale (Across pins quoteTimestamp to a ~10 minute SpokePool window; DEX calldata drifts with the pool),
// so an active request re-quotes on a fixed cadence — the drafts then always bake a recent route.
const QUOTE_REFRESH_MS = 60_000

type IRouteRowOk = { provider: ISwapProvider; status: 'ok'; quote: ISwapQuote }
type IRouteRow =
  | { provider: ISwapProvider; status: 'pending' }
  | IRouteRowOk
  | { provider: ISwapProvider; status: 'error'; message: string }

type IRouteState = { req: ISwapRequest; rows: IRouteRow[] }

interface IRouteOption {
  provider: ISwapProvider
  status: 'pending' | 'ok' | 'error'
  label: string
  feeUsd: string
  feePct: string
  minReceived: string
  high: boolean
  eta: string
  etaWarn: boolean
  isBest: boolean
  isSelected: boolean
  detail: string
}

export interface ISelectedRoute {
  quote: ISwapQuote | null
  forInput: bigint | null
  // The exact request the quote answers; `ready` is the one flag editors gate submit on: a fresh quote (matches the
  // LIVE request, not one still lagging a just-changed amount/route), with output and within bridge limits.
  forRequest: ISwapRequest | null
  ready: boolean
  error: string | null
  limitError: string | null
}

const EMPTY_SELECTED: ISelectedRoute = { quote: null, forInput: null, forRequest: null, ready: false, error: null, limitError: null }

const limitErrorOf = (req: ISwapRequest, quote: ISwapQuote): string | null => {
  // Bridge limits are denominated in the BRIDGED asset, so compare against the amount that ACTUALLY crosses the bridge,
  // in that asset's units: the composed route carries its own bridgeInput/bridgeAsset (the fund composed bridges a
  // swapped stablecoin, not the request input), a fused/same-asset route bridges the request input to its output.
  const bridgedAmount = quote.provider === 'Composed' ? quote.bridgeInput : req.inputAmount
  const desc =
    quote.provider === 'Composed'
      ? getChainTokenDescription(req.originChainId as ChainId, quote.bridgeAsset)
      : getChainTokenDescription(req.destinationChainId as ChainId, req.outputToken)
  if (quote.isAmountTooLow) return `Below bridge minimum ${readableTokenAmountLabel(desc, quote.limits.minDeposit)}`
  if (bridgedAmount > quote.limits.maxDeposit) {
    return `Exceeds bridge maximum ${readableTokenAmountLabel(desc, quote.limits.maxDeposit)}`
  }
  return null
}

const usdNumber = (amount: bigint, price: bigint) => Number(formatUnits(amount * price, USD_PRICE_DECIMALS))

const routeToolName = (quote: ISwapQuote) => ('tool' in quote ? quote.tool : quote.provider)

// Arrival communication, IN ADVANCE: a provider estimate renders as `~3s`; a cross-chain route WITHOUT an estimate
// renders its worst-case bound `≤30m` (the quote's fill deadline — the point past which the runner treats the fill
// as failed and the funds resurface as route surplus) in the attention tone, so slow routes are visible before submit.
const etaLabel = (quote: ISwapQuote, crossChain: boolean): { text: string; warn: boolean } => {
  const sec = quote.etaSec
  if (sec !== undefined && sec > 0) {
    return { text: sec < 60 ? `~${sec}s` : `~${Math.round(sec / 60)}m`, warn: false }
  }
  if (!crossChain) return { text: '', warn: false }
  const untilDeadlineSec = Math.max(0, Math.floor(quote.fillDeadline) - Math.floor(Date.now() / 1000))
  return { text: `≤${Math.max(1, Math.round(untilDeadlineSec / 60))}m`, warn: true }
}

const sameRequest = (a: ISwapRequest | null, b: ISwapRequest | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.originChainId === b.originChainId &&
    a.destinationChainId === b.destinationChainId &&
    a.inputToken === b.inputToken &&
    a.outputToken === b.outputToken &&
    a.inputAmount === b.inputAmount &&
    a.route === b.route &&
    !!a.crossToken === !!b.crossToken)

const okRows = (rows: IRouteRow[]) => rows.filter((r): r is IRouteRowOk => r.status === 'ok')

const bestProvider = (rows: IRouteRow[]): ISwapProvider | null => {
  const oks = okRows(rows)
  if (oks.length === 0) return null
  return oks.reduce((b, r) => (r.quote.outputAmount > b.quote.outputAmount ? r : b)).provider
}

const pickQuote = (rows: IRouteRow[], selected: ISwapProvider | null): ISwapQuote | null => {
  const oks = okRows(rows)
  if (oks.length === 0) return null
  const best = oks.reduce((b, r) => (r.quote.outputAmount > b.quote.outputAmount ? r : b))
  const picked = selected ? oks.find(r => r.provider === selected) : undefined
  return (picked ?? best).quote
}

// The centralized editor alert stays provider-agnostic (per-provider failures are inlined on their dropdown rows);
// it only communicates that nothing can fulfill the swap right now.
const routeError = (rows: IRouteRow[]): string | null => {
  if (rows.length === 0 || rows.some(r => r.status !== 'error')) return null
  return 'No swap route is available right now — adjust the amount or retry shortly'
}

const feeParts = (inUsd: number, outUsd: number): { amount: string; pct: string; high: boolean } => {
  const fee = inUsd - outUsd
  const amount = fee <= 0 ? '$0.00' : fee < 0.01 ? '< $0.01' : `$${fee.toFixed(2)}`
  const pctVal = inUsd > 0 ? (fee / inUsd) * 100 : 0
  const pct = fee <= 0 || inUsd <= 0 ? '' : pctVal < 0.1 ? '< 0.1%' : `${pctVal.toFixed(1)}%`
  return { amount, pct, high: pctVal > HIGH_SWAP_FEE_PCT }
}

const feeDisplay = (opt: IRouteOption) => (opt.feePct === '' ? opt.feeUsd : `${opt.feeUsd} (${opt.feePct})`)

const toOption = (
  row: IRouteRow,
  req: ISwapRequest,
  inPrice: bigint | null,
  outPrice: bigint | null,
  isBest: boolean,
  isSelected: boolean
): IRouteOption => {
  const base = {
    provider: row.provider,
    feeUsd: '-',
    feePct: '',
    minReceived: '-',
    high: false,
    eta: '',
    etaWarn: false,
    isBest,
    isSelected,
    detail: ''
  }
  if (row.status === 'pending') return { ...base, status: 'pending', label: row.provider }
  if (row.status === 'error') return { ...base, status: 'error', label: row.provider, detail: row.message }
  const fee =
    inPrice === null || outPrice === null
      ? { amount: '-', pct: '', high: false }
      : feeParts(usdNumber(req.inputAmount, inPrice), usdNumber(row.quote.outputAmount, outPrice))
  const eta = etaLabel(row.quote, req.originChainId !== req.destinationChainId)
  return {
    ...base,
    status: 'ok',
    label: routeToolName(row.quote),
    feeUsd: fee.amount,
    feePct: fee.pct,
    high: fee.high,
    minReceived: readableTokenAmountLabel(
      getChainTokenDescription(req.destinationChainId as ChainId, req.outputToken),
      row.quote.outputAmount
    ),
    eta: eta.text,
    etaWarn: eta.warn
  }
}

// USD pricing derives from the REQUEST itself (it names both tokens and chains; providerToken resolves the native
// marker to the chain's wrapped-native, which is what the oracle prices) — editors pass no price streams.
const priceOf = (token: Address, chainId: number): IStream<bigint | null> =>
  priceFor(getAddress(providerToken(token, chainId)))

const $defaultDisclaimer = $node(style({ maxWidth: '240px', lineHeight: '1.4', fontSize: text.sm }))(
  $text(
    'The all-in cost of converting through the selected route: what you send minus the guaranteed minimum you receive (routing fee + slippage). It goes to the third-party route, not to Puppet. Each route shows its estimated arrival; without an estimate a cross-chain transfer can take up to its fill deadline (the ≤ time shown) before it is treated as failed and the funds surface back as recoverable balance.'
  )
)

const PLACEHOLDER: IRouteOption = {
  provider: 'LI.FI',
  status: 'pending',
  label: '',
  feeUsd: '-',
  feePct: '',
  minReceived: '-',
  high: false,
  eta: '',
  etaWarn: false,
  isBest: false,
  isSelected: false,
  detail: ''
}

type IAttemptsFor = (req: ISwapRequest, signal: AbortSignal) => ISwapAttempt[]

const rowsFor = (
  req: ISwapRequest,
  signal: AbortSignal,
  attempts: IAttemptsFor,
  seed: IRouteRow[] | null
): IStream<IRouteRow[]> => {
  const seedByProvider = new Map((seed ?? []).filter(r => r.status === 'ok').map(r => [r.provider, r]))
  const streams = attempts(req, signal).map(attempt =>
    start(
      seedByProvider.get(attempt.provider) ?? ({ provider: attempt.provider, status: 'pending' } as IRouteRow),
      fromPromise(
        attempt.quote.then(
          (quote): IRouteRow => ({ provider: attempt.provider, status: 'ok', quote }),
          (err): IRouteRow => ({
            provider: attempt.provider,
            status: 'error',
            message: err instanceof Error ? err.message : 'Route unavailable'
          })
        )
      )
    )
  )
  return op(
    merge(...streams),
    reduce((acc: Record<string, IRouteRow>, row: IRouteRow) => ({ ...acc, [row.provider]: row }), {} as Record<string, IRouteRow>),
    map(acc => Object.values(acc))
  )
}

const $feeEta = (opt: IRouteOption, fee: string): I$Node =>
  $row(style({ alignItems: 'baseline', gap: '6px' }))(
    $node(style({ fontSize: text.xs, color: opt.high ? palette.negative : palette.message }))($text(fee)),
    opt.eta
      ? $node(style({ fontSize: text.xs, color: opt.etaWarn ? palette.indeterminate : palette.foreground }))(
          $text(opt.eta)
        )
      : empty
  )

// Collapsed anchor: the number that matters (all-in fee) plus arrival, nothing else — the route name and the full
// breakdown live in the expanded panel, so the closed control stays narrow enough to share the Save row.
const $anchorLine = (opt: IRouteOption): I$Node =>
  $row(spacing.small, style({ alignItems: 'center' }))(
    $node(style({ fontSize: text.xs, color: palette.foreground }))($text('fee')),
    opt.status === 'pending'
      ? opt.label === ''
        ? $node(style({ color: palette.foreground }))($text('-'))
        : $inlineSpinner
      : opt.status === 'error'
        ? $node(style({ color: palette.foreground }), attr({ title: opt.detail }))($text('unavailable'))
        : $feeEta(opt, opt.high ? feeDisplay(opt) : opt.feeUsd)
  )

const $valueLabel: IOps<IRouteOption, I$Node> = map($anchorLine)

const $routeOptionRow: IOps<IRouteOption, I$Node> = map(opt =>
  $row(style({ minWidth: '280px', padding: '8px 10px', alignItems: 'center', gap: '10px' }))(
    $node(style({ width: '12px', fontSize: text.xs, color: palette.message }))($text(opt.isSelected ? '✓' : '')),
    $node(style({ color: palette.message, flex: '1' }))($text(opt.label)),
    opt.isBest
      ? $node(
          style({
            fontSize: '10px',
            color: palette.positive,
            border: `1px solid ${palette.positive}`,
            borderRadius: '6px',
            padding: '1px 5px'
          })
        )($text('best'))
      : empty,
    opt.status === 'pending'
      ? $inlineSpinner
      : opt.status === 'error'
        ? $node(style({ fontSize: text.xs, color: palette.foreground }), attr({ title: opt.detail }))(
            $text('unavailable')
          )
        : $feeEta(opt, feeDisplay(opt))
  )
)

// Mirrors aelea's node-compose currying (an ops call is all functions, a children call is all slottables) so the
// injected header survives $DropSelect's and $Dropdown's staged decorator application before the children land.
const withPanelHeader = ($header: I$Node, container: INodeCompose): INodeCompose =>
  ((...input: unknown[]) =>
    input.some(a => typeof a === 'function')
      ? withPanelHeader($header, (container as (...args: unknown[]) => INodeCompose)(...input))
      : (container as unknown as (...children: unknown[]) => I$Node)($header, ...input)) as unknown as INodeCompose

export interface I$SwapProviderFeeEditor {
  // Whether a swap/bridge is involved at all (input token != base token). Drives visibility so the row holds its slot
  // and shows an awaiting-amount placeholder rather than popping in once an amount is typed.
  active: IStream<boolean>
  request: IStream<ISwapRequest | null>
  $disclaimer?: I$Slottable
  // Route sources raced for a request; the default races every provider. A single-provider surface (the withdraw
  // bridge is Across-only, its intent bakes an across route) passes its own list.
  attempts?: IAttemptsFor
}

export const $SwapProviderFeeEditor = ({
  active,
  request,
  $disclaimer = $defaultDisclaimer,
  attempts = swapQuoteAttempts
}: I$SwapProviderFeeEditor) =>
  component(([select, selectTether]: IBehavior<IRouteOption>) => {
    // Debounce + dedupe OWNED here so every editor gets both without hand-rolled trigger pipelines: rapid keystrokes
    // collapse to one request, and late-arriving async inputs (fee maps) that re-fire the editor's combine without
    // changing the request are dropped by sameRequest instead of refetching.
    const request0 = op(request, debounce(200), skipRepeatsWith(sameRequest), state())
    // Superseded fetches are ABORTED (not just discarded): a new request or a refresh tick cancels the in-flight
    // provider calls instead of letting them run to their 10s timeouts.
    let inflight: AbortController | null = null
    const routeState = op(
      request0,
      switchMap(req => {
        if (req === null) {
          inflight?.abort()
          inflight = null
          return just<IRouteState | null>(null)
        }
        // Background re-quote: refresh rounds SEED from the previous round's resolved rows, so the displayed quote
        // (and `ready`) holds while fresh quotes stream in — the blocking spinner only ever shows before the FIRST
        // quote of a new request.
        let prior: IRouteRow[] | null = null
        return op(
          start(0, periodic(QUOTE_REFRESH_MS)),
          switchMap(() => {
            inflight?.abort()
            const controller = new AbortController()
            inflight = controller
            return map(rows => {
              prior = rows
              return { req, rows }
            }, rowsFor(req, controller.signal, attempts, prior))
          })
        )
      }),
      state<IRouteState | null>(null)
    )
    const selected = state(null as ISwapProvider | null, op(select, filter(o => o.status === 'ok'), map(o => o.provider)))
    const prices = op(
      request0,
      switchMap(req =>
        req === null
          ? just<{ inPrice: bigint | null; outPrice: bigint | null }>({ inPrice: null, outPrice: null })
          : combine({
              inPrice: priceOf(req.inputToken, req.originChainId),
              outPrice: priceOf(req.outputToken, req.destinationChainId)
            })
      ),
      state({ inPrice: null as bigint | null, outPrice: null as bigint | null })
    )

    const selectedRoute = op(
      combine({ rs: routeState, req: request0, selected }),
      map(({ rs, req, selected }): ISelectedRoute => {
        if (rs === null || req === null) return EMPTY_SELECTED
        const quote = pickQuote(rs.rows, selected)
        const limitError = quote === null ? null : limitErrorOf(rs.req, quote)
        return {
          quote,
          forInput: rs.req.inputAmount,
          forRequest: rs.req,
          ready: sameRequest(rs.req, req) && quote !== null && quote.outputAmount > 0n && limitError === null,
          error: routeError(rs.rows),
          limitError
        }
      }),
      state<ISelectedRoute>(EMPTY_SELECTED)
    )

    const options = op(
      combine({ rs: routeState, prices, selected }),
      map(({ rs, prices: { inPrice, outPrice }, selected }): IRouteOption[] => {
        if (rs === null) return []
        const best = bestProvider(rs.rows)
        const effective = selected !== null && okRows(rs.rows).some(r => r.provider === selected) ? selected : best
        return rs.rows.map(row =>
          toOption(row, rs.req, inPrice, outPrice, row.provider === best, row.provider === effective)
        )
      }),
      state<IRouteOption[]>([])
    )

    const value = op(
      options,
      map((opts): IRouteOption => {
        const picked = opts.find(o => o.isSelected && o.status === 'ok')
        if (picked) return picked
        if (opts.length === 0) return PLACEHOLDER
        // Nothing quoted yet: a still-pending round anchors as loading; an all-failed round anchors as a generic
        // unavailable (the per-provider details live on the list rows).
        return opts.some(o => o.status === 'pending')
          ? { ...PLACEHOLDER, label: opts[0].label }
          : { ...PLACEHOLDER, status: 'error' }
      }),
      state<IRouteOption>(PLACEHOLDER)
    )

    const detailText = (f: (o: IRouteOption) => string) => map(o => (o.status === 'ok' && f(o) !== '' ? f(o) : '-'), value)
    const $detailLabel = (label: string) => $node(style({ fontSize: text.xs, color: palette.foreground }))($text(label))
    const $detailRow = ($label: I$Node, $value: I$Node) =>
      $row(style({ alignItems: 'center', justifyContent: 'space-between', gap: '24px' }))($label, $value)

    const $panelHeader = $column(
      style({
        gap: '8px',
        padding: '12px 14px',
        margin: '-6px -6px 4px',
        minWidth: '280px',
        borderBottom: `1px solid ${palette.horizon}`,
        fontSize: text.sm
      })
    )(
      $detailRow(
        $detailLabel('Route'),
        $node(style({ color: palette.message }))($text(detailText(o => o.label)))
      ),
      $detailRow(
        $row(style({ alignItems: 'center', gap: '2px' }))($detailLabel('Fee'), $infoTooltip($disclaimer, palette.foreground, '18px')),
        $node(styleBehavior(map(o => ({ color: o.status === 'ok' && o.high ? palette.negative : palette.message }), value)))(
          $text(detailText(feeDisplay))
        )
      ),
      $detailRow(
        $detailLabel('Min. received'),
        $node(style({ color: palette.message }))($text(detailText(o => o.minReceived)))
      ),
      $detailRow(
        $detailLabel('Est. arrival'),
        $node(
          styleBehavior(map(o => ({ color: o.status === 'ok' && o.etaWarn ? palette.indeterminate : palette.message }), value))
        )($text(detailText(o => o.eta)))
      )
    )

    const $dropSelect = $DropSelect({
      value,
      optionList: options,
      $valueLabel,
      $$option: $routeOptionRow,
      $dropListContainer: withPanelHeader($panelHeader, $dropSelectJoinedListContainer),
      closeOnSelect: true
    })({
      select: selectTether()
    })

    const $view = $node(
      style({ display: 'contents' }),
      styleBehavior(map(a => (a ? { display: 'contents' } : { display: 'none' }), active))
    )($dropSelect)

    return [$view, { selectRoute: selectedRoute }]
  })
