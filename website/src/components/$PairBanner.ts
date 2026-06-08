import { sealPairingPayload } from '@puppet/sdk/account'
import type { ISubaccountState } from '@puppet/sdk/state'
import { combine, empty, type IStream, map, nowWith, op, switchLatest, switchPromises } from 'aelea/stream'
import { state } from 'aelea/stream-extended'
import { $node, $text, component, effectProp, type I$Node, style } from 'aelea/ui'
import { $column, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { $defaultButtonPrimary, text } from '@/ui-components'
import { $card } from '../common/elements/$common.js'
import { indexerEndpoint } from '../io/indexer/sql.js'
import { wsUrl as matchmakerUrl } from '../io/matchmaker/index.js'
import { subject } from '../utils/subject.js'
import type { IConnectedWallet } from '../wallet/index.js'

interface IPairBanner {
  walletQuery: IStream<Promise<IConnectedWallet | null>>
  subaccountList: IStream<Promise<ISubaccountState[]>>
}

const $hint = (message: string): I$Node => $node(style({ color: palette.foreground }))($text(message))

function readPairParams(): { port: string; token: string; epk: string } | null {
  if (typeof location === 'undefined') return null
  const sp = new URLSearchParams(location.search)
  const port = sp.get('pair')
  const token = sp.get('token')
  const epk = sp.get('epk')
  return port && token && epk ? { port, token, epk } : null
}

export const $PairBanner = ({ walletQuery, subaccountList }: IPairBanner) =>
  component(() => {
    const pairParams = readPairParams()
    if (!pairParams) return [empty]

    const pairMessage = subject<string>()

    const $content = switchLatest(
      map(
        p => {
          const wallet = p.wallet
          if (!wallet?.session) {
            return $hint('Connect your wallet and sign a session to pair your agent.')
          }
          if (!p.masters.some(a => a.isMaster)) {
            return $hint('Create and fund a trading account first, then reopen your agent’s pair link.')
          }
          const session = wallet.session
          return $column(spacing.small)(
            $node(style({ fontSize: text.lg, fontWeight: '600', color: palette.message }))($text('Pair your agent')),
            $hint(
              'Hand this browser session to the local agent waiting to pair. It is encrypted to your agent, sent only to 127.0.0.1, and never written to disk.'
            ),
            $defaultButtonPrimary(
              style({ alignSelf: 'flex-start' }),
              effectProp(
                'onclick',
                nowWith(() => () => {
                  sealPairingPayload(pairParams.epk, {
                    user: wallet.address,
                    // Seal the derived session signer key, never the wallet bind
                    // signature: the operator only needs to sign operate intents, so
                    // it should never receive the stronger deploy-auth secret.
                    signerKey: session.privateKey,
                    endpoints: {
                      matchmakerUrl,
                      indexerUrl: indexerEndpoint,
                      rpcUrl: `${location.origin}/api/rpc?network=arbitrum`
                    }
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
                    .catch(() => pairMessage.push('Pairing failed. Make sure the agent is running on this machine.'))
                })
              )
            )($text('Send session to agent')),
            switchLatest(map(message => $hint(message), pairMessage.stream))
          )
        },
        combine({
          wallet: op(walletQuery, switchPromises, state()),
          masters: op(subaccountList, switchPromises, state())
        })
      )
    )

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
