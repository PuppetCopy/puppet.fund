import { CHAIN_IDS } from '@puppet/contracts/const'
import { type ITokenFlowView, tokenMovesOf, tokenUnitOf } from '@puppet/sdk/client'
import { type ChainId, resolveDispatchChainId } from '@puppet/sdk/const'
import { getDuration, getTokenDescription, getTxExplorerUrl, getUnixTimestamp, readableAddress, readableTokenAmountLabel } from '@puppet/sdk/core'
import { tokenMetaByChainToken, tokenMetaKey } from '@puppet/sdk/state'
import { VENUES } from '@puppet/sdk/venue'
import { combine, constant, empty, type IStream, just, map, merge, op, reduce, skipRepeats, skipRepeatsWith, switchLatest } from 'aelea/stream'
import { type IBehavior, type PromiseState, PromiseStatus, state } from 'aelea/stream-extended'
import { $element, $node, $text, attr, component, type I$Node, type I$Slottable, style, stylePseudo } from 'aelea/ui'
import { $ButtonToggle, $column, $defaultButtonToggleBtn, $defaultButtonToggleContainer, $icon, $Popover, $row, designSheet, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $defaultAnchor, $Link } from 'aelea/ui-router'
import { type Address, getAddress, isAddressEqual } from 'viem'
import {
  $anchor,
  $ButtonSecondary,
  $defaultMiniButtonSecondary,
  $defaultTableCell,
  $defaultTableRowContainer,
  $defaultVScrollContainer,
  $externalMark,
  $gas,
  $infoTooltip,
  $intermediateFailure,
  $intermediatePromise,
  $intermediateText,
  $popoverCaret,
  $intermediateLine,
  $Table,
  type IPageRequest,
  SEPARATOR_COLOR,
  type TablePageResponse,
  text,
  intermediateState
} from '@/ui-components'
import { uiStorage } from '@/ui-storage'
import { routeSchema } from '../../app/routeSchema.js'
import { $chainIcon, chainName } from '../../common/$chain.js'
import { ethUsd } from '../../common/$common.js'
import { chainFor } from '../../common/$contract.js'
import { $venueFields, $venueIcon } from '../../common/$operationView.js'
import { $feeAmount, $relayFeeIcon, $tokenFlows, $tokenFlowsHead, $tokenFlowsRow } from '../../common/$tokenFlows.js'
import { type IVenueAction, operationSummary } from '../../common/operation.js'
import type { IAccountAction } from '../../io/journal/history.js'
import { priceFor, usdOf } from '../../io/price.js'
import { publicClientMap } from '../../wallet/wallet.js'

const KIND_LABEL: Record<IAccountAction['kind'], string> = {
  deposit: 'Deposit',
  revoke: 'Signers revoked',
  swap: 'Swap',
  withdraw: 'Withdraw',
  operate: 'Operate',
  fundSwap: 'Account swap',
  escrow: 'Escrowed',
  fulfil: 'Escrow released',
  returnEscrow: 'Escrow returned',
  requestReturn: 'Escrow return requested',
  walletWithdraw: 'Withdrawn to wallet',
  contribute: 'Contribution',
  allocate: 'Allocate',
  allocation: 'Allocation',
  sell: 'Sell',
  redeem: 'Redeem',
  settle: 'Paid out',
  cut: 'Payout skipped',
  refused: 'Payout refused',
  ownerPayout: 'Fund payout',
  closeOut: 'Redemption closed',
  dustReturn: 'Dust returned',
  mandate: 'Mandate',
  unknown: 'Unrecognized'
}

export type IFamily = 'all' | 'funding' | 'trading' | 'account'

export const FAMILY: Record<IAccountAction['kind'], Exclude<IFamily, 'all'>> = {
  deposit: 'funding',
  revoke: 'account',
  swap: 'funding',
  withdraw: 'funding',
  operate: 'trading',
  fundSwap: 'funding',
  escrow: 'trading',
  fulfil: 'trading',
  returnEscrow: 'funding',
  requestReturn: 'funding',
  walletWithdraw: 'funding',
  contribute: 'trading',
  allocate: 'trading',
  allocation: 'trading',
  sell: 'trading',
  redeem: 'trading',
  settle: 'trading',
  cut: 'trading',
  refused: 'trading',
  ownerPayout: 'trading',
  closeOut: 'trading',
  dustReturn: 'trading',
  mandate: 'account',
  unknown: 'account'
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

interface IHistoryRows {
  family: IFamily
  list: IAccountAction[]
}

interface IShownHistory {
  rows: (IHistoryRows & { loaded: number }) | null
  failure: { error: unknown } | null
}

const puppetCount = (n: number): string => `${n} puppet${n === 1 ? '' : 's'}`


const tokenChainOf = (home: ChainId, token: Address): ChainId => {
  const chain = [home, ...([...CHAIN_IDS] as ChainId[]).filter(c => c !== home)].find(c => tokenMetaByChainToken.has(tokenMetaKey(c, token)))
  if (chain === undefined) throw new Error(`token ${token} is listed on no chain`)
  return chain
}

const $raised = ($content: I$Slottable): I$Node => $node(style({ position: 'relative', zIndex: 1, display: 'flex' }))($content)

const $traderLink = (master: Address): I$Slottable =>
  $Link({
    route: routeSchema.traders.detail,
    params: { master },
    $anchor: $defaultAnchor(style({ color: palette.message })),
    $content: $text(readableAddress(master))
  })({})

const $primary = (content: string | I$Slottable): I$Node =>
  $node(style({ fontSize: text.sm, color: palette.message }))(typeof content === 'string' ? $text(content) : content)

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

const SETTLED_OUTCOMES: readonly string[] = ['executed', 'cancelled']

const venueOutcome = async (a: IAccountAction, x: IVenueAction): Promise<string> => {
  const venue = VENUES.find(v => v.venueId === x.venueId)
  if (venue?.outcome === undefined || x.orderKey === null) return 'unknown'
  const key = `venueOutcome:${x.venueId}:${a.chainId}:${x.orderKey.toLowerCase()}`
  const stored = (await uiStorage.device.read<string>(key))?.value ?? null
  if (stored !== null) return stored
  const outcome =
    (await venue.outcome({
      chainId: a.chainId,
      account: a.account,
      key: x.orderKey,
      fromBlock: a.block,
      publicClient: publicClientMap[a.chainId]
    })) ?? 'unknown'
  if (SETTLED_OUTCOMES.includes(outcome)) void uiStorage.device.write(key, outcome)
  return outcome
}

const $stepDetail = (a: IAccountAction, x: IVenueAction): I$Node =>
  $column(style({ gap: '2px' }))(
    $row(spacing.tiny, style({ alignItems: 'center' }))(
      $venueIcon(x.venue, 14),
      $node(style({ fontWeight: '700', color: palette.message, whiteSpace: 'nowrap' }))($text(x.label)),
      ...(x.orderKey === null || x.call !== 'createOrder'
        ? []
        : [
            $intermediatePromise({
              $loader: $intermediateLine('5em', text.xs),
              $display: map(() => venueOutcome(a, x).then($outcomePill), just(null))
            })
          ])
    ),
    ...(x.fields.length === 0 ? [] : [$venueFields(x.fields)])
  )

const profitFeeLine = (a: { chainId: ChainId; token: Address; profitFee: bigint }): string[] =>
  a.profitFee === 0n ? [] : [`${readableTokenAmountLabel(getTokenDescription(a.chainId, a.token), a.profitFee)} performance fee on your gain`]

const $details = (a: IAccountAction): I$Node | null => {
  switch (a.kind) {
    case 'deposit':
      return $lines('to your account')
    case 'revoke':
      return $lines('ended every mandate now and every session after 10 minutes; your wallet can then withdraw each token for 10 minutes')
    case 'escrow':
      return $lines(a.from === 'account' ? "moved from your account into escrow for your own fund's rounds on this chain" : "held for your own fund's rounds on this chain")
    case 'returnEscrow':
      return $lines('returned from escrow to your wallet')
    case 'requestReturn':
      return $lines(`claimable from ${new Date(Number(a.returnAt) * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`)
    case 'walletWithdraw':
      return $lines('paid from your account to your wallet')
    case 'contribute':
      return $lines(`your ${chainName(a.creditChainId)} escrow credited to this fund`)
    case 'fulfil':
      return $lines(
        `${readableTokenAmountLabel(getTokenDescription(a.chainId, a.token), a.amount)} released from escrow`,
        ...(a.fee === null || a.fee.amount === 0n ? [] : [`${readableTokenAmountLabel(getTokenDescription(a.chainId, a.fee.token), a.fee.amount)} round fee billed here`])
      )
    case 'swap': {
      const chain = tokenChainOf(a.chainId, a.outputToken)
      return chain === a.chainId ? null : $lines(`bridged to ${chainName(chain)}`)
    }
    case 'withdraw': {
      const chain = tokenChainOf(a.chainId, a.outputToken)
      return chain === a.chainId && isAddressEqual(a.outputToken, a.token)
        ? null
        : $lines(`received ${readableTokenAmountLabel(getTokenDescription(chain, a.outputToken), a.outputAmount)}${chain === a.chainId ? '' : ` on ${chainName(chain)}`}`)
    }
    case 'operate':
      return null
    case 'fundSwap':
      return $lines(Number(a.destinationChainId) === a.chainId ? 'funds swapped' : `funds to ${chainName(Number(a.destinationChainId))}`)
    case 'allocate':
      return $lines(
        $element('span')($text('round valued at '), $intermediateText(ethUsd(a.valuation)), $text(' · '), $intermediateText(ethUsd(a.credited)), $text(' of yours credited')),
        puppetCount(a.puppets)
      )
    case 'allocation':
      return $lines($element('span')($intermediateText(ethUsd(a.value)), $text(' allocated to this fund')))
    case 'sell':
      return $lines('queued for the next redemption', ...(a.paid > 0n ? ['settled in the open redemption first'] : []), ...profitFeeLine(a))
    case 'redeem':
      return $lines(
        $element('span')(
          $text('valued at '),
          $intermediateText(ethUsd(a.valuation)),
          $text(' · '),
          $intermediateText(map(price => usdOf(a.paid, price), priceFor(a.chainId, a.token))),
          $text(' to puppets'),
          ...(a.masterPay > 0n ? [$text(', '), $intermediateText(map(price => usdOf(a.masterPay, price), priceFor(a.chainId, a.token))), $text(' to you')] : [])
        )
      )
    case 'settle':
      return $lines('your part of a redemption', ...profitFeeLine(a))
    case 'cut':
      return $lines('your part was worth less than one relay fee, so it stayed in the fund and you keep your shares')
    case 'refused':
      return $lines('the token refused the transfer to your account, so your part went back to the fund; you keep your shares and can redeem again later')
    case 'ownerPayout':
      return $lines("your share of your fund's redemption, paid into your account")
    case 'dustReturn':
      return $lines('claims worth less than one relay fee went back to the fund, and their holders keep their shares')
    case 'closeOut':
      return $lines(
        a.paid > 0n ? $element('span')($intermediateText(map(price => usdOf(a.paid, price), priceFor(a.chainId, a.token))), $text(' paid to you')) : 'your hub part covered your fee',
        ...(a.cut > 0n ? ['the dust tail returned to the fund'] : [])
      )
    case 'unknown':
      return $lines(a.selector, a.reason)
    case 'mandate': {
      const ended = a.masters.filter(m => m.expiry === 0n).length
      const set = a.masters.length - ended
      return $lines(
        a.masters.length === 0
          ? 'no mandate carried'
          : [...(set === 0 ? [] : [`${set} mandate${set === 1 ? '' : 's'} broadcast`]), ...(ended === 0 ? [] : [`${ended} mandate${ended === 1 ? '' : 's'} ended`])].join(', '),
        $row(spacing.small, style({ flexWrap: 'wrap' }))(...a.masters.map(m => $traderLink(m.master)))
      )
    }
  }
}

const $actionCell = (a: IAccountAction): I$Node => {
  if (a.kind === 'operate') {
    const summary = operationSummary(a.chainId, a.steps, a.profiles)
    const lead = summary.actions[0]
    return $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))(
      $chainIcon(a.chainId, 16),
      ...(lead === undefined
        ? []
        : [
            $venueIcon(lead.venue, 16),
            $node(style({ fontSize: text.xs, fontWeight: '700', color: palette.message, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: '0' }))($text(lead.label)),
            $raised($infoTooltip($column(spacing.small, style({ maxWidth: '280px' }))(...summary.actions.map(x => $stepDetail(a, x))), colorShade(palette.foreground, 60)))
          ])
    )
  }
  const detail = $details(a)
  return $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))(
    $chainIcon(a.chainId, 16),
    $node(style({ fontSize: text.xs, fontWeight: '700', color: palette.message, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: '0' }))($text(KIND_LABEL[a.kind])),
    ...('master' in a ? [$raised($traderLink(a.master))] : []),
    ...(detail === null ? [] : [$raised($infoTooltip($column(spacing.tiny, style({ maxWidth: '280px' }))(detail), colorShade(palette.foreground, 60)))])
  )
}

const tokenView = (chainId: ChainId, token: Address, amount: bigint, exact: boolean): ITokenFlowView => ({
  chainId,
  token: getAddress(token),
  profile: getTokenDescription(chainId, token),
  amount,
  exact,
  usd: null
})

const movementsOf = (a: IAccountAction): { outs: ITokenFlowView[]; ins: ITokenFlowView[] } => {
  switch (a.kind) {
    case 'deposit':
      return { outs: [], ins: [tokenView(a.chainId, a.token, a.amount, true)] }
    case 'escrow':
      return { outs: a.from === 'account' ? [tokenView(a.chainId, a.token, a.amount, true)] : [], ins: [] }
    case 'returnEscrow':
    case 'requestReturn':
      return { outs: [], ins: [] }
    case 'walletWithdraw':
    case 'withdraw':
      return { outs: [tokenView(a.chainId, a.token, a.amount, true)], ins: [] }
    case 'contribute':
      return { outs: [], ins: [] }
    case 'swap':
      return {
        outs: [tokenView(a.chainId, a.token, a.amount, true)],
        ins: [tokenView(resolveDispatchChainId(Number(a.destinationChainId)), a.outputToken, a.outputAmount, true)]
      }
    case 'fundSwap':
      return {
        outs: [tokenView(a.chainId, a.token, a.amount, true)],
        ins: [tokenView(resolveDispatchChainId(Number(a.destinationChainId)), a.outputToken, a.outputAmount, Number(a.destinationChainId) !== a.chainId)]
      }
    case 'operate': {
      const moves = tokenMovesOf(a.steps).map(move => ({
        out: move.out,
        view: { chainId: a.chainId, token: move.token, profile: tokenUnitOf(a.chainId, move.token, a.profiles), amount: move.amount, exact: move.exact, usd: null }
      }))
      return { outs: moves.filter(m => m.out).map(m => m.view), ins: moves.filter(m => !m.out).map(m => m.view) }
    }
    case 'fulfil':
      return { outs: [], ins: [tokenView(a.chainId, a.token, a.fee === null ? a.amount : a.amount - a.fee.amount, true)] }
    case 'allocate':
      return {
        outs: [],
        ins:
          a.credit === null || a.credit.chainId !== a.chainId || a.credit.amount === a.masterBilled
            ? []
            : [tokenView(a.credit.chainId, a.credit.token, a.credit.amount - a.masterBilled, true)]
      }
    case 'allocation': {
      return { outs: [tokenView(a.chainId, a.token, a.amount, true)], ins: [] }
    }
    case 'settle':
      return { outs: [], ins: a.paid > 0n ? [tokenView(a.chainId, a.token, a.paid, true)] : [] }
    case 'cut':
    case 'refused':
      return { outs: [], ins: [] }
    case 'ownerPayout':
      return { outs: [], ins: [tokenView(a.chainId, a.token, a.amount, true)] }
    case 'dustReturn':
      return { outs: [], ins: [tokenView(a.chainId, a.token, a.amount, true)] }
    case 'redeem':
      return { outs: [tokenView(a.chainId, a.token, a.paid + a.masterPay, true)], ins: [] }
    case 'sell':
      return { outs: [], ins: a.paid > 0n ? [tokenView(a.chainId, a.token, a.paid, true)] : [] }
    case 'closeOut':
      return { outs: [], ins: a.cut > 0n ? [tokenView(a.chainId, a.token, a.cut, true)] : [] }
    case 'revoke':
    case 'mandate':
    case 'unknown':
      return { outs: [], ins: [] }
  }
}

const $flowsCell = (a: IAccountAction): I$Node => {
  const moved = movementsOf(a)
  if (moved.outs.length + moved.ins.length === 0) return $node()
  return isDesktopScreen ? $tokenFlowsRow(just(false), moved.outs, moved.ins) : $tokenFlows(just(false), moved.outs, moved.ins)
}

const $feeCell = (a: IAccountAction): I$Node =>
  a.fee === null ? $node() : $feeAmount(just(false), tokenView(a.chainId, a.fee.token, a.fee.amount, true))

const $phoneFee = (a: IAccountAction): I$Node =>
  a.fee === null
    ? empty
    : $row(spacing.tiny, style({ alignItems: 'center', justifyContent: 'flex-end', fontSize: text.xs, color: palette.foreground, whiteSpace: 'nowrap' }))(
        $icon({ $content: $gas, width: '14px', viewBox: '0 0 32 32', fill: palette.foreground }),
        $text(readableTokenAmountLabel(getTokenDescription(a.chainId, a.fee.token), a.fee.amount))
      )

const $when = (a: IAccountAction, now: number): I$Node =>
  $anchor(
    attr({ href: getTxExplorerUrl(a.txHash, chainFor(a.chainId)), target: '_blank', title: new Date(a.time * 1000).toLocaleString() }),
    style({ display: 'flex', alignSelf: 'flex-start', alignItems: 'center', gap: '4px', fontSize: text.xs, color: palette.foreground, whiteSpace: 'nowrap' }),
    stylePseudo('::after', { content: '""', position: 'absolute', inset: '0' })
  )($text(`${getDuration(now - a.time)} ago`), $externalMark())

const unitsLabel = (flow: ITokenFlowView, sign: string): string => `${sign}${flow.exact ? '' : '≈'}${readableTokenAmountLabel(flow.profile, flow.amount)}`

const csvOf = (list: readonly IAccountAction[]): string => {
  const cell = (s: string): string => `"${s.replaceAll('"', '""')}"`
  const rows = list.map(a =>
    [
      new Date(a.time * 1000).toISOString(),
      chainName(a.chainId),
      KIND_LABEL[a.kind],
      a.kind === 'operate'
        ? operationSummary(a.chainId, a.steps, a.profiles)
            .actions.map(x => [`${x.venue} ${x.label}`, ...x.fields.map(f => `${f.label} ${f.value}`)].join('; '))
            .join(' | ')
        : '',
      [...movementsOf(a).outs.map(flow => unitsLabel(flow, '-')), ...movementsOf(a).ins.map(flow => unitsLabel(flow, ''))].join(' | '),
      a.fee === null ? '' : readableTokenAmountLabel(getTokenDescription(a.chainId, a.fee.token), a.fee.amount),
      a.txHash
    ]
      .map(cell)
      .join(',')
  )
  return ['time,chain,action,details,flow,relay fee,tx', ...rows].join('\n')
}

const $right = $defaultTableCell(style({ justifyContent: 'flex-end' }))

export const $AccountHistory = (historyQuery: IStream<Promise<IAccountAction[]>>, $header: (failure: IStream<{ error: unknown } | null>, $trailing: I$Node) => I$Node, $empty: I$Node) =>
  component(
    (
      [selectFamily, selectFamilyTether]: IBehavior<IFamily>,
      [requestPage, requestPageTether]: IBehavior<IPageRequest>,
      [clickFilters, clickFiltersTether]: IBehavior<PointerEvent>
    ) => {
      const family: IStream<IFamily> = state('all' as IFamily, selectFamily)
      const filteredQuery = op(
        combine({ query: historyQuery, family }),
        map(p => p.query.then((all): IHistoryRows => ({ family: p.family, list: p.family === 'all' ? all : all.filter(a => FAMILY[a.kind] === p.family) })))
      )
      const shown = op(
        merge(
          intermediateState(filteredQuery),
          op(
            requestPage,
            map(request => request.offset + PAGE)
          )
        ),
        reduce((last: IShownHistory, next: number | PromiseState<IHistoryRows>): IShownHistory => {
          if (typeof next === 'number') return last.rows === null ? last : { ...last, rows: { ...last.rows, loaded: Math.max(last.rows.loaded, next) } }
          if (next.status === PromiseStatus.PENDING) return last
          if (next.status === PromiseStatus.ERROR) return { ...last, failure: { error: next.error } }
          return { rows: { ...next.value, loaded: last.rows !== null && last.rows.family === next.value.family ? last.rows.loaded : PAGE }, failure: null }
        }, { rows: null, failure: null }),
        state()
      )
      const settledRows = op(
        shown,
        skipRepeatsWith((a, b) => {
          if (a.rows === null || b.rows === null) return a.rows === b.rows && a.failure === b.failure
          const list = b.rows.list
          return (
            a.rows.family === b.rows.family &&
            a.rows.list.length === list.length &&
            a.rows.list.every((x, i) => {
              const y = list[i]!
              return x.chainId === y.chainId && x.block === y.block && x.logIndex === y.logIndex && x.kind === y.kind && isAddressEqual(x.account, y.account)
            })
          )
        })
      )

      const $toolbar = $Popover({
        $open: constant(
          $column(spacing.default, style({ minWidth: '240px' }))(
            $column(spacing.small)(
              $node(style({ color: palette.foreground, fontSize: text.sm }))($text('Show')),
              $FamilyToggle({ family })({ selectFamily: selectFamilyTether() })
            ),
            switchLatest(
              map(
                s =>
                  s.rows === null
                    ? s.failure === null
                      ? $intermediateLine('6em', text.sm)
                      : empty
                    : $anchor(
                        attr({ href: `data:text/csv;charset=utf-8,${encodeURIComponent(csvOf(s.rows.list))}`, download: 'history.csv' }),
                        style({ fontSize: text.sm })
                      )($text('Export CSV')),
                settledRows
              )
            )
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

      const refreshFailure = op(
        shown,
        map(s => (s.rows === null ? null : s.failure)),
        skipRepeats
      )

      const $table = op(
        settledRows,
        map(s => {
          if (s.rows === null) return s.failure === null ? empty : $intermediateFailure(s.failure.error, $text('-'), false)
          const rows = s.rows
          if (rows.list.length === 0) return $empty
          const now = getUnixTimestamp()
          const pageOf = (offset: number, size: number): Promise<TablePageResponse<IAccountAction>> =>
            Promise.resolve({ page: rows.list.slice(offset, offset + size), offset, pageSize: size })
          return $Table<IAccountAction>({
            dataSource: merge(just(pageOf(0, rows.loaded)), map(request => pageOf(request.offset, PAGE), requestPage)),
            scrollConfig: {
              $container: $defaultVScrollContainer(
                designSheet.customScroll,
                style({ maxHeight: '560px', overflowY: 'auto', ...(isDesktopScreen ? { marginRight: '-28px', paddingRight: '28px' } : {}) })
              )
            },
            $rowContainer: $defaultTableRowContainer(style({ borderBottom: `1px solid ${SEPARATOR_COLOR}` })),
            columns: isDesktopScreen
              ? [
                  {
                    $head: $text('Action'),
                    gridTemplate: 'minmax(0, 1fr)',
                    $bodyCallback: map((a: IAccountAction) => $column(style({ minWidth: '0', position: 'relative', gap: '2px' }))($actionCell(a), $when(a, now)))
                  },
                  { $head: $tokenFlowsHead, gridTemplate: 'minmax(0, 1.3fr)', $bodyCallback: map($flowsCell) },
                  {
                    $head: $row(spacing.tiny, style({ flex: 1, alignItems: 'center', justifyContent: 'flex-end', whiteSpace: 'nowrap' }))($relayFeeIcon, $text('Relay fee')),
                    gridTemplate: '130px',
                    $bodyCellContainer: $right,
                    $bodyCallback: map($feeCell)
                  }
                ]
              : [
                  {
                    $head: $text('Action'),
                    gridTemplate: 'minmax(0, 1fr)',
                    $bodyCallback: map((a: IAccountAction) => $column(style({ minWidth: '0', position: 'relative', gap: '4px' }))($actionCell(a), $when(a, now)))
                  },
                  {
                    $head: $text('Flows'),
                    gridTemplate: 'minmax(0, 1.3fr)',
                    $bodyCallback: map((a: IAccountAction) => $column(spacing.small, style({ flex: 1, minWidth: '0' }))($flowsCell(a), $phoneFee(a)))
                  }
                ]
          })({ scrollRequest: requestPageTether() })
        }),
        switchLatest
      )

      return [$column(spacing.small)($header(refreshFailure, $toolbar), $table), {}]
    }
  )
