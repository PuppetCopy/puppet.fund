import { $element, $node, $text, attr, type I$Node, style } from 'aelea/ui'
import { type IFundCard, type ITone, type ITopFund, short } from './data.js'

const palette = {
  message: '#ffffff',
  foreground: '#94a4c2',
  background: '#101217',
  horizon: '#292c37',
  middleground: '#1d202b',
  primary: '#964565',
  positive: '#38e567',
  negative: '#ff6050'
}

export const WIDTH = 1200
export const HEIGHT = 630
const LOGO_SRC = 'logo'

const toneColor = (tone: ITone): string =>
  tone === 'positive' ? palette.positive : tone === 'negative' ? palette.negative : palette.foreground

const $frame = (...children: I$Node[]) =>
  $node(
    style({
      width: `${WIDTH}px`,
      height: `${HEIGHT}px`,
      display: 'flex',
      flexDirection: 'column',
      padding: '56px 64px',
      background: `linear-gradient(155deg, ${palette.background} 0%, ${palette.middleground} 60%, #161a24 100%)`,
      color: palette.message,
      fontFamily: 'Geist'
    })
  )(...children)

const $logo = (size: number) =>
  $node(
    style({
      display: 'flex',
      padding: `${Math.round(size * 0.12)}px`,
      borderRadius: '50%',
      border: `2px solid ${palette.horizon}`,
      background: 'rgba(150, 69, 101, 0.1)'
    })
  )($element('img')(attr({ src: LOGO_SRC }), style({ width: `${size}px`, height: `${size}px` }))())

const $wordmark = (size: number) =>
  $element('span')(
    style({ fontSize: `${size}px`, fontWeight: '800', letterSpacing: '0.12em', color: palette.message })
  )($text('PUPPET'))

const $brandRow = $node(style({ display: 'flex', alignItems: 'center', gap: '22px' }))($logo(56), $wordmark(36))

const $footer = (path: string) =>
  $node(
    style({
      marginTop: 'auto',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderTop: `1px solid ${palette.horizon}`,
      paddingTop: '26px',
      fontSize: '26px',
      color: palette.foreground,
      letterSpacing: '0.04em'
    })
  )(
    $element('span')(style({ color: palette.message }))($text('puppet.fund')),
    $element('span')(style({ color: palette.primary }))($text(path))
  )

const $tokenChip = (symbol: string, size = 26) =>
  $element('span')(
    style({
      display: 'flex',
      fontSize: `${size}px`,
      fontWeight: '600',
      letterSpacing: '0.04em',
      color: palette.message,
      padding: '6px 18px',
      borderRadius: '100px',
      border: '1px solid rgba(148, 164, 194, 0.28)',
      background: 'rgba(148, 164, 194, 0.12)'
    })
  )($text(symbol))

const $avatar = (src: string, size: number) =>
  $element('img')(
    attr({ src }),
    style({
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: '50%',
      border: `2px solid ${palette.horizon}`,
      background: palette.middleground
    })
  )()

const sparkSvg = (series: number[], color: string, w: number, h: number): string => {
  const min = Math.min(...series)
  const max = Math.max(...series)
  const span = max - min || 1
  const step = w / (series.length - 1)
  const points = series
    .map((v, i) => `${(i * step).toFixed(1)},${(h - 6 - ((v - min) / span) * (h - 12)).toFixed(1)}`)
    .join(' ')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="${color}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round" points="${points}"/></svg>`
}

const $spark = (series: number[], tone: ITone, w: number, h: number) =>
  $element('img')(
    attr({ src: `data:image/svg+xml;base64,${btoa(sparkSvg(series, toneColor(tone), w, h))}` }),
    style({ width: `${w}px`, height: `${h}px` })
  )()

export const $brand: I$Node = $frame(
  $node(
    style({ flex: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '56px' })
  )(
    $logo(220),
    $node(style({ display: 'flex', flexDirection: 'column', gap: '20px' }))(
      $wordmark(104),
      $element('p')(
        style({ fontSize: '36px', color: palette.foreground, margin: '0', maxWidth: '560px', lineHeight: '1.3' })
      )($text('Wallet for traders, platform for investors'))
    )
  ),
  $footer('/')
)

export const $page = (title: string, subtitle: string, path: string): I$Node =>
  $frame(
    $brandRow,
    $node(
      style({ flex: '1', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '22px' })
    )(
      $element('h1')(
        style({ fontSize: '96px', fontWeight: '700', lineHeight: '1.02', margin: '0', color: palette.message })
      )($text(title)),
      $element('p')(
        style({ fontSize: '38px', color: palette.foreground, margin: '0', maxWidth: '900px', lineHeight: '1.25' })
      )($text(subtitle))
    ),
    $footer(path)
  )

export const $leaderboard = (rows: ITopFund[]): I$Node =>
  $frame(
    $node(style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }))(
      $brandRow,
      $node(style({ display: 'flex', alignItems: 'baseline', gap: '18px' }))(
        $element('h1')(style({ fontSize: '52px', fontWeight: '700', lineHeight: '1', margin: '0' }))(
          $text('Leaderboard')
        ),
        $element('span')(style({ fontSize: '26px', color: palette.foreground }))($text('top funds · 7d'))
      )
    ),
    $node(
      style({ flex: '1', display: 'flex', flexDirection: 'column', justifyContent: 'center', marginTop: '18px' })
    )(
      ...rows.map(row =>
        $node(
          style({
            display: 'flex',
            alignItems: 'center',
            gap: '26px',
            padding: '13px 0',
            borderBottom: `1px solid ${palette.horizon}`,
            fontSize: '32px'
          })
        )(
          $element('span')(style({ color: palette.primary, fontWeight: '700', width: '40px' }))($text(`${row.rank}`)),
          $avatar(row.avatar, 52),
          $element('span')(
            style({
              flex: '1',
              minWidth: '0',
              color: palette.message,
              fontWeight: '600',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            })
          )($text(row.label)),
          ...(row.token ? [$tokenChip(row.token, 22)] : []),
          $element('span')(style({ color: toneColor(row.tone), fontWeight: '700' }))($text(row.value))
        )
      )
    ),
    $footer('/leaderboard')
  )

const $fundMetric = (label: string, value: string, color = palette.message) =>
  $node(style({ display: 'flex', flexDirection: 'column', gap: '6px' }))(
    $element('span')(style({ fontSize: '24px', color: palette.foreground }))($text(label)),
    $element('span')(style({ fontSize: '40px', fontWeight: '700', color }))($text(value))
  )

export const $fund = (card: IFundCard): I$Node =>
  $frame(
    $node(style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }))(
      $brandRow,
      ...(card.token ? [$tokenChip(card.token)] : [])
    ),
    $node(style({ flex: '1', display: 'flex', alignItems: 'center', gap: '44px', marginTop: '12px' }))(
      $avatar(card.avatar, 168),
      $node(style({ display: 'flex', flexDirection: 'column', gap: '14px', flex: '1', minWidth: '0' }))(
        $element('h1')(
          style({
            fontSize: '64px',
            fontWeight: '700',
            lineHeight: '1.05',
            margin: '0',
            color: palette.message,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          })
        )($text(card.label)),
        $element('span')(style({ fontSize: '26px', color: palette.foreground }))($text(short(card.address))),
        $node(style({ display: 'flex', alignItems: 'flex-end', gap: '52px', marginTop: '10px' }))(
          $node(style({ display: 'flex', flexDirection: 'column', gap: '6px' }))(
            $element('span')(style({ fontSize: '24px', color: palette.foreground }))(
              $text(card.window ? `Realised PnL · ${card.window}` : 'Realised PnL')
            ),
            $element('span')(style({ fontSize: '76px', fontWeight: '800', lineHeight: '1', color: toneColor(card.tone) }))(
              $text(card.pnl)
            )
          ),
          $fundMetric('ROI', card.roi, card.roi.startsWith('+') ? palette.positive : card.roi.startsWith('-') ? palette.negative : palette.foreground),
          $fundMetric('AUM', card.aum)
        )
      )
    ),
    ...(card.spark.length > 1 ? [$spark(card.spark, card.tone, WIDTH - 128, 110)] : []),
    $footer(`/fund/${short(card.address)}`)
  )
