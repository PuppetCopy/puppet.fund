import { readableLeverage, readableUsd } from '@puppet/sdk/core'
import { combine, type IStream, map } from 'aelea/stream'
import { multicast } from 'aelea/stream-extended'
import { $node, $text, component, style } from 'aelea/ui'
import { $column, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import type { Address } from 'viem/accounts'
import { intermediateText } from '@/ui-components'
import { $heading2 } from '../../common/$text.js'
import type { IMasterMetricSummary, IPosition } from '../../pages/types.js'
import { $profileDisplay } from '../$AccountProfile.js'

export interface I$PuppetSummary {
  positionListQuery: IStream<Promise<IPosition[]>>
  account: Address
  puppet?: Address
}

// Stubbed metrics until the schema exposes feeCollected + matchedPuppetList again.
// Shape preserved so the file-fill swap is a one-line change in the inner map.
export const $PuppetSummary = (config: I$PuppetSummary) =>
  component(() => {
    const { account, positionListQuery, puppet } = config

    const metricsQuery = multicast(
      map(async params => {
        await params.positionListQuery
        return {
          account: puppet || account,
          realisedPnl: 0n,
          allocatedVolume: 0n,
          lossCount: 0,
          winCount: 0,
          pnlTimeline: [],
          matchedPuppetList: []
        } as IMasterMetricSummary
      }, combine({ positionListQuery }))
    )

    return [
      $column(
        spacing.default,
        style({ minHeight: '90px' })
      )(
        $node(
          style({
            display: 'flex',
            flexDirection: isDesktopScreen ? 'row' : 'column',
            gap: isDesktopScreen ? '56px' : '26px',
            zIndex: 10,
            placeContent: 'center',
            alignItems: 'center',
            padding: '0 8px'
          })
        )(
          $row(
            $profileDisplay({
              address: account,
              profileSize: isDesktopScreen ? 90 : 90
            })
          ),
          $row(spacing.big, style({ alignItems: 'flex-end' }))(
            $metricRow(
              $heading2(
                $text(
                  intermediateText(
                    map(async summaryQuery => {
                      const summary = await summaryQuery
                      return `${summary.winCount} / ${summary.lossCount}`
                    }, metricsQuery)
                  )
                )
              ),
              $metricLabel($text('Win / Loss'))
            ),

            $metricRow(
              $heading2(
                $text(
                  intermediateText(
                    map(async summaryQuery => {
                      await summaryQuery
                      return readableUsd(0n)
                    }, metricsQuery)
                  )
                )
              ),
              $metricLabel($text('Avg Collateral'))
            ),
            $metricRow(
              $heading2(
                $text(
                  intermediateText(
                    map(async summaryQuery => {
                      await summaryQuery
                      return readableLeverage(0n, 1n)
                    }, metricsQuery)
                  )
                )
              ),
              $metricLabel($text('Avg Leverage'))
            )
          )
        )
      ),
      {}
    ]
  })

export const $metricRow = $column(spacing.tiny, style({ placeContent: 'center', alignItems: 'center' }))
export const $metricLabel = $row(
  style({
    color: palette.foreground,
    letterSpacing: '1px',
    fontSize: isDesktopScreen ? '.8rem' : '.8rem'
  })
)
export const $metricValue = $row(style({ fontWeight: 900, letterSpacing: '1px' }))
