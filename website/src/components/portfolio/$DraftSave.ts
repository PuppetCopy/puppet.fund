import { CompactError, formatThrownError } from '@puppet/sdk/compact'
import { CHAIN_MAP, type ChainId, CROSS_CHAIN_MIN_USD } from '@puppet/sdk/const'
import { getTokenDescription, readableTokenAmountLabel } from '@puppet/sdk/core'
import { USD_PRICE_DECIMALS } from '@puppet/sdk/evaluate'
import { type IRoutePlan, routeCalldataBytes } from '@puppet/sdk/intent'
import { type IRelayFeeQuote, providerToken, routeSubcallGas, tokenMetaByChainToken, tokenMetaKey } from '@puppet/sdk/state'
import {
  combine,
  debounce,
  disposeBoth,
  disposeWith,
  empty,
  filter,
  fromPromise,
  type IStream,
  just,
  map,
  merge,
  op,
  reduce,
  sampleMap,
  skipRepeats,
  skipRepeatsWith,
  start,
  switchLatest,
  switchMap
} from 'aelea/stream'
import { type IBehavior, PromiseStatus, type PromiseStateDone, promiseState, state, stream } from 'aelea/stream-extended'
import {
  $node,
  $text,
  attrBehavior,
  component,
  type I$Node,
  style,
  styleBehavior
} from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { formatUnits, } from 'viem'
import { $ButtonPrimaryOutline, $infoTooltip, $intermediateLine, $intermediateText, intermediateState, text } from '@/ui-components'
import { type ISwapRequest, swapRouteCandidates } from '../../io/bridge/swapQuote.js'
import { formatUsdNumber, freshPrice, priceFor } from '../../io/price.js'
import { chainName } from '../../common/$chain.js'
import { $tokenProfile } from '../../common/$common.js'
import { $SwapTargetFlow, type I$SwapTargetFlow, type ISwapTargetOption } from './$SwapTargetFlow.js'


const ROUTE_LABEL: Record<string, string> = {
  lifi: 'LI.FI',
  kyber: 'KyberSwap',
  across: 'Across',
  acrossSwap: 'AcrossSwap',
  relay: 'Relay',
  wrap: 'Wrap'
}

const routeLabel = (id: string): string => {
  const label = ROUTE_LABEL[id]
  if (label === undefined) throw new Error(`unrecognised swap route candidate '${id}'`)
  return label
}

type IRouteRowOk = { id: string; status: 'ok'; req: ISwapRequest; plan: IRoutePlan }
type IRouteRow =
  | { id: string; status: 'pending' }
  | IRouteRowOk
  | { id: string; status: 'error'; message: string }

type IRouteState = { req: ISwapRequest; rows: IRouteRow[]; refusal: string | null }


export type IFeeParts = { amount: string; pct: string; cost: number | null }
type IRoutePrices = { req: ISwapRequest; inPrice: Promise<bigint | null>; outPrice: Promise<bigint | null> }

export type IRouteOption =
  | { status: 'pending'; label: string }
  | { status: 'error'; label: string; detail: string }
  | { status: 'ok'; label: string; fee: Promise<IFeeParts> | null; minReceived: string; fetching: boolean; eta: string; etaWarn: boolean }

export interface ISelectedRoute {
  plan: IRoutePlan | null
  ready: boolean
  error: string | null
  limitError: string | null
}

const EMPTY_SELECTED: ISelectedRoute = { plan: null, ready: false, error: null, limitError: null }

const limitErrorOf = (req: ISwapRequest, plan: IRoutePlan): string | null => {
  if (plan.limits === null) return plan.isAmountTooLow ? 'Below this route’s minimum' : null
  const desc = getTokenDescription(req.destinationChainId, req.outputToken)
  if (plan.isAmountTooLow) return `Below bridge minimum ${readableTokenAmountLabel(desc, plan.limits.minDeposit)}`
  if (req.inputAmount > plan.limits.maxDeposit) return `Exceeds bridge maximum ${readableTokenAmountLabel(desc, plan.limits.maxDeposit)}`
  return null
}

export const usdNumber = (amount: bigint, price: bigint) => Number(formatUnits(amount * price, USD_PRICE_DECIMALS))

export const blockTimeLabel = (chainId: ChainId): { text: string; warn: boolean } => {
  const ms = CHAIN_MAP[chainId].blockTime
  return { text: ms === undefined ? '-' : ms < 1_000 ? `~${ms}ms` : `~${Math.round(ms / 1_000)}s`, warn: false }
}

export const etaLabel = (plan: Pick<IRoutePlan, 'etaSec' | 'fillDeadline'>, originChainId: ChainId, destinationChainId: ChainId): { text: string; warn: boolean } => {
  const sec = plan.etaSec
  if (sec !== undefined) {
    return { text: sec < 1 ? '<1s' : sec < 60 ? `~${sec}s` : `~${Math.round(sec / 60)}m`, warn: false }
  }
  if (originChainId === destinationChainId) return blockTimeLabel(originChainId)
  const untilDeadlineSec = Math.max(0, Math.floor(plan.fillDeadline) - Math.floor(Date.now() / 1000))
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

type IInputFee = { gross: bigint; quote: IRelayFeeQuote; kind: Parameters<IRelayFeeQuote>[0] }

const bestRow = (rows: IRouteRow[], fee: IInputFee | null): IRouteRowOk | null => {
  const kept = (plan: IRoutePlan): bigint =>
    fee === null ? plan.outputAmount : plan.outputAmount * (fee.gross - fee.quote(fee.kind, false, 0n, routeSubcallGas(plan.route), routeCalldataBytes(plan.route)))
  const oks = okRows(rows)
  return oks.length === 0 ? null : oks.reduce((a, b) => (kept(a.plan) > kept(b.plan) ? a : b))
}

const routeError = (rows: IRouteRow[]): string | null => {
  const failed = rows.flatMap(r => (r.status === 'error' ? [r.message] : []))
  if (rows.length === 0 || failed.length < rows.length) return null
  return `No route right now: ${[...new Set(failed)].join(' · ')}`
}

export const feeParts = (inUsd: number, outUsd: number, exact: boolean): IFeeParts => {
  if (inUsd <= 0) return { amount: '-', pct: '', cost: null }
  const cost = Math.max(inUsd - outUsd, 0)
  const pctVal = (cost / inUsd) * 100
  return {
    amount: `${exact ? '' : '≈ '}${formatUsdNumber(cost)}`,
    pct: cost > 0 && pctVal < 0.01 ? '< 0.01%' : `${pctVal < 1 ? pctVal.toFixed(2) : pctVal.toFixed(1)}%`,
    cost
  }
}
const feeColor = (cost: number | null): string => (cost === null || cost === 0 ? palette.message : palette.negative)

const toOption = (row: IRouteRow, req: ISwapRequest, prices: IRoutePrices | null): IRouteOption => {
  if (row.status === 'pending') return { status: 'pending', label: routeLabel(row.id) }
  if (row.status === 'error') return { status: 'error', label: routeLabel(row.id), detail: row.message }
  const displayOut = row.plan.expectedOutputAmount
  const inKey = tokenMetaByChainToken.get(tokenMetaKey(row.req.originChainId, providerToken(row.req.inputToken, row.req.originChainId)))?.tokenKey
  const exact = inKey !== undefined && inKey === tokenMetaByChainToken.get(tokenMetaKey(row.req.destinationChainId, providerToken(row.req.outputToken, row.req.destinationChainId)))?.tokenKey
  const fee =
    prices === null
      ? null
      : Promise.all([prices.inPrice, exact ? prices.inPrice : prices.outPrice]).then(([knownIn, knownOut]) =>
          knownIn === null || knownOut === null ? { amount: '-', pct: '', cost: null } : feeParts(usdNumber(row.req.inputAmount, knownIn), usdNumber(displayOut, knownOut), exact)
        )
  const eta = etaLabel(row.plan, row.req.originChainId, row.req.destinationChainId)
  return {
    status: 'ok',
    label: row.plan.tool,
    fee,
    fetching: !sameRequest(row.req, req),
    minReceived: readableTokenAmountLabel(
      getTokenDescription(req.destinationChainId, req.outputToken),
      row.plan.outputAmount
    ),
    eta: eta.text,
    etaWarn: eta.warn
  }
}

const $defaultDisclaimer = $node(style({ maxWidth: '240px', lineHeight: '1.4', fontSize: text.xs, color: palette.foreground }))(
  $text('Route cost at market prices, paid to the route, not Puppet. Min. received is the guaranteed floor.')
)

const PLACEHOLDER: IRouteOption = { status: 'pending', label: '' }

const rowsFor = (
  req: ISwapRequest,
  signal: AbortSignal,
  plainBridge: boolean,
  seed: IRouteRow[] | null
): IStream<IRouteRow[]> => {
  const seedById = new Map((seed ?? []).filter(r => r.status === 'ok').map(r => [r.id, r]))
  const streams = swapRouteCandidates(req, plainBridge, signal).map(candidate =>
    start(
      seedById.get(candidate.id) ?? ({ id: candidate.id, status: 'pending' } as IRouteRow),
      fromPromise(
        candidate.plan.then(
          (plan): IRouteRow => ({ id: candidate.id, status: 'ok', req, plan }),
          (err): IRouteRow => ({
            id: candidate.id,
            status: 'error',
            message: err instanceof CompactError ? err.detail : err instanceof Error ? err.message : String(err)
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

export interface I$DraftSave {
  target: Pick<I$SwapTargetFlow, 'value' | 'optionList' | 'source'> | ISwapTargetOption | null
  request: IStream<ISwapRequest | null>
  quote?: IStream<IRouteOption>
  commit?: IStream<unknown>
  plainBridge?: boolean
  inputFee?: IStream<IInputFee | null>
  active: IStream<boolean>
  alert: IStream<string | null>
  disabled: IStream<boolean>
  $receive?: I$Node
}

export const $DraftSave = ({ target, request, quote, commit, plainBridge, inputFee, active, alert, disabled, $receive }: I$DraftSave) =>
  component(
    (
      [select, selectTether]: IBehavior<ISwapTargetOption>,
      [selecting, selectingTether]: IBehavior<boolean>,
      [save, saveTether]: IBehavior<PointerEvent>
    ) => {
      const listed: IStream<boolean> = state(false, selecting)
      const liveRequest = op(request, state())
      const routeFee: IStream<IInputFee | null> = inputFee === undefined ? just(null) : op(inputFee, state())
      const request0 = op(merge(op(liveRequest, debounce(200)), commit === undefined ? empty : sampleMap((req: ISwapRequest | null) => req, liveRequest, commit)), skipRepeatsWith(sameRequest), state())
      let lanePrior: { lane: string; rows: IRouteRow[] } | null = null
      const routeState = op(
        request0,
        switchMap(req => {
          if (req === null) return just<IRouteState | null>(null)
          const lane = `${req.originChainId}:${req.inputToken}>${req.destinationChainId}:${req.outputToken}`
          const quoted = stream<IRouteState | null>((sink, scheduler) => {
            const controller = new AbortController()
            const seed = lanePrior?.lane === lane ? lanePrior.rows : null
            return disposeBoth(
              map(rows => {
                lanePrior = { lane, rows }
                return { req, rows, refusal: null }
              }, rowsFor(req, controller.signal, plainBridge === true, seed)).run(sink, scheduler),
              disposeWith(() => controller.abort())
            )
          })
          if (req.originChainId === req.destinationChainId) return quoted
          return op(
            promiseState(just(freshPrice(req.originChainId, req.inputToken))),
            filter(price => price.status !== PromiseStatus.PENDING),
            map((price): string | null => {
              if (price.status === PromiseStatus.ERROR) return `Price unavailable, so the $${CROSS_CHAIN_MIN_USD} cross-chain minimum cannot be checked: ${formatThrownError(price.error)}`
              if (price.status !== PromiseStatus.DONE || price.value === null) return null
              return req.inputAmount * price.value < CROSS_CHAIN_MIN_USD * 10n ** BigInt(USD_PRICE_DECIMALS) ? `Cross-chain moves start at $${CROSS_CHAIN_MIN_USD}` : null
            }),
            skipRepeats,
            switchMap(refusal => (refusal === null ? quoted : just<IRouteState | null>({ req, rows: [], refusal })))
          )
        }),
        state<IRouteState | null>(null)
      )
      const prices: IStream<IRoutePrices> = op(
        request0,
        switchMap(req =>
          req === null
            ? empty
            : map(
                p => ({ req, inPrice: p.inPrice, outPrice: p.outPrice }),
                combine({ inPrice: priceFor(req.originChainId, req.inputToken), outPrice: priceFor(req.destinationChainId, req.outputToken) })
              )
        ),
        state()
      )

      const selectedRoute = op(
        combine({ rs: routeState, req: liveRequest, fee: routeFee }),
        map(({ rs, req, fee }): ISelectedRoute => {
          if (rs === null || req === null) return EMPTY_SELECTED
          const row = bestRow(rs.rows, fee)
          const plan = row === null ? null : row.plan
          const limitError = plan === null ? null : limitErrorOf(rs.req, plan)
          return {
            plan,
            ready:
              row !== null && sameRequest(row.req, req) && row.plan.outputAmount > 0n && limitError === null,
            error: rs.refusal ?? routeError(rs.rows),
            limitError
          }
        }),
        state<ISelectedRoute>(EMPTY_SELECTED)
      )

      const value =
        quote === undefined
          ? op(
              combine({ rs: routeState, req: liveRequest, prices: start(null, prices), fee: routeFee }),
              map(({ rs, req, prices, fee }): IRouteOption => {
                if (rs === null || req === null || rs.rows.length === 0) return PLACEHOLDER
                const row = bestRow(rs.rows, fee)
                if (row !== null) return toOption(row, req, prices !== null && prices.req === rs.req ? prices : null)
                return rs.rows.some(r => r.status === 'pending') ? { status: 'pending', label: routeLabel(rs.rows[0]!.id) } : { status: 'error', label: '', detail: '' }
              }),
              state<IRouteOption>(PLACEHOLDER)
            )
          : op(quote, state<IRouteOption>(PLACEHOLDER))

      const detailText = (f: (o: Extract<IRouteOption, { status: 'ok' }>) => string) => map(o => (o.status === 'ok' && f(o) !== '' ? f(o) : '-'), value)
      const $detailLabel = (label: string) => $node(style({ fontSize: text.xs, color: palette.foreground }))($text(label))
      const $detailRow = ($label: I$Node, $value: I$Node) =>
        $row(style({ alignItems: 'center', justifyContent: 'space-between', gap: '24px' }))($label, $value)
      const feeColorOf = op(
        value,
        map(o => (o.status === 'ok' && o.fee !== null ? o.fee.then(parts => parts.cost) : Promise.resolve(null))),
        intermediateState,
        filter((s): s is PromiseStateDone<number | null> => s.status === PromiseStatus.DONE),
        map(s => ({ color: feeColor(s.value) })),
        start({ color: feeColor(null) })
      )

      const $details = $column(spacing.small, style({ minWidth: '240px', fontSize: text.sm }))(
        $detailRow($detailLabel('Route'), $node(style({ color: palette.message }))($text(detailText(o => o.label)))),
        $detailRow(
          $detailLabel('Fee'),
          $node(styleBehavior(feeColorOf))(
            $intermediateText(map(o => (o.status === 'ok' && o.fee !== null ? o.fee.then(parts => (parts.pct === '' ? parts.amount : `${parts.amount} (${parts.pct})`)) : '-'), value))
          )
        ),
        $detailRow($detailLabel('Min. received'), $node(style({ color: palette.message }))($text(detailText(o => o.minReceived)))),
        $detailRow(
          $detailLabel('Est. arrival'),
          $node(styleBehavior(map(o => ({ color: o.status === 'ok' && o.etaWarn ? palette.indeterminate : palette.message }), value)))(
            $text(detailText(o => o.eta))
          )
        ),
        $defaultDisclaimer
      )
      const $feeEta = $row(style({ alignItems: 'baseline', gap: '6px' }))(
        $node(style({ fontSize: text.xs }), styleBehavior(feeColorOf))($intermediateText(map(o => (o.status === 'ok' && o.fee !== null ? o.fee.then(parts => parts.amount) : '-'), value))),
        $node(
          style({ fontSize: text.xs }),
          styleBehavior(map(o => (o.status === 'ok' && o.eta !== '' ? { color: o.etaWarn ? palette.indeterminate : palette.foreground } : { display: 'none' }), value))
        )($text(map(o => (o.status === 'ok' ? o.eta : ''), value)))
      )
      const $route = $row(
        spacing.tiny,
        style({ alignItems: 'center', whiteSpace: 'nowrap' }),
        styleBehavior(
          map(
            p =>
              !p.active || p.alert !== null ? { display: 'none' } : { display: 'flex' },
            combine({ active, alert })
          )
        )
      )(
        op(
          value,
          map(o => (o.status === 'pending' ? (o.label === '' ? 'none' : 'pending') : o.status)),
          skipRepeats,
          map(shape =>
            shape === 'ok'
              ? $feeEta
              : shape === 'error'
                ? $node(style({ fontSize: text.xs, color: palette.foreground }), attrBehavior(map(o => ({ title: o.status === 'error' ? o.detail : null }), value)))($text('unavailable'))
                : shape === 'none'
                  ? $node(style({ fontSize: text.xs, color: palette.foreground }))($text('No swap yet'))
                  : $intermediateLine('5em', text.xs)
          ),
          switchLatest
        ),
        $infoTooltip(
          op(
            value,
            map(o => o.status === 'pending' && o.label === ''),
            skipRepeats,
            map(intro =>
              intro
                ? $node(style({ maxWidth: '240px', lineHeight: '1.4', fontSize: text.sm }))(
                    $text('Across tokens or chains, the cheapest route is picked for you. Its fee and timing show here.')
                  )
                : $details
            ),
            switchLatest
          ),
          palette.foreground,
          map(o => (o.status === 'pending' && o.label !== '') || (o.status === 'ok' && o.fetching), value)
        )
      )
      const $whileListed = $node(style({ display: 'contents' }), styleBehavior(map(open => (open ? { display: 'none' } : { display: 'contents' }), listed)))
      return [
        $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap', fontSize: text.sm }))(
          ...($receive === undefined ? [] : [$receive]),
          target === null
            ? $route
            : !('optionList' in target)
              ? $row(spacing.small, style({ alignItems: 'center' }))($tokenProfile(target.chainId, target.id, 28, true, chainName(target.chainId)), $route)
              : $SwapTargetFlow({
                ...target,
                $container: $row(style({ gap: '8px', alignItems: 'center' })),
                $inputContent: $anchor => $row(spacing.small, style({ alignItems: 'center' }))($anchor, $route)
              })({ select: selectTether(), selecting: selectingTether() }),
          $whileListed(
            ...($receive === undefined ? [$node(style({ flex: 1 }))()] : []),
            $ButtonPrimaryOutline({ disabled, $content: $text('Save') })({
              click: saveTether()
            })
          )
        ),
        { select, selecting, selectRoute: selectedRoute, save }
      ]
    }
  )
