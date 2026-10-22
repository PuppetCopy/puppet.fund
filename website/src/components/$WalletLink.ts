import { SESSION_REVOKE_DELAY } from '@puppet/contracts/intents'
import type { IRevokeDraft } from '@puppet/sdk/client'
import { formatThrownError } from '@puppet/sdk/compact'
import { CHAIN_ID_LIST, type ChainId } from '@puppet/sdk/const'
import { combine, constant, empty, filter, filterNull, fromIterable, fromPromise, type IStream, just, map, merge, op, reduce, sampleMap, skipRepeats, skipRepeatsWith, start, switchLatest, switchMap, take, until, wait } from 'aelea/stream'
import { type IBehavior, multicast, type PromiseState, PromiseStatus, promiseState, state } from 'aelea/stream-extended'
import { $node, $text, attr, attrBehavior, component, effectRun, fromEventTarget, type I$Node, type INode, type INodeCompose, nodeEvent, style, styleBehavior } from 'aelea/ui'
import { $column, $defaultInputContainer, $Popover, $row, $Tooltip, isDesktopScreen, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { href } from 'aelea/ui-router'
import { type Address, isAddressEqual } from 'viem'
import {
  $alertInfo,
  $anchor,
  $browser,
  $ButtonPrimary,
  $ButtonSecondary,
  $defaultMiniButtonPrimary,
  $defaultMiniButtonSecondary,
  $defaultTextFieldContainer,
  $DropMenu,
  $externalMark,
  $FieldLabeled,
  $detailLine,
  $icon,
  $infoTooltip,
  $intermediatePulse,
  $key,
  $labeledDivider,
  $popoverCaret,
  $tooltipDropContainer,
  SEPARATOR_COLOR,
  $unknown,
  type IDropMenuItem,
  intermediateState,
  keyActivate,
  POPOVER_WIDTH,
  softNavClick,
  text
} from '@/ui-components'
import { routeSchema } from '../app/routeSchema.js'
import { $avatarBadge, $badged } from '../common/$avatar.js'
import { chainName } from '../common/$chain.js'
import { $venueIcon } from '../common/$operationView.js'
import { $walletConnectLogo } from '../common/$icons.js'
import { shortDuration } from '../pages/common.js'
import { type IWalletControl, type IWalletIntent, WALLET_CONNECT_ID } from '../wallet/connect.js'
import type { IConnectedWallet, IRootState, IWalletPair } from '../wallet/index.js'
import { disconnectDapp, enableSignAlerts, type IRelayState, type IWalletLinkLogEntry, type IWalletLinkSession, pairDapp, prettyUrl, refusedSign, signAlertPermission, signQueue, startWalletConnect, venueOfUrl, walletLinkLog, walletLinkRelay, walletLinkSessions } from '../wallet/walletLink.js'
import { wcLinkOf } from '../wallet/wcUri.js'
import { $AgentSection, $agentRequestRow, type I$AgentSection, type IAgentCommand } from './$AgentLink.js'
import { $DappPrompt } from './$DappPrompt.js'
import { $sessionRow } from './$sessionRow.js'

export interface I$WalletLink {
  walletPair: IStream<IWalletPair>
  shownPair: IStream<IWalletPair>
  walletControl: IWalletControl
  agent: I$AgentSection
  account: IStream<Address | null>
  $control: INodeCompose
  $anchorArea: INodeCompose
}

interface ILinkInfo {
  fund: IRootState['fund']
  linked: boolean
  relay: IRelayState | null
  session: 'signed' | 'unsigned' | 'loading' | 'unavailable'
}

export const linkIssueOf = (session: IWalletLinkSession): { text: string; color: string } | null => {
  if (session.probe === 'rejected')
    return { text: "This signature doesn't match your fund's address, so the dApp will reject it. This browser may hold a stale key.", color: palette.negative }
  if (session.probe === 'valid' && session.repeatedSigns >= 2)
    return { text: `The signature is valid, but ${session.name} keeps asking again. Nothing on your side can fix this.`, color: palette.indeterminate }
  return null
}

export const $stillListed = (releases: IWalletControl['releases']): I$Node =>
  switchLatest(
    switchMap(
      release =>
        release.refused.then(
          (refused): I$Node =>
            refused === null
              ? empty
              : $row(spacing.tiny, style({ alignItems: 'center', color: palette.foreground, fontSize: text.sm, lineHeight: '1.5' }))(
                  $node($text(`${release.entry.id === WALLET_CONNECT_ID ? 'Your wallet app' : release.entry.name} still lists this site as connected; remove it there.`)),
                  $infoTooltip(`${release.entry.name} answered: ${formatThrownError(refused.error)}`, palette.foreground)
                )
        ),
      releases
    )
  )

type IPairStatus = { kind: 'pending' } | { kind: 'awaiting' } | { kind: 'error'; text: string }
type ISignOutItem = IDropMenuItem & { everywhere: boolean; chainIds: ChainId[] }
type IClipRead = { text: string } | { error: unknown } | { expired: true }
type ILinkMode = 'idle' | 'listening' | 'manual' | 'stopped'

const PAIR_MS = 20_000
const LINK_ANSWER_MS = 45_000
const LINK_WATCH_MS = 300_000

export const $WalletLink = ({ walletPair, shownPair, walletControl, agent, account, $control, $anchorArea }: I$WalletLink) =>
  component(
    (
      [open, openTether]: IBehavior<PointerEvent>,
      [disconnect, disconnectTether]: IBehavior<PointerEvent, string>,
      [enableAlerts, enableAlertsTether]: IBehavior<PointerEvent>,
      [later, laterTether]: IBehavior<PointerEvent>,
      [popoverOpen, popoverOpenTether]: IBehavior<boolean>,
      [command, commandTether]: IBehavior<IAgentCommand>,
      [enableSession, enableSessionTether]: IBehavior<unknown>,
      [signOut, signOutTether]: IBehavior<ISignOutItem>,
      [listen, listenTether]: IBehavior<PointerEvent>,
      [stopLink, stopLinkTether]: IBehavior<PointerEvent>,
      [pasteLink, pasteLinkTether]: IBehavior<INode, null>,
      [changeUri, changeUriTether]: IBehavior<string>
    ) => {
      const connectedWallet: IStream<IConnectedWallet | null> = map(p => p.wallet, walletPair)
      const isOpen = state(false, popoverOpen)
      const promptArrived = op(
        signQueue,
        map(queue => Math.max(0, ...queue.filter(prompt => !prompt.deferred).map(prompt => prompt.id))),
        skipRepeats,
        filter(id => id > 0)
      )
      const refusalArrived = op(
        refusedSign,
        map(refused => (refused === null ? 0 : refused.id)),
        skipRepeats,
        filter(id => id > 0)
      )
      const agentAsks = op(
        agent.status,
        map(statuses => Object.values(statuses).some(current => current?.kind === 'waiting' && current.sign)),
        skipRepeats,
        filter(asking => asking)
      )
      const autoOpen = op(
        sampleMap((opened: boolean) => opened, isOpen, merge(promptArrived, refusalArrived, agentAsks)),
        filter(opened => !opened)
      )
      const prompting = op(
        combine({ queue: signQueue, refused: refusedSign }),
        map(({ queue, refused }) => queue.length > 0 || refused !== null),
        skipRepeats
      )
      const rootState: IStream<PromiseState<IRootState | null>> = start(
        { status: PromiseStatus.PENDING },
        op(
          connectedWallet,
          map(wallet => (wallet === null ? null : wallet.address)),
          skipRepeats,
          switchMap(() =>
            op(
              intermediateState(map(pair => pair.root, shownPair)),
              reduce(
                (last: PromiseState<IRootState | null>, next: PromiseState<IRootState | null>) =>
                  next.status === PromiseStatus.PENDING && last.status === PromiseStatus.DONE ? last : next,
                { status: PromiseStatus.PENDING }
              )
            )
          )
        )
      )

      const linkInfo: IStream<ILinkInfo> = op(
        combine({ sessions: walletLinkSessions, root: rootState, relay: walletLinkRelay }),
        map(({ sessions, root, relay }) => ({
          fund: root.status === PromiseStatus.DONE && root.value !== null ? root.value.fund : null,
          linked: sessions.length > 0,
          relay,
          session:
            root.status === PromiseStatus.PENDING
              ? ('loading' as const)
              : root.status === PromiseStatus.ERROR
                ? ('unavailable' as const)
                : root.value === null || root.value.fund === null
                  ? ('unsigned' as const)
                  : 'unknown' in root.value.fund
                    ? ('unavailable' as const)
                    : ('signed' as const)
        })),
        skipRepeatsWith<ILinkInfo>(
          (a, b) =>
            (a.fund === b.fund || (a.fund !== null && b.fund !== null && 'account' in a.fund && 'account' in b.fund && a.fund.account === b.fund.account)) &&
            a.linked === b.linked && a.relay === b.relay && a.session === b.session
        ),
        state()
      )

      const linkKind = op(
        linkInfo,
        map(i => (i.session === 'signed' ? 'signed' : i.session === 'unsigned' && i.fund === null ? 'unfunded' : 'other')),
        skipRepeats
      )

      const proposed: IStream<number> = op(
        signQueue,
        map(queue => queue.filter(p => p.chains !== null).length),
        skipRepeatsWith((a, b) => a === b),
        filter(count => count > 0)
      )
      const clipboardWatch: IStream<IClipRead> = op(
        merge(
          map(() => true, listen),
          map(() => false, merge(stopLink, pasteLink, proposed))
        ),
        switchMap(on => {
          if (!on) return empty
          const reads: IStream<IClipRead> = op(
            merge(just(null), fromEventTarget(window, 'focus'), fromEventTarget(document, 'visibilitychange')),
            filter(() => document.hasFocus()),
            switchMap(() =>
              fromPromise(
                typeof navigator.clipboard?.readText === 'function'
                  ? navigator.clipboard.readText().then(
                      (text): IClipRead => ({ text }),
                      (error: unknown): IClipRead => ({ error })
                    )
                  : Promise.resolve<IClipRead>({ error: new Error('This browser gives no clipboard access') })
              )
            ),
            multicast
          )
          const failed = filter((read: IClipRead) => 'error' in read, reads)
          const expired: IStream<IClipRead> = op(
            wait(LINK_WATCH_MS),
            until(failed),
            map((): IClipRead => ({ expired: true })),
            multicast
          )
          return merge(
            until(
              merge(failed, expired),
              filter((read: IClipRead) => 'text' in read, reads)
            ),
            take(1, until(expired, failed)),
            take(1, expired)
          )
        }),
        multicast
      )
      const linkMode: IStream<ILinkMode> = state(
        'idle' as ILinkMode,
        merge(
          map((): ILinkMode => 'listening', listen),
          map((): ILinkMode => 'idle', merge(stopLink, proposed)),
          map((): ILinkMode => 'manual', pasteLink),
          op(
            clipboardWatch,
            filter(read => 'error' in read),
            map((): ILinkMode => 'manual')
          ),
          op(
            clipboardWatch,
            filter(read => 'expired' in read),
            map((): ILinkMode => 'stopped')
          )
        )
      )
      const clipText: IStream<string> = op(
        clipboardWatch,
        filter((read): read is { text: string } => 'text' in read),
        map(read => read.text)
      )
      const clipEmpty: IStream<boolean> = state(
        false,
        merge(
          map(() => false, listen),
          map(text => wcLinkOf(text) === null, clipText)
        )
      )
      const linkUri = state('', merge(changeUri, constant('', proposed), constant('', stopLink)))
      const pairing: IStream<Promise<void>> = op(
        merge(
          op(clipText, map(wcLinkOf), filterNull, skipRepeats),
          op(changeUri, map(wcLinkOf), filterNull)
        ),
        map(link =>
          Promise.race([
            startWalletConnect().then(() => pairDapp(link)),
            new Promise<never>((_resolve, reject) => window.setTimeout(() => reject(new Error(`WalletConnect did not pair within ${PAIR_MS / 1000} s`)), PAIR_MS))
          ])
        ),
        multicast
      )
      const connectStatus: IStream<IPairStatus | null> = state(
        null as IPairStatus | null,
        switchMap(
          (paired: Promise<void>) =>
            map(
              (p): IPairStatus | null => {
                if (p.arrived) return null
                if (p.res.status === PromiseStatus.PENDING) return { kind: 'pending' }
                if (p.res.status === PromiseStatus.ERROR) return { kind: 'error', text: `Could not link the dApp: ${formatThrownError(p.res.error)}` }
                return p.late ? { kind: 'error', text: 'The dApp did not answer this link. Copy a fresh link from the dApp.' } : { kind: 'awaiting' }
              },
              combine({ res: promiseState(just(paired)), arrived: start(false, constant(true, proposed)), late: start(false, constant(true, wait(LINK_ANSWER_MS))) })
            ),
          pairing
        )
      )
      const linkInert: IStream<boolean> = op(
        combine({ status: connectStatus, held: agent.session }),
        map(p => p.status?.kind === 'pending' || !p.held),
        skipRepeats,
        state()
      )
      const linkInputError: IStream<string | null> = map(({ input, status }) => {
        if (input.trim().length > 0 && wcLinkOf(input) === null) return 'That is not a valid WalletConnect link. Copy a fresh one from the dApp.'
        return status?.kind === 'error' ? status.text : null
      }, combine({ input: linkUri, status: connectStatus }))

      const clipboardPermission: IStream<PermissionState | null> = op(
        fromPromise(
          typeof navigator.permissions?.query === 'function'
            ? navigator.permissions.query({ name: 'clipboard-read' as PermissionName }).then(
                status => status,
                () => null
              )
            : Promise.resolve(null)
        ),
        switchMap(status =>
          status === null
            ? just(null)
            : op(
                merge(just(null), fromEventTarget(status, 'change')),
                map(() => status.state)
              )
        ),
        skipRepeats
      )
      const missingPermissions: IStream<readonly { label: string; value: string }[]> = op(
        combine({ alerts: signAlertPermission, clipboard: clipboardPermission, statuses: agent.status }),
        map(({ alerts, clipboard, statuses }) => [
          ...(alerts === 'denied'
            ? [{ label: 'Approval alerts', value: 'Blocked' }]
            : alerts === 'unsupported'
              ? [{ label: 'Approval alerts', value: 'Not in this browser' }]
              : alerts === 'insecure'
                ? [{ label: 'Approval alerts', value: 'Needs HTTPS' }]
                : []),
          ...(clipboard === 'denied' ? [{ label: 'Clipboard for Link dApp', value: 'Blocked' }] : []),
          ...(Object.values(statuses).some(current => current?.kind === 'blocked') ? [{ label: 'Local network for agents', value: 'Blocked' }] : [])
        ]),
        skipRepeatsWith((a, b) => a.map(m => `${m.label}:${m.value}`).join() === b.map(m => `${m.label}:${m.value}`).join())
      )

      const problemOf = (i: ILinkInfo): { text: string; color: string } | null => {
        if (i.fund !== null && 'unknown' in i.fund) return { text: i.fund.unknown, color: palette.negative }
        if (i.session === 'unavailable') return { text: 'Your account state could not be read; dApps cannot connect until it loads.', color: palette.negative }
        if (i.linked && i.relay === 'disconnected')
          return {
            text: 'Puppet cannot reach the WalletConnect relay, so linked dApps cannot reach your fund. It reconnects when this tab is in front or the network returns.',
            color: palette.negative
          }
        if (i.linked && i.relay === 'connecting') return { text: 'Reconnecting to the WalletConnect relay.', color: palette.indeterminate }
        return null
      }

      const alert = op(
        combine({ info: linkInfo, sessions: walletLinkSessions, statuses: agent.status, held: agent.session }),
        map(({ info, sessions, statuses, held }) => {
          const problem = problemOf(info)
          const issues = [
            ...(problem === null ? [] : [problem]),
            ...sessions.filter(session => session.verifiedOrigin === null || venueOfUrl(session.verifiedOrigin) === null).flatMap(session => {
              const issue = linkIssueOf(session)
              return issue === null ? [] : [issue]
            })
          ]
          const agents = Object.values(statuses)
          return {
            color: issues.some(issue => issue.color === palette.negative) || agents.some(current => current?.kind === 'blocked')
              ? palette.negative
              : issues.length > 0 || agents.some(current => current?.kind === 'waiting')
                ? palette.indeterminate
                : info.linked || held || agents.some(current => current?.kind === 'linked')
                  ? palette.positive
                  : palette.foreground,
            issues
          }
        }),
        state()
      )

      const $logRow = (entry: IWalletLinkLogEntry): I$Node =>
        $row(spacing.small, style({ alignItems: 'baseline', minWidth: '0' }))(
          $node(style({ fontSize: '10px', color: palette.foreground, flexShrink: '0' }))(
            $text(new Date(entry.time).toLocaleTimeString())
          ),
          $node(
            attr({ title: entry.text }),
            style({
              fontSize: '11px',
              lineHeight: '1.4',
              minWidth: '0',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
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
        map(
          permission =>
            permission !== 'default'
              ? empty
              : $row(spacing.small, style({ alignItems: 'center', justifyContent: 'space-between' }))(
                  $node(style({ fontSize: text.xs, color: palette.foreground, lineHeight: '1.4' }))($text('Get pinged when a linked dApp needs your approval.')),
                  $ButtonSecondary({
                    $container: $defaultMiniButtonSecondary(style({ flexShrink: '0' })),
                    $content: $text('Enable alerts')
                  })({ click: enableAlertsTether() })
                ),
          signAlertPermission
        )
      )

      const $activityLog = switchLatest(
        map(({ dapps, agents, identities }) => {
          const entries = [
            ...dapps.map(entry => ({ at: entry.time, $entry: $logRow(entry) })),
            ...agents.map(entry => ({ at: entry.at, $entry: $agentRequestRow(entry, identities.find(identity => identity.secret === entry.secret)) }))
          ].sort((a, b) => b.at - a.at)
          return entries.length === 0
            ? empty
            : $column(spacing.small)(
                $labeledDivider($node(style({ fontSize: text.sm }))($text('Activity'))),
                $column(spacing.tiny, style({ maxHeight: '160px', overflowY: 'auto' }))(...entries.map(entry => entry.$entry))
              )
        }, combine({ dapps: walletLinkLog, agents: agent.log, identities: agent.identities }))
      )

      const forgetting: IStream<Promise<void>> = op(
        sampleMap(
          (pair: IWalletPair, chainIds: ChainId[]) => ({ pair, chainIds }),
          walletPair,
          op(
            signOut,
            filter(item => !item.everywhere),
            map(item => item.chainIds)
          )
        ),
        map(async ({ pair, chainIds }) => {
          const { wallet, keys } = pair
          if (wallet === null || keys === null) throw new Error('no wallet is connected')
          for (const chainId of chainIds) await keys.forgetSessions(wallet.address, chainId)
        }),
        multicast
      )
      const ended: IStream<string> = op(
        forgetting,
        switchMap(forgot => forgot.then(() => '', (err: unknown) => `Sign out failed: ${formatThrownError(err)}`)),
        start('')
      )

      const accountChains: IStream<ChainId[]> = op(
        rootState,
        map((root): ChainId[] => {
          if (root.status !== PromiseStatus.DONE || root.value === null) return []
          const deployed = root.value.deployed
          return CHAIN_ID_LIST.filter(chainId => deployed.has(chainId))
        }),
        skipRepeatsWith((prev, next) => prev.join() === next.join())
      )

      const $browserSessions = switchLatest(
        map(({ pair, note, accountChains }: { pair: IWalletPair; note: string; accountChains: ChainId[] }): I$Node => {
          const $note = note === '' ? empty : $node(style({ color: palette.foreground, fontSize: text.sm, lineHeight: '1.5' }))($text(note))
          if (pair.wallet === null || pair.keys === null)
            return $column(spacing.small)(
              $alertInfo($node(style({ color: palette.foreground, fontSize: text.sm, lineHeight: '1.5' }))($text('Connect your wallet to see its sessions'))),
              $stillListed(walletControl.releases)
            )
          const user = pair.wallet.address
          const keys = pair.keys
          const held = keys.grantedChains(user).flatMap(chainId => {
            const session = keys.sessionOf(user, chainId)
            return session === null ? [] : [session]
          })
          if (held.length === 0)
            return $column(spacing.small)(
              $row(spacing.small, style({ alignItems: 'center' }))(
                $icon({ $content: $browser, viewBox: '0 0 24 24', size: '24px', svgOps: style({ color: palette.foreground, flexShrink: '0' }) }),
                $column(style({ flex: '1', gap: '2px', minWidth: '0' }))(
                  $node(style({ fontSize: text.sm, color: palette.message }))($text('This browser')),
                  $node(style({ fontSize: text.xs, color: palette.foreground }))($text('no session'))
                ),
                $ButtonPrimary({ $container: $defaultMiniButtonPrimary, $content: $text('Sign session') })({ click: enableSessionTether() })
              ),
              $note
            )
          const now = Math.floor(Date.now() / 1000)
          const residual =
            accountChains.length === 0 || accountChains.length === CHAIN_ID_LIST.length
              ? ''
              : " Sign out everywhere revokes sessions on your account's chains, and the attestor then refuses them on every other chain too."
          return $column(spacing.small)(
            ...[...new Set(held.map(session => session.signer))].map(signer => {
              const own = held.filter(session => session.signer === signer)
              const chainIds = CHAIN_ID_LIST.filter(chainId => own.some(session => session.chainId === chainId))
              const expiry = own.map(session => session.expiry).reduce((soonest, next) => (next < soonest ? next : soonest))
              return $row(spacing.small, style({ alignItems: 'center' }))(
                $icon({ $content: $browser, viewBox: '0 0 24 24', size: '24px', svgOps: style({ color: palette.foreground, flexShrink: '0' }) }),
                $column(style({ flex: '1', gap: '2px', minWidth: '0' }))(
                  $node(style({ fontSize: text.sm, color: palette.message }))($text('This browser')),
                  $row(spacing.tiny, style({ alignItems: 'center', fontSize: text.xs, color: palette.foreground, whiteSpace: 'nowrap' }))(
                    $node($text(`ends in ${shortDuration(Number(expiry) - now)}`)),
                    $infoTooltip(
                      `Ends ${new Date(Number(expiry) * 1000).toLocaleString()}. Your wallet granted this session to this browser; the dApps and agents below act through it.${residual}`,
                      palette.foreground
                    )
                  )
                ),
                $DropMenu<ISignOutItem>({
                  label: 'Sign out',
                  optionList: [
                    { label: 'Sign out', description: "Forgets this browser's key and disconnects your wallet; no gas", everywhere: false, chainIds },
                    ...(accountChains.length === 0
                      ? []
                      : [
                          {
                            label: 'Sign out everywhere',
                            description: `Ends every mandate, and every session on ${new Intl.ListFormat('en', { type: 'conjunction' }).format(accountChains.map(chainName))} within ${Number(SESSION_REVOKE_DELAY) / 60} minutes, then lets your wallet withdraw for ${Number(SESSION_REVOKE_DELAY) / 60} minutes; one wallet prompt and its gas per chain`,
                            everywhere: true,
                            chainIds: accountChains
                          }
                        ])
                  ]
                })({ select: signOutTether() })
              )
            }),
            $note
          )
        }, combine({ pair: walletPair, note: ended, accountChains, open: agent.session }))
      )

      const $connectionRow = (session: IWalletLinkSession): I$Node => {
        const origin = prettyUrl(session.verifiedOrigin ?? session.url)
        const venue = session.verifiedOrigin === null ? null : venueOfUrl(session.verifiedOrigin)
        const linkIssue = linkIssueOf(session)
        const issue = venue === null ? linkIssue : null
        const detail = [...(venue === null && issue !== null ? [issue.text] : []), ...(session.acknowledged ? [] : ['confirming'])].join(' · ')
        return $sessionRow(
          $badged(
            venue === null ? $icon({ $content: $unknown, viewBox: '0 0 32 32', size: '24px', fill: palette.foreground }) : $venueIcon(venue.venueId, 24),
            $avatarBadge(style({ width: '14px', height: '14px' }))(
              $icon({ $content: $walletConnectLogo, viewBox: '0 0 32 32', width: '10px', fill: linkIssue === null ? palette.positive : linkIssue.color, svgOps: style({ display: 'block' }) })
            )
          ),
          venue === null ? origin : venue.name,
          venue !== null && session.verifiedOrigin !== null
            ? $row(spacing.tiny, style({ flex: '1 1 0', minWidth: '3em', alignItems: 'center', overflow: 'hidden' }))(
                $anchor(
                  attr({ href: session.verifiedOrigin, rel: 'noopener noreferrer', title: session.verifiedOrigin }),
                  style({ display: 'flex', alignItems: 'center', minWidth: '0', color: palette.foreground })
                )($node(style({ minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis' }))($text(origin)), $externalMark()),
                ...(detail === '' ? [] : [$node(style({ flexShrink: '0' }))($text(`· ${detail}`))])
              )
            : detail === ''
              ? null
              : $node(attr({ title: detail }), style({ flex: '1 1 0', minWidth: '3em', overflow: 'hidden', textOverflow: 'ellipsis', color: issue === null ? palette.foreground : issue.color }))($text(detail)),
          $ButtonSecondary({ $container: $defaultMiniButtonSecondary, $content: $text('Disconnect') })({ click: disconnectTether(map(() => session.topic)) })
        )
      }

      const $sessionNeeded = (): I$Node =>
        switchLatest(
          map(
            open => (open ? empty : $node(style({ fontSize: text.xs, lineHeight: '1.5', color: palette.foreground }))($text("Needs this browser's session; sign one above."))),
            agent.session
          )
        )

      const $sessionsHeader = (): I$Node =>
        $row(spacing.small, style({ alignItems: 'center' }))(
          $node(style({ flex: '1', minWidth: '0' }))(
            $labeledDivider(
              $row(spacing.tiny, style({ alignItems: 'center' }))(
                $node($text('Sessions')),
                switchLatest(
                  map(
                    missing =>
                      $infoTooltip(
                        $column(spacing.small, style({ maxWidth: '280px', whiteSpace: 'normal', lineHeight: '1.4' }))(
                          ...(missing.length === 0
                            ? []
                            : [
                                ...missing.map(item => $detailLine(item.label, item.value, palette.indeterminate)),
                                ...(missing.some(item => item.value === 'Blocked')
                                  ? [
                                      $node(style({ fontSize: text.xs, color: palette.foreground }))(
                                        $text(
                                          `Allow ${missing.filter(item => item.value === 'Blocked').length > 1 ? 'them' : 'it'} ${
                                            matchMedia('(display-mode: standalone)').matches ? "in App info, from the app's ⋮ menu." : 'in site settings, the icon left of the address.'
                                          }`
                                        )
                                      )
                                    ]
                                  : []),
                                $node(style({ borderTop: `1px solid ${SEPARATOR_COLOR}` }))()
                              ]),
                          $node(style({ color: palette.foreground }))($text("dApps and agents act for this fund through this browser's session."))
                        ),
                        missing.length === 0 ? palette.foreground : palette.indeterminate
                      ),
                    missingPermissions
                  )
                )
              )
            )
          ),
          switchLatest(
            map(
              fund =>
                fund === null
                  ? empty
                  : $ButtonSecondary({ $container: $defaultMiniButtonSecondary(softNavClick(href(routeSchema.wallet.agent))), $content: $text('New agent') })({}),
              account
            )
          )
        )

      const $linkButton = switchLatest(
        map(
          current =>
            current === 'idle' || current === 'stopped'
              ? $ButtonSecondary({ $container: $defaultMiniButtonSecondary, $content: $text('Link dApp'), disabled: map(open => !open, agent.session) })({ click: listenTether() })
              : $ButtonSecondary({ $container: $defaultMiniButtonSecondary, $content: $text('Cancel') })({ click: stopLinkTether() }),
          linkMode
        )
      )
      const $linkWaiting = switchLatest(
        map(
          ({ status, looked }) =>
            $row(spacing.tiny, style({ alignItems: 'baseline', minWidth: '0', fontSize: text.xs, lineHeight: '1.5' }))(
              status === null
                ? $intermediatePulse(just(true))(
                    $node(style({ minWidth: '0', color: palette.foreground, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }))(
                      $text(looked ? 'No wc: link on the clipboard yet' : "Copy a dApp's wc: link, then come back")
                    )
                  )
                : $node(style({ minWidth: '0', color: status.kind === 'error' ? palette.negative : palette.foreground }))(
                    $text(status.kind === 'pending' ? 'Connecting…' : status.kind === 'awaiting' ? 'Pairing, waiting for the dApp' : status.text)
                  ),
              $node(style({ flexShrink: '0', color: palette.foreground }))($text('·')),
              $node(
                attr({ role: 'button', tabindex: '0' }),
                style({ flexShrink: '0', color: palette.primary, cursor: 'pointer' }),
                keyActivate(),
                pasteLinkTether(
                  nodeEvent('click'),
                  map(() => null)
                )
              )($text('Paste'))
            ),
          combine({ status: connectStatus, looked: clipEmpty })
        )
      )
      const $linkPaste = $FieldLabeled({
        label: null,
        placeholder: "paste a dApp's wc: link",
        value: linkUri,
        $container: $defaultTextFieldContainer(style({ alignItems: 'stretch' })),
        $input: $defaultInputContainer(
          effectRun((el: unknown) => {
            requestAnimationFrame(() => (el as HTMLInputElement).focus({ preventScroll: true }))
          }),
          styleBehavior(just({ paddingLeft: '36px' })),
          attrBehavior(map(off => ({ disabled: off ? '' : null }), linkInert)),
          styleBehavior(map(off => (off ? { opacity: '0.6' } : null), linkInert))
        ),
        $$field: $field =>
          $node(style({ position: 'relative', display: 'flex', width: '100%' }))(
            $node(style({ position: 'absolute', left: '10px', top: 0, bottom: 0, display: 'flex', alignItems: 'center', pointerEvents: 'none' }))(
              $icon({ $content: $walletConnectLogo, viewBox: '0 0 32 32', width: '18px', fill: palette.foreground })
            ),
            $field
          ),
        hint: map(status => (status?.kind === 'pending' ? 'Connecting…' : status?.kind === 'awaiting' ? 'Pairing, waiting for the dApp' : ''), connectStatus),
        validation: linkInputError
      })({ change: changeUriTether() })
      const $linkBody = switchLatest(
        map(
          current =>
            current === 'idle'
              ? empty
              : current === 'stopped'
                ? $node(style({ fontSize: text.xs, lineHeight: '1.5', color: palette.foreground }))($text('Stopped watching the clipboard'))
                : current === 'listening'
                  ? $linkWaiting
                  : $linkPaste,
          linkMode
        )
      )

      const $linkPanel: I$Node =
        $column(spacing.default)(
          ...(isDesktopScreen
            ? []
            : [
                switchLatest(
                  map(
                    a =>
                      a.issues.length === 0
                        ? empty
                        : $column(spacing.tiny)(...a.issues.map(issue => $node(style({ fontSize: text.xs, lineHeight: '1.5', color: issue.color }))($text(issue.text)))),
                    alert
                  )
                )
              ]),
          $browserSessions,
          switchLatest(
            map(
              kind =>
                kind === 'unfunded'
                  ? $alertInfo($node(style({ color: palette.foreground, fontSize: text.sm, lineHeight: '1.5' }))($text('Create your fund first; dApps and agents act for it.')))
                  : $column(spacing.default)(
                      ...(kind === 'signed'
                        ? [$row(spacing.small, style({ alignItems: 'center' }))($node(style({ flex: '1', minWidth: '0' }))($sessionsHeader()), $linkButton), $sessionNeeded(), $linkBody]
                        : [$sessionsHeader(), $sessionNeeded()]),
                      switchLatest(
                        map(
                          listed =>
                            listed
                              ? $column(spacing.small)(
                                  switchLatest(map(list => (list.length === 0 ? empty : $column(spacing.small)(...list.map($connectionRow))), walletLinkSessions)),
                                  $AgentSection(agent, account)({ command: commandTether(), enableSession: enableSessionTether() })
                                )
                              : $node(style({ fontSize: text.xs, lineHeight: '1.5', color: palette.foreground }))($text('No dApp or agent yet')),
                          op(
                            combine({ sessions: walletLinkSessions, identities: agent.identities, fund: account }),
                            map(({ sessions, identities, fund }) => sessions.length > 0 || (fund !== null && identities.some(identity => isAddressEqual(identity.fund, fund)))),
                            skipRepeats
                          )
                        )
                      )
                    ),
              linkKind
            )
          ),
          $alertState,
          $activityLog
        )

      return [
        $node(style({ display: 'contents' }))(
          switchLatest(map(() => empty, combine({ status: connectStatus, mode: linkMode, looked: clipEmpty }))),
          $control(
            $ButtonSecondary({
              $container: $defaultMiniButtonSecondary(
                style({ height: '34px' }),
                attr({ 'aria-haspopup': 'dialog', 'aria-label': 'Sessions', title: 'Sessions' }),
                attrBehavior(map(opened => ({ 'aria-expanded': opened ? 'true' : 'false' }), isOpen))
              ),
              $content: $row(spacing.tiny, style({ alignItems: 'center' }))(
                switchLatest(
                  map(({ a, count }) => {
                    const $mark =
                      count === 0
                        ? $icon({ $content: $key, viewBox: '0 0 24 24', size: '20px', svgOps: style({ color: a.color }) })
                        : $node(
                            attr({ 'aria-label': `${count} dApp ${count === 1 ? 'request' : 'requests'} waiting` }),
                            style({
                              minWidth: '20px',
                              height: '20px',
                              padding: '0 5px',
                              boxSizing: 'border-box',
                              borderRadius: '10px',
                              backgroundColor: a.color,
                              color: palette.background,
                              fontSize: '11px',
                              fontWeight: '700',
                              lineHeight: '20px',
                              textAlign: 'center'
                            })
                          )($text(String(count)))
                    return a.issues.length === 0 || !isDesktopScreen
                      ? $mark
                      : $Tooltip({
                          $dropContainer: $tooltipDropContainer,
                          $content: $column(spacing.small, style({ fontSize: text.sm, maxWidth: '280px', whiteSpace: 'normal', lineHeight: '1.4' }))(
                            ...a.issues.map(issue => $node(style({ color: issue.color }))($text(issue.text)))
                          ),
                          $anchor: $mark
                        })({})
                  }, combine({ a: alert, count: op(signQueue, map(queue => queue.length), skipRepeats) }))
                ),
                $popoverCaret()
              )
            })({ click: openTether() })
          ),
          $Popover({
            $container: $anchorArea,
            $target: $node(attr({ 'aria-hidden': 'true' }), style({ flex: 1 }))(),
            dismiss: later,
            $open: map(
              () =>
                $column(spacing.default, style({ width: POPOVER_WIDTH }))(
                  switchLatest(
                    map(topic => {
                      void disconnectDapp(topic)
                      return empty
                    }, disconnect)
                  ),
                  switchLatest(
                    map(() => {
                      enableSignAlerts()
                      return empty
                    }, enableAlerts)
                  ),
                  switchLatest(map(shown => (shown ? $DappPrompt({ walletPair })({ later: laterTether() }) : $linkPanel), prompting))
                ),
              merge(open, autoOpen)
            )
          })({ open: popoverOpenTether() })
        ),
        {
          command,
          enableSession,
          revoke: switchLatest(
            map(
              (item: ISignOutItem) => fromIterable(item.chainIds.map((chainId): IRevokeDraft => ({ kind: 'revoke', id: `revoke:${chainId}`, chainId }))),
              filter(item => item.everywhere, signOut)
            )
          ),
          walletIntent: op(
            forgetting,
            switchMap(forgot => forgot.then((): IWalletIntent => 'disconnect', (): null => null)),
            filterNull
          )
        }
      ]
    }
  )
