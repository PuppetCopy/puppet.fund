import { empty, filter, type IStream, just, map, op, switchLatest, switchMap } from 'aelea/stream'
import { type IBehavior, PromiseStatus, promiseState, state } from 'aelea/stream-extended'
import { $node, $text, component, type I$Node, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $alertNegativeContainer, $FieldLabeled, text } from '@/ui-components'
import { isAppInstalled } from '../utils/pwaInstall.js'
import type { IConnectedWallet } from '../wallet/index.js'
import { $EnableSession } from './$enableSession.js'

const $hint = (s: string): I$Node =>
  $node(style({ color: palette.foreground, fontSize: text.sm, lineHeight: '1.6' }))($text(s))

const $callout = (s: string): I$Node =>
  $node(
    style({
      background: colorShade(palette.foreground, 8),
      borderLeft: `3px solid ${palette.indeterminate}`,
      padding: '12px 16px',
      borderRadius: '4px',
      color: palette.message,
      fontSize: text.sm,
      lineHeight: '1.5'
    })
  )($text(s))

type IPairStatus = { kind: 'pending' } | { kind: 'error'; text: string }

const isWcLink = (link: string): boolean => link.startsWith('wc:') && link.includes('symKey=')

export interface I$WalletTunnel {
  walletState: IStream<IConnectedWallet | null>
}

export const $WalletTunnel = ({ walletState }: I$WalletTunnel) =>
  component(([changeUri, changeUriTether]: IBehavior<string>) => {
    const installedAsApp = isAppInstalled()
    const uri = state('', changeUri)
    // No connect button: pairing fires the moment a valid wc: link is pasted into the field.
    const pairTrigger: IStream<string> = op(
      changeUri,
      map(u => u.trim()),
      filter(isWcLink)
    )
    const connectStatus: IStream<IPairStatus | null> = state(
      null as IPairStatus | null,
      switchMap((link: string) => {
        const paired = import('../wallet/walletKitConnect.js').then(async mod => {
          await mod.startWalletConnect()
          await mod.pairDapp(link)
        })
        return map((res): IPairStatus | null => {
          if (res.status === PromiseStatus.PENDING) return { kind: 'pending' }
          if (res.status === PromiseStatus.ERROR) {
            console.error('[wc] connect failed', res.error)
            return { kind: 'error', text: 'Could not link the dApp. Paste a fresh WalletConnect link and try again.' }
          }
          return null
        }, promiseState(just(paired)))
      }, pairTrigger)
    )
    return [
      $column(spacing.small)(
        switchLatest(
          map(w => {
            if (!w) return $callout('Connect your wallet first, then link a dApp here.')
            if (!w.session)
              return $column(spacing.small)(
                $hint('Enable a signing session to link a dApp.'),
                $row(spacing.default, style({ alignItems: 'center' }))($EnableSession(w)({}))
              )
            return $column(spacing.small)(
              $hint('On the dApp choose WalletConnect, copy its connection link, and paste it here.'),
              $FieldLabeled({ label: 'Pair', placeholder: 'wc:', value: uri })({ change: changeUriTether() }),
              switchLatest(
                map(
                  s =>
                    s === null
                      ? empty
                      : s.kind === 'pending'
                        ? $hint('Connecting to the dApp…')
                        : $alertNegativeContainer(style({ fontSize: text.sm }))($text(s.text)),
                  connectStatus
                )
              ),
              installedAsApp
                ? $callout('Running as an app, your dApp connection stays alive in the background.')
                : $callout('Keep this tab open while connected. The session lives in this tab, not in the background.')
            )
          }, walletState)
        )
      ),
      {}
    ]
  })
