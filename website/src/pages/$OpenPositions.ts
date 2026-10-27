import type { ChainId } from '@puppet/sdk/const'
import { CHAIN_TOKEN_MAP, IntervalTime, USD_DECIMALS, VENUE_READ_STALE_SEC } from '@puppet/sdk/const'
import { dustToZeroUsd, formatFixed, getUnixTimestamp, readablePercentage, readableTokenAmount, readableUsd, toBasisPoints } from '@puppet/sdk/core'
import { ACCOUNT_VENUE, type IPositionRow } from '@puppet/sdk/schema'
import { contractLabelOf } from '@puppet/sdk/state'
import { gmxVenue, hyperliquidVenue, type IVenue, SAMPLEABLE_ALLOWANCE, VENUES } from '@puppet/sdk/venue'
import { combine, empty, type IStream, just, map, op, periodic, skipRepeats, start, switchLatest } from 'aelea/stream'
import { state } from 'aelea/stream-extended'
import { $node, $text, attr, type I$Node, type I$Slottable, style, stylePseudo } from 'aelea/ui'
import { $column, $row, $Tooltip, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { formatUnits, isAddressEqual } from 'viem'
import { $amountDisplay, $anchor, $detailLine, $icon, $infoMark, $infoTooltip, $intermediatePromise, $intermediateProfile, $intermediateRow, $tooltipDropContainer, maskBalance, SEPARATOR_COLOR, text } from '@/ui-components'
import { $tokenIcon, $tokenProfile } from '../common/$common.js'
import { $contractIdentity } from '../common/$contract.js'
import { $venueIcon, $venueLink } from '../common/$operationView.js'
import { formatUsdNumber, MINUS, signedDollar } from '../io/price.js'
import { type IOpenPositions, type IStandingAllowance, OWNER_SYNC_CHECK_MS, OWNER_SYNC_MS } from '../io/venue.js'
import { $avatarBadge, $badged, AVATAR_SIZE } from '../common/$avatar.js'
import { $walletConnectLogo } from '../common/$icons.js'
import { $sectionTip, ago, shortDuration } from './common.js'

const PNL_KINDS: ReadonlySet<string> = new Set(['perp', 'spot', 'outcome', 'vault', 'lend'])
const KIND_ORDER = ['perp', 'outcome', 'spot', 'vault', 'lend', 'order', 'pending', 'transit', 'cash']

export interface I$OpenPositions {
  hideBalances: IStream<boolean>
  positions: IStream<Promise<IOpenPositions>>
  standing: IStream<Promise<IStandingAllowance[]>>
  $empty: I$Node
}

const unitLabel = (amount: bigint, decimals: number): string =>
  Intl.NumberFormat('en-US', { maximumSignificantDigits: 5 }).format(formatFixed(decimals, amount))

const SIZE_WIDTH = isDesktopScreen ? '112px' : '88px'
const PNL_WIDTH = isDesktopScreen ? '128px' : '104px'

const signOf = (amount: bigint): string => (amount < 0n ? MINUS : '')
const signedUsdLabel = (amount: bigint): string => `${signedDollar(signOf(amount))}${readableUsd(amount < 0n ? -amount : amount)}`

const $fieldLine = (label: string, value: string): I$Node =>
  value === ''
    ? $node(style({ fontSize: text.xs, fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase', color: palette.foreground, paddingTop: '4px' }))($text(label))
    : $detailLine(label, value, value.startsWith(MINUS) ? palette.negative : value.startsWith('+') ? palette.positive : palette.message)

const $pnlCell = (hideBalances: IStream<boolean>, value: bigint | undefined, cost: bigint | undefined, details: I$Node[]): I$Node => {
  const pnl = value === undefined || cost === undefined ? null : dustToZeroUsd(value - cost)
  const roi = pnl === null || cost === undefined || cost === 0n ? null : toBasisPoints(pnl, cost)
  return $column(style({ width: PNL_WIDTH, flexShrink: '0', alignItems: 'flex-end', gap: '2px' }))(
    $row(spacing.tiny, style({ alignItems: 'center' }))(
      ...(details.length === 0 ? [] : [$infoTooltip($column(spacing.tiny, style({ fontSize: text.sm, minWidth: '220px' }))(...details), palette.foreground)]),
      $node(style({ fontWeight: '600', fontFamily: 'var(--font-numbers)', whiteSpace: 'nowrap', color: pnl === null || pnl === 0n ? palette.foreground : pnl > 0n ? palette.positive : palette.negative }))(
        $text(maskBalance(pnl === null ? '-' : signedUsdLabel(pnl), hideBalances))
      )
    ),
    ...(roi === null ? [] : [$node(style({ fontSize: text.xs, color: palette.foreground, whiteSpace: 'nowrap' }))($text(`${signOf(roi)}${readablePercentage(roi < 0n ? -roi : roi)} ROI`))])
  )
}

export const $positionRow = (hideBalances: IStream<boolean>, row: IPositionRow): I$Node => {
  if (row.kind === 'perp') {
    const at = row.fieldLabelList.indexOf('Leverage')
    const notionalAt = row.fieldLabelList.indexOf('Notional')
    const details = row.fieldLabelList.flatMap((label, i) => (i === at || i === notionalAt ? [] : [$fieldLine(label, row.fieldValueList[i]!)]))
    const amount = row.unit === 'USD' ? `$${unitLabel(row.size, row.decimals)}` : `${unitLabel(row.size, row.decimals)} ${row.unit}`
    const side = /\b(long|short)\b/i.exec(row.label)
    const market = side === null ? row.label : row.label.replace(side[0], '').replace(/\s+/g, ' ').trim()
    const secondary = [side === null ? null : `${side[1]!.charAt(0).toUpperCase()}${side[1]!.slice(1).toLowerCase()}`, at === -1 ? null : row.fieldValueList[at]!]
      .filter((part): part is string => part !== null)
      .join(' ')
    return $row(spacing.default, style({ alignItems: 'center' }))(
      $row(spacing.small, style({ flex: 1, minWidth: '0', alignItems: 'center' }))(
        $tokenIcon(market.split('/')[0]!.trim()),
        $column(style({ flex: 1, minWidth: '0', gap: '2px' }))(
          $node(style({ fontWeight: '600', color: palette.message, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }))($text(market)),
          ...(secondary === '' ? [] : [$node(style({ fontSize: text.xs, color: palette.foreground, whiteSpace: 'nowrap' }))($text(secondary))])
        )
      ),
      $node(style({ width: SIZE_WIDTH, flexShrink: '0', whiteSpace: 'nowrap' }))(
        notionalAt === -1 || row.unit === 'USD'
          ? $node(style({ textAlign: 'right', color: palette.message }))($text(maskBalance(amount, hideBalances)))
          : $amountDisplay({ hideBalances, usd: just(row.fieldValueList[notionalAt]!), amount, align: 'flex-end' })
      ),
      $pnlCell(hideBalances, row.value, row.cost, details)
    )
  }
  const contract = row.contract
  const chainId = row.chainId === undefined ? null : (Number(row.chainId) as ChainId)
  const listed = chainId === null ? undefined : (CHAIN_TOKEN_MAP as Record<number, Record<string, string> | undefined>)[chainId]
  const token =
    (row.kind === 'cash' || row.kind === 'spot') && chainId !== null && contract !== undefined
      ? {
          chainId,
          address: contract,
          registered: listed !== undefined && Object.values(listed).some(known => isAddressEqual(known as typeof contract, contract))
        }
      : null
  if (row.kind === 'spot' && token !== null) {
    const pricedAt = row.fieldLabelList.indexOf('Priced by')
    return $row(spacing.default, style({ alignItems: 'center' }))(
      $node(style({ flex: 1, minWidth: '0' }))(
        $tokenProfile(
          token.chainId,
          token.address,
          28,
          true,
          $row(spacing.tiny, style({ alignItems: 'center' }))(
            $text('Spot'),
            $infoTooltip(
              $column(spacing.tiny, style({ fontSize: text.sm, minWidth: '220px' }))(
                ...row.fieldLabelList.flatMap((label, i) => (i === pricedAt ? [] : [$fieldLine(label, row.fieldValueList[i]!)])),
                ...(pricedAt === -1
                  ? []
                  : [$node(style({ fontSize: text.xs, color: palette.foreground, maxWidth: '240px', whiteSpace: 'normal' }))($text(`Priced by ${row.fieldValueList[pricedAt]}`))])
              ),
              palette.foreground
            )
          ),
          token.registered ? undefined : { symbol: row.unit, decimals: row.decimals }
        )
      ),
      $node(style({ width: SIZE_WIDTH, flexShrink: '0', whiteSpace: 'nowrap' }))(
        $amountDisplay({
          hideBalances,
          usd: just(row.value === undefined ? '-' : `$${readableUsd(row.value)}`),
          amount: unitLabel(row.size, row.decimals),
          align: 'flex-end'
        })
      ),
      $pnlCell(hideBalances, row.value, row.cost, [])
    )
  }
  const resolvedAt = row.kind === 'outcome' ? row.fieldLabelList.indexOf('Resolved') : -1
  const outcomes = row.kind === 'outcome' ? row.fieldLabelList.filter((_, i) => i !== resolvedAt) : []
  const secondary =
    row.kind === 'outcome'
      ? [...outcomes, ...(resolvedAt === -1 ? [] : ['Resolved'])].join(' · ')
      : row.fieldLabelList.map((label, i) => `${label} ${row.fieldValueList[i]}`).join(' · ')
  const details = row.kind === 'outcome' && (outcomes.length > 1 || resolvedAt !== -1) ? row.fieldLabelList.map((label, i) => $fieldLine(label, row.fieldValueList[i]!)) : []
  return $row(isDesktopScreen ? spacing.big : spacing.default, style({ alignItems: 'center' }))(
    $column(style({ flex: 1, minWidth: '0', gap: '2px' }))(
      token === null
        ? $Tooltip({
            $dropContainer: $tooltipDropContainer,
            $content: $node(style({ fontSize: text.sm }))($text(row.label)),
            $anchor: (row.url === undefined ? $node : $anchor(attr({ href: row.url, rel: 'noopener noreferrer' }), style({ display: 'block' })))(
              style({ fontWeight: '600', color: palette.message, minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
            )($text(row.label))
          })({})
        : token.registered
          ? $tokenProfile(token.chainId, token.address)
          : $tokenProfile(token.chainId, token.address, 28, true, null, { symbol: row.unit, decimals: row.decimals }),
      ...(secondary === '' && details.length === 0
        ? []
        : [
            $row(spacing.tiny, style({ alignItems: 'center', minWidth: '0', fontSize: text.xs, color: palette.foreground }))(
              ...(secondary === ''
                ? []
                : [
                    $Tooltip({
                      $dropContainer: $tooltipDropContainer,
                      $content: $node(style({ fontSize: text.sm }))($text(secondary)),
                      $anchor: $node(style({ minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }))($text(secondary))
                    })({})
                  ]),
              ...(details.length === 0 ? [] : [$infoTooltip($column(spacing.tiny, style({ fontSize: text.sm, minWidth: '220px' }))(...details), palette.foreground)])
            )
          ])
    ),
    ...(PNL_KINDS.has(row.kind) && row.cost !== undefined && row.value !== undefined ? [$pnlCell(hideBalances, row.value, row.cost, [])] : []),
    $amountDisplay({
      hideBalances,
      usd: just(row.value === undefined ? '-' : `$${readableUsd(row.value)}`),
      amount: token !== null ? unitLabel(row.size, row.decimals) : row.unit === 'USD' ? `$${unitLabel(row.size, row.decimals)}` : `${unitLabel(row.size, row.decimals)} ${row.unit}`,
      align: 'flex-end'
    })
  )
}

const $divider = $node(style({ borderTop: `1px solid ${SEPARATOR_COLOR}` }))()

export const SUB_INDENT = '12px'

export const $positionList = (hideBalances: IStream<boolean>, positions: readonly IPositionRow[]): I$Node[] => {
  if (positions.length === 0) return []
  const sorted = positions.filter(row => row.kind !== 'cash').sort((x, y) => KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind))
  if (sorted.length === 0) return []
  return [
    $column(style({ marginTop: '12px', paddingLeft: SUB_INDENT }))(
      ...(sorted.some(row => row.kind === 'perp' || (row.kind === 'spot' && row.chainId !== undefined && row.contract !== undefined))
        ? [
            $row(spacing.default, style({ fontSize: text.xs, color: palette.foreground, paddingBottom: '2px' }))(
              $node(style({ flex: 1 }))($text('Market')),
              $node(style({ width: SIZE_WIDTH, flexShrink: '0', textAlign: 'right' }))($text('Size')),
              $node(style({ width: PNL_WIDTH, flexShrink: '0', textAlign: 'right' }))($text('PnL'))
            )
          ]
        : []),
      ...sorted.flatMap((row, i) => [...(i === 0 ? [] : [$divider]), $node(style({ padding: '10px 0' }))($positionRow(hideBalances, row))])
    )
  ]
}

const usdLabel = (amount: bigint): string => `${signedDollar(amount < 0n ? MINUS : '')}${readableUsd(amount < 0n ? -amount : amount)}`

export const $venueRow = (
  hideBalances: IStream<boolean>,
  venueId: string,
  entry: IStream<IOpenPositions['venues'][number] | undefined>,
  failure: IStream<string | null>,
  $disconnect: I$Node | null,
  linkIssue: IStream<{ text: string; color: string } | null>,
  $status: readonly I$Node[]
): I$Node => {
  const figures = op(
    entry,
    map(current => {
      if (current === undefined) return null
      const costs = current.positions.flatMap(row => (row.cost === undefined ? [] : [row.cost]))
      const cost = costs.reduce((total, amount) => total + amount, 0n)
      const gains = current.positions.flatMap(row => (PNL_KINDS.has(row.kind) && row.value !== undefined && row.cost !== undefined ? [row.value - row.cost] : []))
      const pnl = gains.length === 0 ? null : dustToZeroUsd(gains.reduce((total, gain) => total + gain, 0n))
      return { value: current.value, costs, cost, pnl, roi: pnl === null || cost <= 0n ? null : toBasisPoints(pnl, cost), waiting: current.waiting }
    }),
    state()
  )
  return $row(spacing.small, style({ alignItems: 'center' }))(
    $Tooltip({
      $dropContainer: $tooltipDropContainer,
      $content: $column(spacing.small, style({ fontSize: text.sm, minWidth: '220px' }))(
        $row(spacing.default, style({ alignItems: 'center', justifyContent: 'space-between' }))($node($text('Open '), $venueLink(venueId)), ...($disconnect === null ? [] : [$disconnect])),
        switchLatest(map(issue => (issue === null ? empty : $node(style({ fontSize: text.xs, color: issue.color, maxWidth: '240px', whiteSpace: 'normal', lineHeight: '1.4' }))($text(issue.text))), linkIssue)),
        switchLatest(map(current => (current === undefined ? empty : $node(style({ fontSize: text.xs, color: palette.foreground }))($text(current.syncedAt === null ? 'Not read yet' : current.waiting ? `Refreshing after your last action; last read ${ago(current.syncedAt)}` : `Read ${ago(current.syncedAt)}`))), entry)),
        switchLatest(map(reason => (reason === null ? empty : $node(style({ fontSize: text.xs, color: palette.negative, maxWidth: '240px', whiteSpace: 'normal', lineHeight: '1.4' }))($text(`Not refreshed: ${reason}`))), failure)),
        switchLatest(
          map(
            f =>
              f === null || f.value === null
                ? empty
                : $column(spacing.small)(
                    $column(spacing.tiny)(
                      $detailLine('Value', maskBalance(usdLabel(f.value), hideBalances)),
                      $detailLine('Invested', maskBalance(f.costs.length === 0 ? '-' : usdLabel(f.cost), hideBalances)),
                      $detailLine('PnL', maskBalance(f.pnl === null ? '-' : signedUsdLabel(f.pnl), hideBalances)),
                      ...(f.roi === null ? [] : [$detailLine('ROI', `${signOf(f.roi)}${readablePercentage(f.roi < 0n ? -f.roi : f.roi)}`)])
                    ),
                    $node(style({ fontSize: text.xs, color: palette.foreground, maxWidth: '240px', whiteSpace: 'normal' }))(
                      $text('Holdings as the venue reports them; results already paid out show at fund level.')
                    )
                  ),
            figures
          )
        )
      ),
      $anchor: $node(style({ display: 'flex', cursor: 'help' }))(
        $badged(
          $venueIcon(venueId, AVATAR_SIZE),
          $disconnect === null
            ? $avatarBadge(switchLatest(map(reason => $icon({ $content: $infoMark, viewBox: '6 6 20 20', width: '10px', fill: reason === null ? palette.foreground : palette.negative, svgOps: style({ display: 'block' }) }), failure)))
            : $avatarBadge(style({ width: '22px', height: '22px' }))(
                switchLatest(
                  map(
                    params =>
                      $icon({
                        $content: $walletConnectLogo,
                        viewBox: '0 0 32 32',
                        width: '15px',
                        fill: params.reason !== null ? palette.negative : params.issue === null ? palette.positive : params.issue.color,
                        svgOps: style({ display: 'block' })
                      }),
                    combine({ issue: linkIssue, reason: failure })
                  )
                )
              )
        )
      )
    })({}),
    $column(style({ flex: 1, minWidth: '0', gap: '2px' }))(...$status),
    switchLatest(
      map(
        f =>
          f === null || f.value === null
            ? $amountDisplay({ hideBalances, usd: just('-'), amount: '', align: 'flex-end' })
            : $column(style({ alignItems: 'flex-end', gap: '2px', opacity: f.waiting ? '0.55' : '1' }))(
                  $node(style({ fontWeight: '600', fontFamily: 'var(--font-numbers)', whiteSpace: 'nowrap', color: palette.message }))($text(maskBalance(usdLabel(f.value), hideBalances))),
                  $node(style({ fontSize: text.xs, whiteSpace: 'nowrap', color: f.pnl === null || f.pnl === 0n ? palette.foreground : f.pnl > 0n ? palette.positive : palette.negative }))(
                    $text(maskBalance(f.pnl === null ? '-' : signedUsdLabel(f.pnl), hideBalances))
                  )
                ),
        figures
      )
    )
  )
}

export const $standingAllowance = (venue: IVenue, grant: IStandingAllowance, live: bigint | null, $revoke: I$Node | null): I$Node => {
  const amount = live === null ? grant.implied : live
  return $row(spacing.default, style({ alignItems: 'center', padding: '10px 0', marginLeft: SUB_INDENT, borderTop: `1px solid ${SEPARATOR_COLOR}` }))(
    $row(spacing.small, style({ alignItems: 'center' }))(
      $node(style({ fontWeight: '600', color: palette.message }))($text('Standing allowance')),
      $infoTooltip(
        $column(spacing.tiny, style({ maxWidth: '240px', lineHeight: '1.4', fontSize: text.sm }))(
          $node(style({ color: palette.indeterminate, fontWeight: 'bold' }))($text(`${grant.profile.symbol} can be spent without a fund signature`)),
          $contractIdentity({ address: grant.spender, chainId: grant.chainId, name: contractLabelOf(grant.chainId, grant.spender).name }),
          $text(
            `${venue.name} can move up to this amount through this approval. Revoking costs one relay fee; positions stay open.`
          ),
          ...(live !== null && live < grant.implied
            ? [
                $node(style({ color: venue === gmxVenue ? palette.indeterminate : palette.negative }))(
                  $text(
                    `${venue === gmxVenue ? `Pulled through ${venue.name} outside the fund's calls` : "Pulled outside the fund's calls"}: ${readableTokenAmount(grant.profile.decimals, grant.implied - live)} ${grant.profile.symbol}`
                  )
                )
              ]
            : [])
        ),
        palette.indeterminate
      )
    ),
    ...($revoke === null ? [] : [$revoke]),
    $node(style({ flex: 1 }))(),
    $column(style({ alignItems: 'flex-end', gap: '2px' }))(
      $node(style({ whiteSpace: 'nowrap', fontWeight: '600', color: palette.message }))(
        $text(amount > SAMPLEABLE_ALLOWANCE / 2n ? 'unlimited' : readableTokenAmount(grant.profile.decimals, amount))
      ),
      $node(style({ fontSize: text.xs, color: palette.foreground }))($tokenProfile(grant.chainId, grant.token, 16, true, null, grant.profile))
    )
  )
}

const SYNC_GRACE_SEC = 30
export const OWNER_SYNC_SCHEDULE_SEC = (OWNER_SYNC_MS + OWNER_SYNC_CHECK_MS) / 1000 + SYNC_GRACE_SEC
export const TICK_SYNC_SCHEDULE_SEC = VENUE_READ_STALE_SEC + 2 * IntervalTime.MIN5
const METERED_SCHEDULE_SEC = IntervalTime.MIN5 + SYNC_GRACE_SEC

export const $syncTip = (about: string, open: IOpenPositions, scheduleSec: number): I$Node => {
  const $tip = (color: string, $line: I$Slottable): I$Node =>
    $sectionTip($column(spacing.small)($text(about), $node(style({ color: palette.foreground }))($line)), color)
  if (open.venues.length === 0) return $tip(colorShade(palette.foreground, 60), $text('No venue outflows or open positions to sync'))
  const synced = open.venues.flatMap(entry =>
    entry.syncedAt === null ? [] : [{ syncedAt: entry.syncedAt, scheduleSec: entry.venue === hyperliquidVenue ? METERED_SCHEDULE_SEC : scheduleSec }]
  )
  if (synced.length === 0) return $tip(palette.indeterminate, $text('Not synced yet'))
  const behind = op(
    start(null, periodic(1000)),
    map(() => {
      const now = getUnixTimestamp()
      return synced
        .map(entry => ({ seconds: now - entry.syncedAt, scheduleSec: entry.scheduleSec }))
        .reduce((worst, entry) => (entry.seconds / entry.scheduleSec > worst.seconds / worst.scheduleSec ? entry : worst))
    }),
    state()
  )
  return switchLatest(
    op(
      behind,
      map(worst => (worst.seconds <= worst.scheduleSec ? palette.positive : worst.seconds <= 2 * worst.scheduleSec ? palette.indeterminate : palette.negative)),
      skipRepeats,
      map(color =>
        $tip(
          color,
          $node(style({ display: 'inline' }))(
            $text('Synced '),
            $node(style({ display: 'inline', color: palette.message }))($text(map(worst => shortDuration(worst.seconds), behind))),
            $text(' ago')
          )
        )
      )
    )
  )
}

const $rowSeparator = $node(style({ height: '1px', margin: '0 10px', backgroundColor: colorShade(palette.foreground, 15) }))()

export const $hoverList = (rows: I$Node[]): I$Node =>
  $column(style({ margin: '0 -10px' }))(
    ...rows.flatMap((row, i) => {
      const $item = $row(style({ padding: '8px 10px', borderRadius: '6px', alignItems: 'center' }), stylePseudo(':hover', { backgroundColor: colorShade(palette.foreground, 8) }))(row)
      return i === 0 ? [$item] : [$rowSeparator, $item]
    })
  )

export const $openPositionsView = (hideBalances: IStream<boolean>, open: IOpenPositions, standing: readonly IStandingAllowance[], $empty: I$Node): I$Node => {
  const shown = VENUES.flatMap(venue => {
    const entry = open.venues.find(e => e.venue === venue)
    const grants = standing.filter(grant => grant.venueId === venue.venueId)
    const failure = open.failed.find(f => f.venue === venue.venueId)
    const held = entry !== undefined && (entry.syncedAt === null || failure !== undefined || entry.positions.some(row => row.size !== 0n))
    return held || grants.length > 0 ? [{ venue, entry, grants, failure }] : []
  })
  const unshown = open.failed.filter(f => !open.venues.some(entry => entry.venue.venueId === f.venue))
  if (shown.length === 0 && unshown.length === 0 && open.selfCustody.length === 0) return $empty
  return $column(spacing.big)(
    ...unshown.map(f =>
      $node(style({ fontSize: text.xs, color: palette.negative }))($text(`${f.venue === ACCOUNT_VENUE ? 'Fund holdings' : f.venue} not refreshed: ${f.reason}`))
    ),
    ...(open.selfCustody.length === 0
      ? []
      : [
          $column(spacing.small)(
            $node(style({ fontSize: text.sm, fontWeight: '600', color: palette.message }))($text('Valuable ERC-20')),
            $hoverList(
              open.selfCustody.map(row =>
                $row(spacing.small, style({ alignItems: 'center', flex: 1 }))(
                  $tokenProfile(Number(row.chainId) as ChainId, row.contract, 28, true, null, { symbol: row.unit, decimals: row.decimals }),
                  $node(style({ flex: 1 }))(),
                  $amountDisplay({
                    hideBalances,
                    usd: just(row.value === undefined ? '-' : formatUsdNumber(Number(formatUnits(row.value, USD_DECIMALS)))),
                    amount: readableTokenAmount(row.decimals, row.size),
                    align: 'flex-end'
                  })
                )
              )
            )
          )
        ]),
    ...shown.flatMap((group, i) => [
      ...(i === 0 && open.selfCustody.length === 0 ? [] : [$divider]),
      $node(
        $venueRow(hideBalances, group.venue.venueId, just(group.entry), just(group.failure === undefined ? null : group.failure.reason), null, just(null), [
          $node(style({ fontSize: text.sm, fontWeight: '600', color: palette.message }))($text(group.venue.name))
        ]),
        ...(group.entry === undefined ? [] : $positionList(hideBalances, group.entry.positions)),
        ...group.grants.map(grant => $standingAllowance(group.venue, grant, null, null))
      )
    ])
  )
}

export const $OpenPositions = ({ hideBalances, positions, standing, $empty }: I$OpenPositions): I$Node =>
  $intermediatePromise({
    $loader: $intermediateRow($intermediateProfile(24)),
    $display: map(async q => $openPositionsView(hideBalances, await q.positions, await q.standing, $empty), combine({ positions, standing }))
  })
