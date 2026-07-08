import { type IPairedSession, predictPuppetAccount, sealPairingPayload } from '@puppet/sdk/account'
import type { IFund } from '@puppet/sdk/schema'
import { type ISubaccountState, tokenRegistryRows } from '@puppet/sdk/state'
import { combine, constant, empty, type IStream, map, nowWith, switchLatest } from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $node, $text, component, effectProp, type I$Node, type INode, nodeEvent, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { type Hex, isAddressEqual } from 'viem'
import { $defaultButtonPrimary, text } from '@/ui-components'
import { $card } from '../common/elements/$common.js'
import context from '../io/context.js'
import { matchmakerUrl } from '../io/matchmaker/index.js'
import { subject } from '../utils/subject.js'
import type { IConnectedWallet } from '../wallet/index.js'
import { resolvedWalletPair } from '../wallet/pair.js'
import { $fundProfile } from './$AccountProfile.js'
import { $EnableSession } from './$enableSession.js'
import { $WalletConnect } from './$WalletConnect.js'

interface IPairBanner {
  walletQuery: IStream<Promise<IConnectedWallet | null>>
  walletState: IStream<Promise<ISubaccountState | null>>
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

export const $PairBanner = ({ walletQuery, walletState: rootStateQuery }: IPairBanner) =>
  component(([selectFund, selectFundTether]: IBehavior<INode, Hex>, [_connect, connectTether]: IBehavior<unknown>) => {
    const pairParams = readPairParams()
    if (!pairParams) return [empty]
    const walletPair = resolvedWalletPair(walletQuery, rootStateQuery)
    const walletState: IStream<ISubaccountState | null> = map(p => p.root, walletPair)

    const pairMessage = subject<string>()

    const $content = switchLatest(
      map(
        p => {
          const wallet = p.wallet
          if (!wallet) {
            return $column(spacing.small)(
              $hint('Connect your wallet to pair your agent.'),
              $WalletConnect()({ connect: connectTether() })
            )
          }
          if (!wallet.session) {
            return $column(spacing.small)($hint('Sign a session to pair your agent.'), $EnableSession(wallet)({}))
          }
          const session = wallet.session
          const master = predictPuppetAccount({ user: wallet.address, signer: session.signer })
          const masteredFunds = (p.root?.funds ?? []).filter(f => isAddressEqual(f.master, master))
          if (masteredFunds.length === 0) {
            return $hint('Create and fund a trading account first, then reopen your agent’s pair link.')
          }
          const onlyFund = masteredFunds.length === 1
          const selectedBid: Hex | null = onlyFund ? masteredFunds[0]!.baseToken : p.sel
          const selectedFund = masteredFunds.find(f => f.baseToken === selectedBid) ?? null

          const $fundRow = (f: IFund): I$Node =>
            $row(
              spacing.small,
              style({
                alignItems: 'center',
                padding: '8px 10px',
                borderRadius: '10px',
                cursor: onlyFund ? 'default' : 'pointer',
                border: `1px solid ${selectedFund?.baseToken === f.baseToken ? palette.primary : colorShade(palette.foreground, 18)}`
              }),
              ...(onlyFund ? [] : [selectFundTether(nodeEvent('click'), constant(f.baseToken))])
            )($fundProfile({ master: f.master, baseToken: f.baseToken, name: f.name }, 36, f))

          return $column(spacing.small)(
            $node(style({ fontSize: text.lg, fontWeight: '600', color: palette.message }))($text('Pair your agent')),
            $hint(
              'Hand this browser session to the local agent waiting to pair. It is encrypted to your agent, sent only to 127.0.0.1, and never written to disk.'
            ),
            onlyFund ? empty : $hint('Choose which fund this agent trades.'),
            $column(spacing.small)(...masteredFunds.map($fundRow)),
            selectedFund
              ? $defaultButtonPrimary(
                  style({ alignSelf: 'flex-start' }),
                  effectProp(
                    'onclick',
                    nowWith(() => () => {
                      context
                        .getTokenRegistry()
                        .then(registry => {
                          const payload: IPairedSession = {
                            signerKey: session.privateKey,
                            user: wallet.address,
                            baseToken: selectedFund.baseToken,
                            name: selectedFund.name,
                            matchmakerUrl: new URL(matchmakerUrl, location.origin).href,
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
                )($text('Send session to agent'))
              : $defaultButtonPrimary(style({ alignSelf: 'flex-start', opacity: '0.5', pointerEvents: 'none' }))(
                  $text('Select a fund to pair')
                ),
            switchLatest(map(message => $hint(message), pairMessage.stream))
          )
        },
        combine({
          wallet: map(p => p.wallet, walletPair),
          root: walletState,
          sel: state(null, selectFund)
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
