import { getDuration, getUnixTimestamp } from '@puppet/sdk/core'
import { empty, type IStream } from 'aelea/stream'
import { $node, $text, $wrapNativeElement, type I$Node, style } from 'aelea/ui'
import { $column, $row, $separator, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $infoLabel, $infoTooltip, $intermediateText, text } from '@/ui-components'
import { $mockWindow } from '../common/elements/$common.js'

export const $separator2 = style(
  { backgroundColor: colorShade(palette.foreground, 40), alignSelf: 'stretch', display: 'block' },
  $separator
)

export const $stack = ($primary: I$Node, $secondary: I$Node, align: 'flex-start' | 'flex-end'): I$Node =>
  $column(spacing.tiny, style({ alignItems: align, placeContent: 'center', whiteSpace: 'nowrap' }))($primary, $separator2, $secondary)

export const $headerFigure = (label: IStream<Promise<string> | string>): I$Node => $node(style({ fontSize: text.sm, fontFamily: 'var(--font-numbers)', color: palette.foreground, whiteSpace: 'nowrap' }))($intermediateText(label))

export const ago = (sec: number): string => {
  const elapsed = getUnixTimestamp() - sec
  return elapsed < 1 ? 'just now' : `${getDuration(elapsed)} ago`
}

export const shortDuration = (seconds: number): string => {
  const parts: string[] = []
  let rest = Math.max(0, Math.floor(seconds))
  for (const [label, size] of [['d', 86400], ['h', 3600], ['m', 60], ['s', 1]] as const) {
    if (rest < size && !(label === 's' && parts.length === 0)) {
      if (parts.length > 0) break
      continue
    }
    const count = Math.floor(rest / size)
    rest -= count * size
    parts.push(`${count}${label}`)
    if (parts.length === 2) break
  }
  return parts.join(' ')
}

export const $caption = (label: string | IStream<string>): I$Node => $node(style({ fontSize: text.xs, color: palette.foreground }))($text(label))

export const $emptyNote = (title: string, detail: string): I$Node =>
  $column(spacing.tiny)(
    $node(style({ color: palette.message, fontSize: text.sm }))($text(title)),
    $infoLabel(style({ fontSize: text.xs }))($text(detail))
  )

export const $video = (src: string): I$Node => {
  const video = document.createElement('video')
  video.muted = true
  video.loop = true
  video.playsInline = true
  video.preload = 'none'
  video.setAttribute('playsinline', '')
  video.setAttribute('muted', '')
  video.style.cssText =
    'width:100%;display:block;aspect-ratio:1/1;object-fit:cover;opacity:0;transition:opacity 700ms ease'
  let loaded = false
  const load = () => {
    if (loaded) return
    loaded = true
    const fetchVideo = () =>
      requestAnimationFrame(() => {
        video.src = src
        video.load()
      })
    if (document.readyState === 'complete') fetchVideo()
    else window.addEventListener('load', fetchVideo, { once: true })
  }
  const play = () => {
    Promise.resolve(video.play()).catch(() => {})
  }
  video.addEventListener('loadeddata', () => {
    video.style.opacity = '1'
    play()
  })
  video.addEventListener('canplay', play)
  video.addEventListener('pause', () => {
    if (video.isConnected) play()
  })
  const io = new IntersectionObserver(
    entries => {
      if (entries.some(e => e.isIntersecting)) {
        load()
        io.disconnect()
      }
    },
    { rootMargin: '300px' }
  )
  io.observe(video)
  return $mockWindow(
    $node(style({ position: 'relative' }))(
      $wrapNativeElement(video)(),
      $node(
        style({
          position: 'absolute',
          inset: '0',
          zIndex: '1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: text.xl,
          fontWeight: '800',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'rgba(255, 255, 255, 0.6)',
          textShadow: '0 2px 12px rgba(0, 0, 0, 0.5)',
          pointerEvents: 'none'
        })
      )($text('Outdated Preview'))
    )
  )
}

export const $section = $column(spacing.small)
export const $sectionList = $column(style({ gap: isDesktopScreen ? '48px' : '34px' }))

export const $sectionTip = (tooltip: string | I$Node, color: string): I$Node =>
  $infoTooltip(
    $node(style({ display: 'block', maxWidth: '280px', whiteSpace: 'normal', fontSize: text.sm }))(typeof tooltip === 'string' ? $text(tooltip) : tooltip),
    color
  )

export const $emptySection = (detail: string, $cta?: I$Node): I$Node =>
  $row(spacing.small, style({ alignItems: 'baseline', flexWrap: 'wrap', padding: '4px 0', color: palette.foreground, fontSize: text.sm }))(
    $node($text(detail)),
    ...($cta ? [$cta] : [])
  )

export const $sectionHeader = ($title: I$Node, tooltip: string | I$Node | null, $trailing?: I$Node): I$Node =>
  $row(
    spacing.small,
    style({
      alignItems: 'center',
      justifyContent: 'space-between',
      height: '44px',
      flexShrink: 0,
      borderBottom: `1px solid ${colorShade(palette.foreground, 15)}`
    })
  )(
    tooltip === null ? $title : $row(spacing.small, style({ alignItems: 'center' }))($title, $sectionTip(tooltip, colorShade(palette.foreground, 60))),
    $trailing ?? empty
  )

export const $vital = (label: string, $v: I$Node, tooltip?: string | I$Node): I$Node =>
  $column(spacing.tiny)(
    tooltip
      ? $row(spacing.tiny, style({ alignItems: 'center' }))($infoLabel($text(label)), $infoTooltip(tooltip, palette.foreground))
      : $infoLabel($text(label)),
    $node(style({ fontWeight: '700', fontFamily: 'var(--font-numbers)' }))($v)
  )
