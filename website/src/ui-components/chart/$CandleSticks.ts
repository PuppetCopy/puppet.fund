import type { IStream } from 'aelea/stream'
import { colorShade, palette } from 'aelea/ui-components-theme'
import {
  CandlestickSeries,
  type CandlestickSeriesOptions,
  type ChartOptions,
  CrosshairMode,
  createChart,
  type DeepPartial,
  LineStyle
} from 'lightweight-charts'
import { $Chart, defaultChartConfig, type IMarker, type ISeriesType } from './$Chart.js'

export interface I$CandleSticks {
  data: ISeriesType['Candlestick'][]
  candlestickConfig?: CandlestickSeriesOptions

  chartConfig?: DeepPartial<ChartOptions>
  markers?: IStream<IMarker[]>
}

export const $CandleSticks = ({ data, candlestickConfig, chartConfig, markers }: I$CandleSticks) => {
  const chartElement = document.createElement('chart')
  const chartApi = createChart(chartElement, {
    ...defaultChartConfig,
    overlayPriceScales: {
      borderColor: palette.indeterminate,
      borderVisible: false
    },
    leftPriceScale: {
      visible: false
    },
    rightPriceScale: {
      borderColor: 'yellow',
      autoScale: true,
      visible: false,
      scaleMargins: {
        top: 0.4,
        bottom: 0
      }
    },
    timeScale: {
      fixLeftEdge: true,
      fixRightEdge: true,
      rightOffset: 0,
      rightBarStaysOnScroll: true,
      secondsVisible: true,
      timeVisible: true
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      horzLine: {
        visible: false,
        labelVisible: false,
        labelBackgroundColor: palette.foreground,
        color: colorShade(palette.foreground, 20),
        width: 1,
        style: LineStyle.Solid
      },
      vertLine: {
        // visible: false,
        // labelVisible: false,
        labelBackgroundColor: palette.indeterminate,
        color: colorShade(palette.indeterminate, 20),
        width: 1,
        style: LineStyle.Solid
      }
    },
    ...chartConfig
  })
  const series = chartApi.addSeries(CandlestickSeries, {
    ...candlestickConfig
  })

  series.setData(data)

  return $Chart({
    chartApi,
    series,
    markers
  })
}
