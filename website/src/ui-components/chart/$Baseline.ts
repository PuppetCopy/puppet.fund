import { readableUnitAmount } from '@puppet/sdk/core'
import type { IStream } from 'aelea/stream'
import { palette } from 'aelea/ui-components-theme'
import {
  type BarPrice,
  BaselineSeries,
  type BaselineSeriesPartialOptions,
  type ChartOptions,
  createChart,
  type DeepPartial,
  LineStyle,
  LineType
} from 'lightweight-charts'
import { $Chart, defaultChartConfig, type IMarker, type ISeriesType } from './$Chart.js'

// lightweight-charts paints to a canvas that can't resolve CSS custom properties,
// so a raw `var(--x)` palette token renders as a dull fallback. Resolve to a concrete
// color off the themed <body> before handing it to the series.
const themeColor = (token: string): string => {
  const name = token.replace(/^var\(\s*/, '').replace(/\s*\)$/, '')
  return getComputedStyle(document.body).getPropertyValue(name).trim() || token
}

const withAlpha = (hex: string, alpha: number): string => {
  const h = hex.replace('#', '')
  if (h.length < 6) return hex
  const r = Number.parseInt(h.slice(0, 2), 16)
  const g = Number.parseInt(h.slice(2, 4), 16)
  const b = Number.parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export interface I$Baseline {
  baselineOptions?: BaselineSeriesPartialOptions
  data: ISeriesType['Baseline'][]

  chartConfig?: DeepPartial<ChartOptions>
  markers?: IStream<IMarker[]>
}

export const $Baseline = ({ data, baselineOptions, chartConfig, markers }: I$Baseline) => {
  const chartElement = document.createElement('chart')
  const chartApi = createChart(chartElement, {
    ...defaultChartConfig,
    layout: {
      attributionLogo: false,
      background: {
        color: 'transparent'
      },
      textColor: themeColor(palette.foreground),
      fontSize: 10
    },
    leftPriceScale: {
      ticksVisible: true,
      scaleMargins: {
        top: 0.1,
        bottom: 0.1
      }
    },
    handleScale: false,
    handleScroll: false,
    timeScale: {
      secondsVisible: false,
      timeVisible: true,
      shiftVisibleRangeOnNewBar: true,
      rightBarStaysOnScroll: true,
      fixRightEdge: true,
      fixLeftEdge: true,
      borderVisible: false,
      rightOffset: 0
    },
    ...chartConfig
  })
  const positive = themeColor(palette.positive)
  const negative = themeColor(palette.negative)
  const series = chartApi.addSeries(BaselineSeries, {
    priceFormat: {
      type: 'custom',
      formatter: (priceValue: BarPrice) => readableUnitAmount(priceValue.valueOf())
    },
    baseLineStyle: LineStyle.Dashed,
    lineStyle: LineStyle.Solid,
    lineType: LineType.Curved,
    lineWidth: 2,
    topLineColor: positive,
    bottomLineColor: negative,
    topFillColor1: withAlpha(positive, 0.3),
    topFillColor2: withAlpha(positive, 0.02),
    bottomFillColor1: withAlpha(negative, 0.02),
    bottomFillColor2: withAlpha(negative, 0.3),
    baseValue: {
      type: 'price',
      price: 0
    },
    baseLineWidth: 1,
    // baseLineColor: 'yellow',
    // priceLineColor: 'yellow',
    baseLineVisible: true,
    // lastValueVisible: false,
    priceLineVisible: false,
    ...baselineOptions
  })

  // setTimeout(() => {
  series.setData(data)
  // }, 100)

  return $Chart({
    chartApi,
    series,
    markers
  })
}
