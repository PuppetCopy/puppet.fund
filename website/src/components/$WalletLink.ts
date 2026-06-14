import { combine, empty, filter, type IStream, map, op, skip, switchLatest } from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import { $element, $node, $text, attr, component, type INode, nodeEvent, style, stylePseudo } from 'aelea/ui'
import { $column, $Popover, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $icon, text } from '@/ui-components'
import { $walletConnectLogo } from '../common/$icons.js'
import type { IConnectedWallet } from '../wallet/index.js'
import {
  hasPersistedWalletLink,
  type IWalletLinkSession,
  setLinkWallet,
  walletLinkConnected,
  walletLinkSessions
} from '../wallet/walletLinkState.js'
import { $WalletTunnel } from './$WalletTunnel.js'

export interface I$WalletLink {
  walletState: IStream<IConnectedWallet | null>
  size?: number
}

const prettyUrl = (url: string): string => url.replace(/^https?:\/\//, '').replace(/\/$/, '')

void hasPersistedWalletLink().then(has => {
  if (has) {
    console.info('[wc] restoring persisted session')
    void import('../wallet/walletKitConnect.js').then(m => m.startWalletConnect())
  }
})

export const $WalletLink = ({ walletState, size = 32 }: I$WalletLink) =>
  component(
    (
      [open, openTether]: IBehavior<INode, PointerEvent>,
      [disconnect, disconnectTether]: IBehavior<INode, string>
    ) => {
      const status: IStream<string> = map(
        ({ linked, wallet }) => {
          setLinkWallet(wallet)
          return linked ? palette.positive : palette.foreground
        },
        combine({ linked: walletLinkConnected, wallet: walletState })
      )

      const $connectionRow = (session: IWalletLinkSession) =>
        $row(spacing.small, style({ alignItems: 'center', justifyContent: 'space-between' }))(
          $row(spacing.small, style({ alignItems: 'center', minWidth: '0', flex: 1 }))(
            session.icon
              ? $element('img')(
                  attr({ src: session.icon, alt: '' }),
                  style({ width: '28px', height: '28px', borderRadius: '6px', objectFit: 'cover', flexShrink: 0 })
                )()
              : $node(
                  style({
                    width: '28px',
                    height: '28px',
                    borderRadius: '6px',
                    flexShrink: 0,
                    backgroundColor: colorShade(palette.foreground, 25),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: text.sm,
                    color: palette.message
                  })
                )($text((session.name || session.url || '?').slice(0, 1).toUpperCase())),
            $column(style({ minWidth: '0' }))(
              $node(
                style({
                  fontSize: text.sm,
                  color: palette.message,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                })
              )($text(session.name || prettyUrl(session.url))),
              $node(
                style({
                  fontSize: text.xs,
                  color: palette.foreground,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                })
              )($text(prettyUrl(session.url)))
            )
          ),
          $node(
            style({
              cursor: 'pointer',
              fontSize: text.xs,
              color: palette.foreground,
              padding: '5px 10px',
              borderRadius: '100px',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              border: `1px solid ${colorShade(palette.foreground, 30)}`
            }),
            stylePseudo(':hover', { color: palette.negative, borderColor: palette.negative }),
            disconnectTether(
              nodeEvent('click'),
              map(() => session.topic)
            )
          )($text('Disconnect'))
        )

      return [
        $Popover({
          $container: $node(style({ display: 'flex' })),
          $open: map(
            () =>
              $column(spacing.default, style({ minWidth: '300px', maxWidth: '340px' }))(
                switchLatest(
                  map(
                    sessions =>
                      sessions.length === 0
                        ? empty
                        : $column(spacing.small)(
                            $node(style({ fontSize: text.base, fontWeight: 'bold', color: palette.message }))(
                              $text('Connected')
                            ),
                            ...sessions.map($connectionRow)
                          ),
                    walletLinkSessions
                  )
                ),
                switchLatest(
                  map(topic => {
                    void import('../wallet/walletKitConnect.js').then(m => m.disconnectDapp(topic))
                    return empty
                  }, disconnect)
                ),
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
              map(
                c => $icon({ $content: $walletConnectLogo, viewBox: '0 0 32 32', width: `${Math.round(size * 0.56)}px`, fill: c }),
                status
              )
            )
          )
        })({}),
        {}
      ]
    }
  )
