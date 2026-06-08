import type { Connector } from '@wagmi/core'
import { empty, type IStream, just, map, switchMap } from 'aelea/stream'
import { type IBehavior, multicast, PromiseStatus, promiseState, state } from 'aelea/stream-extended'
import { $element, $node, $text, attr, attrBehavior, component, style } from 'aelea/ui'
import { $column, $defaultButtonContainer, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $alertNegativeContainer, $ButtonSecondary, $icon, text } from '@/ui-components'
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

const $inlineSpinner = $node(
  style({
    width: '16px',
    height: '16px',
    flexShrink: '0',
    boxSizing: 'border-box',
    borderRadius: '50%',
    borderStyle: 'solid',
    borderWidth: '2px',
    borderColor: `${palette.message} transparent ${colorShade(palette.foreground, 30)} transparent`,
    animation: 'rotate 0.7s linear infinite'
  })
)()

const friendlyConnectError = (err: unknown): string => {
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name?: unknown }).name ?? '') : ''
  const causeName =
    err && typeof err === 'object' && 'cause' in err
      ? String((err as { cause?: { name?: unknown } }).cause?.name ?? '')
      : ''
  const message =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message?: unknown }).message ?? '')
      : typeof err === 'string'
        ? err
        : ''

  if (name === 'UserRejectedRequestError' || causeName === 'UserRejectedRequestError' || /reject/i.test(message)) {
    return 'Connection cancelled in your wallet, tap to retry'
  }
  if (/No compatible wallet found/i.test(message)) {
    return 'No compatible wallet found. Please install a supported wallet, then retry.'
  }
  if (/already in progress/i.test(message)) {
    return 'Connection already in progress'
  }
  if (/already connected/i.test(message)) {
    return 'Wallet already connected'
  }
  return message || 'Could not connect. Tap to retry.'
}

type IAttempt = { id: string; promise: ReturnType<typeof connectWallet> }
type IConnectorStatus = { kind: 'idle' } | { kind: 'pending' } | { kind: 'error'; message: string }

export const $WalletConnect = () =>
  component(([attempt, attemptTether]: IBehavior<PointerEvent, IAttempt>) => {
    const attempts = multicast(attempt)

    const connectStream = multicast(map(a => a.promise, attempts))

    const statusById: IStream<Record<string, IConnectorStatus>> = state({} as Record<string, IConnectorStatus>)(
      switchMap(
        ({ id, promise }) =>
          map(
            (res): Record<string, IConnectorStatus> => {
              if (res.status === PromiseStatus.PENDING) return { [id]: { kind: 'pending' } }
              if (res.status === PromiseStatus.ERROR)
                return { [id]: { kind: 'error', message: friendlyConnectError(res.error) } }
              return {}
            },
            promiseState(just(promise))
          ),
        attempts
      )
    )

    return [
      $column(spacing.small)(
        switchMap(
          list =>
            $column(spacing.small)(
              ...list
                .slice()
                .reverse()
                .map(connector => {
                  const connectorStatus: IStream<IConnectorStatus> = map(
                    byId => byId[connector.id] ?? { kind: 'idle' },
                    statusById
                  )
                  const isPending: IStream<boolean> = map(s => s.kind === 'pending', connectorStatus)

                  return $column(spacing.small)(
                    $ButtonSecondary({
                      disabled: isPending,
                      $container: $defaultButtonContainer(
                        style({
                          color: palette.message,
                          borderStyle: 'solid',
                          backgroundColor: palette.background,
                          borderWidth: '1px',
                          borderRadius: '100px',
                          padding: '12px 16px',
                          borderColor: colorShade(palette.foreground, 25)
                        }),
                        attrBehavior(
                          map(
                            s => ({
                              'aria-label':
                                s.kind === 'pending'
                                  ? `Connecting to ${connector.name || connector.id}`
                                  : `Connect ${connector.name || connector.id}`,
                              'aria-busy': s.kind === 'pending' ? 'true' : 'false'
                            }),
                            connectorStatus
                          )
                        )
                      ),
                      $content: $row(spacing.default, style({ alignItems: 'center', width: '100%' }))(
                        $walletIcon(connector),
                        $text(
                          map(
                            s => (s.kind === 'pending' ? 'Connecting…' : connector.name || 'Connect Wallet'),
                            connectorStatus
                          )
                        ),
                        switchMap(s => (s.kind === 'pending' ? $inlineSpinner : empty), connectorStatus)
                      )
                    })({
                      click: attemptTether(map(() => ({ id: connector.id, promise: connectWallet(connector.id) })))
                    }),
                    switchMap(
                      s =>
                        s.kind === 'error'
                          ? $alertNegativeContainer(style({ fontSize: text.sm }))($text(s.message))
                          : empty,
                      connectorStatus
                    )
                  )
                })
            ),
          connectors
        )
      ),
      { connect: connectStream }
    ]
  })
