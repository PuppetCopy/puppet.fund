import { CHAIN_IDS, HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { ChainId } from '@puppet/sdk/const'
import { getDuration, getTokenDescription, getUnixTimestamp, readableAddress, readableTokenAmountLabel } from '@puppet/sdk/core'
import { VALUE_KEY } from '@puppet/sdk/evaluate'
import { markPeriodPnl } from '@puppet/sdk/fold'
import { bondTokenOf, chainTokenOfKey, tokenMetaByChainToken, tokenMetaKey } from '@puppet/sdk/state'
import { combine, constant, empty, type IStream, just, map, merge, op } from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $node, $text, attr, component, type I$Node, type I$Slottable, style } from 'aelea/ui'
import { $ButtonToggle, $column, $defaultButtonToggleBtn, $defaultButtonToggleContainer, $icon, $Popover, $row, designSheet, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $defaultAnchor, $Link } from 'aelea/ui-router'
import { type Address, isAddressEqual } from 'viem'
import {
  $anchor,
  $ButtonSecondary,
  $defaultMiniButtonSecondary,
  $defaultTableCell,
  $defaultTableRowContainer,
  $defaultVScrollContainer,
  $external,
  $gmx,
  $infoTooltip,
  $intermediatePromise,
  $popoverCaret,
  $Table,
  type IPageRequest,
  type TablePageResponse,
  text
} from '@/ui-components'
import { routeSchema } from '../../app/routeSchema.js'
import { $chainIcon, chainExplorerTxUrl, chainName } from '../../common/$chain.js'
import { type ITokenFlow, type IVenueAction, operationSummary, readableFlow } from '../../common/operation.js'
import type { IAccountAction } from '../../io/journal/history.js'
import { gmxOrderOutcome, type IGmxOrderOutcome } from '../../io/onchain/gmxOrder.js'
import { accountDisplayName } from '../$AccountProfile.js'

const creditedList = (a: IAccountAction & { kind: 'credit' }): { token: Address; credited: bigint }[] =>
  a.creditList.map(c => ({
    token: c.token,
    credited: c.amount - (a.fee !== null && isAddressEqual(a.fee.token, c.token) ? a.fee.amount : 0n)
  }))

const KIND: Record<IAccountAction['kind'], { label: string; color: string }> = {
  genesis: { label: 'Deployed', color: palette.message },
  deposit: { label: 'Deposit', color: palette.positive },
  swap: { label: 'Swap', color: palette.primary },
  withdraw: { label: 'Withdraw', color: palette.negative },
  credit: { label: 'Credit', color: palette.positive },
  operate: { label: 'Operate', color: palette.primary },
  backing: { label: 'Backing', color: palette.primary },
  settle: { label: 'Settle', color: palette.indeterminate },
  gain: { label: 'Gain', color: palette.positive },
  mandate: { label: 'Mandate', color: palette.message },
  unbond: { label: 'Unbond', color: palette.message },
  draw: { label: 'Draw', color: palette.indeterminate },
  loss: { label: 'Loss', color: palette.negative },
  forcedWithdrawal: { label: 'Forced withdrawal', color: palette.negative }
}

type IFamily = 'all' | 'funding' | 'trading' | 'account'

const FAMILY: Record<IAccountAction['kind'], Exclude<IFamily, 'all'>> = {
  genesis: 'account',
  deposit: 'funding',
  swap: 'funding',
  withdraw: 'funding',
  credit: 'funding',
  operate: 'trading',
  backing: 'trading',
  settle: 'trading',
  gain: 'trading',
  draw: 'trading',
  loss: 'trading',
  mandate: 'account',
  unbond: 'funding',
  forcedWithdrawal: 'funding'
}

const FAMILY_LABEL: Record<IFamily, string> = { all: 'All', funding: 'Funding', trading: 'Trading', account: 'Account' }

const OUTCOME: Record<IGmxOrderOutcome, { label: string; color: string }> = {
  open: { label: 'open', color: palette.message },
  frozen: { label: 'frozen', color: palette.indeterminate },
  executed: { label: 'executed', color: palette.positive },
  cancelled: { label: 'cancelled', color: palette.negative },
  unknown: { label: 'no outcome found', color: palette.foreground }
}

const PAGE = 25

const value = getTokenDescription(HUB_CHAIN_ID, chainTokenOfKey(HUB_CHAIN_ID, VALUE_KEY))
const bond = getTokenDescription(HUB_CHAIN_ID, bondTokenOf(HUB_CHAIN_ID))

const backerCount = (n: number): string => `${n} backer${n === 1 ? '' : 's'}`

const tokenChainOf = (home: ChainId, token: Address): ChainId => {
  const chain = [home, ...([...CHAIN_IDS] as ChainId[]).filter(c => c !== home)].find(c => tokenMetaByChainToken.has(tokenMetaKey(c, token)))
  if (chain === undefined) throw new Error(`token ${token} is registered on no chain`)
  return chain
}

const $traderLink = (master: Address): I$Slottable =>
  $Link({
    route: routeSchema.traders.detail,
    params: { master },
    $anchor: $defaultAnchor(style({ color: palette.message, textDecoration: 'none' })),
    $content: $text(accountDisplayName(master))
  })({})

const $tooltipLine = (label: string, content: string): I$Node =>
  $row(spacing.default, style({ alignItems: 'baseline', justifyContent: 'space-between' }))(
    $node(style({ fontSize: text.xs, color: palette.foreground }))($text(label)),
    $node(style({ fontSize: text.sm, color: palette.message }))($text(content))
  )

const $action = (a: IAccountAction): I$Node => {
  const kind = KIND[a.kind]
  return $row(spacing.small, style({ alignItems: 'center', alignSelf: 'flex-start' }))(
    $row(
      spacing.small,
      style({
        alignItems: 'center',
        padding: '3px 10px 3px 5px',
        borderRadius: '6px',
        fontSize: text.xs,
        fontWeight: '600',
        whiteSpace: 'nowrap',
        color: kind.color,
        backgroundColor: colorShade(kind.color, 12)
      })
    )($chainIcon(a.chainId, 18), $text(kind.label)),
    $infoTooltip(
      $column(spacing.tiny, style({ whiteSpace: 'nowrap' }))(
        $tooltipLine('Chain', chainName(a.chainId)),
        $tooltipLine('Relay fee', a.fee === null ? 'none' : readableTokenAmountLabel(getTokenDescription(a.chainId, a.fee.token), a.fee.amount)),
        $tooltipLine('Entry', `${a.block}#${a.logIndex}`)
      ),
      colorShade(palette.foreground, 60))
  )
}

const $primary = (content: string | I$Slottable): I$Node =>
  $node(style({ fontSize: text.sm, color: palette.message, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }))(
    typeof content === 'string' ? $text(content) : content
  )

const $secondary = (content: string | I$Slottable): I$Node =>
  $node(style({ fontSize: text.xs, color: palette.foreground }))(typeof content === 'string' ? $text(content) : content)

const $lines = (primary: string | I$Slottable, secondary?: string | I$Slottable): I$Node =>
  $column(style({ gap: '2px', minWidth: 0 }))($primary(primary), ...(secondary === undefined ? [] : [$secondary(secondary)]))

const $venueIcon = (venue: string): I$Node => {
  if (venue === 'GMX') return $icon({ $content: $gmx, size: '16px', viewBox: '0 0 32 32', fill: palette.message })
  if (venue === 'Hyperliquid') {
    return $node(
      style({
        width: '16px',
        height: '16px',
        borderRadius: '50%',
        backgroundColor: colorShade(palette.message, 20),
        color: palette.message,
        fontSize: '8px',
        fontWeight: '700',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: '0'
      })
    )($text('HL'))
  }
  return empty
}

const $outcomePill = (o: IGmxOrderOutcome): I$Node =>
  $node(
    style({
      fontSize: text.xs,
      padding: '0 6px',
      borderRadius: '4px',
      whiteSpace: 'nowrap',
      color: OUTCOME[o].color,
      backgroundColor: colorShade(OUTCOME[o].color, 12)
    })
  )($text(OUTCOME[o].label))

const $venueAction = (a: IAccountAction, x: IVenueAction): I$Node =>
  $row(spacing.small, style({ alignItems: 'center', minWidth: 0 }))(
    $venueIcon(x.venue),
    $node(style({ fontSize: text.sm, color: palette.message, whiteSpace: 'nowrap' }))($text(x.venue)),
    $node(style({ fontSize: text.sm, color: palette.message, whiteSpace: 'nowrap' }))($text(x.label)),
    $node(style({ fontSize: text.xs, color: palette.foreground, fontFamily: 'monospace', whiteSpace: 'nowrap' }))($text(x.call)),
    ...(x.orderKey === null || x.call !== 'createOrder'
      ? []
      : [
          $intermediatePromise({
            $loader: $node(style({ fontSize: text.xs, color: palette.foreground }))($text('checking')),
            $display: map(async o => $outcomePill(await o), just(gmxOrderOutcome(a.account, x.orderKey, a.block)))
          })
        ]),
    $infoTooltip(
      $column(spacing.tiny, style({ maxWidth: '280px', whiteSpace: 'normal' }))(
        $node(style({ fontSize: text.sm, color: palette.message }))($text(x.title)),
        ...x.details.map(d => $node(style({ fontSize: text.xs, color: palette.foreground }))($text(d))),
        ...(x.orderKey === null ? [] : [$node(style({ fontSize: text.xs, color: palette.foreground, fontFamily: 'monospace', wordBreak: 'break-all' }))($text(x.orderKey))])
      ),
      colorShade(palette.foreground, 60))
  )

const $markLine = (a: Extract<IAccountAction, { kind: 'operate' }>): I$Node => {
  if (a.mark === null) return $secondary('mark not folded yet')
  const inflow = a.mark.inflow > 0n ? ` · +${readableTokenAmountLabel(value, a.mark.inflow)} inflow` : ''
  const at = `at ${readableTokenAmountLabel(value, a.mark.openValue)}${inflow}`
  if (a.mark.closeValue === undefined) return $secondary(`${at} · evaluating`)
  const pnl = markPeriodPnl(a.mark, a.mark.closeValue)
  return $row(spacing.tiny, style({ alignItems: 'baseline', fontSize: text.xs }))(
    $node(style({ color: palette.foreground }))($text(`${at} ·`)),
    $node(style({ color: pnl > 0n ? palette.positive : pnl < 0n ? palette.negative : palette.foreground }))(
      $text(`${pnl > 0n ? '+' : ''}${readableTokenAmountLabel(value, pnl)}`)
    ),
    $node(style({ color: palette.foreground }))($text('until the next mark'))
  )
}

const $details = (a: IAccountAction): I$Node => {
  switch (a.kind) {
    case 'genesis':
      return $lines(accountDisplayName(a.account), `signer ${readableAddress(a.signer)}`)
    case 'deposit':
      return a.bond === 0n ? empty : $lines(`bonded ${readableTokenAmountLabel(getTokenDescription(a.chainId, a.token), a.bond)}`)
    case 'swap': {
      const chain = tokenChainOf(a.chainId, a.outputToken)
      return chain === a.chainId ? empty : $lines(`bridged to ${chainName(chain)}`)
    }
    case 'withdraw': {
      const chain = tokenChainOf(a.chainId, a.outputToken)
      return chain === a.chainId && isAddressEqual(a.outputToken, a.token)
        ? empty
        : $lines(`received ${readableTokenAmountLabel(getTokenDescription(chain, a.outputToken), a.outputAmount)}${chain === a.chainId ? '' : ` on ${chainName(chain)}`}`)
    }
    case 'credit':
      return $lines(
        creditedList(a)
          .map(c => readableTokenAmountLabel(getTokenDescription(a.chainId, c.token), c.credited))
          .join(' · '),
        a.fee === null
          ? 'swept from the deposit route'
          : `swept ${a.creditList.map(c => readableTokenAmountLabel(getTokenDescription(a.chainId, c.token), c.amount)).join(' · ')} from the deposit route, less ${readableTokenAmountLabel(getTokenDescription(a.chainId, a.fee.token), a.fee.amount)} relay fee`
      )
    case 'operate': {
      const summary = operationSummary(a.chainId, a.steps)
      return $column(spacing.tiny, style({ minWidth: 0 }))(
        ...summary.actions.map(x => $venueAction(a, x)),
        $secondary(`cycle ${a.cycle} · ${backerCount(a.backers)} · ${readableTokenAmountLabel(value, a.backed)} backed`),
        $markLine(a)
      )
    }
    case 'backing':
      return $lines(
        $row(spacing.tiny)($text('backing'), $traderLink(a.master), $text(`· cycle ${a.cycle}`)),
        `${readableTokenAmountLabel(bond, a.stake)} of your matchable bond`
      )
    case 'settle':
      return $lines(
        `cycle ${a.cycle} closed at ${readableTokenAmountLabel(getTokenDescription(a.chainId, a.token), a.value)}`,
        `${backerCount(a.backers)} paid`
      )
    case 'gain':
      return $lines(
        $row(spacing.tiny)($text('gain from'), $traderLink(a.master), $text(`· cycle ${a.cycle}`)),
        `${readableTokenAmountLabel(getTokenDescription(a.chainId, a.token), a.owed)} owed before the trader's fee`
      )
    case 'mandate':
      return $lines(
        a.masters.length === 0 ? 'no mandate carried' : `${a.masters.length} mandate${a.masters.length === 1 ? '' : 's'} broadcast`,
        $row(spacing.small, style({ flexWrap: 'wrap' }))(...a.masters.map(m => $traderLink(m.master)))
      )
    case 'unbond':
      return $lines(`released ${readableTokenAmountLabel(bond, a.amount)} of bond`)
    case 'draw':
      return $lines(`cycle ${a.cycle} on ${chainName(Number(a.spokeChainId))}`, `${backerCount(a.backers)} drawn on the hub`)
    case 'loss':
      return $lines(
        $row(spacing.tiny)($text('loss to'), $traderLink(a.master), $text(`· cycle ${a.cycle} on ${chainName(Number(a.spokeChainId))}`)),
        `${readableTokenAmountLabel(bond, a.owed)} owed under your mandate`
      )
    case 'forcedWithdrawal':
      return $lines(`to ${readableAddress(a.to)}`)
  }
}

const flowsOf = (a: IAccountAction): ITokenFlow[] => {
  switch (a.kind) {
    case 'deposit':
      return [{ token: getTokenDescription(a.chainId, a.token), delta: a.amount - a.bond }]
    case 'swap':
      return []
    case 'withdraw':
      return [{ token: getTokenDescription(a.chainId, a.token), delta: -a.amount }]
    case 'credit':
      return creditedList(a).map(c => ({ token: getTokenDescription(a.chainId, c.token), delta: c.credited }))
    case 'operate':
      return operationSummary(a.chainId, a.steps).flows
    case 'gain':
      return [{ token: getTokenDescription(a.chainId, a.token), delta: a.net }]
    case 'loss':
      return [{ token: bond, delta: -a.drawn }]
    case 'unbond':
      return [{ token: bond, delta: a.amount }]
    case 'forcedWithdrawal':
      return [{ token: getTokenDescription(a.chainId, a.token), delta: -a.amount }]
    default:
      return []
  }
}

const $flowLine = (f: ITokenFlow): I$Node =>
  $node(style({ fontSize: text.xs, whiteSpace: 'nowrap', color: f.delta > 0n ? palette.positive : f.delta < 0n ? palette.negative : palette.foreground }))(
    $text(readableFlow(f))
  )

const $flow = (a: IAccountAction): I$Node => {
  const list = flowsOf(a)
  if (list.length === 0) return empty
  return $column(style({ gap: '2px', alignItems: 'flex-end' }))(...list.map($flowLine))
}

const $when = (a: IAccountAction, now: number): I$Node =>
  $anchor(
    attr({ href: chainExplorerTxUrl(a.chainId, a.txHash), target: '_blank', title: new Date(a.time * 1000).toLocaleString() }),
    spacing.small,
    style({ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', fontSize: text.xs, color: palette.foreground, whiteSpace: 'nowrap', textDecoration: 'none' })
  )(
    $column(style({ gap: '2px', alignItems: 'flex-end' }))(
      $text(new Date(a.time * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })),
      $row(spacing.tiny, style({ alignItems: 'center', color: palette.message }))(
        $text(`${getDuration(now - a.time)} ago`),
        $icon({ $content: $external, width: '12px', viewBox: '0 0 24 24', fill: 'currentColor' })
      )
    )
  )

const csvOf = (list: readonly IAccountAction[]): string => {
  const cell = (s: string): string => `"${s.replaceAll('"', '""')}"`
  const rows = list.map(a =>
    [
      new Date(a.time * 1000).toISOString(),
      chainName(a.chainId),
      KIND[a.kind].label,
      a.kind === 'operate' ? operationSummary(a.chainId, a.steps).actions.map(x => x.title).join(' | ') : '',
      flowsOf(a).map(readableFlow).join(' | '),
      a.fee === null ? '' : readableTokenAmountLabel(getTokenDescription(a.chainId, a.fee.token), a.fee.amount),
      a.txHash
    ]
      .map(cell)
      .join(',')
  )
  return ['time,chain,action,details,flow,relay fee,tx', ...rows].join('\n')
}

const $right = $defaultTableCell(style({ justifyContent: 'flex-end' }))
const $rightHead = (label: string): I$Node => $node(style({ flex: 1, textAlign: 'right' }))($text(label))

export const $AccountHistory = (historyQuery: IStream<Promise<IAccountAction[]>>, $header: ($trailing: I$Node) => I$Node, $empty: I$Node) =>
  component(
    (
      [selectFamily, selectFamilyTether]: IBehavior<IFamily>,
      [requestPage, requestPageTether]: IBehavior<IPageRequest>,
      [clickFilters, clickFiltersTether]: IBehavior<PointerEvent>
    ) => {
      const family: IStream<IFamily> = state('all' as IFamily, selectFamily)
      const filteredQuery: IStream<Promise<IAccountAction[]>> = op(
        map(async p => {
          const all = await p.query
          return p.family === 'all' ? all : all.filter(a => FAMILY[a.kind] === p.family)
        }, combine({ query: historyQuery, family })),
        state()
      )

      const $toolbar = $Popover({
        $open: constant(
          $column(spacing.default, style({ minWidth: '240px' }))(
            $column(spacing.small)(
              $node(style({ color: palette.foreground, fontSize: text.sm }))($text('Show')),
              $ButtonToggle({
                value: family,
                optionList: ['all', 'funding', 'trading', 'account'] as const,
                $container: $defaultButtonToggleContainer(style({ flexWrap: 'wrap' })),
                $button: $defaultButtonToggleBtn(style({ padding: '4px 12px', fontSize: text.xs })),
                $$option: map((f: IFamily) => $node($text(FAMILY_LABEL[f])))
              })({ select: selectFamilyTether() })
            ),
            $intermediatePromise({
              $loader: empty,
              $display: map(async q => {
                const filtered = await q
                return $anchor(
                  attr({ href: `data:text/csv;charset=utf-8,${encodeURIComponent(csvOf(filtered))}`, download: 'history.csv' }),
                  style({ fontSize: text.sm })
                )($text('Export CSV'))
              }, filteredQuery)
            })
          ),
          clickFilters
        ),
        $target: $ButtonSecondary({
          $container: $defaultMiniButtonSecondary(style({ height: '32px', padding: '0 12px', fontSize: text.sm, fontWeight: '500' })),
          $content: $row(spacing.small, style({ alignItems: 'center', whiteSpace: 'nowrap' }))(
            $node($text(map((f: IFamily) => FAMILY_LABEL[f], family))),
            $popoverCaret()
          )
        })({ click: clickFiltersTether() })
      })({})

      const $table = $intermediatePromise({
          $display: map(async query => {
            const filtered = await query
            if (filtered.length === 0) return $empty
            const now = getUnixTimestamp()
            const pageOf = (offset: number): Promise<TablePageResponse<IAccountAction>> =>
              Promise.resolve({ page: filtered.slice(offset, offset + PAGE), offset, pageSize: PAGE })
            return $Table<IAccountAction>({
                dataSource: merge(just(pageOf(0)), map(request => pageOf(request.offset), requestPage)),
                scrollConfig: {
                  $container: $defaultVScrollContainer(designSheet.customScroll, style({ maxHeight: '560px', overflowY: 'auto', marginRight: isDesktopScreen ? '-28px' : '-12px', paddingRight: isDesktopScreen ? '28px' : '12px' }))
                },
                $rowContainer: $defaultTableRowContainer(style({ borderBottom: `1px solid ${colorShade(palette.foreground, 12)}` })),
                columns: [
                  { $head: $text('Action'), gridTemplate: '150px', $bodyCallback: map($action) },
                  { $head: $text('Details'), gridTemplate: 'minmax(200px, 1fr)', $bodyCallback: map($details) },
                  { $head: $rightHead('Flow'), gridTemplate: '120px', $bodyCellContainer: $right, $bodyCallback: map($flow) },
                  { $head: $rightHead('Time'), gridTemplate: '120px', $bodyCallback: map((a: IAccountAction) => $when(a, now)) }
                ]
              })({ scrollRequest: requestPageTether() })
          }, filteredQuery)
        })

      return [$column(spacing.small)($header($toolbar), $table), {}]
    }
  )
