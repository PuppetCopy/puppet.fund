import { style } from 'aelea/ui'
import { $separator } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import type { Address } from 'viem'
import type { IFundLatestMetric } from '../io/indexer/query.js'

export const $separator2 = style(
  { backgroundColor: colorShade(palette.foreground, 40), alignSelf: 'stretch', display: 'block' },
  $separator
)

export function accountSettledPositionListSummary(account: Address, metricList: IFundLatestMetric[]) {
  const seed = {
    account,
    realisedPnl: 0n,
    allocatedVolume: 0n,
    lossCount: 0,
    winCount: 0,
    pnlTimeline: [] as { time: number; value: bigint; fund: Address }[],
    matchedPuppetList: [] as Address[]
  }

  const summary = metricList.reduce((seed, next) => {
    seed.realisedPnl += next.realisedPnl
    seed.allocatedVolume += next.allocated

    next.pnlList.forEach((pnl: bigint, idx: number) => {
      seed.lossCount += pnl < 0n ? 1 : 0
      seed.winCount += pnl > 0n ? 1 : 0
      seed.pnlTimeline.push({ time: next.pnlTimestampList[idx], value: pnl, fund: next.fund })
    })

    return seed
  }, seed)

  summary.pnlTimeline = summary.pnlTimeline.sort((a, b) => a.time - b.time)

  return summary
}

export type IMasterMetricSummary = ReturnType<typeof accountSettledPositionListSummary>
