import { $element, $node, $text, attr, type I$Node, style } from 'aelea/ui'
import type { ITopMaster } from './leaderboard.js'

const palette = {
  message: '#ffffff',
  foreground: '#94a4c2',
  background: '#0c0e13',
  horizon: '#292c37',
  middleground: '#1d202b',
  primary: '#b02a42',
  accent: '#00d1ff',
  positive: '#38e567',
  negative: '#ff6050'
}

const SIZE = 1200
const LOGO_SRC = 'logo'

const $frame = (...children: I$Node[]) =>
  $node(
    style({
      width: `${SIZE}px`,
      height: `${SIZE}px`,
      display: 'flex',
      flexDirection: 'column',
      padding: '110px',
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
      background: 'rgba(176, 42, 66, 0.08)'
    })
  )($element('img')(attr({ src: LOGO_SRC }), style({ width: `${size}px`, height: `${size}px` }))())

const $wordmark = (size: number) =>
  $element('span')(
    style({ fontSize: `${size}px`, fontWeight: '800', letterSpacing: '0.12em', color: palette.message })
  )($text('PUPPET'))

const $footer = (path: string) =>
  $node(
    style({
      marginTop: 'auto',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderTop: `1px solid ${palette.horizon}`,
      paddingTop: '34px',
      fontSize: '30px',
      color: palette.foreground,
      letterSpacing: '0.04em'
    })
  )(
    $element('span')(style({ color: palette.message }))($text('puppet.fund')),
    $element('span')(style({ color: palette.accent }))($text(path))
  )

export const $brand: I$Node = $frame(
  $node(
    style({
      flex: '1',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '52px'
    })
  )(
    $logo(420),
    $node(style({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' }))(
      $wordmark(120),
      $element('p')(
        style({
          fontSize: '40px',
          color: palette.foreground,
          margin: '0',
          textAlign: 'center',
          maxWidth: '820px',
          lineHeight: '1.3'
        })
      )($text('Wallet for traders, platform for investors'))
    )
  ),
  $footer('/')
)

const $brandRow = $node(style({ display: 'flex', alignItems: 'center', gap: '28px' }))($logo(96), $wordmark(48))

export const $leaderboard = (rows: ITopMaster[]): I$Node =>
  $frame(
    $brandRow,
    $node(style({ display: 'flex', alignItems: 'baseline', gap: '28px', marginTop: '56px' }))(
      $element('h1')(style({ fontSize: '96px', fontWeight: '700', lineHeight: '1', margin: '0' }))(
        $text('Leaderboard')
      ),
      $element('span')(style({ fontSize: '34px', color: palette.foreground }))($text('top traders · 7d'))
    ),
    $node(style({ flex: '1', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '6px' }))(
      ...rows.map(row =>
        $node(
          style({
            display: 'flex',
            alignItems: 'center',
            gap: '36px',
            padding: '24px 0',
            borderBottom: `1px solid ${palette.horizon}`,
            fontSize: '52px'
          })
        )(
          $element('span')(style({ color: palette.accent, fontWeight: '700', width: '56px' }))($text(`${row.rank}`)),
          $element('img')(
            attr({ src: row.avatar }),
            style({
              width: '80px',
              height: '80px',
              borderRadius: '20px',
              border: `2px solid ${palette.horizon}`,
              background: palette.middleground
            })
          )(),
          $element('span')(style({ flex: '1', color: palette.message, fontWeight: '600', overflow: 'hidden' }))(
            $text(row.label)
          ),
          $element('span')(style({ color: row.positive ? palette.positive : palette.negative, fontWeight: '700' }))(
            $text(row.value)
          )
        )
      )
    ),
    $footer('/leaderboard')
  )

export const $page = (title: string, subtitle: string, path: string): I$Node =>
  $frame(
    $brandRow,
    $node(
      style({
        flex: '1',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: '28px'
      })
    )(
      $element('h1')(
        style({ fontSize: '128px', fontWeight: '700', lineHeight: '1.02', margin: '0', color: palette.message })
      )($text(title)),
      $element('p')(
        style({ fontSize: '44px', color: palette.foreground, margin: '0', maxWidth: '900px', lineHeight: '1.25' })
      )($text(subtitle))
    ),
    $footer(path)
  )
