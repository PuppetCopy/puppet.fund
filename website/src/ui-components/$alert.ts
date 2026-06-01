import { $node, type I$Node, type I$Slottable, style } from 'aelea/ui'
import { $row, $Tooltip, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $elipsisTextWrapper, $icon } from './$common.js'
import { $alertIcon, $info } from './$icons.js'

const $alertBox = (borderColor: string) =>
  $row(
    spacing.small,
    style({
      minWidth: 0,
      maxWidth: '100%',
      borderRadius: '100px',
      alignItems: 'center',
      padding: '8px 12px',
      border: `1px dashed ${colorShade(borderColor, 50)}`
    })
  )

export const $alertNegativeContainer = $alertBox(palette.negative)
export const $alertPositiveContainer = $alertBox(palette.positive)
export const $alertIntermediateContainer = $alertBox(palette.indeterminate)

export const $alertIntermediateSpinnerContainer = (...$content: I$Node[]) =>
  $row(
    spacing.small,
    style({
      minWidth: 0,
      maxWidth: '100%',
      borderRadius: '100px',
      alignItems: 'center',
      padding: '8px 12px',
      border: '1px dashed transparent',
      position: 'relative',
      overflow: 'hidden'
    })
  )(
    $node(
      style({
        left: '-50%',
        width: '200%',
        aspectRatio: '1 / 1',
        animation: 'rotate 3.5s linear infinite',
        position: 'absolute',
        background: `conic-gradient(transparent, transparent, transparent, ${palette.indeterminate})`
      })
    )(),
    $node(
      style({
        inset: '1px',
        position: 'absolute',
        background: colorShade(palette.background, 70),
        borderRadius: 'inherit'
      })
    )(),
    $row(spacing.small, style({ position: 'relative', alignItems: 'center' }))(...$content)
  )

const $alertIconLeading = $icon({
  $content: $alertIcon,
  viewBox: '0 0 24 24',
  width: '18px',
  svgOps: style({ minWidth: '18px' })
})

export const $alert = ($content: I$Slottable) =>
  $alertNegativeContainer(style({ alignSelf: 'flex-start' }))($alertIconLeading, $content)

export const $alertTooltip = ($tooltip: I$Slottable, $content: I$Slottable = $tooltip) =>
  $Tooltip({
    $content: $tooltip,
    $anchor: $alertNegativeContainer($alertIconLeading, $elipsisTextWrapper($content))
  })({})

export const NOTE_TOOLTIP_HEIGHT = '16px'

const $tooltipBody = $node(style({ maxWidth: '320px', overflowWrap: 'anywhere', whiteSpace: 'normal' }))

export const $noteTooltip = ($tooltip: I$Slottable, $content: I$Slottable = $tooltip) =>
  $Tooltip({
    $content: $tooltipBody($tooltip),
    $anchor: $row(
      spacing.tiny,
      style({
        minWidth: 0,
        maxWidth: '100%',
        height: NOTE_TOOLTIP_HEIGHT,
        lineHeight: NOTE_TOOLTIP_HEIGHT,
        fontSize: '0.75rem',
        alignItems: 'center',
        color: palette.negative
      })
    )(
      $icon({
        $content: $info,
        viewBox: '0 0 32 32',
        fill: palette.negative,
        size: '12px',
        svgOps: style({ minWidth: '12px' })
      }),
      $elipsisTextWrapper($content)
    )
  })({})

export const $spinnerTooltip = ($content: I$Slottable) =>
  $Tooltip({
    $content,
    $anchor: $alertIntermediateSpinnerContainer(
      $icon({
        $content: $alertIcon,
        viewBox: '0 0 24 24',
        width: '18px',
        svgOps: style({ minWidth: '18px', position: 'relative' })
      }),
      $elipsisTextWrapper(style({ position: 'relative' }))($content)
    )
  })({})
