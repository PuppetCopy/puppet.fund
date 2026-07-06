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
import { $node, $text, attr, component, type I$Node, type I$Slottable, style, styleBehavior } from 'aelea/ui'
import { $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { type Address, formatUnits, getAddress } from 'viem'
import { $DropSelect, $inlineSpinner, $labeledValue, text } from '@/ui-components'
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
  high: boolean
  eta: string
  etaWarn: boolean
  isBest: boolean
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

const feeText = (inUsd: number, outUsd: number): { text: string; high: boolean } => {
  const fee = inUsd - outUsd
  const amount = fee <= 0 ? '$0.00' : fee < 0.01 ? '< $0.01' : `$${fee.toFixed(2)}`
  const pct = inUsd > 0 ? (fee / inUsd) * 100 : 0
  const high = pct > HIGH_SWAP_FEE_PCT
  return { text: high ? `${amount} (${pct.toFixed(1)}%)` : amount, high }
}

const toOption = (
  row: IRouteRow,
  req: ISwapRequest,
  inPrice: bigint | null,
  outPrice: bigint | null,
  isBest: boolean
): IRouteOption => {
  if (row.status === 'pending') {
    return { provider: row.provider, status: 'pending', label: row.provider, feeUsd: '', high: false, eta: '', etaWarn: false, isBest, detail: '' }
  }
  if (row.status === 'error') {
    return { provider: row.provider, status: 'error', label: row.provider, feeUsd: '', high: false, eta: '', etaWarn: false, isBest, detail: row.message }
  }
  const fee =
    inPrice === null || outPrice === null
      ? { text: '-', high: false }
      : feeText(usdNumber(req.inputAmount, inPrice), usdNumber(row.quote.outputAmount, outPrice))
  const eta = etaLabel(row.quote, req.originChainId !== req.destinationChainId)
  return {
    provider: row.provider,
    status: 'ok',
    label: routeToolName(row.quote),
    feeUsd: fee.text,
    high: fee.high,
    eta: eta.text,
    etaWarn: eta.warn,
    isBest,
    detail: ''
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

const PLACEHOLDER: IRouteOption = { provider: 'LI.FI', status: 'pending', label: '', feeUsd: '', high: false, eta: '', etaWarn: false, isBest: false, detail: '' }

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

// One shared single-line composition for the option rows AND the anchor, so the selected value reads exactly like the
// list it was picked from: `<tool>  <fee> <eta>`.
const $routeLine = (opt: IRouteOption): I$Node =>
  $row(spacing.small, style({ alignItems: 'center' }))(
    $node(style({ color: palette.message }))($text(opt.label)),
    opt.status === 'pending'
      ? $inlineSpinner
      : opt.status === 'error'
        ? $node(style({ fontSize: text.xs, color: palette.foreground }), attr({ title: opt.detail }))($text('unavailable'))
        : $row(spacing.tiny, style({ alignItems: 'baseline', gap: '6px' }))(
            $node(style({ fontSize: text.xs, ...(opt.high ? { color: palette.negative } : { color: palette.message }) }))(
              $text(opt.feeUsd)
            ),
            opt.eta
              ? $node(style({ fontSize: text.xs, color: opt.etaWarn ? palette.indeterminate : palette.foreground }))(
                  $text(opt.eta)
                )
              : empty
          )
  )

const $routeOptionRow: IOps<IRouteOption, I$Node> = map(opt =>
  $row(style({ minWidth: '220px', padding: '6px 8px' }))($routeLine(opt))
)

const $valueLabel: IOps<IRouteOption, I$Node> = map(opt => {
  if (opt.label === '') {
    if (opt.status === 'error') return $node(style({ color: palette.foreground }))($text('unavailable'))
    return $node(style({ color: palette.foreground }))($text('-'))
  }
  return $routeLine(opt)
})

export interface I$SwapProviderFeeEditor {
  // Whether a swap/bridge is involved at all (input token != base token). Drives visibility so the row holds its slot
  // and shows an awaiting-amount placeholder rather than popping in once an amount is typed.
  active: IStream<boolean>
  request: IStream<ISwapRequest | null>
  label?: string
  $disclaimer?: I$Slottable
  // Route sources raced for a request; the default races every provider. A single-provider surface (the withdraw
  // bridge is Across-only, its intent bakes an across route) passes its own list.
  attempts?: IAttemptsFor
}

export const $SwapProviderFeeEditor = ({
  active,
  request,
  label = 'Swap fee',
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
      combine({ rs: routeState, prices }),
      map(({ rs, prices: { inPrice, outPrice } }): IRouteOption[] => {
        if (rs === null) return []
        const best = bestProvider(rs.rows)
        return rs.rows.map(row => toOption(row, rs.req, inPrice, outPrice, row.provider === best))
      }),
      state<IRouteOption[]>([])
    )

    const value = op(
      combine({ options, selected }),
      map(({ options, selected }): IRouteOption => {
        if (options.length === 0) return PLACEHOLDER
        const oks = options.filter(o => o.status === 'ok')
        const picked = selected ? oks.find(o => o.provider === selected) : undefined
        const best = picked ?? oks.find(o => o.isBest) ?? oks[0]
        if (best) return best
        // Nothing quoted yet: a still-pending round anchors as loading; an all-failed round anchors as a generic
        // unavailable (the per-provider details live on the list rows).
        return options.some(o => o.status === 'pending')
          ? { ...PLACEHOLDER, label: options[0].label }
          : { ...PLACEHOLDER, status: 'error' }
      }),
      state<IRouteOption>(PLACEHOLDER)
    )

    // The anchor already shows the selection; the open list offers only the alternatives (falling back to the full
    // list for a single-provider surface so the dropdown never opens empty).
    const listOptions = op(
      combine({ options, value }),
      map(({ options, value }) => {
        const rest = options.filter(o => o.provider !== value.provider)
        return rest.length > 0 ? rest : options
      })
    )
    const $dropSelect = $DropSelect({
      value,
      optionList: listOptions,
      $valueLabel,
      $$option: $routeOptionRow,
      closeOnSelect: true
    })({
      select: selectTether
        ()
    })

    const $view = $node(
      style({ display: 'contents' }),
      styleBehavior(map(a => (a ? { display: 'contents' } : { display: 'none' }), active))
    )($labeledValue(label, $dropSelect, $disclaimer))

    return [$view, { selectRoute: selectedRoute }]
  })
