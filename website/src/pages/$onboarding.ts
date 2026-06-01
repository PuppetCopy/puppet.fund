import { $element, $node, $text, attr, type I$Node, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { text } from '@/ui-components'
import { $card } from '../common/elements/$common.js'

export const $stage = (n: number, title: string, $content: I$Node): I$Node =>
  $card(spacing.default)(
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
    ),
    $node(style({ height: '8px' }))(),
    $content
  )

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

export const $codeBlock = (lines: string[]): I$Node =>
  $element('pre')(
    style({
      background: palette.background,
      border: `1px solid ${colorShade(palette.foreground, 18)}`,
      borderRadius: '6px',
      padding: '14px 16px',
      fontSize: text.sm,
      fontFamily: 'monospace',
      color: palette.message,
      whiteSpace: 'pre-wrap',
      lineHeight: '1.5',
      margin: '0'
    })
  )($text(lines.join('\n')))

export const $envBlock = (rows: [string, string][]): I$Node =>
  $element('pre')(
    style({
      background: palette.background,
      border: `1px solid ${colorShade(palette.foreground, 18)}`,
      borderRadius: '6px',
      padding: '14px 16px',
      fontSize: text.sm,
      fontFamily: 'monospace',
      color: palette.message,
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
      lineHeight: '1.6',
      margin: '0'
    })
  )($text(rows.map(([k, v]) => `${k}=${v}`).join('\n')))

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
