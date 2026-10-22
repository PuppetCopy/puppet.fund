import { $element, $node, $text, attr, type I$Node, style, stylePseudo } from 'aelea/ui'
import { $column, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $Link, type Route } from 'aelea/ui-router'
import { $icon, $throne, softNavClick, text } from '@/ui-components'
import { routeSchema } from '../app/routeSchema.js'
import { $puppetLogo } from '../common/$icons.js'

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

export const $body = (s: string): I$Node =>
  $node(style({ color: palette.message, fontSize: text.sm, lineHeight: '1.6' }))($text(s))

export const $bulletList = (items: [string, string][]): I$Node =>
  $column(spacing.small, style({ paddingLeft: '4px' }))(
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
  return internal ? a(attr({ href: hrefValue }), softNavClick(hrefValue))($text(label)) : a(attr({ href: hrefValue, target: '_blank' }))($text(label))
}

export const $pillAnchor = (filled: boolean, borderColor?: string) =>
  $element('a')(
    style({
      display: 'inline-flex',
      cursor: 'pointer',
      alignItems: 'center',
      height: '48px',
      padding: '0 28px',
      borderRadius: '30px',
      backgroundColor: filled ? palette.primary : palette.background,
      color: filled ? 'white' : palette.message,
      fontWeight: 'bold',
      fontSize: text.base,
      textDecoration: 'none',
      whiteSpace: 'nowrap',
      border: filled ? 'none' : `1px solid ${borderColor ?? colorShade(palette.foreground, 30)}`
    }),
    stylePseudo(
      ':hover',
      filled
        ? { filter: 'brightness(1.1)' }
        : borderColor
          ? { backgroundColor: colorShade(palette.primary, 12) }
          : { borderColor: colorShade(palette.foreground, 60) }
    )
  )

const $pillLabel = (label: string, $glyph: I$Node | undefined, filled: boolean): I$Node =>
  $row(spacing.small, style({ alignItems: 'center' }))(
    ...($glyph ? [$icon({ $content: $glyph, width: '20px', viewBox: '0 0 32 32', fill: filled ? 'white' : palette.message })] : []),
    $text(label)
  )

export const $navPill = (label: string, route: Route, filled: boolean, borderColor?: string, $glyph?: I$Node): I$Node =>
  $Link({ route, $content: $pillLabel(label, $glyph, filled), $anchor: $pillAnchor(filled, borderColor) })({})

export const $launchCta = (): I$Node => {
  return $row(
    spacing.default,
    style({
      flexDirection: isDesktopScreen ? 'row' : 'column',
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: '4px'
    })
  )(
    $navPill('Launch Fund', routeSchema.wallet, true, undefined, $puppetLogo),
    $node(style({ fontSize: text.xs, fontWeight: 'bold', color: palette.foreground }))($text('OR')),
    $navPill('Explore Funds', routeSchema.traders, false, palette.primary, $throne)
  )
}
