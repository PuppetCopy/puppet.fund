import type { ITokenDescription } from '@puppet/sdk/core'
import { getMappedValue } from '@puppet/sdk/core'
import { empty } from 'aelea/stream'
import { $node, $text, type I$Node, type I$Slottable, style } from 'aelea/ui'
import { $column, $row, $Tooltip, layoutSheet, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { text } from '@/ui-components'
import { $tokenIcon, $tokenLabeled } from '../common/$common.js'
import { $elipsisTextWrapper, $icon, $label } from './$common.js'
import { $tokenIconMap } from './$icons.js'
import { $labeledValue } from './$info.js'

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
    $icon({ $content: getMappedValue($tokenIconMap, token.symbol), width: '34px', viewBox: '0 0 32 32' }),
    $column(layoutSheet.flex)(
      $node(style({ fontWeight: 'bold' }))($text(token.symbol)),
      $node(style({ color: palette.foreground }))($text(token.name))
    ),
    $tokenLabelExtra ? $elipsisTextWrapper($tokenLabelExtra) : empty
  )

export const $marketLabel = (
  indexToken: ITokenDescription,
  longToken: ITokenDescription,
  shortToken: ITokenDescription,
  $marketLabelExtra?: I$Slottable
) =>
  $row(spacing.tiny, style({ position: 'relative', alignItems: 'center' }))(
    $Tooltip({
      $content: $column(spacing.default)(
        $labeledValue($label($text('Index Token')), $tokenLabeled(indexToken)),
        $labeledValue($label($text('Long Token')), $tokenLabeled(longToken)),
        $labeledValue($label($text('Short Token')), $tokenLabeled(shortToken))
      ),
      $anchor: $tokenIcon(indexToken, '32px')
    })({}),
    $marketLabelExtra ? $elipsisTextWrapper($marketLabelExtra) : empty
  )
