import { $node, $text, attr, type I$Node, style } from 'aelea/ui'
import { $column } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { $alertIcon, $alertNegativeContainer, $anchor, $icon, text } from '@/ui-components'

export const $enableSessionDisclaimer = (): I$Node[] => [
  $node(style({ fontSize: text.base, fontWeight: 'bold', color: palette.message }))($text('Enable a signing session')),
  $node(style({ fontSize: text.sm, color: palette.message, lineHeight: '1.5' }))(
    $text('Sign once to create a session key from your wallet. Trades then sign without a wallet popup.')
  ),
  $node(style({ fontSize: text.sm, color: palette.foreground, lineHeight: '1.5' }))(
    $text('It acts only within the rules you sign, never moves funds out, and you can revoke it anytime.')
  )
]

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
        style({ fontSize: text.xs, display: 'inline-block', fontWeight: '600', textDecoration: 'underline' })
      )($text('Report an issue on Telegram'))
    )
  )
