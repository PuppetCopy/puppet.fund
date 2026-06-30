import type { ITokenDescription } from '@puppet/sdk/core'
import { getMappedValueFallback } from '@puppet/sdk/core'
import { empty } from 'aelea/stream'
import { $node, $text, type I$Node, type I$Slottable, style } from 'aelea/ui'
import { $column, $row, layoutSheet, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { text } from '@/ui-components'
import { $elipsisTextWrapper, $icon } from './$common.js'
import { $tokenIconMap, $unknown } from './$icons.js'

export const $tokenLabel = (token: ITokenDescription, $iconPath: I$Node, $tokenLabelExtra?: I$Slottable) =>
  $row(spacing.default, style({ cursor: 'pointer', alignItems: 'center' }))(
    $icon({ $content: $iconPath, width: '34px', viewBox: '0 0 32 32' }),
    $column(layoutSheet.flex)(
      $node(style({ fontWeight: 'bold' }))($text(token.symbol)),
      $node(style({ fontSize: text.sm, color: palette.foreground }))($text(token.symbol))
    ),
    $tokenLabelExtra ? $elipsisTextWrapper($tokenLabelExtra) : empty
  )

export const $tokenLabelFromSummary = (token: ITokenDescription, $tokenLabelExtra?: I$Slottable) =>
  $row(spacing.default, style({ cursor: 'pointer', alignItems: 'center' }))(
    $icon({ $content: getMappedValueFallback($tokenIconMap, token.symbol, $unknown), width: '34px', viewBox: '0 0 32 32' }),
    $column(layoutSheet.flex)(
      $node(style({ fontWeight: 'bold' }))($text(token.symbol)),
      token.name && token.name !== token.symbol
        ? $node(style({ color: palette.foreground }))($text(token.name))
        : empty
    ),
    $tokenLabelExtra ? $elipsisTextWrapper($tokenLabelExtra) : empty
  )
