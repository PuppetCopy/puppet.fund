import { predictPuppetAccount } from '@puppet/sdk/account'
import type { IFund } from '@puppet/sdk/schema'
import type { ISubaccountState } from '@puppet/sdk/state'
import { combine, constant, empty, filter, type IStream, map, merge, op, skip, switchLatest, tap } from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import {
  $element,
  $node,
  $text,
  attr,
  component,
  type I$Node,
  type INode,
  nodeEvent,
  style,
  stylePseudo
} from 'aelea/ui'
import { $column, $Popover, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { type Address, isAddressEqual } from 'viem'
import { $icon, $infoTooltip, $labeledDivider, text } from '@/ui-components'
import { $walletConnectLogo } from '../common/$icons.js'
import { $navText } from '../common/elements/$common.js'
import type { IConnectedWallet } from '../wallet/index.js'
import {
  blockedRequest,
  hasPersistedWalletLink,
  type IActiveFund,
  type IPendingSign,
  type IWalletLinkSession,
  peekActiveFund,
  pendingSign,
  resolveSignApproval,
  setActiveFund,
  setLinkWallet,
  walletLinkConnected,
  walletLinkSessions
} from '../wallet/walletLinkState.js'
import { wcUriFromLocation } from '../wallet/wcUri.js'
import { $fundProfile } from './$AccountProfile.js'
import { $WalletTunnel } from './$WalletTunnel.js'

export interface I$WalletLink {
  walletState: IStream<IConnectedWallet | null>
  rootState: IStream<ISubaccountState | null>
  size?: number
}

interface ILinkInfo {
  wallet: IConnectedWallet | null
  hasSession: boolean
  funds: IFund[]
  selected: IActiveFund | null
  ownSessions: IWalletLinkSession[]
  linked: boolean
}

const prettyUrl = (url: string): string => url.replace(/^https?:\/\//, '').replace(/\/$/, '')

const $dot = (color: string): I$Node =>
  $node(style({ width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0, backgroundColor: color }))()

const sameFund = (a: IActiveFund | null, b: { baseToken: Address; name: string }): boolean =>
  !!a && a.baseToken === b.baseToken && a.name === b.name

void hasPersistedWalletLink().then(has => {
  if (has) {
    console.info('[wc] restoring persisted session')
    void import('../wallet/walletKitConnect.js').then(m => m.startWalletConnect())
  }
})

if (wcUriFromLocation()) {
  void import('../wallet/walletKitConnect.js').then(m => m.pairFromUrl())
}

export const $WalletLink = ({ walletState, rootState, size = 32 }: I$WalletLink) =>
  component(
    (
      [open, openTether]: IBehavior<INode, PointerEvent>,
      [disconnect, disconnectTether]: IBehavior<INode, string>,
      [signDecision, signDecisionTether]: IBehavior<INode, { id: number; approved: boolean }>,
      [selectFund, selectFundTether]: IBehavior<INode, IActiveFund>,
      [createFundNav, createFundNavTether]: IBehavior<INode, PointerEvent>
    ) => {
      const masterFor = (wallet: IConnectedWallet | null): Address | null =>
        wallet?.session ? predictPuppetAccount({ user: wallet.session.user, signer: wallet.session.signer }) : null

      const funds$: IStream<IFund[]> = op(
        combine({ wallet: walletState, root: rootState }),
        map(({ wallet, root }) => {
          const master = masterFor(wallet)
          return master ? (root?.funds ?? []).filter(f => isAddressEqual(f.master, master)) : []
        }),
        state()
      )
      // Active fund priority: an explicit in-session selection (still in the list) wins, else the
      // per-master remembered fund persisted in localStorage (survives refresh), else the first
      // fund. A wallet with no funds resolves to null so no account is exposed to a linked dApp.
      // The tap persists the choice per master for the wallet-responder; it never writes null, so a
      // transient empty list while the root state loads can't wipe a remembered selection.
      const selection: IStream<IActiveFund | null> = state(null, selectFund)
      const active$: IStream<IActiveFund | null> = op(
        combine({ wallet: walletState, funds: funds$, selection }),
        map(({ wallet, funds, selection }) => {
          const master = masterFor(wallet)
          const valid = (f: IActiveFund | null) => !!f && funds.some(x => sameFund(f, x))
          const remembered = master ? peekActiveFund(master) : null
          const chosen = valid(selection)
            ? selection
            : valid(remembered)
              ? remembered
              : funds[0]
                ? { baseToken: funds[0].baseToken, name: funds[0].name }
                : null
          return { master, chosen }
        }),
        tap(({ master, chosen }) => {
          if (master && chosen) setActiveFund(master, chosen)
        }),
        map(p => p.chosen),
        state()
      )

      const linkInfo: IStream<ILinkInfo> = op(
        combine({ sessions: walletLinkSessions, wallet: walletState, funds: funds$, active: active$ }),
        map(({ sessions, wallet, funds, active }) => {
          setLinkWallet(wallet)
          const hasSession = !!wallet?.session
          const selected = active && funds.some(f => sameFund(active, f)) ? active : null
          // Every linked dApp operates the active fund, so they are all shown (not lensed per fund).
          return { wallet, hasSession, funds, selected, ownSessions: sessions, linked: sessions.length > 0 }
        }),
        state()
      )

      const statusColor: IStream<string> = map(i => (i.linked ? palette.positive : palette.foreground), linkInfo)

      const status = (i: ILinkInfo): { label: string; color: string; tip: string } => {
        if (!i.wallet)
          return { label: 'Offline', color: palette.foreground, tip: 'Connect your wallet to link a dApp.' }
        if (!i.hasSession)
          return {
            label: 'No session',
            color: palette.indeterminate,
            tip: 'Enable a signing session to link your funds to a dApp.'
          }
        if (i.funds.length === 0)
          return {
            label: 'No funds',
            color: palette.indeterminate,
            tip: 'Create a fund first, then link a dApp to it.'
          }
        if (i.linked)
          return { label: 'Linked', color: palette.positive, tip: 'This fund is linked and can trade on the dApp.' }
        return {
          label: 'Ready',
          color: palette.primary,
          tip: 'Pick a fund, then paste a WalletConnect link from a dApp to connect it.'
        }
      }

      const $header = (i: ILinkInfo): I$Node => {
        const s = status(i)
        return $row(spacing.default, style({ alignItems: 'center' }))(
          $column(style({ flex: 1, borderBottom: `1px solid ${palette.horizon}` }))(),
          $row(spacing.small, style({ alignItems: 'center', flexShrink: 0 }))(
            $node(style({ fontSize: text.sm, color: palette.foreground }))($text('Funds')),
            $row(spacing.tiny, style({ alignItems: 'center' }))(
              $dot(s.color),
              $node(style({ fontSize: text.xs, color: s.color, whiteSpace: 'nowrap' }))($text(s.label)),
              $infoTooltip(s.tip, palette.foreground, '18px')
            )
          ),
          $column(style({ flex: 1, borderBottom: `1px solid ${palette.horizon}` }))()
        )
      }

      const $fundIdentity = (f: IFund): I$Node =>
        $row(
          spacing.small,
          style({ alignItems: 'center', minWidth: '0', flex: 1 })
        )($fundProfile({ master: f.master, baseToken: f.baseToken, name: f.name }, 30))

      const $selectableFund = (i: ILinkInfo, f: IFund): I$Node => {
        const isActive = sameFund(i.selected, f)
        return $row(
          spacing.small,
          style({
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            padding: '8px 10px',
            borderRadius: '12px',
            border: `1px solid ${isActive ? palette.primary : colorShade(palette.foreground, 15)}`
          }),
          stylePseudo(':hover', { borderColor: isActive ? palette.primary : colorShade(palette.foreground, 40) }),
          selectFundTether(nodeEvent('click'), constant({ baseToken: f.baseToken, name: f.name }))
        )($fundIdentity(f), isActive ? $dot(palette.positive) : empty)
      }

      const $connectionRow = (session: IWalletLinkSession): I$Node =>
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
          $node(
            style({ cursor: 'pointer', flexShrink: 0, padding: '4px', fontSize: text.xs, color: palette.foreground }),
            stylePseudo(':hover', { color: palette.negative }),
            disconnectTether(
              nodeEvent('click'),
              map(() => session.topic)
            )
          )($text('Disconnect'))
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
            $text(`${p.name} is asking you to sign in. Approve to authorize the login signature for your fund.`)
          ),
          $row(spacing.small, style({ justifyContent: 'flex-end', alignItems: 'center' }))(
            $node(
              style({
                cursor: 'pointer',
                fontSize: text.sm,
                color: palette.foreground,
                padding: '6px 12px',
                borderRadius: '100px',
                border: `1px solid ${colorShade(palette.foreground, 30)}`
              }),
              stylePseudo(':hover', { color: palette.negative, borderColor: palette.negative }),
              signDecisionTether(
                nodeEvent('click'),
                map(() => ({ id: p.id, approved: false }))
              )
            )($text('Decline')),
            $node(
              style({
                cursor: 'pointer',
                fontSize: text.sm,
                color: palette.message,
                padding: '6px 14px',
                borderRadius: '100px',
                backgroundColor: palette.primary
              }),
              signDecisionTether(
                nodeEvent('click'),
                map(() => ({ id: p.id, approved: true }))
              )
            )($text('Approve'))
          )
        )

      return [
        $Popover({
          $container: $node(style({ display: 'flex' })),
          $open: map(
            () =>
              $column(spacing.default, style({ minWidth: '300px', maxWidth: '340px' }))(
                switchLatest(
                  map(topic => {
                    void import('../wallet/walletKitConnect.js').then(m => m.disconnectDapp(topic))
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
                  map(
                    i =>
                      $column(spacing.default)(
                        switchLatest(map(p => (p ? $signPrompt(p) : empty), pendingSign)),
                        $labeledDivider(
                          $row(spacing.tiny, style({ alignItems: 'center' }))(
                            $node(style({ fontSize: text.sm }))($text('Link a dApp')),
                            $infoTooltip(
                              'On the dApp choose WalletConnect, copy its connection link, and paste it here. Keep this tab open while linked.',
                              palette.foreground,
                              '14px'
                            )
                          )
                        ),
                        ...(!i.wallet
                          ? [
                              $node(style({ fontSize: text.sm, color: palette.foreground, lineHeight: '1.5' }))(
                                $text('Connect your wallet, then link a dApp here.')
                              )
                            ]
                          : i.funds.length === 0
                            ? [
                                $column(spacing.small)(
                                  $node(style({ fontSize: text.sm, color: palette.foreground, lineHeight: '1.5' }))(
                                    $text(
                                      'A linked dApp trades through one of your funds, so you need a fund before you can link.'
                                    )
                                  ),
                                  $node(createFundNavTether(nodeEvent('click')))(
                                    $navText('/', 'Create a fund', () => {
                                      let tries = 0
                                      const scrollToQuickstart = (): void => {
                                        const el = document.getElementById('hello-create')
                                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
                                        else if (tries++ < 30) requestAnimationFrame(scrollToQuickstart)
                                      }
                                      scrollToQuickstart()
                                    })
                                  )
                                )
                              ]
                            : [
                                $WalletTunnel({ walletState })({}),
                                ...(i.ownSessions.length > 0
                                  ? [$column(spacing.small)(...i.ownSessions.map($connectionRow))]
                                  : []),
                                $header(i),
                                ...(i.hasSession
                                  ? [$column(spacing.small)(...i.funds.map(f => $selectableFund(i, f)))]
                                  : [])
                              ])
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
                filter((p): p is IPendingSign => !!p)
              )
            )
          ),
          dismiss: merge(
            op(walletLinkConnected, skip(1), filter(c => c)),
            constant(true, createFundNav)
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
