import { predictFundAccount, predictPuppetAccount } from '@puppet/sdk/account'
import { readableAddress } from '@puppet/sdk/core'
import { combine, type IStream, map, nowWith, op, switchLatest, switchPromises } from 'aelea/stream'
import { state } from 'aelea/stream-extended'
import { $node, $text, component, effectProp, type I$Node, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import type { Address } from 'viem'
import { $defaultButtonPrimary, text } from '@/ui-components'
import { $card } from '../common/elements/$common.js'
import { subject } from '../utils/subject.js'
import {
  approveConnection,
  bindSession,
  type IConnectedWallet,
  type ISessionKey,
  lastStoredSession,
  puppetActiveAccount,
  rejectConnection
} from '../wallet/index.js'

interface IExtensionBanner {
  walletQuery: IStream<Promise<IConnectedWallet | null>>
}

const $hidden: I$Node = $node(style({ display: 'none' }))()
const $hint = (message: string): I$Node => $node(style({ color: palette.foreground }))($text(message))
const $title = (message: string): I$Node =>
  $node(style({ fontSize: text.lg, fontWeight: '600', color: palette.message }))($text(message))

// The floating card is part of each VISIBLE state, so the hidden state renders nothing at
// all (no empty frame lingering after Approve/Reject).
const $frame = (...$content: I$Node[]): I$Node =>
  $node(
    style({
      position: 'fixed',
      top: '16px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '1000',
      width: 'calc(100% - 32px)',
      maxWidth: '480px'
    })
  )($card(spacing.small)($column(spacing.small)(...$content)))

function fundOf(session: ISessionKey): Address {
  return predictFundAccount(predictPuppetAccount({ user: session.user, signer: session.signer }))
}

function readableOrigin(origin: string): string {
  try {
    return new URL(origin).host
  } catch {
    return origin
  }
}

// Consent prompt for a pending dApp connection: the extension opened
// /portfolio?connect-extension=1&origin=<dApp>. Approve grants that origin access to the
// fund (and resolves its eth_requestAccounts); reject denies it. Hidden once connected.
export const $ExtensionBanner = ({ walletQuery }: IExtensionBanner) =>
  component(() => {
    const sp = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null
    if (!sp || sp.get('connect-extension') === null) return [$hidden]
    const origin = sp.get('origin') ?? ''

    const dismissed = subject<boolean>()
    // Bumped after binding a session, so the prompt re-reads the now-stored session.
    const refresh = subject<number>()

    const $content = switchLatest(
      map(
        p => {
          if (p.connected || p.dismissed) return $hidden

          const session = p.wallet?.session ?? lastStoredSession()

          if (session) {
            const fund = fundOf(session)
            return $frame(
              $title(origin ? `Connect to ${readableOrigin(origin)}?` : 'A dApp wants to connect'),
              $hint(
                `It will use your fund ${readableAddress(fund)} on Arbitrum as a wallet. Every transaction is still screened and co-signed by the protocol.`
              ),
              $row(spacing.small)(
                $defaultButtonPrimary(
                  effectProp(
                    'onclick',
                    nowWith(() => () => {
                      approveConnection({ user: session.user, privateKey: session.privateKey, origin })
                        .then(() => dismissed.push(true))
                        .catch(e => console.error('[Puppet] approve failed', e))
                    })
                  )
                )($text('Approve')),
                $defaultButtonPrimary(
                  style({ opacity: '0.7' }),
                  effectProp(
                    'onclick',
                    nowWith(() => () => {
                      rejectConnection(origin)
                        .then(() => dismissed.push(true))
                        .catch(e => console.error('[Puppet] reject failed', e))
                    })
                  )
                )($text('Reject'))
              )
            )
          }

          // Connected wallet but no session yet: let the user sign one inline, then the
          // prompt advances to Approve.
          if (p.wallet) {
            const wallet = p.wallet
            return $frame(
              $title(origin ? `Connect to ${readableOrigin(origin)}` : 'Sign a session'),
              $hint('Sign a session once so the extension can act as your fund. Your key never leaves this site.'),
              $defaultButtonPrimary(
                effectProp(
                  'onclick',
                  nowWith(() => () => {
                    bindSession(wallet)
                      .then(() => refresh.push(Date.now()))
                      .catch(e => console.error('[Puppet] session sign failed', e))
                  })
                )
              )($text('Sign session'))
            )
          }

          return $frame(
            $title('Connect Puppet Wallet'),
            $hint('Connect the wallet you created your account with, then sign a session to let a dApp use your fund.')
          )
        },
        combine({
          wallet: op(walletQuery, switchPromises, state(null)),
          connected: puppetActiveAccount,
          dismissed: op(dismissed.stream, state(false)),
          refresh: op(refresh.stream, state(0))
        })
      )
    )

    return [$content]
  })
