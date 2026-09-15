import { formatThrownError } from '@puppet/sdk/compact'
import {
  combine,
  constant,
  empty,
  filter,
  type IStream,
  just,
  map,
  merge,
  op,
  skipRepeatsWith,
  switchLatest,
  switchMap
} from 'aelea/stream'
import { type IBehavior, PromiseStatus, promiseState, state } from 'aelea/stream-extended'
import {
  $element,
  $node,
  $text,
  attr,
  attrBehavior,
  component,
  type I$Node,
  type INode,
  nodeEvent,
  style,
  styleBehavior,
  stylePseudo
} from 'aelea/ui'
import { $column, $defaultInputContainer, $Popover, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $ButtonPrimary, $ButtonSecondary, $defaultButtonPrimary, $defaultMiniButtonPrimary, $defaultMiniButtonSecondary, $FieldLabeled, $icon, $infoTooltip, $labeledDivider, $popoverCaret, POPOVER_WIDTH, text } from '@/ui-components'
import type { Address } from 'viem'
import { $walletConnectLogo } from '../common/$icons.js'
import type { IConnectedWallet, IWalletPair } from '../wallet/index.js'
import {
  blockedRequest,
  disconnectDapp,
  enableSignAlerts,
  type IPendingSign,
  type IWalletLinkLogEntry,
  type IWalletLinkSession,
  pairDapp,
  pendingSign,
  resolveSignApproval,
  signAlertPermission,
  signWalletLinkSession,
  startWalletConnect,
  walletLinkLog,
  walletLinkSessions
} from '../wallet/walletLink.js'
import { isWcLink } from '../wallet/wcUri.js'
import { $enableSessionDisclaimer } from './$enableSession.js'

export interface I$WalletLink {
  walletPair: IStream<IWalletPair>
  size?: number
}

interface ILinkInfo {
  wallet: IConnectedWallet | null
  linked: boolean
  unanswered: boolean
  session: 'signed' | 'unsigned' | 'loading' | 'unavailable'
}

const prettyUrl = (url: string): string => url.replace(/^https?:\/\//, '').replace(/\/$/, '')

const $dot = (color: string): I$Node =>
  $node(style({ width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0, backgroundColor: color }))()

type IPairStatus = { kind: 'pending' } | { kind: 'error'; text: string }

const $linkTunnel = (walletState: IStream<IConnectedWallet | null>) =>
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
        const paired = startWalletConnect().then(() => pairDapp(link))
        return map((res): IPairStatus | null => {
          if (res.status === PromiseStatus.PENDING) return { kind: 'pending' }
          if (res.status === PromiseStatus.ERROR) {
            console.error('[wc] connect failed', res.error)
            return { kind: 'error', text: 'Could not link the dApp. Paste a fresh link and try again.' }
          }
          return null
        }, promiseState(just(paired)))
      }, pairTrigger)
    )
    const inputError: IStream<string | null> = map(({ input, status }) => {
      const link = input.trim()
      if (link.length > 0 && !isWcLink(link))
        return 'That is not a valid WalletConnect link. Copy a fresh one from the dApp.'
      return status?.kind === 'error' ? status.text : null
    }, combine({ input: uri, status: connectStatus }))
    return [
      switchLatest(
        map(w => {
          if (!w) return empty
          return $FieldLabeled({
            label: null,
            placeholder: 'Paste wc: link',
            value: uri,
            $input: $defaultInputContainer(
              attrBehavior(map(s => ({ disabled: s?.kind === 'pending' ? '' : null }), connectStatus)),
              styleBehavior(map(s => (s?.kind === 'pending' ? { opacity: '0.6' } : null), connectStatus))
            ),
            hint: map(s => (s?.kind === 'pending' ? 'Connecting…' : ''), connectStatus),
            validation: inputError
          })({ change: changeUriTether() })
        }, skipRepeatsWith<IConnectedWallet | null>(
          (a, b) => (a?.address ?? null) === (b?.address ?? null),
          walletState
        ))
      ),
      {}
    ]
  })

export const $WalletLink = ({ walletPair, size = 32 }: I$WalletLink) =>
  component(
    (
      [open, openTether]: IBehavior<INode, PointerEvent>,
      [disconnect, disconnectTether]: IBehavior<PointerEvent, string>,
      [signDecision, signDecisionTether]: IBehavior<PointerEvent, { id: number; approved: boolean }>,
      [enableAlerts, enableAlertsTether]: IBehavior<PointerEvent>,
      [signSession, signSessionTether]: IBehavior<PointerEvent>,
      [popSession, popSessionTether]: IBehavior<PointerEvent>
    ) => {
      const connectedWallet: IStream<IConnectedWallet | null> = map(p => p.wallet, walletPair)
      const rootState = promiseState(map(p => p.root, walletPair))

      const linkInfo: IStream<ILinkInfo> = op(
        combine({ sessions: walletLinkSessions, pair: walletPair, root: rootState }),
        map(({ sessions, pair, root }) => ({
          wallet: pair.wallet,
          linked: sessions.some(s => s.reachable !== false),
          unanswered: sessions.length > 0 && sessions.every(s => s.reachable === false),
          session:
            root.status === PromiseStatus.PENDING
              ? ('loading' as const)
              : root.status === PromiseStatus.ERROR
                ? ('unavailable' as const)
                : root.value === null
                  ? ('unsigned' as const)
                  : ('signed' as const)
        })),
        skipRepeatsWith<ILinkInfo>(
          (a, b) => a.wallet?.address === b.wallet?.address && a.linked === b.linked && a.unanswered === b.unanswered && a.session === b.session
        ),
        state()
      )

      const signAttempt: IStream<Promise<Address>> = op(
        signSession,
        map(() => signWalletLinkSession()),
        state()
      )

      const signOutcome: IStream<string | null> = op(
        signAttempt,
        promiseState,
        map(s =>
          s.status === PromiseStatus.PENDING
            ? 'Waiting for your wallet signature…'
            : s.status === PromiseStatus.ERROR
              ? formatThrownError(s.error)
              : null
        )
      )

      const $sessionGate: I$Node = $column(spacing.small)(
        $node(style({ fontSize: text.sm, color: palette.foreground, lineHeight: '1.5' }))(
          $text('Sign a session to derive your account key. dApps connect to it, and the same wallet re-derives it on any device.')
        ),
        $row(spacing.default, style({ alignItems: 'center' }))(
          $Popover({
            $container: $node(style({ display: 'flex' })),
            $open: constant(
              $column(spacing.default, style({ maxWidth: '320px' }))(
                ...$enableSessionDisclaimer(),
                $ButtonPrimary({
                  $container: $defaultButtonPrimary(style({ alignSelf: 'flex-end', minHeight: '40px' })),
                  $content: $text('Enable session'),
                  disabled: signAttempt
                })({ click: signSessionTether() })
              ),
              popSession
            ),
            $target: $ButtonSecondary({
              $container: $defaultMiniButtonSecondary,
              $content: $row(spacing.small, style({ alignItems: 'center' }))($text('Sign session'), $popoverCaret()),
              disabled: signAttempt
            })({ click: popSessionTether() })
          })({}),
          $node(style({ fontSize: text.xs, color: palette.foreground }))($text(map(o => o ?? '', signOutcome)))
        )
      )

      const statusColor: IStream<string> = map(i => (i.linked ? palette.positive : palette.foreground), linkInfo)

      const status = (i: ILinkInfo): { label: string; color: string; tip: string } => {
        if (!i.wallet) return { label: 'Offline', color: palette.foreground, tip: 'Connect your wallet to link a dApp.' }
        if (i.session === 'loading') return { label: 'Loading', color: palette.foreground, tip: 'Reading your account state.' }
        if (i.session === 'unavailable')
          return { label: 'Account unavailable', color: palette.negative, tip: 'Your account state could not be read; dApps cannot connect until it loads.' }
        if (i.session === 'unsigned')
          return { label: 'Session unsigned', color: palette.indeterminate, tip: 'Sign once with your wallet to derive your account key; the same wallet re-derives it on any device. dApps connect to that account.' }
        if (i.unanswered)
          return {
            label: 'Not responding',
            color: palette.negative,
            tip: 'The linked dApp did not answer over WalletConnect. It has most likely dropped the link on its side; disconnect it here and pair again.'
          }
        if (i.linked)
          return {
            label: 'Linked',
            color: palette.positive,
            tip: 'Your account is linked over WalletConnect. Whether the dApp accepts it depends on that dApp supporting smart-account (ERC-1271) signatures; Puppet cannot see their side.'
          }
        return { label: 'Ready', color: palette.message, tip: 'Paste a WalletConnect link from a dApp to connect it to your account.' }
      }

      const $header = (i: ILinkInfo): I$Node => {
        const s = status(i)
        return $row(spacing.default, style({ alignItems: 'center' }))(
          $column(style({ flex: 1, borderBottom: `1px solid ${palette.horizon}` }))(),
          $row(spacing.small, style({ alignItems: 'center', flexShrink: 0 }))(
            $node(style({ fontSize: text.sm, color: palette.foreground }))($text('Account')),
            $row(spacing.tiny, style({ alignItems: 'center' }))(
              $dot(s.color),
              $node(style({ fontSize: text.xs, color: s.color, whiteSpace: 'nowrap' }))($text(s.label)),
              $infoTooltip(s.tip, palette.foreground)
            )
          ),
          $column(style({ flex: 1, borderBottom: `1px solid ${palette.horizon}` }))()
        )
      }

      const $signHint = (session: IWalletLinkSession): I$Node => {
        if (session.reachable === false)
          return $node(style({ color: palette.negative, fontSize: text.xs, lineHeight: '1.5' }))(
            $text(`${session.name} did not answer the ping. It has most likely dropped this link on its side; disconnect and pair again.`)
          )
        if (session.probe === 'rejected')
          return $node(style({ color: palette.negative, fontSize: text.xs, lineHeight: '1.5' }))(
            $text('Your account rejected the signature Puppet just produced. A stale key share may be cached here; reconnect and try again.')
          )
        if (session.probe === 'valid')
          return $node(style({ color: palette.foreground, fontSize: text.xs, lineHeight: '1.5' }))(
            $text(
              session.repeatedSigns >= 2
                ? `The signature is valid and ${session.name} keeps asking again, so ${session.name} is not accepting it. Nothing on your side can fix this.`
                : `Signature verified on-chain against your account. If ${session.name} still refuses to sign you in, it does not support smart accounts.`
            )
          )
        return empty
      }

      const $logRow = (entry: IWalletLinkLogEntry): I$Node =>
        $row(spacing.small, style({ alignItems: 'baseline' }))(
          $node(style({ fontSize: '10px', color: palette.foreground, flexShrink: '0' }))(
            $text(new Date(entry.time).toLocaleTimeString())
          ),
          $node(
            style({
              fontSize: '11px',
              lineHeight: '1.4',
              wordBreak: 'break-word',
              color:
                entry.level === 'error'
                  ? palette.negative
                  : entry.level === 'warn'
                    ? palette.indeterminate
                    : palette.message
            })
          )($text(entry.text))
        )

      const $alertState = switchLatest(
        map(permission => {
          if (permission === 'granted') return empty
          return $row(spacing.small, style({ alignItems: 'center', justifyContent: 'space-between' }))(
            $node(style({ fontSize: text.xs, color: palette.foreground, lineHeight: '1.4' }))(
              $text(
                permission === 'denied'
                  ? 'Approval alerts are blocked. Allow notifications from the padlock in your address bar.'
                  : permission === 'insecure'
                    ? 'Approval alerts need HTTPS; this page is not served over a valid certificate.'
                    : permission === 'unsupported'
                      ? 'This browser cannot show approval alerts.'
                      : 'Get pinged when a linked dApp needs your approval.'
              )
            ),
            permission === 'default'
              ? $ButtonSecondary({
                  $container: $defaultMiniButtonSecondary(style({ flexShrink: '0' })),
                  $content: $text('Enable alerts')
                })({ click: enableAlertsTether() })
              : empty
          )
        }, signAlertPermission)
      )

      const $activityLog = switchLatest(
        map(
          entries =>
            entries.length === 0
              ? empty
              : $column(spacing.small)(
                  $labeledDivider($node(style({ fontSize: text.sm }))($text('Activity'))),
                  $column(spacing.tiny, style({ maxHeight: '160px', overflowY: 'auto' }))(...entries.map($logRow))
                ),
          walletLinkLog
        )
      )

      const $connectionRow = (session: IWalletLinkSession): I$Node =>
        $column(spacing.tiny, style({ width: '100%' }))(
        $row(spacing.small, style({ alignItems: 'center', justifyContent: 'space-between' }))(
          $row(spacing.small, style({ alignItems: 'center', minWidth: '0', flex: 1 }))(
            session.icon
              ? $element('img')(
                  attr({ src: session.icon, alt: '' }),
                  style({ width: '24px', height: '24px', borderRadius: '6px', objectFit: 'cover', flexShrink: 0 })
                )()
              : $node(
                  style({
                    width: '24px',
                    height: '24px',
                    borderRadius: '6px',
                    flexShrink: 0,
                    backgroundColor: colorShade(palette.foreground, 25),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: text.xs,
                    color: palette.message
                  })
                )($text((session.name || session.url || '?').slice(0, 1).toUpperCase())),
            $node(
              style({
                fontSize: text.sm,
                color: palette.message,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              })
            )($text(session.name || prettyUrl(session.url)))
          ),
          $ButtonSecondary({
            $container: $defaultMiniButtonSecondary(style({ flexShrink: '0' })),
            $content: $text('Disconnect')
          })({ click: disconnectTether(map(() => session.topic)) })
        ),
          $signHint(session)
        )

      const $signPrompt = (p: IPendingSign): I$Node =>
        $column(
          spacing.small,
          style({
            padding: '10px 12px',
            borderRadius: '10px',
            backgroundColor: colorShade(palette.primary, 12),
            border: `1px solid ${colorShade(palette.primary, 35)}`
          })
        )(
          $node(style({ fontSize: text.sm, color: palette.message, lineHeight: '1.4' }))(
            $text(
              p.method === 'wc_sessionProposal'
                ? `${p.name} wants to link to your account. It will be able to request signatures until you disconnect it.`
                : p.method === 'eth_sendTransaction'
                  ? `${p.name} wants to submit a transaction from your account. Only approve it if you recognise this action.`
                  : `${p.name} wants a signature from your account. Only approve it if you recognise this action.`
            )
          ),
          $node(
            style({
              fontSize: text.xs,
              color: palette.foreground,
              fontFamily: 'monospace',
              wordBreak: 'break-word',
              maxHeight: '120px',
              overflowY: 'auto',
              padding: '6px 8px',
              borderRadius: '6px',
              backgroundColor: colorShade(palette.horizon, 15)
            })
          )($text(p.payload)),
          $row(spacing.small, style({ justifyContent: 'flex-end', alignItems: 'center' }))(
            $ButtonSecondary({
              $container: $defaultMiniButtonSecondary,
              $content: $text('Decline')
            })({ click: signDecisionTether(map(() => ({ id: p.id, approved: false }))) }),
            $ButtonPrimary({
              $container: $defaultMiniButtonPrimary,
              $content: $text('Approve')
            })({ click: signDecisionTether(map(() => ({ id: p.id, approved: true }))) })
          )
        )

      return [
        $Popover({
          $container: $node(style({ display: 'flex' })),
          $open: map(
            () =>
              $column(spacing.default, style({ width: POPOVER_WIDTH, maxWidth: 'calc(100vw - 32px)' }))(
                switchLatest(
                  map(topic => {
                    void disconnectDapp(topic)
                    return empty
                  }, disconnect)
                ),
                switchLatest(
                  map(d => {
                    resolveSignApproval(d.id, d.approved)
                    return empty
                  }, signDecision)
                ),
                switchLatest(
                  map(() => {
                    enableSignAlerts()
                    return empty
                  }, enableAlerts)
                ),
                switchLatest(
                  map(
                    (i: ILinkInfo) =>
                      $column(spacing.default)(
                        switchLatest(map(p => (p ? $signPrompt(p) : empty), pendingSign)),
                        $labeledDivider(
                          $row(spacing.tiny, style({ alignItems: 'center' }))(
                            $node(style({ fontSize: text.sm }))($text('Link a dApp')),
                            $infoTooltip(
                              'On the dApp choose WalletConnect, copy its connection link, and paste it here. Keep this tab open while linked.',
                              palette.foreground)
                          )
                        ),
                        ...(!i.wallet
                          ? [
                              $node(style({ fontSize: text.sm, color: palette.foreground, lineHeight: '1.5' }))(
                                $text('Connect your wallet, then link a dApp here.')
                              )
                            ]
                          : i.session !== 'signed'
                            ? [...(i.session === 'unsigned' ? [$sessionGate] : []), $header(i)]
                            : [
                                $linkTunnel(connectedWallet)({}),
                                switchLatest(
                                  map(
                                    list =>
                                      list.length > 0 ? $column(spacing.small)(...list.map($connectionRow)) : empty,
                                    walletLinkSessions
                                  )
                                ),
                                $header(i)
                              ]),
                        $alertState,
                        $activityLog
                      ),
                    linkInfo
                  )
                )
              ),
            merge(
              open,
              blockedRequest,
              op(
                pendingSign,
                filter((p): p is IPendingSign => !!p),
                skipRepeatsWith((a, b) => a.id === b.id)
              )
            )
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
                c =>
                  $icon({
                    $content: $walletConnectLogo,
                    viewBox: '0 0 32 32',
                    width: `${Math.round(size * 0.56)}px`,
                    fill: c
                  }),
                statusColor
              )
            )
          )
        })({}),
        {}
      ]
    }
  )
