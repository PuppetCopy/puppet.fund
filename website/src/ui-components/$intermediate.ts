import { $node, type I$Node, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette, text } from 'aelea/ui-components-theme'
import { SEPARATOR_COLOR } from './$common.js'

export const INTERMEDIATE_FILL = { background: colorShade(palette.foreground, 15), animation: 'pulse 1.4s ease-in-out infinite' }

export const $intermediateLine = (width: string, fontSize = 'inherit'): I$Node =>
  $node(
    style({
      display: 'inline-block',
      flexShrink: '0',
      verticalAlign: 'middle',
      fontSize,
      width,
      maxWidth: '100%',
      height: '1em',
      borderRadius: '0.25em',
      ...INTERMEDIATE_FILL
    })
  )()

export const $intermediateCircle = (size: number): I$Node =>
  $node(style({ width: `${size}px`, height: `${size}px`, flexShrink: '0', borderRadius: '50%', ...INTERMEDIATE_FILL }))()

export const $intermediateProfile = (size = 32): I$Node =>
  $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))(
    $intermediateCircle(size),
    $column(spacing.tiny)($intermediateLine('6em', text.base), $intermediateLine('7em', text.xs))
  )

export const $intermediateValue: I$Node = $column(spacing.tiny, style({ alignItems: 'flex-end' }))($intermediateLine('4.5em', text.base), $intermediateLine('3.5em', text.xs))

export const $intermediateRow = ($lead: I$Node, $value: I$Node = $intermediateValue): I$Node =>
  $row(spacing.default, style({ alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${SEPARATOR_COLOR}` }))(
    $lead,
    $node(style({ flex: 1 }))(),
    $value
  )

export const $intermediateList = (count: number, $item: I$Node): I$Node => $column(spacing.tiny)(...Array.from({ length: count }, () => $item))

export const $intermediateChart: I$Node = $node(style({ flex: 1, alignSelf: 'stretch', position: 'relative' }))(
  $node(style({ position: 'absolute', left: 0, right: 0, bottom: '30%', height: '2px', ...INTERMEDIATE_FILL }))()
)

export const $intermediatePill = (width: string, height: string): I$Node =>
  $node(style({ width, height, flexShrink: '0', borderRadius: height, ...INTERMEDIATE_FILL }))()
