import { combine, empty, filter, type IStream, just, map, op, switchLatest, switchMap } from 'aelea/stream'
import { type IBehavior, PromiseStatus, promiseState, state } from 'aelea/stream-extended'
import { component, style } from 'aelea/ui'
import { $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { $FieldLabeled, $infoTooltip } from '@/ui-components'
import type { IConnectedWallet } from '../wallet/index.js'
import { isWcLink } from '../wallet/wcUri.js'
import { $EnableSession } from './$enableSession.js'

type IPairStatus = { kind: 'pending' } | { kind: 'error'; text: string }

export interface I$WalletTunnel {
  walletState: IStream<IConnectedWallet | null>
}

export const $WalletTunnel = ({ walletState }: I$WalletTunnel) =>
  component(([changeUri, changeUriTether]: IBehavior<string>) => {
    const uri = state('', changeUri)
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
        return map(
          (res): IPairStatus | null => {
            if (res.status === PromiseStatus.PENDING) return { kind: 'pending' }
            if (res.status === PromiseStatus.ERROR) {
              console.error('[wc] connect failed', res.error)
              return { kind: 'error', text: 'Could not link the dApp. Paste a fresh link and try again.' }
            }
            return null
          },
          promiseState(just(paired))
        )
      }, pairTrigger)
    )
    const inputError: IStream<string | null> = map(
      ({ input, status }) => {
        const link = input.trim()
        if (link.length > 0 && !isWcLink(link))
          return 'That is not a valid WalletConnect link. Copy a fresh one from the dApp.'
        return status?.kind === 'error' ? status.text : null
      },
      combine({ input: uri, status: connectStatus })
    )
    return [
      switchLatest(
        map(w => {
          if (!w) return empty
          if (!w.session)
            return $row(spacing.small, style({ alignItems: 'center' }))(
              $EnableSession(w)({}),
              $infoTooltip(
                'A session key signs your trades automatically, with no wallet popup per action. It only acts within the rules you sign, can never move funds out, and you can revoke it anytime.',
                palette.foreground,
                '16px'
              )
            )
          return $FieldLabeled({
            label: null,
            placeholder: 'Paste wc: link',
            value: uri,
            hint: map(s => (s?.kind === 'pending' ? 'Connecting…' : ''), connectStatus),
            validation: inputError
          })({ change: changeUriTether() })
        }, walletState)
      ),
      {}
    ]
  })
