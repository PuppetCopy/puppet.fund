import { map, nowWith, switchLatest } from 'aelea/stream'
import { state } from 'aelea/stream-extended'
import { $element, $node, $text, attr, effectProp, type I$Node, style, stylePseudo } from 'aelea/ui'
import { $column, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $Link, href, pushUrl, type Route } from 'aelea/ui-router'
import { $check, $copy, $icon, $throne, text } from '@/ui-components'
import { routeSchema } from '../app/routeSchema.js'
import { $puppetLogo } from '../common/$icons.js'
import { promptInstallApp } from '../utils/pwaInstall.js'
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
  return internal ? a(attr({ href: hrefValue }))($text(label)) : a(attr({ href: hrefValue, target: '_blank' }))($text(label))
}

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
      spacing.small,
      style({
        alignItems: 'baseline',
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
            navigator.clipboard
              ?.writeText(lines.join('\n'))
              .then(() => {
                copied.push(true)
                setTimeout(() => copied.push(false), 5_000)
              })
              .catch(() => {})
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
  const portfolioUrl = href(routeSchema.portfolio)
  return $row(
    spacing.default,
    style({
      flexDirection: isDesktopScreen ? 'row' : 'column',
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: '4px'
    })
  )(
    $pillAnchor(true)(
      attr({ href: portfolioUrl }),
      effectProp(
        'onclick',
        nowWith(() => (ev: MouseEvent) => {
          if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return
          ev.preventDefault()
          void promptInstallApp().finally(() => pushUrl(portfolioUrl))
        })
      )
    )($pillLabel('Launch wallet', $puppetLogo, true)),
    $node(style({ fontSize: text.xs, fontWeight: 'bold', color: palette.foreground }))($text('OR')),
    $navPill('Explore traders', routeSchema.traders, false, palette.primary, $throne)
  )
}
