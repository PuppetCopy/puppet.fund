import { $element, $node, $text, attr, type I$Node, style } from 'aelea/ui'
import { baselinePlot, VENUE_ICONS, venueIconSvg } from '@puppet/sdk/ui-components'
import { type ILeaderRow, type IMasterCard, type IPuppetCard, type ITone, LEADERBOARD_WINDOW } from './data.js'

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

export const SIZE = 1200
const X_POST_WIDTH = 506
const LOGO_SRC = 'logo'

const toneColor = (tone: ITone): string =>
  tone === 'positive' ? palette.positive : tone === 'negative' ? palette.negative : palette.foreground

const $frame = (...children: I$Node[]) =>
  $node(
    style({
      width: `${SIZE}px`,
      height: `${SIZE}px`,
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      padding: '56px 64px',
      background: `linear-gradient(155deg, ${palette.background} 0%, ${palette.middleground} 60%, #161a24 100%)`,
      color: palette.message,
      fontFamily: 'Inter'
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
    style({ fontSize: `${size}px`, fontWeight: '800', color: palette.message })
  )($text('puppet.fund'))

const $brandRow = $node(style({ display: 'flex', alignItems: 'center', gap: '14px', opacity: '0.35' }))($logo(36), $wordmark(26))

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

const sparkSvg = (series: readonly { time: number; value: number }[], w: number, h: number): string => {
  const shown = X_POST_WIDTH / SIZE
  const { base, upLine, zeroLine, downLine, upGrid, downGrid } = baselinePlot(series, 0, 0, w, h, 0.12)
  const stops = [0, h].flatMap(edge =>
    Array.from({ length: 9 }, (_, i) => {
      const reach = i / 8
      const distance = reach * Math.abs(edge - base) * shown
      const damp = distance <= 40 ? 1 : Math.max(0.35, 1 - (0.65 * (distance - 40)) / 360)
      return { offset: (base + (edge - base) * reach) / h, opacity: (0.03 + 0.27 * reach) * damp }
    })
  )
  const box = `maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}"`
  const fade = `<linearGradient id="fade" x1="0" y1="0" x2="${w}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#000"/><stop offset="0.3" stop-color="#000"/><stop offset="0.75" stop-color="#fff"/></linearGradient><mask id="fadeMask" ${box}><rect x="0" y="0" width="${w}" height="${h}" fill="url(#fade)"/></mask>`
  const depth = `<linearGradient id="depth" x1="0" y1="0" x2="0" y2="${h}" gradientUnits="userSpaceOnUse">${stops.sort((a, b) => a.offset - b.offset).map(stop => `<stop offset="${stop.offset.toFixed(4)}" stop-color="#fff" stop-opacity="${stop.opacity.toFixed(3)}"/>`).join('')}</linearGradient><mask id="depthMask" ${box}><rect x="0" y="0" width="${w}" height="${h}" fill="url(#depth)"/></mask>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${fade}${depth}</defs><g mask="url(#fadeMask)"><g mask="url(#depthMask)"><path d="${upGrid}" fill="none" stroke="${palette.positive}" stroke-width="1.5"/><path d="${downGrid}" fill="none" stroke="${palette.negative}" stroke-width="1.5"/></g>${upLine === '' ? '' : `<path d="${upLine}" fill="none" stroke="${palette.positive}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`}${zeroLine === '' ? '' : `<path d="${zeroLine}" fill="none" stroke="${palette.foreground}" stroke-opacity="0.6" stroke-width="2" stroke-linecap="round"/>`}${downLine === '' ? '' : `<path d="${downLine}" fill="none" stroke="${palette.negative}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`}</g></svg>`
}

const $spark = (series: readonly { time: number; value: number }[], w: number, h: number) =>
  $element('img')(attr({ src: `data:image/svg+xml;base64,${btoa(sparkSvg(series, w, h))}` }), style({ width: `${w}px`, height: `${h}px` }))()

export const $brand: I$Node = $frame(
  $node(style({ flex: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '44px' }))(
    $logo(300),
    $wordmark(120),
    $element('p')(
      style({ fontSize: '44px', color: palette.foreground, margin: '0', maxWidth: '820px', lineHeight: '1.3', textAlign: 'center' })
    )($text('A shared wallet, operated by humans and agents'))
  )
)

export const $page = (title: string, subtitle: string): I$Node =>
  $frame(
    $brandRow,
    $node(style({ flex: '1', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '28px' }))(
      $element('h1')(style({ fontSize: '120px', fontWeight: '700', lineHeight: '1.02', margin: '0', color: palette.message }))($text(title)),
      $element('p')(style({ fontSize: '48px', color: palette.foreground, margin: '0', maxWidth: '1000px', lineHeight: '1.25' }))($text(subtitle))
    )
  )

const COLUMNS = { venues: '64px', perf: 460, row: 140 }

const $windowTitle = (label: string): I$Node =>
  $node(style({ display: 'flex', alignItems: 'flex-end', gap: '22px' }))(
    $element('h1')(style({ fontSize: '72px', fontWeight: '700', lineHeight: '1', margin: '0' }))($text(label)),
    $node(style({ display: 'flex', flexDirection: 'column', paddingBottom: '4px', fontSize: '30px', fontWeight: '700', lineHeight: '1.1', color: palette.foreground }))(
      $element('span')($text('Last')),
      $element('span')($text('activity'))
    )
  )

export const $masters = (rows: ILeaderRow[]): I$Node =>
  $frame(
    $brandRow,
    $node(style({ flex: '1', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '24px' }))(
      $windowTitle(LEADERBOARD_WINDOW),
      $node(style({ display: 'flex', flexDirection: 'column' }))(
        ...rows.map(row => {
          const venues = row.venues.filter(id => VENUE_ICONS[id] !== undefined)
          return $node(style({ display: 'flex', alignItems: 'center', gap: '24px', padding: '12px 0' }))(
            $node(style({ display: 'flex', alignItems: 'center', gap: '18px', flex: '1', minWidth: '0' }))(
              $avatar(row.avatar, 84),
              $node(style({ display: 'flex', flexDirection: 'column', gap: '4px' }))(
                $element('span')(style({ fontSize: '36px', fontWeight: '700', whiteSpace: 'nowrap' }))($text(row.label)),
                $address(row.master, 26)
              )
            ),
            $node(style({ display: 'flex', flexDirection: 'column', width: COLUMNS.venues, justifyContent: 'center', alignItems: 'center' }))(
              ...(venues.length === 0
                ? [$element('span')(style({ fontSize: '32px', color: palette.foreground }))($text('-'))]
                : [
                    ...venues.slice(0, venues.length > 3 ? 2 : 3).map((id, i) =>
                      $node(
                        style({
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '60px',
                          height: '60px',
                          marginTop: i === 0 ? '0px' : '-22px',
                          borderRadius: '50%',
                          border: `6px solid ${palette.background}`,
                          background: palette.horizon
                        })
                      )($element('img')(attr({ src: `data:image/svg+xml;base64,${btoa(venueIconSvg(id, palette.message))}` }), style({ width: '30px', height: '30px' }))())
                    ),
                    ...(venues.length > 3
                      ? [
                          $element('span')(
                            style({
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              minWidth: '60px',
                              height: '60px',
                              padding: '0 6px',
                              marginTop: '-22px',
                              borderRadius: '30px',
                              border: `6px solid ${palette.background}`,
                              background: palette.horizon,
                              fontSize: '26px',
                              fontWeight: '700'
                            })
                          )($text(`${venues.length - 2}`))
                        ]
                      : [])
                  ])
            ),
            $node(style({ position: 'relative', display: 'flex', alignItems: 'center', width: `${COLUMNS.perf}px`, height: `${COLUMNS.row}px` }))(
              ...(row.spark.length > 1 ? [$node(style({ position: 'absolute', left: '0px', top: '0px', display: 'flex' }))($spark(row.spark, COLUMNS.perf, COLUMNS.row))] : []),
              $node(style({ position: 'relative', display: 'flex' }))(
                $stacked(
                  'flex-start',
                  $usd(row.pnl, 56, '700', toneColor(row.tone)),
                  $element('span')(style({ fontSize: '32px', lineHeight: '1.1', color: palette.foreground }))($text(`${row.roi === null ? '-' : row.roi} ROI`))
                )
              )
            )
          )
        })
      )
    )
  )

const $puppetStack = (avatars: string[], count: number, box: number, font: number) => {
  if (count === 0) return $element('span')(style({ fontSize: `${font}px`, fontWeight: '700', color: palette.message }))($text('0'))
  const ring = Math.round(box / 6)
  const step = Math.round(box / 2)
  const shown = avatars.slice(0, count > avatars.length ? avatars.length - 1 : avatars.length)
  const rest = count > avatars.length ? `${count - shown.length}` : null
  const pill = rest === null ? 0 : Math.max(box, Math.round(rest.length * box * 0.34) + 2 * ring + Math.round(box / 5))
  const at = (i: number) => i * step - ring
  return $node(style({ position: 'relative', display: 'flex', width: `${rest === null ? at(shown.length - 1) + box : at(shown.length) + pill}px`, height: `${box}px` }))(
    ...shown.map((src, i) =>
      $element('img')(
        attr({ src }),
        style({ position: 'absolute', left: `${at(i)}px`, top: '0px', width: `${box}px`, height: `${box}px`, borderRadius: '50%', border: `${ring}px solid ${palette.background}` })
      )()
    ),
    ...(rest === null
      ? []
      : [
          $element('span')(
            style({
              position: 'absolute',
              left: `${at(shown.length)}px`,
              top: '0px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: `${pill}px`,
              height: `${box}px`,
              borderRadius: `${step}px`,
              border: `${ring}px solid ${palette.background}`,
              background: palette.horizon,
              fontSize: `${step}px`,
              fontWeight: '700',
              color: palette.message
            })
          )($text(rest))
        ])
  )
}

const $address = (master: string, size: number) =>
  $node(style({ display: 'flex', alignItems: 'baseline' }))(
    $element('span')(style({ fontSize: `${Math.round(size * 0.85)}px`, color: palette.foreground }))($text(`${master.slice(0, 6)}…`)),
    $element('span')(style({ fontSize: `${size}px`, color: palette.message }))($text(master.slice(-4)))
  )

const $stacked = (align: 'flex-start' | 'flex-end', $top: I$Node, $bottom: I$Node) =>
  $node(style({ display: 'flex', flexDirection: 'column', alignItems: align, gap: '8px' }))(
    $top,
    $node(style({ display: 'flex', alignSelf: 'stretch', height: '2px', background: palette.horizon }))(),
    $bottom
  )

const $usd = (amount: string, size: number, weight: string, color: string) => {
  const at = amount.indexOf('$')
  return $node(style({ display: 'flex', alignItems: 'baseline', fontSize: `${size}px`, fontWeight: weight, lineHeight: '1.1', color }))(
    ...(at === -1
      ? [$element('span')($text(amount))]
      : [
          $element('span')($text(amount.slice(0, at))),
          $element('span')(style({ fontSize: `${Math.round(size * 0.62)}px` }))($text('$')),
          $element('span')($text(amount.slice(at + 1)))
        ])
  )
}

const $metric = (label: string, value: string, size: number) =>
  $node(style({ display: 'flex', flexDirection: 'column', gap: '12px' }))(
    $element('span')(style({ fontSize: '32px', color: palette.foreground }))($text(label)),
    $usd(value, size, '700', palette.message)
  )

export const $master = (card: IMasterCard): I$Node => {
  const figure = card.fundValue.length + card.allocated.length > 16 ? 48 : 60
  return $frame(
    $brandRow,
    $node(style({ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '36px', marginTop: '48px' }))(
      $avatar(card.avatar, 200),
      $node(style({ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '0', maxWidth: '836px' }))(
        $element('h1')(
          style({
            fontSize: '96px',
            fontWeight: '700',
            lineHeight: '1.05',
            margin: '0',
            color: palette.message,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          })
        )($text(card.label)),
        $element('span')(style({ fontSize: '36px', color: palette.foreground }))($text(`${card.master.slice(0, 6)}…${card.master.slice(-4)}`))
      )
    ),
    $node(style({ position: 'relative', display: 'flex', alignItems: 'center', height: '540px', marginTop: '40px' }))(
      ...(card.spark.length > 1 ? [$node(style({ position: 'absolute', right: '0px', top: '0px', display: 'flex' }))($spark(card.spark, 880, 540))] : []),
      $node(style({ position: 'relative', display: 'flex', flexDirection: 'column', gap: '18px' }))(
        $windowTitle(card.window),
        $usd(card.pnl, card.pnl.length > 9 ? 104 : 136, '800', toneColor(card.tone)),
        $node(style({ display: 'flex', height: '3px', background: palette.horizon }))(),
        $node(style({ display: 'flex', alignItems: 'baseline', gap: '12px' }))(
          $element('span')(style({ fontSize: '44px', color: palette.message }))($text(card.roi === null ? '-' : card.roi)),
          $element('span')(style({ fontSize: '36px', color: palette.foreground }))($text('ROI'))
        )
      )
    ),
    $node(style({ display: 'flex', justifyContent: 'center', gap: '64px', marginTop: 'auto' }))(
      $metric('Fund value', card.fundValue, figure),
      $metric('Allocated', card.allocated, figure),
      $node(style({ display: 'flex', flexDirection: 'column', gap: '12px' }))(
        $element('span')(style({ fontSize: '32px', color: palette.foreground }))($text('Puppets')),
        $node(style({ display: 'flex', alignItems: 'center', height: `${Math.round(figure * 1.1)}px` }))($puppetStack(card.puppets, card.puppetCount, 96, figure))
      )
    )
  )
}

export const $puppet = (card: IPuppetCard): I$Node =>
  $frame(
    $brandRow,
    $node(style({ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '36px', marginTop: '48px' }))(
      $avatar(card.avatar, 200),
      $node(style({ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '0', maxWidth: '836px' }))(
        $element('h1')(style({ fontSize: '96px', fontWeight: '700', lineHeight: '1.05', margin: '0', color: palette.message, whiteSpace: 'nowrap' }))(
          $text(`${card.account.slice(0, 6)}…${card.account.slice(-4)}`)
        ),
        $element('span')(style({ fontSize: '36px', color: palette.foreground, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }))(
          $text(card.masterOf === null ? 'Puppet' : `Puppet · Master of ${card.masterOf}`)
        )
      )
    ),
    $node(style({ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '18px', height: '540px', marginTop: '40px' }))(
      $element('span')(style({ fontSize: '44px', color: palette.foreground }))($text('In funds')),
      $usd(card.inFunds, card.inFunds.length > 9 ? 104 : 136, '800', palette.message)
    ),
    $node(style({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', marginTop: 'auto' }))(
      $element('span')(style({ fontSize: '32px', color: palette.foreground }))($text('Funds')),
      $puppetStack(card.funds, card.fundCount, 96, 60)
    )
  )
