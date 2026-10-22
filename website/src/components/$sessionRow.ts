import { $node, $text, type I$Node, style } from 'aelea/ui'
import { $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { text } from '@/ui-components'

export const $sessionRow = ($identity: I$Node, name: string | null, $detail: I$Node | null, $action: I$Node): I$Node =>
  $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))(
    $node(style({ display: 'flex', flexShrink: '0' }))($identity),
    $row(spacing.tiny, style({ flex: '1', alignItems: 'center', minWidth: '0', overflow: 'hidden', whiteSpace: 'nowrap', fontSize: text.xs, color: palette.foreground }))(
      ...(name === null ? [] : [$node(style({ minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: text.sm, color: palette.message }))($text(name))]),
      ...(name === null || $detail === null ? [] : [$node(style({ flexShrink: '0' }))($text('·'))]),
      ...($detail === null ? [] : [$detail])
    ),
    $node(style({ display: 'flex', flexShrink: '0' }))($action)
  )
