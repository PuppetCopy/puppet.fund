import { readableUnitAmount } from '@puppet/sdk/core'
import type { IStream } from 'aelea/stream'
import { palette } from 'aelea/ui-components-theme'
import {
  type AutoscaleInfo,
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

const spanAroundBaseline =
  (baseline: number, floor: number) =>
  (orig: () => AutoscaleInfo | null): AutoscaleInfo | null => {
    const base = orig()
    if (base === null || base.priceRange === null) return base
    return {
      priceRange: {
        minValue: Math.min(base.priceRange.minValue, baseline - floor),
        maxValue: Math.max(base.priceRange.maxValue, baseline + floor)
      },
      margins: base.margins
    }
  }

const themeColor = (token: string): string => {
  const name = token.replace(/^var\(\s*/, '').replace(/\s*\)$/, '')
  const resolved = getComputedStyle(document.body).getPropertyValue(name).trim()
  if (resolved === '') throw new Error(`chart palette token ${token} resolves to nothing on document.body`)
  return resolved
}

const withAlpha = (hex: string, alpha: number): string => {
  const h = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) {
    throw new Error(`chart colour ${hex} must be 6-digit hex to carry an alpha into a canvas gradient`)
  }
  const r = Number.parseInt(h.slice(0, 2), 16)
  const g = Number.parseInt(h.slice(2, 4), 16)
  const b = Number.parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export interface I$Baseline {
  baselineOptions?: BaselineSeriesPartialOptions
  data: ISeriesType['Baseline'][]
  scaleFloor?: number

  chartConfig?: DeepPartial<ChartOptions>
  markers?: IStream<IMarker[]>
}

export const $Baseline = ({ data, baselineOptions, chartConfig, markers, scaleFloor }: I$Baseline) => {
  const plotted = data.flatMap(point => ('value' in point && point.value !== undefined ? [point.value] : []))
  const opening = plotted[0] ?? 0
  const flat = plotted.every(value => value === opening)
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
  const up = flat ? themeColor(palette.foreground) : themeColor(palette.positive)
  const down = flat ? themeColor(palette.foreground) : themeColor(palette.negative)
  const series = chartApi.addSeries(BaselineSeries, {
    priceFormat: {
      type: 'custom',
      formatter: (priceValue: BarPrice) => readableUnitAmount(priceValue.valueOf())
    },
    lineStyle: LineStyle.Solid,
    lineType: LineType.Simple,
    lineWidth: 2,
    relativeGradient: !flat,
    topLineColor: up,
    bottomLineColor: down,
    topFillColor1: withAlpha(up, 0.3),
    topFillColor2: withAlpha(up, 0.02),
    bottomFillColor1: withAlpha(down, 0.02),
    bottomFillColor2: withAlpha(down, 0.3),
    baseValue: {
      type: 'price',
      price: opening
    },
    ...(scaleFloor !== undefined && scaleFloor > 0
      ? { autoscaleInfoProvider: spanAroundBaseline(opening, scaleFloor) }
      : {}),
    priceLineVisible: false,
    ...baselineOptions
  })

  series.setData(data)

  return $Chart({
    chartApi,
    series,
    markers
  })
}
