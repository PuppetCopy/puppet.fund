import { CHAIN_IDS, HUB_CHAIN_ID } from '@puppet/contracts/const'
import { type ChainId, resolveDispatchChainId } from '@puppet/sdk/const'
import { getDuration, getTokenDescription, getTxExplorerUrl, getUnixTimestamp, readableAddress, readableTokenAmountLabel } from '@puppet/sdk/core'
import { VALUE_KEY } from '@puppet/sdk/evaluate'
import { bondTokenOf, chainTokenOfKey, tokenMetaByChainToken, tokenMetaKey } from '@puppet/sdk/state'
import { VENUES } from '@puppet/sdk/venue'
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
  $infoTooltip,
  $intermediatePromise,
  $popoverCaret,
  $Table,
  type IPageRequest,
  type TablePageResponse,
  text
} from '@/ui-components'
import { routeSchema } from '../../app/routeSchema.js'
import { $chainIcon, chainName } from '../../common/$chain.js'
import { chainFor } from '../../common/$contract.js'
import { $venueFields, $venueHeadline } from '../../common/$operationView.js'
import { type ITokenFlow, type IVenueAction, operationSummary, readableFlow } from '../../common/operation.js'
import type { IAccountAction } from '../../io/journal/history.js'
import { publicClientMap } from '../../wallet/wallet.js'

const KIND: Record<IAccountAction['kind'], { label: string; color: string }> = {
  genesis: { label: 'Deployed', color: palette.message },
  deposit: { label: 'Deposit', color: palette.positive },
  selfWithdraw: { label: 'Withdraw', color: palette.negative },
  withdrawRequest: { label: 'Withdrawal requested', color: palette.message },
  revoke: { label: 'Signers revoked', color: palette.message },
  swap: { label: 'Swap', color: palette.primary },
  withdraw: { label: 'Withdraw', color: palette.negative },
  operate: { label: 'Operate', color: palette.primary },
  fundSwap: { label: 'Account swap', color: palette.primary },
  createFund: { label: 'Fund opened', color: palette.message },
  escrow: { label: 'Escrowed', color: palette.indeterminate },
  fulfil: { label: 'Escrow released', color: palette.positive },
  refund: { label: 'Escrow refunded', color: palette.negative },
  allocate: { label: 'Allocate', color: palette.indeterminate },
  allocation: { label: 'Allocation', color: palette.primary },
  sell: { label: 'Sell', color: palette.indeterminate },
  sellFee: { label: 'Sell fee', color: palette.positive },
  redeem: { label: 'Redeem', color: palette.indeterminate },
  claim: { label: 'Claim', color: palette.positive },
  claimFee: { label: 'Claim fee', color: palette.positive },
  mandate: { label: 'Mandate', color: palette.message }
}

export type IFamily = 'all' | 'funding' | 'trading' | 'account'

export const FAMILY: Record<IAccountAction['kind'], Exclude<IFamily, 'all'>> = {
  genesis: 'account',
  deposit: 'funding',
  selfWithdraw: 'funding',
  withdrawRequest: 'funding',
  revoke: 'account',
  swap: 'funding',
  withdraw: 'funding',
  operate: 'trading',
  fundSwap: 'funding',
  createFund: 'account',
  escrow: 'trading',
  fulfil: 'trading',
  refund: 'funding',
  allocate: 'trading',
  allocation: 'trading',
  sell: 'trading',
  sellFee: 'trading',
  redeem: 'trading',
  claim: 'trading',
  claimFee: 'trading',
  mandate: 'account'
}

export const FAMILY_LABEL: Record<IFamily, string> = { all: 'All', funding: 'Funding', trading: 'Trading', account: 'Account' }

export const $FamilyToggle = ({ family }: { family: IStream<IFamily> }) =>
  component(([selectFamily, selectFamilyTether]: IBehavior<IFamily>) => [
    $ButtonToggle({
      value: family,
      optionList: ['all', 'funding', 'trading', 'account'] as const,
      $container: $defaultButtonToggleContainer(style({ flexWrap: 'wrap' })),
      $button: $defaultButtonToggleBtn(style({ padding: '4px 12px', fontSize: text.xs })),
      $$option: map((f: IFamily) => $node($text(FAMILY_LABEL[f])))
    })({ select: selectFamilyTether() }),
    { selectFamily }
  ])

const OUTCOME: Record<string, { label: string; color: string }> = {
  open: { label: 'open', color: palette.message },
  frozen: { label: 'frozen', color: palette.indeterminate },
  executed: { label: 'executed', color: palette.positive },
  cancelled: { label: 'cancelled', color: palette.negative },
  unknown: { label: 'no outcome found', color: palette.foreground }
}

export const PAGE = 25

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
    $content: $text(readableAddress(master))
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

const $outcomePill = (o: string): I$Node => {
  const pill = OUTCOME[o] ?? { label: o, color: palette.foreground }
  return $node(
    style({
      fontSize: text.xs,
      padding: '0 6px',
      borderRadius: '4px',
      whiteSpace: 'nowrap',
      color: pill.color,
      backgroundColor: colorShade(pill.color, 12)
    })
  )($text(pill.label))
}

const venueOutcome = async (a: IAccountAction, x: IVenueAction): Promise<string> => {
  const venue = VENUES.find(v => v.venueId === x.venueId)
  if (venue?.outcome === undefined || x.orderKey === null) return 'unknown'
  const outcome = await venue.outcome({
    chainId: a.chainId,
    account: a.account,
    key: x.orderKey,
    fromBlock: a.block,
    publicClient: publicClientMap[a.chainId]
  })
  return outcome ?? 'unknown'
}

const $venueAction = (a: IAccountAction, x: IVenueAction): I$Node =>
  $venueHeadline(
    x,
    ...(x.fields.length === 0
      ? []
      : [$infoTooltip($column(style({ maxWidth: '280px' }))($venueFields(x.fields)), colorShade(palette.foreground, 60))]),
    ...(x.orderKey === null || x.call !== 'createOrder'
      ? []
      : [
          $intermediatePromise({
            $loader: $node(style({ fontSize: text.xs, color: palette.foreground }))($text('checking')),
            $display: map(async o => $outcomePill(await o), just(venueOutcome(a, x)))
          })
        ])
  )

const $details = (a: IAccountAction): I$Node => {
  switch (a.kind) {
    case 'genesis':
      return $lines(readableAddress(a.account), a.parent === null ? 'your account' : `fund of ${readableAddress(a.parent)}`)
    case 'deposit':
      return $lines('to your account')
    case 'selfWithdraw':
      return $lines('to your wallet')
    case 'withdrawRequest':
      return $lines('a direct withdrawal opens once the module delay has passed; relayed actions pause until it is used')
    case 'revoke':
      return $lines('every session signed before now stopped acting for this account')
    case 'createFund':
      return $lines(`share ${readableAddress(a.share)}`)
    case 'escrow':
      return $lines($row(spacing.tiny)($text('committed to'), $traderLink(a.master)))
    case 'refund':
      return $lines($row(spacing.tiny)($text('returned to your wallet from the escrow of'), $traderLink(a.master)))
    case 'fulfil':
      return $lines(
        `${readableTokenAmountLabel(getTokenDescription(a.chainId, a.token), a.amount)} released from escrow`,
        ...(a.fee === null || a.fee.amount === 0n ? [] : [`${readableTokenAmountLabel(getTokenDescription(a.chainId, a.fee.token), a.fee.amount)} round fee billed here`])
      )
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
    case 'operate': {
      const summary = operationSummary(a.chainId, a.steps)
      return $column(spacing.tiny, style({ minWidth: 0 }))(...summary.actions.map(x => $venueAction(a, x)), $secondary('from the fund'))
    }
    case 'fundSwap':
      return $lines(
        Number(a.destinationChainId) === a.chainId ? 'funds swapped' : `funds to ${chainName(Number(a.destinationChainId))}`,
        `at least ${readableTokenAmountLabel(getTokenDescription(resolveDispatchChainId(Number(a.destinationChainId)), a.outputToken), a.outputAmount)} out`
      )
    case 'allocate':
      return $lines(
        `round valued at ${readableTokenAmountLabel(value, a.value)} · ${readableTokenAmountLabel(bond, a.credited)} of yours credited`,
        backerCount(a.backers)
      )
    case 'allocation':
      return $lines($row(spacing.tiny)($text(`${readableTokenAmountLabel(bond, a.stake)} allocated to`), $traderLink(a.master)))
    case 'sell':
      return $lines(
        $row(spacing.tiny)($text('sold part of your share in'), $traderLink(a.master)),
        `${readableTokenAmountLabel(bond, a.payoutFee)} performance fee`
      )
    case 'sellFee':
      return $lines($row(spacing.tiny)($text('performance fee from'), $traderLink(a.puppet)))
    case 'redeem':
      return $lines(
        `${readableTokenAmountLabel(bond, a.cash)} redeemed from the queue${a.retire > 0n ? ', including your retired share' : ''}`,
        `valued at ${readableTokenAmountLabel(value, a.value)} · ${readableTokenAmountLabel(bond, a.payout)} to backers`
      )
    case 'claim':
      return $lines(
        $row(spacing.tiny)($text('claimed from'), $traderLink(a.master)),
        `${readableTokenAmountLabel(bond, a.payoutFee)} performance fee`
      )
    case 'claimFee':
      return $lines($row(spacing.tiny)($text('performance fee from'), $traderLink(a.holder)))
    case 'mandate':
      return $lines(
        a.masters.length === 0 ? 'no mandate carried' : `${a.masters.length} mandate${a.masters.length === 1 ? '' : 's'} broadcast`,
        $row(spacing.small, style({ flexWrap: 'wrap' }))(...a.masters.map(m => $traderLink(m.master)))
      )
  }
}

const flowsOf = (a: IAccountAction): ITokenFlow[] => {
  switch (a.kind) {
    case 'deposit':
      return [{ token: getTokenDescription(a.chainId, a.token), delta: a.amount }]
    case 'selfWithdraw':
      return [{ token: getTokenDescription(a.chainId, a.token), delta: -a.amount }]
    case 'withdrawRequest':
      return []
    case 'swap':
      return []
    case 'withdraw':
      return [{ token: getTokenDescription(a.chainId, a.token), delta: -a.amount }]
    case 'operate':
      return operationSummary(a.chainId, a.steps).flows
    case 'fundSwap':
      return [{ token: getTokenDescription(a.chainId, a.token), delta: -a.amount }]
    case 'escrow':
      return [{ token: getTokenDescription(a.chainId, a.token), delta: -a.amount }]
    case 'refund':
      return [{ token: getTokenDescription(a.chainId, a.token), delta: a.amount }]
    case 'fulfil':
      return [{ token: getTokenDescription(a.chainId, a.token), delta: a.fee === null ? a.amount : a.amount - a.fee.amount }]
    case 'allocate':
      return a.credit === null ? [] : [{ token: getTokenDescription(a.credit.chainId, a.credit.token), delta: -a.credit.amount }]
    case 'allocation':
      return [{ token: bond, delta: -a.stake }]
    case 'sell':
    case 'claim':
      return [{ token: bond, delta: a.payout - a.payoutFee }]
    case 'sellFee':
    case 'claimFee':
      return [{ token: bond, delta: a.payoutFee }]
    case 'redeem':
      return [{ token: bond, delta: a.cash - a.payout }]
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
    attr({ href: getTxExplorerUrl(a.txHash, chainFor(a.chainId)), target: '_blank', title: new Date(a.time * 1000).toLocaleString() }),
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
      a.kind === 'operate'
        ? operationSummary(a.chainId, a.steps)
            .actions.map(x => [`${x.venue} ${x.label}`, ...x.fields.map(f => `${f.label} ${f.value}`)].join('; '))
            .join(' | ')
        : '',
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
              $FamilyToggle({ family })({ selectFamily: selectFamilyTether() })
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
