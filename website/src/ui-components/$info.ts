import { type IStream, isStream, map, switchLatest } from 'aelea/stream'
import { $node, $text, type I$Node, type I$Slottable, style } from 'aelea/ui'
import { $column, $row, $Tooltip, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'

import { text } from '@/ui-components'
import { $fromText, $icon } from './$common.js'
import { $info } from './$icons.js'
import { $inlineSpinner, $intermediateText, $tooltipDropContainer } from './$IntermediateDisplay.js'

export const $infoLabel = $node(style({ color: palette.foreground }))

export const $labeledValue = (label: string | I$Slottable, value: string | I$Slottable, tooltip?: I$Slottable) =>
  $row(spacing.small, style({ alignItems: 'center' }))(
    tooltip
      ? $Tooltip({
          $dropContainer: $tooltipDropContainer,
          $content: tooltip,
          $anchor: $row(style({ alignItems: 'center', cursor: 'help' }))(
            $infoLabel($fromText(label)),
            $icon({
              $content: $info,
              viewBox: '0 0 32 32',
              fill: palette.foreground,
              size: '1.15em',
              svgOps: style({ flexShrink: '0', marginLeft: '4px' })
            })
          )
        })({})
      : $infoLabel($fromText(label)),
    isStream(value) ? value : $text(value)
  )

export const $infoTooltip = (text: string | I$Slottable, color = palette.foreground, busy?: IStream<boolean>) =>
  $Tooltip({
    $dropContainer: $tooltipDropContainer,
    $content: isStream(text) ? text : $node($text(text)),
    $anchor:
      busy === undefined
        ? $icon({
            $content: $info,
            viewBox: '0 0 32 32',
            fill: color,
            size: '1.15em',
            svgOps: style({ display: 'block', flexShrink: '0', cursor: 'help' })
          })
        : $node(style({ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '1.15em', height: '1.15em', flexShrink: '0', cursor: 'help' }))(
            switchLatest(
              map(
                loading =>
                  loading
                    ? $inlineSpinner
                    : $icon({ $content: $info, viewBox: '0 0 32 32', fill: color, size: '1.15em', svgOps: style({ display: 'block', flexShrink: '0' }) }),
                busy
              )
            )
          )
  })({})

export const $detailLine = (label: string, value: string | IStream<Promise<string> | string>, color: string = palette.message) =>
  $row(spacing.big, style({ justifyContent: 'space-between' }))(
    $node(style({ color: palette.foreground }))($text(label)),
    $node(style({ whiteSpace: 'nowrap', color }))(typeof value === 'string' ? $text(value) : $intermediateText(value))
  )

export const $dot = (color: string): I$Node =>
  $node(style({ width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0, backgroundColor: color }))()

export const $labeledDivider = (label: string | I$Slottable) =>
  $row(spacing.default, style({ placeContent: 'center', alignItems: 'center' }))(
    $column(style({ flex: 1, borderBottom: `1px solid ${palette.horizon}` }))(),
    $row(
      spacing.small,
      style({ fontSize: text.sm, color: palette.foreground, alignItems: 'center' })
    )($fromText(label)),
    $column(style({ flex: 1, borderBottom: `1px solid ${palette.horizon}` }))()
  )
