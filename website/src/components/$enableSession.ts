import { empty, map, nowWith } from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import { $node, $text, attr, component, effectProp, type I$Node, style } from 'aelea/ui'
import { $column, $Popover, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import {
  $alertIcon,
  $alertNegativeContainer,
  $anchor,
  $ButtonSecondary,
  $defaultButtonPrimary,
  $defaultButtonSecondary,
  $icon,
  text
} from '@/ui-components'
import { bindSession, type IConnectedWallet, refreshWallet } from '../wallet/index.js'

export const $enableSessionDisclaimer = (): I$Node[] => [
  $node(style({ fontSize: text.base, fontWeight: 'bold', color: palette.message }))($text('Enable a signing session')),
  $node(style({ fontSize: text.sm, color: palette.message, lineHeight: '1.5' }))(
    $text(
      'Sign once to create a session key on this device. Your trades then sign automatically, with no wallet popup on every action.'
    )
  ),
  $node(style({ fontSize: text.sm, color: palette.foreground, lineHeight: '1.5' }))(
    $text(
      'The key only acts within the rules you sign and can never move funds out. It stays on this device, and you can revoke it anytime.'
    )
  ),
  $alertNegativeContainer(style({ alignItems: 'flex-start', borderRadius: '12px' }))(
    $icon({
      $content: $alertIcon,
      viewBox: '0 0 24 24',
      width: '18px',
      svgOps: style({ minWidth: '18px', marginTop: '2px' })
    }),
    $column(spacing.tiny)(
      $node(style({ fontSize: text.xs, color: palette.message, lineHeight: '1.5' }))(
        $text(
          'Puppet is in early beta on Arbitrum mainnet. These are real funds, so only deposit what you can afford to lose, and expect rough edges while we harden it.'
        )
      ),
      $anchor(
        attr({ href: 'https://t.me/+ooS1qp3Ar7xlYWNk', target: '_blank' }),
        style({ fontSize: text.xs, display: 'inline-block', fontWeight: '600', textDecoration: 'underline' })
      )($text('Report a bug on Telegram'))
    )
  )
]

export const $EnableSession = (wallet: IConnectedWallet) =>
  component(([popSession, popSessionTether]: IBehavior<PointerEvent>) => [
    $Popover({
      $container: $node(style({ display: 'flex' })),
      $open: map(
        () =>
          $column(spacing.default, style({ maxWidth: '320px' }))(
            ...$enableSessionDisclaimer(),
            $defaultButtonPrimary(
              style({ alignSelf: 'flex-end', minHeight: '40px' }),
              effectProp(
                'onclick',
                nowWith(() => () => {
                  bindSession(wallet)
                    .then(() => refreshWallet())
                    .catch(e => console.error('create session failed', e))
                })
              )
            )($text('Enable session'))
          ),
        popSession
      ),
      dismiss: empty,
      $target: $ButtonSecondary({
        $container: $defaultButtonSecondary(style({ flexShrink: '0', alignSelf: 'center' })),
        $content: $text('Sign session')
      })({ click: popSessionTether() })
    })({}),
    {}
  ])
