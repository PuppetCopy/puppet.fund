import { $node, $text, attr, type I$Node, style } from 'aelea/ui'
import { $column } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { $alertIcon, $alertNegativeContainer, $anchor, $externalMark, $icon, text } from '@/ui-components'

export const $betaAgreement = (): I$Node =>
  $alertNegativeContainer(style({ alignItems: 'flex-start', borderRadius: '12px' }))(
    $icon({
      $content: $alertIcon,
      viewBox: '0 0 24 24',
      width: '18px',
      svgOps: style({ minWidth: '18px', marginTop: '2px' })
    }),
    $column(style({ gap: '10px', fontSize: text.xs, color: palette.message, lineHeight: '1.5' }))(
      $node($text('Early beta on mainnet, with real funds. We tinker and iterate on versions continuously.')),
      $node($text('Expect rough edges, and deposit only what you can afford to lose.')),
      $anchor(
        attr({ href: 'https://t.me/+ooS1qp3Ar7xlYWNk', target: '_blank' }),
        style({ fontSize: text.xs, display: 'inline-flex', fontWeight: '600' })
      )($text('Report an issue on Telegram'), $externalMark())
    )
  )
