import type { Connector } from '@wagmi/core'
import { map, switchMap } from 'aelea/stream'
import { type IBehavior, multicast } from 'aelea/stream-extended'
import { $element, $text, attr, component, style } from 'aelea/ui'
import { $column, $defaultButtonContainer, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $ButtonSecondary, $icon } from '@/ui-components'
import { $walletConnectLogo } from '../common/$icons.js'
import { connectors, connectWallet, WALLETCONNECT_PROJECT_ID } from '../wallet/index.js'

const $walletIcon = (connector: Connector) => {
  const iconUrl =
    connector.icon ||
    (connector.id && connector.id !== 'default' && connector.id !== 'walletConnect'
      ? `https://explorer-api.walletconnect.com/v3/logo/md/${WALLETCONNECT_PROJECT_ID}/${connector.id}`
      : null)
  const $wcLogo =
    connector.id === 'walletConnect'
      ? $icon({
          $content: $walletConnectLogo,
          viewBox: '0 0 32 32',
          size: '20px'
        })
      : null
  const fallbackLabel = (connector.name || connector.id || '?').slice(0, 1).toUpperCase()

  const $content = $wcLogo
    ? $wcLogo
    : iconUrl
      ? $element('img')(
          attr({
            src: iconUrl,
            alt: `${connector.name || connector.id} icon`,
            loading: 'lazy'
          }),
          style({
            width: '100%',
            height: '100%',
            objectFit: 'cover'
          })
        )()
      : $text(fallbackLabel)

  return $row(
    style({
      width: '32px',
      height: '32px',
      borderRadius: '8px',
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colorShade(palette.foreground, 8),
      color: palette.message,
      fontWeight: 'bold',
      flexShrink: '0'
    })
  )($content)
}

export const $WalletConnect = () =>
  component(
    (
      // The `connect` output is load-bearing even when the caller ignores its value:
      // wiring it via `connect: connectTether()` is what subscribes the click → map
      // operator chain that actually invokes `connectWallet(connector.id)`. Without
      // an external wiring, the chain stays dormant and clicks don't trigger connect.
      [connect, connectTether]: IBehavior<PointerEvent, ReturnType<typeof connectWallet>> //
    ) => {
      const connectStream = multicast(connect)
      return [
        $column(spacing.small)(
          switchMap(
            list =>
              $column(spacing.small)(
                ...list
                  .slice()
                  .reverse()
                  .map(connector =>
                    $ButtonSecondary({
                      $container: $defaultButtonContainer(
                        style({
                          color: palette.message,
                          borderStyle: 'solid',
                          backgroundColor: palette.background,
                          borderWidth: '1px',
                          borderRadius: '100px',
                          padding: '12px 16px',
                          borderColor: colorShade(palette.foreground, 25)
                        })
                      ),
                      $content: $row(spacing.default, style({ alignItems: 'center', width: '100%' }))(
                        $walletIcon(connector),
                        $text(connector.name || 'Connect Wallet')
                      )
                    })({
                      click: connectTether(map(() => connectWallet(connector.id)))
                    })
                  )
              ),
            connectors
          )
        ),
        { connect: connectStream }
      ]
    }
  )
