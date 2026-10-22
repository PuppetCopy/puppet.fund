import { combine, empty, filter, type IStream, just, map, nowWith, op, start, switchLatest, switchMap } from 'aelea/stream'
import { fromCallback, type IBehavior, PromiseStatus, promiseState, state } from 'aelea/stream-extended'
import { $element, $node, $text, attr, attrBehavior, component, effectProp, type I$Node, style } from 'aelea/ui'
import { $column, $defaultButtonContainer, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $alertNegativeContainer, $ButtonSecondary, $icon, $intermediateBorder, $spinner, INTERMEDIATE_FILL, text } from '@/ui-components'
import { renderSVG } from 'uqr'
import { $walletConnectLogo } from '../common/$icons.js'
import { connectErrorText, INJECTED_ID, type IWalletControl, type IWalletEntry, type IWalletIntent, WALLET_CONNECT_ID } from '../wallet/connect.js'

const $walletIconBox = $row(
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
)

const $walletIcon = (entry: IWalletEntry) => {
  const iconUrl = entry.icon
  const $wcLogo =
    entry.id === WALLET_CONNECT_ID
      ? $icon({
          $content: $walletConnectLogo,
          viewBox: '0 0 32 32',
          size: '20px'
        })
      : null
  const fallbackLabel = entry.name.slice(0, 1).toUpperCase()

  const $content = $wcLogo
    ? $wcLogo
    : iconUrl
      ? $element('img')(
          attr({
            src: iconUrl,
            alt: `${entry.name} icon`,
            loading: 'lazy'
          }),
          style({
            width: '100%',
            height: '100%',
            objectFit: 'cover'
          })
        )()
      : $text(fallbackLabel)

  return $walletIconBox($content)
}

const WALLET_APPS = [
  { name: 'MetaMask', link: (page: URL): string => `https://metamask.app.link/dapp/${page.host}${page.pathname}${page.search}` },
  { name: 'Coinbase Wallet', link: (page: URL): string => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(page.href)}` },
  { name: 'Trust Wallet', link: (page: URL): string => `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(page.href)}` }
]

const PILL = {
  color: palette.message,
  textDecoration: 'none',
  border: `1px solid ${colorShade(palette.foreground, 25)}`,
  borderRadius: '100px',
  padding: '12px 16px',
  backgroundColor: palette.background,
  fontSize: text.sm,
  fontWeight: '600',
  whiteSpace: 'nowrap',
  cursor: 'pointer'
}

const $pairing = (uri: string | null): I$Node =>
  $column(
    spacing.small,
    style({ alignItems: 'center', padding: '12px', borderRadius: '16px', backgroundColor: palette.background, border: `1px solid ${colorShade(palette.foreground, 25)}` })
  )(
    uri === null
      ? $intermediateBorder($node(style({ width: '200px', height: '200px', borderRadius: '8px', boxSizing: 'border-box' })))(
          $node(style({ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }))($spinner)
        )
      : $element('img')(
          attr({ src: `data:image/svg+xml;base64,${btoa(renderSVG(uri, { border: 2 }))}`, alt: 'WalletConnect pairing code' }),
          style({ width: '200px', height: '200px', borderRadius: '8px', backgroundColor: '#ffffff' })
        )(),
    $element('span')(style({ fontSize: text.xs, color: palette.foreground }))($text('Scan with your wallet app')),
    $row(spacing.small, style({ flexWrap: 'wrap', justifyContent: 'center' }))(
      ...(uri === null
        ? ['Open wallet', 'Copy link'].map(label =>
            $element('span')(style({ ...PILL, color: 'transparent', ...INTERMEDIATE_FILL, borderColor: 'transparent', cursor: 'default' }))($text(label))
          )
        : [
            $element('a')(attr({ href: uri }), style(PILL))($text('Open wallet')),
            $element('button')(
              attr({ type: 'button' }),
              style(PILL),
              effectProp(
                'onclick',
                nowWith(() => () => {
                  void navigator.clipboard.writeText(uri)
                })
              )
            )($text('Copy link'))
          ])
    )
  )

type IEntryStatus = { kind: 'idle' } | { kind: 'pending' } | { kind: 'error'; message: string }

const rankOf = (entry: IWalletEntry): number => (entry.id === WALLET_CONNECT_ID ? 2 : entry.id === INJECTED_ID ? 1 : 0)

export interface I$WalletConnect {
  control: IWalletControl
}

export const $WalletConnect = ({ control }: I$WalletConnect) =>
  component(([connect, connectTether]: IBehavior<PointerEvent, IWalletIntent>) => {
    const attempts = control.attempts

    const statusById: IStream<Record<string, IEntryStatus>> = state({} as Record<string, IEntryStatus>)(
      switchMap(
        ({ id, result }) =>
          map(
            (res): Record<string, IEntryStatus> => {
              if (res.status === PromiseStatus.PENDING) return { [id]: { kind: 'pending' } }
              if (res.status === PromiseStatus.ERROR) return { [id]: { kind: 'error', message: connectErrorText(res.error) } }
              return {}
            },
            promiseState(just(result))
          ),
        attempts
      )
    )

    const anyPending: IStream<boolean> = map(
      byId => Object.values(byId).some(s => s.kind === 'pending'),
      statusById
    )

    return [
      $column(spacing.small)(
        switchMap(
          list =>
            $column(spacing.small)(
              ...[...list]
                .sort((a, b) => rankOf(a) - rankOf(b))
                .map(entry => {
                  const entryStatus: IStream<IEntryStatus> = map(byId => byId[entry.id] ?? { kind: 'idle' }, statusById)

                  return $column(spacing.small)(
                    $ButtonSecondary({
                      disabled: anyPending,
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
                              'aria-label': s.kind === 'pending' ? `Connecting to ${entry.name}` : `Connect ${entry.name}`,
                              'aria-busy': s.kind === 'pending' ? 'true' : 'false'
                            }),
                            entryStatus
                          )
                        )
                      ),
                      $content: $row(spacing.default, style({ alignItems: 'center', width: '100%' }))($walletIcon(entry), $text(entry.name))
                    })({
                      click: connectTether(map((): IWalletIntent => ({ connect: entry.id })))
                    }),
                    switchMap(s => (s.kind === 'error' ? $alertNegativeContainer(style({ fontSize: text.sm }))($text(s.message)) : empty), entryStatus),
                    ...(entry.id === WALLET_CONNECT_ID
                      ? [
                          switchLatest(
                            map(
                              p => (p.status.kind === 'pending' ? $pairing(p.uri) : empty),
                              combine({
                                status: entryStatus,
                                uri: op(
                                  attempts,
                                  filter(next => next.id === entry.id),
                                  map(() =>
                                    start(
                                      null,
                                      fromCallback<string>(cb => {
                                        const onUri = (payload: unknown): void => {
                                          if (typeof payload === 'string') cb(payload)
                                        }
                                        entry.provider.on('display_uri', onUri)
                                        return () => entry.provider.removeListener('display_uri', onUri)
                                      })
                                    )
                                  ),
                                  switchLatest
                                )
                              })
                            )
                          )
                        ]
                      : [])
                  )
                }),
              ...(list.some(entry => entry.id !== WALLET_CONNECT_ID)
                ? []
                : [
                    $column(spacing.small, style({ alignItems: 'center' }))(
                      $element('span')(style({ fontSize: text.xs, color: palette.foreground }))($text('Or open in your wallet app')),
                      $column(spacing.small, style({ width: '100%' }))(
                        ...WALLET_APPS.map(app =>
                          $element('a')(
                            attr({ href: app.link(new URL(location.href)) }),
                            style({ ...PILL, display: 'flex', alignItems: 'center', width: '100%', boxSizing: 'border-box' })
                          )($text(app.name))
                        )
                      )
                    )
                  ])
            ),
          control.entries
        )
      ),
      { walletIntent: connect }
    ]
  })
