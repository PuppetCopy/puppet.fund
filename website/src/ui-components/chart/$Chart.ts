import { disposeWith, empty, filter, type IOps, type IStream, merge, switchMap, tap } from 'aelea/stream'
import { fromCallback, type IBehavior, multicast } from 'aelea/stream-extended'
import { $wrapNativeElement, component, type INode, style } from 'aelea/ui'
import { observer } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import {
  type ChartOptions,
  CrosshairMode,
  createSeriesMarkers,
  type DeepPartial,
  type IChartApi,
  type IRange,
  type ISeriesApi,
  LineStyle,
  type LogicalRange,
  type MouseEventParams,
  type SeriesDataItemTypeMap,
  type SeriesMarker,
  type Time
} from 'lightweight-charts'
export type ISeriesTime = Time
export type IMarker = SeriesMarker<ISeriesTime> & {}
export type ISeriesType = SeriesDataItemTypeMap<ISeriesTime>

export interface I$Chart<TSeriesType extends keyof ISeriesType> {
  chartApi: IChartApi
  series: ISeriesApi<TSeriesType>
  markers?: IStream<IMarker[]>
}

export const $Chart = <TSeriesType extends keyof ISeriesType>({ chartApi, series, markers }: I$Chart<TSeriesType>) =>
  component(([containerDimension, sampleContainerDimension]: IBehavior<INode, ResizeObserverEntry[]>) => {
    const containerEl = chartApi.chartElement()

    const crosshairMove = fromCallback<MouseEventParams>(cb => {
      chartApi.subscribeCrosshairMove(cb)
      return disposeWith(handler => chartApi.unsubscribeCrosshairMove(handler), cb)
    })

    const click = multicast(
      fromCallback<MouseEventParams>(cb => {
        chartApi.subscribeClick(cb)
        return disposeWith(handler => chartApi.unsubscribeClick(handler), cb)
      })
    )

    const timeScale = chartApi.timeScale()

    const visibleLogicalRangeChange: IStream<LogicalRange | null> = multicast(
      fromCallback(cb => {
        timeScale.subscribeVisibleLogicalRangeChange(cb)
        return disposeWith(handler => timeScale.unsubscribeVisibleLogicalRangeChange(handler), cb)
      })
    )

    const visibleTimeRangeChange = multicast(
      fromCallback<IRange<Time> | null>(cb => {
        timeScale.subscribeVisibleTimeRangeChange(cb)
        return disposeWith(handler => timeScale.unsubscribeVisibleTimeRangeChange(handler), cb)
      })
    )

    const ignoreAll = filter(() => false)
    const seriesMarkers = createSeriesMarkers(series)

    return [
      $wrapNativeElement(containerEl)(
        style({ position: 'relative', minHeight: '30px', flex: 1, width: '100%' }),
        sampleContainerDimension(observer.resize() as IOps<INode<unknown>, ResizeObserverEntry[]>)
      )(
        ignoreAll(
          merge(
            fromCallback<null, [null]>(() => () => {
              chartApi.remove()
            }),
            switchMap(([containerObserver]) => {
              chartApi.resize(containerObserver.contentRect.width, containerObserver.contentRect.height)
              timeScale.fitContent()
              return empty
            }, containerDimension),
            tap(next => {
              seriesMarkers.setMarkers(next)
            }, markers || empty)
          )
        )
      ),

      {
        crosshairMove,
        click,
        visibleLogicalRangeChange,
        visibleTimeRangeChange,
        containerDimension
      }
    ]
  })

export const defaultChartConfig: DeepPartial<ChartOptions> = {
  rightPriceScale: {
    visible: false
  },
  grid: {
    horzLines: {
      visible: false
    },
    vertLines: {
      visible: false
    }
  },
  overlayPriceScales: {
    borderVisible: false
  },
  layout: {
    attributionLogo: false,
    textColor: palette.message,
    background: {
      color: 'transparent'
    },
    fontFamily: '-apple-system,BlinkMacSystemFont,Trebuchet MS,Roboto,Ubuntu,sans-serif',
    fontSize: 12
  },
  timeScale: {
    rightOffset: 0,
    secondsVisible: true,
    timeVisible: true,
    lockVisibleTimeRangeOnResize: true
  },
  crosshair: {
    mode: CrosshairMode.Magnet,
    horzLine: {
      labelBackgroundColor: palette.background,
      color: palette.indeterminate,
      width: 1,
      style: LineStyle.Dotted
    },
    vertLine: {
      color: palette.indeterminate,
      labelBackgroundColor: palette.background,
      width: 1,
      style: LineStyle.Dotted
    }
  }
}
