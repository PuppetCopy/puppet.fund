import { combine, filter, type IStream, map, op, skip, switchLatest } from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import { $node, $text, component, type INode, nodeEvent, style, stylePseudo } from 'aelea/ui'
import { $column, $Popover, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $icon, text } from '@/ui-components'
import { $walletConnectLogo } from '../common/$icons.js'
import type { IConnectedWallet } from '../wallet/index.js'
import { hasPersistedWalletLink, setLinkWallet, walletLinkConnected } from '../wallet/walletLinkState.js'
import { $WalletTunnel } from './$WalletTunnel.js'

export interface I$WalletLink {
  walletState: IStream<IConnectedWallet | null>
  size?: number
}

void hasPersistedWalletLink().then(has => {
  if (has) {
    console.info('[wc] restoring persisted session')
    void import('../wallet/walletKitConnect.js').then(m => m.startWalletConnect())
  }
})

export const $WalletLink = ({ walletState, size = 32 }: I$WalletLink) =>
  component(([open, openTether]: IBehavior<INode, PointerEvent>) => {
    const status: IStream<string> = map(
      ({ linked, wallet }) => {
        setLinkWallet(wallet)
        return linked ? palette.positive : palette.foreground
      },
      combine({ linked: walletLinkConnected, wallet: walletState })
    )

    return [
      $Popover({
        $container: $node(style({ display: 'flex' })),
        $open: map(
          () =>
            $column(spacing.default, style({ minWidth: '300px', maxWidth: '340px' }))(
              $column(spacing.tiny)(
                $node(style({ fontSize: text.base, fontWeight: 'bold', color: palette.message }))($text('Link a dApp')),
                $node(style({ fontSize: text.sm, color: palette.foreground, lineHeight: '1.4' }))(
                  $text('Connect this fund to GMX or any dApp over WalletConnect.')
                )
              ),
              $WalletTunnel({ walletState })({})
            ),
          open
        ),
        dismiss: op(
          walletLinkConnected,
          skip(1),
          filter(c => c)
        ),
        $target: $row(
          style({
            cursor: 'pointer',
            width: `${size}px`,
            height: `${size}px`,
            borderRadius: '50%',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colorShade(palette.foreground, 18),
            border: `1px solid ${colorShade(palette.foreground, 35)}`
          }),
          stylePseudo(':hover', {
            backgroundColor: colorShade(palette.foreground, 28),
            borderColor: colorShade(palette.foreground, 55)
          }),
          openTether(nodeEvent('click'))
        )(
          switchLatest(
            map(c => $icon({ $content: $walletConnectLogo, viewBox: '0 0 32 32', width: `${Math.round(size * 0.56)}px`, fill: c }), status)
          )
        )
      })({}),
      {}
    ]
  })
