import { constant, empty, type IOps, type IStream, just, map, switchLatest, switchMap } from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import {
  $node,
  $svg,
  $text,
  attr,
  component,
  type I$Node,
  type I$Slottable,
  type INode,
  type INodeCompose,
  nodeEvent,
  style
} from 'aelea/ui'
import {
  $column,
  $defaultVScrollContainer,
  $icon,
  $QuantumScroll,
  $row,
  type I$QuantumScroll,
  type IPageRequest,
  isDesktopScreen,
  spacing
} from 'aelea/ui-components'
import { colorShade, palette, text } from 'aelea/ui-components-theme'
export interface TablePageResponse<T> extends IPageRequest {
  page: T[]
}

export interface TableOption<T> {
  columns: TableColumn<T>[]
  dataSource: IStream<Promise<TablePageResponse<T> | T[]>> | T[]

  $between?: I$Node
  scrollConfig?: Omit<I$QuantumScroll, 'dataSource'>

  $rowCallback?: IOps<T, INodeCompose>

  $container?: INodeCompose
  $rowContainer?: INodeCompose
  $headerRowContainer?: INodeCompose

  $cell?: INodeCompose
  $bodyCell?: INodeCompose
  $headerCell?: INodeCompose

  sortBy?: ISortBy<T>
  $sortArrowDown?: I$Node
}

export interface TableColumn<T> {
  $head: I$Slottable
  $bodyCallback: IOps<T, I$Node>
  sortBy?: string

  gridTemplate?: string

  $bodyCellContainer?: INodeCompose
  $headerCellContainer?: INodeCompose
}

export interface ISortBy<T = any, K extends keyof T = keyof T> {
  direction: 'asc' | 'desc'
  selector: K
}

const $caretDown = $svg('path')(
  attr({
    d: 'M4.616.296c.71.32 1.326.844 2.038 1.163L13.48 4.52a6.105 6.105 0 005.005 0l6.825-3.061c.71-.32 1.328-.84 2.038-1.162l.125-.053A3.308 3.308 0 0128.715 0a3.19 3.19 0 012.296.976c.66.652.989 1.427.989 2.333 0 .906-.33 1.681-.986 2.333L18.498 18.344a3.467 3.467 0 01-1.14.765c-.444.188-.891.291-1.345.314a3.456 3.456 0 01-1.31-.177 2.263 2.263 0 01-1.038-.695L.95 5.64A3.22 3.22 0 010 3.309C0 2.403.317 1.628.95.98c.317-.324.68-.568 1.088-.732a3.308 3.308 0 011.24-.244 3.19 3.19 0 011.338.293z'
  })
)()

export const $defaultTableCell = $row(
  spacing.small,
  style({ padding: '6px 0', display: 'flex', minWidth: 0, alignItems: 'center', overflowWrap: 'break-word' })
)
export const $defaultTableHeaderCell = $defaultTableCell(
  style({ alignItems: 'center', color: palette.foreground, fontSize: text.sm })
)
export const $defaultTableRowContainer = $node(isDesktopScreen ? spacing.big : spacing.default)
export const $defaultTableContainer = $column(spacing.default, style({ flex: 1 }))

export const $Table = <T>({
  dataSource,
  columns,
  scrollConfig,

  $container = $defaultTableContainer,
  $rowContainer = $defaultTableRowContainer,
  $headerRowContainer = $rowContainer,
  $cell = $defaultTableCell,
  $bodyCell = $cell,
  $headerCell = $defaultTableHeaderCell,
  $rowCallback,

  sortBy,
  $between = empty,
  $sortArrowDown = $caretDown
}: TableOption<T>) =>
  component(
    (
      [scrollRequest, scrollRequestTether]: IBehavior<IPageRequest, IPageRequest>,
      [sortByChange, sortByChangeTether]: IBehavior<INode, string>
    ) => {
      const gridTemplateColumns = style({
        display: 'grid',
        gridTemplateColumns: columns.map(col => col.gridTemplate || '1fr').join(' ')
      })

      // Sum the columns' intended widths so a mobile horizontal-scroll wrapper can keep
      // them at their declared sizes instead of squeezing them into the viewport.
      // Fixed `px` widths are summed directly; `minmax(<px>, ...)` contributes its px floor;
      // flexible (`1fr`/`auto`) columns fall back to a sensible minimum.
      const columnsMinWidth = columns.reduce((sum, col) => {
        const template = col.gridTemplate || '1fr'
        const pxMatch = template.match(/(\d+(?:\.\d+)?)px/)
        return sum + (pxMatch ? Number(pxMatch[1]) : 80)
      }, 0)
      const $bodyContainer = scrollConfig?.$container ?? $defaultVScrollContainer
      const $emptyMessage =
        scrollConfig?.$emptyMessage ??
        $column(spacing.default, style({ padding: '20px' }))($text('No items to display'))

      const $sortArrow = (colSortBy: string, direction: 'asc' | 'desc') =>
        $icon({
          $content: $sortArrowDown,
          svgOps: direction === 'asc' ? style({ transform: 'rotate(180deg)' }) : undefined,
          width: '8px',
          viewBox: '0 0 32 19.43',
          fill:
            sortBy && sortBy.selector === colSortBy && sortBy.direction === direction
              ? palette.message
              : colorShade(palette.message, 30)
        })

      const $header = $headerRowContainer(gridTemplateColumns)(
        ...columns.map(col => {
          const $headerCellContainer = col.$headerCellContainer || $headerCell
          if (!col.sortBy) return $headerCellContainer(col.$head)

          const colSortBy = col.sortBy
          return $headerCellContainer(style({ cursor: 'pointer' }))(
            sortByChangeTether(nodeEvent('click'), constant(colSortBy))
          )(
            col.$head,
            sortBy
              ? $column(
                  style({
                    borderRadius: '50%',
                    padding: '6px',
                    border: `1px solid ${colorShade(palette.message, sortBy.selector === colSortBy ? 25 : 7.5)}`
                  })
                )($sortArrow(colSortBy, 'asc'), $sortArrow(colSortBy, 'desc'))
              : empty
          )
        })
      )

      const renderRow = (rowData: T) => {
        const $cellDataList = columns.map(col => {
          const $body = col.$bodyCellContainer ?? $bodyCell
          return $body(switchLatest(col.$bodyCallback(just(rowData))))
        })

        return $rowCallback
          ? switchMap(
              $customRowContainer => $customRowContainer(gridTemplateColumns)(...$cellDataList),
              $rowCallback(just(rowData))
            )
          : $rowContainer(gridTemplateColumns)(...$cellDataList)
      }

      const bodyNode = Array.isArray(dataSource)
        ? dataSource.length === 0
          ? $emptyMessage
          : $bodyContainer(...dataSource.map(renderRow))
        : $QuantumScroll({
            ...scrollConfig,
            dataSource: map(async resPromise => {
              const res = await resPromise
              const pageItems = Array.isArray(res) ? res : res.page
              const $items = pageItems.map(renderRow)

              if (Array.isArray(res)) {
                return {
                  $items,
                  offset: 0,
                  pageSize: $items.length
                }
              }

              return {
                $items,
                offset: res.offset,
                pageSize: res.pageSize
              }
            }, dataSource)
          })({
            scrollRequest: scrollRequestTether()
          })

      const sortByOutput = sortBy
        ? map(
            (selector: string) =>
              sortBy.selector === selector
                ? { direction: sortBy.direction === 'asc' ? 'desc' : 'asc', selector }
                : { direction: sortBy.direction, selector },
            sortByChange
          )
        : empty

      // On non-desktop (phone/tablet) widths the fixed-pixel grid is wider than the screen.
      // Wrap the header + body in a horizontally scrollable element with a min-width equal to
      // the sum of the column widths so columns keep their intended sizes and the table can be
      // swiped sideways, instead of being squeezed or forcing the whole page to scroll.
      const $tableBody = isDesktopScreen
        ? $container($header, $between, bodyNode)
        : $node(style({ overflowX: 'auto', WebkitOverflowScrolling: 'touch', maxWidth: '100%' }))(
            $container(style({ minWidth: `${columnsMinWidth}px` }))($header, $between, bodyNode)
          )

      return [
        $tableBody,

        {
          scrollRequest,
          sortBy: sortByOutput
        }
      ]
    }
  )
