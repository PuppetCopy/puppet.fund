import { map, nowWith, switchLatest } from 'aelea/stream'
import { state } from 'aelea/stream-extended'
import { $element, $node, $text, attr, effectProp, type I$Node, style, stylePseudo } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $check, $copy, $icon, text } from '@/ui-components'
import { $card } from '../common/elements/$common.js'
import { subject } from '../utils/subject.js'

export const $stageHeader = (n: number, title: string): I$Node =>
  $row(spacing.default, style({ alignItems: 'center' }))(
    $node(
      style({
        width: '32px',
        height: '32px',
        borderRadius: '50%',
        background: colorShade(palette.foreground, 18),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: text.sm,
        fontWeight: '600',
        color: palette.message,
        flexShrink: '0'
      })
    )($text(String(n))),
    $node(style({ fontSize: text.lg, fontWeight: '600', color: palette.message }))($text(title))
  )

export const $stage = (n: number, title: string, $content: I$Node): I$Node =>
  $card(spacing.default)($stageHeader(n, title), $content)

export const $body = (s: string): I$Node =>
  $node(style({ color: palette.message, fontSize: text.sm, lineHeight: '1.6' }))($text(s))

export const $bulletList = (items: [string, string][]): I$Node =>
  $column(
    spacing.small,
    style({ paddingLeft: '4px' })
  )(
    ...items.map(([k, v]) =>
      $row(spacing.default, style({ alignItems: 'baseline' }))(
        $node(style({ color: palette.foreground, fontSize: text.sm, minWidth: '4px' }))($text('•')),
        $row(spacing.small, style({ flex: 1, flexWrap: 'wrap' }))(
          $node(style({ color: palette.message, fontWeight: '600', fontSize: text.sm }))($text(`${k} -`)),
          $node(style({ color: palette.message, fontSize: text.sm, lineHeight: '1.5' }))($text(v))
        )
      )
    )
  )

// A terminal-style command card: a header (>_ label + copy button) over a dark body where each line
// renders as a `$ ` prompt + the command (leading binary tinted). The copy button writes all lines to
// the clipboard. Used for scaffold / setup commands in the onboarding guide.
export const $terminal = (lines: string[], label = 'terminal'): I$Node => {
  const copied = subject<boolean>()
  return $column(
    style({
      border: `1px solid ${colorShade(palette.foreground, 30)}`,
      borderRadius: '10px',
      overflow: 'hidden'
    })
  )(
    $row(
      style({
        alignItems: 'baseline',
        gap: '8px',
        padding: '8px 14px',
        color: palette.foreground,
        fontSize: text.sm,
        lineHeight: '1.5',
        borderBottom: `1px solid ${colorShade(palette.foreground, 18)}`
      })
    )(
      $node(style({ fontFamily: 'monospace', fontWeight: '700', flexShrink: '0' }))($text('>_')),
      $node(style({ minWidth: '0', fontSize: text.xs }))($text(label))
    ),
    $node(
      style({
        position: 'relative',
        padding: '12px 16px',
        background: palette.background,
        fontFamily: 'monospace',
        fontSize: text.sm,
        lineHeight: '1.7'
      })
    )(
      $column(style({ paddingRight: '24px' }))(
        ...lines.map(line => {
          const [bin, ...rest] = line.split(' ')
          return $row(style({ whiteSpace: 'pre-wrap', flexWrap: 'wrap' }))(
            $node(style({ color: palette.foreground }))($text('$ ')),
            $node(style({ color: palette.positive }))($text(bin)),
            $node(style({ color: palette.message }))($text(rest.length ? ` ${rest.join(' ')}` : ''))
          )
        })
      ),
      // Copy button lives inside the command box, pinned to its top-right corner.
      $node(
        attr({ role: 'button', 'aria-label': 'Copy command' }),
        style({
          position: 'absolute',
          top: '8px',
          right: '10px',
          display: 'flex',
          cursor: 'pointer',
          opacity: '0.6'
        }),
        stylePseudo(':hover', { opacity: '1' }),
        effectProp(
          'onclick',
          nowWith(() => () => {
            navigator.clipboard?.writeText(lines.join('\n'))
            copied.push(true)
            setTimeout(() => copied.push(false), 5_000)
          })
        )
      )(
        switchLatest(
          map(
            isCopied =>
              isCopied
                ? $icon({ $content: $check, width: '15px', viewBox: '0 0 24 24', fill: palette.positive })
                : $icon({ $content: $copy, width: '15px', viewBox: '0 0 24 24', fill: palette.foreground }),
            state(false, copied.stream)
          )
        )
      )
    )
  )
}

export const $callout = (s: string): I$Node =>
  $node(
    style({
      background: colorShade(palette.foreground, 8),
      borderLeft: `3px solid ${palette.indeterminate}`,
      padding: '12px 16px',
      borderRadius: '4px',
      color: palette.message,
      fontSize: text.sm,
      lineHeight: '1.5'
    })
  )($text(s))

export const $linkButton = (label: string, hrefValue: string, internal: boolean): I$Node => {
  const a = $element('a')(
    style({
      padding: '8px 14px',
      borderRadius: '8px',
      border: `1px solid ${colorShade(palette.foreground, 30)}`,
      color: palette.message,
      fontSize: text.sm,
      textDecoration: 'none',
      cursor: 'pointer'
    })
  )
  return internal
    ? a(attr({ href: hrefValue }))($text(label))
    : a(attr({ href: hrefValue, target: '_blank' }))($text(label))
}
