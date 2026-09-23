
import { getTokenDescription, readableTokenAmountLabel } from '@puppet/sdk/core'
import { USD_PRICE_DECIMALS } from '@puppet/sdk/evaluate'
import { deliveredLeg, type IRouteLane, type IRoutePlan } from '@puppet/sdk/intent'
import {
  combine,
  debounce,
  disposeBoth,
  disposeWith,
  empty,
  filter,
  fromPromise,
  type IOps,
  type IStream,
  just,
  map,
  merge,
  op,
  reduce,
  skipRepeatsWith,
  start,
  switchMap
} from 'aelea/stream'
import { type IBehavior, state, stream } from 'aelea/stream-extended'
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
import { formatUnits, } from 'viem'
import { $DropSelect, $dropSelectJoinedListContainer, $infoTooltip, $inlineSpinner, text } from '@/ui-components'
import { type ISwapRequest, swapRouteCandidates } from '../../io/bridge/swapQuote.js'
import { formatUsdNumber, priceFor } from '../../io/price.js'


const ROUTE_LABEL: Record<string, string> = {
  lifi: 'LI.FI',
  kyber: 'KyberSwap',
  across: 'Across',
  acrossSwap: 'AcrossSwap',
  composed: 'Composed'
}

const routeLabel = (id: string): string => {
  const label = ROUTE_LABEL[id]
  if (label === undefined) throw new Error(`unrecognised swap route candidate '${id}'`)
  return label
}

const bridgeLeg = (plan: IRoutePlan): IRouteLane =>
  plan.length === 1 || plan[0].route.kind === 'across' ? plan[0] : plan[1]!

type IRouteRowOk = { id: string; status: 'ok'; req: ISwapRequest; plan: IRoutePlan }
type IRouteRow =
  | { id: string; status: 'pending' }
  | IRouteRowOk
  | { id: string; status: 'error'; message: string }

type IRouteState = { req: ISwapRequest; rows: IRouteRow[] }

interface IRouteOption {
  id: string
  status: 'pending' | 'ok' | 'error'
  label: string
  feeUsd: string
  feePct: string
  minReceived: string
  net: number | null
  fetching: boolean
  eta: string
  etaWarn: boolean
  isBest: boolean
  isSelected: boolean
  detail: string
}

export interface ISelectedRoute {
  plan: IRoutePlan | null
  ready: boolean
  error: string | null
  limitError: string | null
}

const EMPTY_SELECTED: ISelectedRoute = { plan: null, ready: false, error: null, limitError: null }

const limitErrorOf = (req: ISwapRequest, plan: IRoutePlan): string | null => {
  const bridge = bridgeLeg(plan)
  const composed = plan.length > 1
  const tooLow = plan.some(leg => leg.isAmountTooLow)
  if (bridge.limits === null) return tooLow ? 'Below this route’s minimum' : null
  const desc = composed
    ? getTokenDescription(req.originChainId, bridge.inputToken)
    : getTokenDescription(req.destinationChainId, req.outputToken)
  if (tooLow) return `Below bridge minimum ${readableTokenAmountLabel(desc, bridge.limits.minDeposit)}`
  const bridgedAmount = composed ? bridge.inputAmount : req.inputAmount
  if (bridgedAmount > bridge.limits.maxDeposit) {
    return `Exceeds bridge maximum ${readableTokenAmountLabel(desc, bridge.limits.maxDeposit)}`
  }
  return null
}

const usdNumber = (amount: bigint, price: bigint) => Number(formatUnits(amount * price, USD_PRICE_DECIMALS))

const etaLabel = (plan: IRoutePlan, crossChain: boolean): { text: string; warn: boolean } => {
  const sec = bridgeLeg(plan).etaSec
  if (sec !== undefined) {
    return { text: sec < 1 ? '<1s' : sec < 60 ? `~${sec}s` : `~${Math.round(sec / 60)}m`, warn: false }
  }
  if (!crossChain) return { text: 'instant', warn: false }
  const untilDeadlineSec = Math.max(0, Math.floor(plan[0].fillDeadline) - Math.floor(Date.now() / 1000))
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
    a.depositor === b.depositor &&
    a.recipient === b.recipient)

const okRows = (rows: IRouteRow[]) => rows.filter((r): r is IRouteRowOk => r.status === 'ok')

const cheaper = (a: IRouteRowOk, b: IRouteRowOk): IRouteRowOk => {
  if (a.plan.length !== b.plan.length) return a.plan.length < b.plan.length ? a : b
  return deliveredLeg(a.plan).outputAmount > deliveredLeg(b.plan).outputAmount ? a : b
}

const bestRouteId = (rows: IRouteRow[]): string | null => {
  const oks = okRows(rows)
  if (oks.length === 0) return null
  return oks.reduce(cheaper).id
}

const pickRow = (rows: IRouteRow[], selected: string | null): IRouteRowOk | null => {
  const oks = okRows(rows)
  if (oks.length === 0) return null
  const best = oks.reduce(cheaper)
  const picked = selected ? oks.find(r => r.id === selected) : undefined
  return picked ?? best
}

const routeError = (rows: IRouteRow[]): string | null => {
  if (rows.length === 0 || rows.some(r => r.status !== 'error')) return null
  return 'No swap route is available right now. Adjust the amount or retry shortly'
}

const feeParts = (inUsd: number, outUsd: number): { amount: string; pct: string; net: number } => {
  const net = outUsd - inUsd
  const sign = net > 0 ? '+' : ''
  const pctVal = inUsd > 0 ? (net / inUsd) * 100 : 0
  const pct = net === 0 || inUsd <= 0 ? '' : `${sign}${Math.abs(pctVal) < 1 ? pctVal.toFixed(2) : pctVal.toFixed(1)}%`
  return { amount: `${sign}${formatUsdNumber(net)}`, pct, net }
}
const feeColor = (net: number | null): string => (net === null || net === 0 ? palette.message : net > 0 ? palette.positive : palette.negative)

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
    id: row.id,
    feeUsd: '-',
    feePct: '',
    minReceived: '-',
    net: null,
    fetching: false,
    eta: '',
    etaWarn: false,
    isBest,
    isSelected,
    detail: ''
  }
  if (row.status === 'pending') return { ...base, status: 'pending', label: routeLabel(row.id) }
  if (row.status === 'error') return { ...base, status: 'error', label: routeLabel(row.id), detail: row.message }
  const displayOut = deliveredLeg(row.plan).expectedOutputAmount
  const fee =
    inPrice === null || outPrice === null
      ? { amount: '-', pct: '', net: null }
      : feeParts(usdNumber(req.inputAmount, inPrice), usdNumber(displayOut, outPrice))
  const eta = etaLabel(row.plan, req.originChainId !== req.destinationChainId)
  return {
    ...base,
    status: 'ok',
    label: row.plan.map(leg => leg.tool).join(' + '),
    feeUsd: fee.amount,
    feePct: fee.pct,
    net: fee.net,
    fetching: !sameRequest(row.req, req),
    minReceived: readableTokenAmountLabel(
      getTokenDescription(req.destinationChainId, req.outputToken),
      deliveredLeg(row.plan).outputAmount
    ),
    eta: [eta.text, row.plan.length > 1 ? `${row.plan.length} txs` : ''].filter(part => part !== '').join(' - '),
    etaWarn: eta.warn
  }
}

const $defaultDisclaimer = $node(style({ maxWidth: '240px', lineHeight: '1.4', fontSize: text.sm }))(
  $text(
    'What the route delivers minus what you send, at market prices. Negative is your cost (route fee and price impact, paid to the route, not Puppet); positive means the route beats market. Min. received is the guaranteed floor. Without an arrival estimate (≤ time), a cross-chain transfer may take up to its fill deadline before it counts as failed and the funds return as recoverable balance.'
  )
)

const PLACEHOLDER: IRouteOption = {
  id: 'lifi',
  status: 'pending',
  label: '',
  feeUsd: '-',
  feePct: '',
  minReceived: '-',
  net: null,
  fetching: false,
  eta: '',
  etaWarn: false,
  isBest: false,
  isSelected: false,
  detail: ''
}

const rowsFor = (
  req: ISwapRequest,
  signal: AbortSignal,
  maxLegs: number,
  seed: IRouteRow[] | null
): IStream<IRouteRow[]> => {
  const seedById = new Map((seed ?? []).filter(r => r.status === 'ok').map(r => [r.id, r]))
  const streams = swapRouteCandidates(req, maxLegs, signal).map(candidate =>
    start(
      seedById.get(candidate.id) ?? ({ id: candidate.id, status: 'pending' } as IRouteRow),
      fromPromise(
        candidate.plan.then(
          (plan): IRouteRow => ({ id: candidate.id, status: 'ok', req, plan }),
          (err): IRouteRow => ({
            id: candidate.id,
            status: 'error',
            message: err instanceof Error ? err.message : 'Route unavailable'
          })
        )
      )
    )
  )
  return op(
    merge(...streams),
    reduce((acc: Record<string, IRouteRow>, row: IRouteRow) => ({ ...acc, [row.id]: row }), {} as Record<string, IRouteRow>),
    map(acc => Object.values(acc))
  )
}

const $feeEta = (opt: IRouteOption, fee: string): I$Node =>
  $row(style({ alignItems: 'baseline', gap: '6px' }))(
    $node(style({ fontSize: text.xs, color: feeColor(opt.net) }))($text(fee)),
    opt.eta
      ? $node(style({ fontSize: text.xs, color: opt.etaWarn ? palette.indeterminate : palette.foreground }))(
          $text(opt.eta)
        )
      : empty,
    opt.fetching ? $node(style({ alignSelf: 'center', display: 'flex' }))($inlineSpinner) : empty
  )

const $anchorLine = (opt: IRouteOption): I$Node =>
  $row(spacing.small, style({ alignItems: 'center' }))(
    opt.status === 'pending'
      ? opt.label === ''
        ? $node(style({ color: palette.foreground }))($text('-'))
        : $inlineSpinner
      : opt.status === 'error'
        ? $node(style({ color: palette.foreground }), attr({ title: opt.detail }))($text('unavailable'))
        : $row(spacing.small, style({ alignItems: 'baseline' }))(
            $node(style({ fontSize: text.xs, color: palette.foreground }))($text(opt.label)),
            $feeEta(opt, feeDisplay(opt))
          )
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

const withPanelHeader = ($header: I$Node, container: INodeCompose): INodeCompose =>
  ((...input: unknown[]) =>
    input.some(a => typeof a === 'function')
      ? withPanelHeader($header, (container as (...args: unknown[]) => INodeCompose)(...input))
      : (container as unknown as (...children: unknown[]) => I$Node)($header, ...input)) as unknown as INodeCompose

export interface I$SwapProviderFeeEditor {
  active: IStream<boolean>
  request: IStream<ISwapRequest | null>
  $disclaimer?: I$Slottable
  maxLegs: number
}

export const $SwapProviderFeeEditor = ({
  active,
  request,
  $disclaimer = $defaultDisclaimer,
  maxLegs
}: I$SwapProviderFeeEditor) =>
  component(([select, selectTether]: IBehavior<IRouteOption>) => {
    const liveRequest = op(request, state())
    const request0 = op(liveRequest, debounce(200), skipRepeatsWith(sameRequest), state())
    let lanePrior: { lane: string; rows: IRouteRow[] } | null = null
    const routeState = op(
      request0,
      switchMap(req => {
        if (req === null) return just<IRouteState | null>(null)
        const lane = `${req.originChainId}:${req.inputToken}>${req.destinationChainId}:${req.outputToken}`
        return stream<IRouteState | null>((sink, scheduler) => {
          const controller = new AbortController()
          const seed = lanePrior?.lane === lane ? lanePrior.rows : null
          return disposeBoth(
            map(rows => {
              lanePrior = { lane, rows }
              return { req, rows }
            }, rowsFor(req, controller.signal, maxLegs, seed)).run(sink, scheduler),
            disposeWith(() => controller.abort())
          )
        })
      }),
      state<IRouteState | null>(null)
    )
    const selected = state(null as string | null, op(select, filter(o => o.status === 'ok'), map(o => o.id)))
    const prices = op(
      request0,
      switchMap(req =>
        req === null
          ? just<{ inPrice: bigint | null; outPrice: bigint | null }>({ inPrice: null, outPrice: null })
          : combine({
              inPrice: priceFor(req.originChainId, req.inputToken),
              outPrice: priceFor(req.destinationChainId, req.outputToken)
            })
      ),
      state({ inPrice: null as bigint | null, outPrice: null as bigint | null })
    )

    const selectedRoute = op(
      combine({ rs: routeState, req: liveRequest, selected }),
      map(({ rs, req, selected }): ISelectedRoute => {
        if (rs === null || req === null) return EMPTY_SELECTED
        const row = pickRow(rs.rows, selected)
        const plan = row === null ? null : row.plan
        const limitError = plan === null ? null : limitErrorOf(rs.req, plan)
        return {
          plan,
          ready:
            row !== null && sameRequest(row.req, req) && deliveredLeg(row.plan).outputAmount > 0n && limitError === null,
          error: routeError(rs.rows),
          limitError
        }
      }),
      state<ISelectedRoute>(EMPTY_SELECTED)
    )

    const options = op(
      combine({ rs: routeState, req: liveRequest, prices, selected }),
      map(({ rs, req, prices: { inPrice, outPrice }, selected }): IRouteOption[] => {
        if (rs === null || req === null) return []
        const rows = rs.rows.some(r => r.status === 'ok') ? rs.rows.filter(r => r.status !== 'error') : rs.rows
        const best = bestRouteId(rows)
        const effective = selected !== null && okRows(rows).some(r => r.id === selected) ? selected : best
        return rows.map(row => toOption(row, req, inPrice, outPrice, row.id === best, row.id === effective))
      }),
      state<IRouteOption[]>([])
    )

    const value = op(
      options,
      map((opts): IRouteOption => {
        const picked = opts.find(o => o.isSelected && o.status === 'ok')
        if (picked) return picked
        if (opts.length === 0) return PLACEHOLDER
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
      spacing.small,
      style({
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
        $row(style({ alignItems: 'center', gap: '2px' }))($detailLabel('Fee'), $infoTooltip($disclaimer, palette.foreground)),
        $node(styleBehavior(map(o => ({ color: feeColor(o.status === 'ok' ? o.net : null) }), value)))(
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
