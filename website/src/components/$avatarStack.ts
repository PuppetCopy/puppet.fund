import { $node, $text, type I$Node, style } from 'aelea/ui'
import { $column, $row, $Tooltip } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { $tooltipDropContainer } from '@/ui-components'

const STACK_LIMIT = 5

export const $avatarStack = ($avatars: readonly I$Node[], $list: I$Node | null): I$Node => {
  if ($avatars.length === 0) return $node($text('0'))
  const truncated = $avatars.length > STACK_LIMIT
  const $anchor = $row(style({ alignItems: 'center', ...($list === null ? {} : { cursor: 'pointer' }) }))(
    ...$avatars
      .slice(0, truncated ? STACK_LIMIT - 1 : STACK_LIMIT)
      .map(($avatar, i) => $node(style({ display: 'flex', marginLeft: i === 0 ? '0' : '-6px', borderRadius: '50%', border: `2px solid ${palette.background}` }))($avatar)),
    ...(truncated
      ? [
          $node(
            style({
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: '18px',
              height: '18px',
              padding: '0 4px',
              marginLeft: '-6px',
              borderRadius: '9px',
              border: `2px solid ${palette.background}`,
              backgroundColor: palette.horizon,
              color: palette.message,
              fontSize: '10px',
              fontWeight: '700'
            })
          )($text(`${$avatars.length - (STACK_LIMIT - 1)}`))
        ]
      : [])
  )
  if ($list === null) return $anchor
  return $Tooltip({
    $dropContainer: $tooltipDropContainer,
    $content: $column(style({ maxHeight: '360px', overflowY: 'auto', minWidth: '320px' }))($list),
    $anchor
  })({})
}
