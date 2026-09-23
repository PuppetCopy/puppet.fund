import { type IPairedSession, sealPairingPayload } from '@puppet/sdk/account'
import { tokenRegistryRows } from '@puppet/sdk/state'
import { empty, type IStream, map, nowWith, switchLatest } from 'aelea/stream'
import { $node, $text, component, effectProp, type I$Node, style } from 'aelea/ui'
import { $column, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { $defaultButtonPrimary, $intermediatePromise, text } from '@/ui-components'
import { $card } from '../common/elements/$common.js'
import context from '../io/context.js'
import { matchmakerUrl, relayerAddress } from '../io/matchmaker/index.js'
import { subject } from '../utils/subject.js'
import type { IWalletPair } from '../wallet/index.js'
import { $WalletConnect } from './$WalletConnect.js'

const $hint = (message: string): I$Node => $node(style({ color: palette.foreground }))($text(message))

function readPairParams(): { port: string; token: string; epk: string } | null {
  if (typeof location === 'undefined') return null
  const sp = new URLSearchParams(location.search)
  const port = sp.get('pair')
  const token = sp.get('token')
  const epk = sp.get('epk')
  return port && token && epk ? { port, token, epk } : null
}

export interface I$PairBanner {
  walletPair: IStream<IWalletPair>
}

export const $PairBanner = ({ walletPair }: I$PairBanner) =>
  component(() => {
    const pairParams = readPairParams()
    if (!pairParams) return [empty]

    const pairMessage = subject<string>()

    const $content = $intermediatePromise({
      $display: map(
        async (p: IWalletPair) => {
          const root = await p.root
          const wallet = p.wallet
          if (!wallet) {
            return $column(spacing.small)(
              $hint('Connect your wallet to pair your agent.'),
              $WalletConnect()({})
            )
          }
          if (root === null) return $column(spacing.small)($hint('Your account state could not be read, so the agent cannot pair yet.'))
          if (root.fund === null) return $column(spacing.small)($hint('Open a fund first; the agent pairs to the fund it trades for.'))
          const pairing = p.keys === null ? null : p.keys.pairingOf(wallet.address, root.fund.account)
          if (pairing === null) return $column(spacing.small)($hint('This browser holds no key share for that fund; reopen it here first.'))
          const fund = root.fund
          return $column(spacing.small)(
            $node(style({ fontSize: text.lg, fontWeight: '600', color: palette.message }))($text('Pair your agent')),
            $hint(
              'Hand this fund key share to the local agent waiting to pair. It is encrypted to your agent, sent only to 127.0.0.1, and never written to disk.'
            ),
            $defaultButtonPrimary(
                  style({ alignSelf: 'flex-start' }),
                  effectProp(
                    'onclick',
                    nowWith(() => () => {
                      context
                        .getTokenRegistry()
                        .then(registry => {
                          const payload: IPairedSession = {
                            share: pairing.share,
                            signerKey: pairing.signerKey,
                            grants: pairing.grants,
                            user: wallet.address,
                            account: fund.account,
                            matchmakerUrl: new URL(matchmakerUrl, location.origin).href,
                            oracleUrl: new URL('/api/oracle', location.origin).href,
                            relayer: relayerAddress,
                            tokenRegistry: tokenRegistryRows(registry)
                          }
                          return sealPairingPayload(pairParams.epk, payload)
                        })
                        .then(sealed =>
                          fetch(`http://127.0.0.1:${pairParams.port}/session?token=${pairParams.token}`, {
                            method: 'POST',
                            body: JSON.stringify(sealed)
                          })
                        )
                        .then(r =>
                          pairMessage.push(
                            r.ok
                              ? 'Paired. Your agent received the session and is connecting.'
                              : 'Pairing failed. Make sure the agent is still running and reopen its link.'
                          )
                        )
                        .catch(() =>
                          pairMessage.push('Pairing failed. Make sure the agent is running on this machine.')
                        )
                    })
                  )
                )($text('Send session to agent')),
            switchLatest(map(message => $hint(message), pairMessage.stream))
          )
        },
        walletPair
      )
    })

    return [
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
      )($card(spacing.small)($content))
    ]
  })
