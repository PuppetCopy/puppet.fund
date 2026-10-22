import { HUB_CANONICAL_TOKEN, HUB_CHAIN_ID } from '@puppet/contracts/const'
import { fundSymbolOf, gridOf } from '@puppet/sdk/account'
import { type ChainId, PRECISION } from '@puppet/sdk/const'
import { getDuration, getTokenDescription, getUnixTimestamp, readableDate, readablePercentage, readableTokenAmountLabel } from '@puppet/sdk/core'
import type { IFundRow, IMandateRow } from '@puppet/sdk/schema'
import { robotCellsOf } from '@puppet/sdk/ui-components'
import { type IStream, map } from 'aelea/stream'
import { $node, $text, type I$Node, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import type { Address } from 'viem'
import { $amountDisplay, $detailLine, $icon, $infoTooltip, $intermediateText, $puppet, maskBalance, SEPARATOR_COLOR, text } from '@/ui-components'
import { ethUsd } from '../common/$common.js'
import { type IHoldingView, type IMandateWorth, mandatePerformanceOf } from '../io/datastore/own.js'
import { SUB_INDENT } from '../pages/$OpenPositions.js'
import { ago } from '../pages/common.js'
import { $fundProfile } from './$AccountProfile.js'
import { $pnlSpark, $pnlValue, $sparkCell, pnlLabelOf, roiLabelOf } from './$PerformanceMetric.js'

const approx = (text: string): string => (text === '-' ? text : `≈ ${text}`)
const percent = (value: bigint): string => readablePercentage(value).replace(/\.0+%$/, '%')

const $meta = (label: string): I$Node => $node(style({ color: palette.foreground, fontSize: text.sm }))($text(label))

export const mandateTermsOf = (mandate: Pick<IMandateRow, 'allocationRate' | 'skin' | 'exitCap' | 'cooldownPeriod' | 'expiry'>) => {
  return {
    perRound: percent(mandate.allocationRate),
    skin: mandate.skin === 0n ? 'uncapped' : `${Number((Number(mandate.skin) / Number(PRECISION.basisPoints)).toPrecision(2))}x`,
    exitCap: percent(mandate.exitCap),
    cooldown: mandate.cooldownPeriod > 0n ? getDuration(Number(mandate.cooldownPeriod)) : 'None',
    until: mandate.expiry
  }
}

export const $mandateTerms = (terms: ReturnType<typeof mandateTermsOf>): I$Node => {
  const $label = (label: string): I$Node => $node(style({ color: palette.foreground, fontSize: text.xs }))($text(label))
  const $pair = (value: string, label: string, color: string): I$Node =>
    $row(spacing.tiny, style({ alignItems: 'baseline', whiteSpace: 'nowrap' }))($node(style({ color }))($text(value)), $label(label))
  return $row(spacing.small, style({ alignItems: 'baseline', flexWrap: 'wrap', rowGap: '4px' }))(
    $pair(terms.perRound, 'Rate', palette.message),
    $label('·'),
    $pair(terms.skin, 'skin', palette.message),
    $label('·'),
    $pair(terms.exitCap, 'exit cap', palette.message),
    $label('·'),
    terms.cooldown === 'None' ? $label('no cooldown') : $pair(terms.cooldown, 'cooldown', palette.message),
    $label('·'),
    terms.until === 0n
      ? $node(style({ color: palette.negative }))($text('Expired'))
      : $pair(readableDate(Number(terms.until)), 'expiry', terms.until <= BigInt(getUnixTimestamp()) ? palette.negative : palette.message)
  )
}

export const $mandatePerformance = (hideBalances: IStream<boolean>, perf: IMandateWorth | null): I$Node => {
  const performance = mandatePerformanceOf(perf === null ? [] : [perf])
  const [first] = performance.pnlPoints
  const pnl = map(label => label.then(text => `${text} · ${roiLabelOf(performance.roi)} ROI`), maskBalance(pnlLabelOf(performance.pnl), hideBalances))
  return $row(spacing.small, style({ minWidth: '240px', alignItems: 'center', justifyContent: 'flex-end' }))(
    $node(style({ display: 'flex', width: '200px', height: '44px' }))(
      $sparkCell(
        $pnlSpark(first === undefined ? getUnixTimestamp() - 86_400 : first.time, performance, []),
        $pnlValue(maskBalance(pnlLabelOf(performance.pnl), hideBalances), performance)
      )
    ),
    $column(style({ alignItems: 'flex-end', gap: '2px', minWidth: '72px' }))(
      $row(spacing.tiny, style({ alignItems: 'center' }))(
        $node(style({ fontWeight: '600', color: palette.message }))($intermediateText(maskBalance(ethUsd(perf === null ? 0n : perf.worth - perf.paid), hideBalances))),
        ...(perf === null
          ? []
          : [
        $infoTooltip(
          $column(spacing.tiny, style({ minWidth: '220px', fontSize: text.sm }))(
            $detailLine('Max invested', maskBalance(ethUsd(perf.invested), hideBalances)),
            $detailLine('PnL', pnl),
            ...(perf.exit === null ? [] : [$detailLine('Queued', map(usd => usd.then(approx), maskBalance(ethUsd(perf.exit.value - perf.exit.fee), hideBalances)))]),
            $node(style({ fontSize: text.xs, color: palette.foreground, paddingTop: '4px' }))($text("Values at today's ETH price"))
          )
        )
            ])
      )
    )
  )
}

export const $mandatePosition = (
  hideBalances: IStream<boolean>,
  master: Address,
  mandate: IMandateRow | undefined,
  holding: IHoldingView | undefined,
  fundRow: IFundRow | undefined,
  perf: IMandateWorth | null | undefined,
  $manage: readonly I$Node[],
  $actions: readonly I$Node[]
): I$Node => {
  const terms = mandate === undefined ? null : mandateTermsOf(mandate)
  return $column(spacing.small)(
    $row(spacing.default, style({ alignItems: 'center', flexWrap: 'wrap' }))(
      $row(spacing.small, style({ alignItems: 'center', flex: 1, minWidth: '160px' }))(
        $fundProfile(master, fundRow === undefined ? robotCellsOf(master) : gridOf(fundRow), fundRow === undefined ? null : fundSymbolOf(fundRow)),
        ...$actions
      ),
      (perf === undefined || perf === null) && holding !== undefined && holding.standing.kind === 'behind'
        ? $node(style({ minWidth: '240px', display: 'flex', justifyContent: 'flex-end' }))($meta('syncing with the chronicle'))
        : $mandatePerformance(hideBalances, perf === undefined ? null : perf)
    ),
    $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap', marginLeft: SUB_INDENT, fontSize: text.sm }))(
      terms !== null ? $mandateTerms(terms) : $meta('Not allocating'),
      ...$manage
    )
  )
}

export const $exitQueueRow = (hideBalances: IStream<boolean>, fundRow: IFundRow, exit: NonNullable<IMandateWorth['exit']>): I$Node =>
  $row(spacing.default, style({ alignItems: 'center', marginTop: '10px', paddingTop: '10px', marginLeft: SUB_INDENT, borderTop: `1px solid ${SEPARATOR_COLOR}` }))(
    $row(spacing.small, style({ flex: 1, minWidth: '0', alignItems: 'center' }))(
      $icon({ $content: $puppet, width: '24px', viewBox: '0 0 32 32', fill: palette.foreground }),
      $column(style({ gap: '2px', minWidth: '0' }))(
        $node(style({ fontWeight: '600', color: palette.message }))($text('Exit queue')),
        $row(spacing.tiny, style({ alignItems: 'center', fontSize: text.xs, color: palette.foreground }))(
          $node($text(`queued ${ago(exit.since)}`)),
          $infoTooltip(
            $column(spacing.tiny, style({ minWidth: '220px', fontSize: text.sm }))(
              $detailLine('Queued now', maskBalance(ethUsd(exit.value), hideBalances)),
              $detailLine('Performance fee', map(usd => usd.then(text => `${percent(fundRow.performanceFee)} of the gain, ${text}`), maskBalance(ethUsd(exit.fee), hideBalances))),
              $detailLine('Payout', map(usd => usd.then(approx), maskBalance(ethUsd(exit.value - exit.fee), hideBalances))),
              $detailLine('Queued since', readableDate(exit.since)),
              $node(style({ fontSize: text.xs, color: palette.foreground, paddingTop: '4px' }))(
                $text("The next redemption pays the queue at one price. Until then it moves with the fund's value.")
              )
            )
          )
        )
      )
    ),
    $node(style({ width: '110px', flexShrink: '0' }))(
      $amountDisplay({
        hideBalances,
        usd: ethUsd(exit.value),
        amount: readableTokenAmountLabel(getTokenDescription(HUB_CHAIN_ID as ChainId, HUB_CANONICAL_TOKEN.WETH), exit.value),
        align: 'flex-end'
      })
    ),
    $node(style({ minWidth: '96px', display: 'flex', justifyContent: 'flex-end' }))(
      $amountDisplay({
        hideBalances,
        usd: map(usd => usd.then(approx), ethUsd(exit.value - exit.fee)),
        amount: exit.fee === 0n ? 'no fee' : map(usd => usd.then(text => `after ${text} performance fee`), ethUsd(exit.fee)),
        align: 'flex-end'
      })
    )
  )
