import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { type ExecContext, type IAttestation, passthroughOperate, planDappOperate, runDraft, venueIntentOf } from '@puppet/sdk/client'
import { CompactContractError, CompactError, formatThrownError } from '@puppet/sdk/compact'
import { CHAIN_ID_LIST, type ChainId, PRECISION } from '@puppet/sdk/const'
import { clientOf, readFundState } from '@puppet/sdk/intent'
import { fundTable } from '@puppet/sdk/schema'
import { type IDappTypedData, screenDappTypedData, signDappTypedData, VENUES } from '@puppet/sdk/venue'
import {
  awaitPromises,
  combine,
  empty,
  filter,
  filterNull,
  fromIterable,
  fromPromise,
  type IStream,
  joinMap,
  joinMapConcurrently,
  just,
  map,
  merge,
  never,
  op,
  reduce,
  sampleMap,
  skipRepeats,
  skipRepeatsWith,
  switchLatest,
  switchMap,
  take,
  until,
  wait
} from 'aelea/stream'
import { type IBehavior, multicast, state } from 'aelea/stream-extended'
import { $node, $text, attr, component, fromEventTarget, type I$Node, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { type Address, getAddress, isAddress, isAddressEqual, isHex, type TypedDataDefinition } from 'viem'
import {
  $ButtonSecondary,
  $defaultMiniButtonSecondary,
  $dot,
  $DropMenu,
  $infoTooltip,
  $intermediatePulse,
  type IDropMenuItem,
  text
} from '@/ui-components'
import type { IAgentIdentity } from '../app/localStoreSchema.js'
import { $fundAvatar } from '../common/$fundAvatar.js'
import { chainName } from '../common/$chain.js'
import { clientDeps } from '../io/clientDeps.js'
import { agentManual, type IAgentReply, type IAppFrame } from '@puppet/sdk/agent'
import { agentSocket, type IAgentEvent } from '../wallet/agentLink.js'
import type { IConnectedWallet, ISettledTx, IWalletKeys, IWalletPair } from '../wallet/index.js'
import { DAPP_ERROR_MESSAGE } from '../wallet/walletLink.js'
import { $sessionRow } from './$sessionRow.js'

export type IAgentCommand = { kind: 'knock'; secret: string } | { kind: 'pause'; secret: string } | { kind: 'remove'; secret: string }

export type IAgentLogEntry = { secret: string; at: number; kind: string; reply: IAgentReply; note?: string }

export type IAgentStatus =
  | { kind: 'searching'; reason: string }
  | { kind: 'blocked' }
  | { kind: 'waiting'; reason: string; sign: boolean }
  | { kind: 'linked'; expiry: bigint }
  | { kind: 'paused' }

export type IAgentStatuses = Readonly<Partial<Record<string, IAgentStatus>>>

type ILinkSession = { user: Address; account: Address; expiry: bigint }
type IServed = { kind: 'served'; entry: IAgentLogEntry; settled: ISettledTx[] }
type IStep =
  | { secret: string; kind: 'searching'; reason: string }
  | { secret: string; kind: 'blocked' }
  | { secret: string; kind: 'waiting'; reason: string; sign: boolean }
  | { secret: string; kind: 'grant'; session: ILinkSession }
  | { secret: string; kind: 'paused' }
  | { secret: string; kind: 'proven' }
  | ({ secret: string } & IServed)
  | { secret: string; kind: 'refused'; entry: IAgentLogEntry }
  | { secret: string; kind: 'lost'; reason: string; retry: number }

const RECONNECT_FIRST_MS = 3_000
const RECONNECT_CAP_MS = 60_000

export const $agentStatus = (current: IAgentStatus | undefined): I$Node => {
  const shown =
    current === undefined
      ? { label: 'Awaiting', color: palette.foreground, tip: 'Your wallet looks for it while it is open.' }
      : current.kind === 'linked'
        ? {
            label: 'Linked',
            color: palette.positive,
            tip: `It acts with this browser's session until ${new Date(Number(current.expiry) * 1000).toLocaleString()}, as you would here. Every request is screened and simulated before the app signs.`
          }
        : current.kind === 'waiting'
          ? { label: 'Waiting', color: palette.indeterminate, tip: `It is running and proved its link. ${current.reason}` }
          : current.kind === 'paused'
            ? { label: 'Paused', color: palette.foreground, tip: 'You paused it, so the app no longer looks for it. Resume lets it link again.' }
            : current.kind === 'blocked'
              ? {
                  label: 'Blocked',
                  color: palette.negative,
                  tip: 'Your browser blocks this site from reaching apps on this device. Allow it in this site’s settings, and the app finds your agent on its own.'
                }
              : { label: 'Awaiting', color: palette.foreground, tip: current.reason }
  return $row(spacing.tiny, style({ alignItems: 'center', flexShrink: '0' }))(
    $intermediatePulse(just(current === undefined || current.kind === 'searching'))(
      $dot(shown.color),
      $node(style({ fontSize: text.xs, color: shown.color, whiteSpace: 'nowrap' }))($text(shown.label))
    ),
    $infoTooltip(shown.tip, palette.foreground)
  )
}

export const agentActionOf = (current: IAgentStatus | undefined): { label: 'Pause' | 'Sign session' | 'Resume'; title: string; run: 'pause' | 'sign' | 'knock' } | null =>
  current?.kind === 'linked'
    ? { label: 'Pause', title: 'Stop this agent’s link; it can act again once you resume it', run: 'pause' }
    : current?.kind === 'waiting' && current.sign
      ? { label: 'Sign session', title: 'Sign one session to let it act; it covers every agent until it ends', run: 'sign' }
      : current?.kind === 'paused'
        ? { label: 'Resume', title: 'Let the app look for it again', run: 'knock' }
        : null

export const $agentRequestRow = (entry: IAgentLogEntry, identity: IAgentIdentity | undefined): I$Node =>
  $row(spacing.small, style({ alignItems: 'baseline', fontSize: text.xs, minWidth: '0' }))(
    identity === undefined ? empty : $node(attr({ title: identity.name }), style({ display: 'flex', alignSelf: 'center', flexShrink: '0' }))($fundAvatar(identity.cells, 14)),
    $node(style({ color: palette.foreground, flexShrink: '0' }))($text(new Date(entry.at).toLocaleTimeString())),
    $node(style({ color: palette.message, flexShrink: '0' }))($text(entry.kind)),
    entry.reply.type === 'failed'
      ? $node(attr({ title: `${entry.reply.code}: ${entry.reply.detail}` }), style({ color: palette.negative, minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }))(
          $text(DAPP_ERROR_MESSAGE[entry.reply.code] ?? entry.reply.detail)
        )
      : $node(
          style({ color: palette.foreground, minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
          ...(entry.note === undefined
            ? []
            : [attr({ title: `A step the venue runs before this signature failed: ${entry.note}` }), style({ textDecoration: `underline dotted ${palette.indeterminate}`, textUnderlineOffset: '3px', cursor: 'help' })])
        )(
          $text(entry.reply.type === 'done' ? `settled on ${chainName(entry.reply.chainId)}` : entry.reply.type === 'signed' ? 'signed' : 'sent to the venue')
        )
  )

async function linkSessionOf(pair: IWalletPair, fund: Address): Promise<ILinkSession> {
  if (pair.wallet === null) throw new Error('Connect your wallet first')
  if (pair.keys === null) throw new Error('This build carries no key service, so the app cannot sign for your agents')
  const root = await pair.root
  if (root === null) throw new Error('A connected wallet resolved no account')
  if (root.fund === null) throw new Error('Create your fund first; your agents operate it')
  if ('unknown' in root.fund) throw new Error(root.fund.unknown)
  if (!isAddressEqual(root.fund.account, fund)) throw new Error(`It operates fund ${fund}, which is not your active fund; switch to it to link this agent.`)
  const user = getAddress(pair.wallet.address)
  const session = await pair.keys.carriedSessionOf(user, HUB_CHAIN_ID)
  if (session === null) throw new CompactError('SESSION_EXPIRED', 'Sign a session to let it act; one session covers every agent until it ends.', 'hard')
  if (pair.keys.fundSignerOf(user, root.fund.account) === null) throw new CompactError('FUND_KEY_MISSING', 'This browser no longer holds your fund’s key; sign a session to restore it.', 'hard')
  return { user, account: root.fund.account, expiry: session.expiry }
}

function chainOf(raw: unknown): ChainId {
  const chainId = CHAIN_ID_LIST.find(id => id === raw)
  if (chainId === undefined) throw new CompactError('BAD_REQUEST', `chain ${String(raw)} is not one Puppet runs on`, 'hard')
  return chainId
}

async function serve(pair: IWalletPair, session: ILinkSession, secret: string, id: number, frame: Record<string, unknown>): Promise<IServed> {
  const at = Date.now()
  const kind = frame.kind
  try {
    if (kind !== 'operate' && kind !== 'sign' && kind !== 'venueWithdraw' && kind !== 'venueIntent' && kind !== 'allocate' && kind !== 'redeem' && kind !== 'retire') {
      throw new CompactError('BAD_REQUEST', `kind ${String(kind)} is not one of operate, sign, venueWithdraw, venueIntent, allocate, redeem, retire`, 'hard')
    }
    const root = await pair.root
    const fund = root === null || root.fund === null || 'unknown' in root.fund ? null : root.fund
    const keys = pair.keys
    if (pair.wallet === null || keys === null || root === null || fund === null || !isAddressEqual(pair.wallet.address, session.user) || !isAddressEqual(fund.account, session.account)) {
      throw new CompactError('LINK_STALE', `the app no longer holds the fund ${session.account} this agent operates; the owner makes it the active fund again`, 'hard')
    }
    const unattended: IWalletKeys = {
      ...keys,
      async grantSession(wallet, chainId) {
        const session = await keys.carriedSessionOf(wallet.address, chainId)
        if (session !== null) return session
        if (keys.sessionOf(wallet.address, HUB_CHAIN_ID) === null) {
          throw new CompactError('SESSION_EXPIRED', 'the app has no live signing session; the owner signs one in the app', 'hard')
        }
        throw new CompactError(
          'CHAIN_SESSION_MISSING',
          `${chainName(chainId)} needs its own signing session, since its key epoch differs from the hub’s; make one trade there from the app to sign it`,
          'hard'
        )
      },
      async restoreFund(wallet, recorded) {
        const signer = keys.fundSignerOf(wallet.address, recorded.account)
        if (signer === null) throw new CompactError('FUND_KEY_MISSING', 'this browser no longer holds the fund’s key; the owner signs a session in the app to restore it', 'hard')
        return signer
      },
      async approveFund() {
        throw new CompactError('GENESIS_UNSIGNED', 'this request would open the fund’s account on a new chain before its opening is recorded, which needs the owner’s signature in the app', 'hard')
      }
    }
    if (kind === 'sign') {
      const raw = frame.typedData
      if (typeof raw !== 'object' || raw === null) throw new CompactError('BAD_REQUEST', 'a sign request carries typedData, as eth_signTypedData_v4 takes it', 'hard')
      const { domain, types, primaryType, message }: Record<string, unknown> = Object.fromEntries(Object.entries(raw))
      if (typeof domain !== 'object' || domain === null || typeof types !== 'object' || types === null || typeof primaryType !== 'string' || typeof message !== 'object' || message === null) {
        throw new CompactError('BAD_REQUEST', 'typedData needs domain, types, primaryType and message, as eth_signTypedData_v4 takes them', 'hard')
      }
      const typedData = { domain, types, primaryType, message } as TypedDataDefinition
      const reasons = screenDappTypedData(session.account, typedData as unknown as IDappTypedData)
      const [refusal] = reasons
      if (refusal !== undefined) throw new CompactError(refusal.code, reasons.map(reason => `${reason.code}: ${reason.detail}`).join('; '), 'hard')
      await unattended.grantSession(pair.wallet, HUB_CHAIN_ID)
      const { signature, presignFailures } = await signDappTypedData(await unattended.restoreFund(pair.wallet, fund), typedData)
      return {
        kind: 'served',
        entry: { secret, at, kind, reply: { type: 'signed', id, signature }, ...(presignFailures.length === 0 ? {} : { note: presignFailures.map(formatThrownError).join('; ') }) },
        settled: []
      }
    }
    const walletPrompt = (): Promise<never> =>
      Promise.reject(new CompactError('WALLET_UNATTENDED', 'this request needs the owner’s wallet to sign, which an agent request never prompts; the owner runs it from the app', 'hard'))
    const unattendedWallet: IConnectedWallet = { ...pair.wallet, walletClient: { ...pair.wallet.walletClient, signTypedData: walletPrompt }, switchChain: walletPrompt }
    const agentPair: IWalletPair = { ...pair, keys: unattended }
    const ctx: ExecContext = { ...clientDeps, wallet: unattendedWallet, root, loadRoot: () => Promise.resolve(root), keys: unattended }
    if (kind === 'venueWithdraw') {
      const { venue, amount } = frame
      if (typeof venue !== 'string' || !VENUES.some(entry => entry.venueId === venue && entry.withdraw !== undefined)) {
        throw new CompactError('BAD_REQUEST', `venue is one of ${VENUES.filter(entry => entry.withdraw !== undefined).map(entry => `"${entry.venueId}"`).join(', ')}`, 'hard')
      }
      if (typeof amount !== 'string' || !/^\d+$/.test(amount) || BigInt(amount) === 0n) {
        throw new CompactError('BAD_REQUEST', 'amount is a decimal string above "0", in the smallest unit of the token the venue pays out', 'hard')
      }
      await unattended.grantSession(pair.wallet, HUB_CHAIN_ID)
      await unattended.restoreFund(pair.wallet, fund)
      await runDraft({ kind: 'venueWithdraw', id: `agent:${id}`, venueId: venue, amount: BigInt(amount) }, ctx, null, [])
      return { kind: 'served', entry: { secret, at, kind, reply: { type: 'submitted', id } }, settled: [] }
    }
    if (kind === 'venueIntent') {
      const { venue, intent, params } = frame
      if (typeof venue !== 'string' || typeof intent !== 'string' || !VENUES.some(entry => entry.venueId === venue && entry.intents !== undefined && entry.intents.list.some(each => each.intent === intent))) {
        const known = VENUES.flatMap(entry => (entry.intents === undefined ? [] : entry.intents.list.map(each => `"${entry.venueId}" "${each.intent}"`)))
        throw new CompactError('BAD_REQUEST', `venue and intent are one of ${known.join(', ')}`, 'hard')
      }
      const action = venueIntentOf(venue, intent).intent
      const given: Record<string, unknown> = typeof params === 'object' && params !== null ? Object.fromEntries(Object.entries(params)) : {}
      const missing = action.inputs.filter(input => typeof given[input.name] !== 'string').map(input => input.name)
      if (missing.length > 0) throw new CompactError('BAD_REQUEST', `params needs ${missing.join(', ')} as strings`, 'hard')
      await unattended.grantSession(pair.wallet, HUB_CHAIN_ID)
      await unattended.restoreFund(pair.wallet, fund)
      await runDraft({ kind: 'venueIntent', id: `agent:${id}`, venueId: venue, intent, params: Object.fromEntries(action.inputs.map(input => [input.name, String(given[input.name])])) }, ctx, null, [])
      return { kind: 'served', entry: { secret, at, kind, reply: { type: 'submitted', id } }, settled: [] }
    }
    let attestations: IAttestation[]
    if (kind === 'operate') {
      const listed = frame.calls
      if (!Array.isArray(listed) || listed.length === 0) throw new CompactError('BAD_REQUEST', 'an operate request carries one or more calls', 'hard')
      const calls = listed.map((item: unknown, i) => {
        if (typeof item !== 'object' || item === null) throw new CompactError('BAD_REQUEST', `call ${i + 1} is not an object`, 'hard')
        const { to, data, value, gas }: Record<string, unknown> = Object.fromEntries(Object.entries(item))
        if (typeof to !== 'string' || !isAddress(to)) throw new CompactError('BAD_REQUEST', `call ${i + 1} names no valid "to" address`, 'hard')
        if (data !== undefined && (typeof data !== 'string' || !isHex(data))) throw new CompactError('BAD_REQUEST', `call ${i + 1} carries a "data" that is not hex`, 'hard')
        if (value !== undefined && typeof value !== 'string') throw new CompactError('BAD_REQUEST', `call ${i + 1} carries a non-string "value"`, 'hard')
        if (gas !== undefined && typeof gas !== 'string') throw new CompactError('BAD_REQUEST', `call ${i + 1} carries a non-string "gas"`, 'hard')
        return { to, data, value, gas }
      })
      const chainId = chainOf(frame.chainId)
      attestations = [await passthroughOperate(clientDeps, agentPair, root, await planDappOperate(clientDeps, agentPair, root, chainId, calls))]
    } else if (kind === 'allocate') {
      const { token, amount } = frame
      if (typeof token !== 'string' || !isAddress(token)) throw new CompactError('BAD_REQUEST', 'an allocate request names the round token', 'hard')
      if (typeof amount !== 'string' || !/^\d+$/.test(amount)) throw new CompactError('BAD_REQUEST', 'amount is a decimal string in the token’s smallest unit', 'hard')
      attestations = await runDraft(
        { kind: 'allocate', id: `agent:${id}`, escrowChainId: chainOf(frame.chainId), escrowToken: getAddress(token), contribution: BigInt(amount), puppets: 0n, identity: null },
        ctx,
        null,
        []
      )
    } else {
      const [fundRow] = await clientDeps.chronicle.select(fundTable, { where: { master: session.account } })
      if (fundRow === undefined) throw new CompactError('FUND_UNRECORDED', `the chronicle records no fund for ${session.account} yet`, 'soft')
      const fundState = await readFundState(clientDeps, fundRow, await clientOf(clientDeps, HUB_CHAIN_ID).getBlockNumber())
      const { token } = frame
      if (typeof token !== 'string' || !isAddress(token)) throw new CompactError('BAD_REQUEST', `a ${kind} request names the hub token it pays out in`, 'hard')
      let fraction = 0n
      if (kind === 'redeem') {
        if (frame.fill !== 'all') throw new CompactError('BAD_REQUEST', 'fill is "all": a redemption pays the whole exit queue at once', 'hard')
        if (fundState.redemption.queued === 0n) throw new CompactError('NOTHING_TO_PAY', 'no queued exits to pay', 'hard')
      } else {
        const { shares } = frame
        if (typeof shares !== 'string' || !/^\d+$/.test(shares) || BigInt(shares) === 0n) throw new CompactError('BAD_REQUEST', 'shares is a decimal string above "0"', 'hard')
        if (fundState.masterShares === 0n) throw new CompactError('NOTHING_TO_PAY', 'the owner holds no shares of the fund', 'hard')
        if (BigInt(shares) > fundState.masterShares) throw new CompactError('BAD_REQUEST', `shares ${shares} is more than the owner’s ${fundState.masterShares}`, 'hard')
        fraction = (BigInt(shares) * PRECISION.basisPoints) / fundState.masterShares
        if (fraction === 0n) throw new CompactError('BAD_REQUEST', `shares is below one basis point of the owner’s ${fundState.masterShares}`, 'hard')
      }
      attestations = await runDraft(
        {
          kind: 'redeem',
          id: `agent:${id}`,
          fraction,
          join: 0n,
          token: getAddress(token),
          holders: 0n,
          plan: null,
          source: null,
          leg: null
        },
        ctx,
        null,
        []
      )
    }
    const last = attestations[attestations.length - 1]
    if (last === undefined) throw new CompactError('NOTHING_SENT', `the ${kind} request sent no transaction`, 'hard')
    return {
      kind: 'served',
      entry: {
        secret,
        at,
        kind,
        reply: {
          type: 'done',
          id,
          chainId: last.request.chainId,
          block: String(last.settledBlock),
          txHash: last.result.txHash,
          fees: attestations.map(a => ({ chainId: a.request.chainId, token: a.request.intent.header.feeToken, amount: String(a.result.relayFee) }))
        }
      },
      settled: attestations.map(a => ({ chainId: a.request.chainId, account: a.result.account, block: a.settledBlock, txHash: a.result.txHash }))
    }
  } catch (err) {
    const code = err instanceof CompactError || err instanceof CompactContractError ? err.code : 'REQUEST_FAILED'
    return { kind: 'served', entry: { secret, at, kind: String(kind), reply: { type: 'failed', id, code, detail: formatThrownError(err) } }, settled: [] }
  }
}

export interface I$AgentLink {
  walletPair: IStream<IWalletPair>
  identities: IStream<readonly IAgentIdentity[]>
  command: IStream<IAgentCommand>
  session: IStream<boolean>
}

const linkKeyOf = (identity: IAgentIdentity): string => `${identity.secret}:${identity.port}:${identity.fund}`

export const $AgentLink = ({ walletPair, identities, command, session }: I$AgentLink) =>
  component(
    ([replied, repliedTether]: IBehavior<IStep, { secret: string; frame: IAppFrame }>, [lost, lostTether]: IBehavior<IStep, Extract<IStep, { kind: 'lost' }>>) => {
      let serving: Promise<unknown> = Promise.resolve()
      const access: IStream<PermissionState | 'unsupported'> = op(
        fromPromise(
          navigator.permissions === undefined
            ? Promise.resolve(null)
            : navigator.permissions.query({ name: 'loopback-network' as PermissionName }).catch((err: unknown) => {
                if (err instanceof TypeError) return null
                throw err
              })
        ),
        switchMap(status => (status === null ? just<PermissionState | 'unsupported'>('unsupported') : merge(just(status.state), map(() => status.state, fromEventTarget(status, 'change'))))),
        skipRepeats,
        state()
      )
      const reachable: IStream<boolean> = op(
        access,
        filter(reach => reach !== 'denied'),
        take(1),
        map(() => true)
      )

      const sessionOf = (identity: IAgentIdentity, retry: number): IStream<IStep> => {
        const secret = identity.secret
        const events: IStream<IAgentEvent> = op(
          agentSocket(
            identity.port,
            secret,
            op(
              replied,
              filter(out => out.secret === secret),
              map(out => out.frame)
            )
          ),
          multicast
        )
        const decided: IStream<IStep> = op(
          events,
          filter(event => event.kind === 'proven'),
          take(1),
          switchMap(() =>
            op(
              combine({ pair: walletPair, open: session }),
              switchMap(async ({ pair }): Promise<IStep> => {
                try {
                  return { secret, kind: 'grant', session: await linkSessionOf(pair, identity.fund) }
                } catch (err) {
                  const code = err instanceof CompactError ? err.code : null
                  return { secret, kind: 'waiting', reason: formatThrownError(err), sign: code === 'SESSION_EXPIRED' || code === 'FUND_KEY_MISSING' }
                }
              }),
              skipRepeatsWith((a, b) => a.kind === 'grant' && b.kind === 'grant' && a.session.expiry === b.session.expiry)
            )
          ),
          multicast
        )
        const served: IStream<IStep> = op(
          sampleMap(
            (grant: Extract<IStep, { kind: 'grant' }>, request: Extract<IAgentEvent, { kind: 'request' }>) => ({ grant, request }),
            filter((step): step is Extract<IStep, { kind: 'grant' }> => step.kind === 'grant', decided),
            filter((event): event is Extract<IAgentEvent, { kind: 'request' }> => event.kind === 'request', events)
          ),
          joinMapConcurrently(
            next =>
              op(
                walletPair,
                take(1),
                map(pair => {
                  const run = serving.then(() => serve(pair, next.grant.session, secret, next.request.id, next.request.frame))
                  serving = run
                  return run.then((answer): IStep => ({ secret, ...answer }))
                }),
                awaitPromises
              ),
            1
          )
        )
        const refused: IStream<IStep> = op(
          events,
          filter((event): event is Extract<IAgentEvent, { kind: 'busy' }> => event.kind === 'busy'),
          map((event): IStep => ({ secret, kind: 'refused', entry: { secret, at: Date.now(), kind: String(event.frame.kind), reply: event.reply } }))
        )
        const closed: IStream<IStep> = op(
          events,
          filter((event): event is Extract<IAgentEvent, { kind: 'closed' }> => event.kind === 'closed'),
          map(
            (event): IStep => ({
              secret,
              kind: 'lost',
              retry: event.phase === 'granting' || event.phase === 'linked' ? 0 : retry,
              reason:
                event.phase === null
                  ? `Nothing answers on port ${identity.port} yet. Start your agent; it shows up here on its own while your wallet is open.`
                  : event.reason === ''
                    ? 'It dropped the link; the app looks for it again.'
                    : `The link closed: ${event.reason}. The app looks for it again.`
            })
          )
        )
        const proven: IStream<IStep> = op(
          events,
          filter(event => event.kind === 'proven'),
          take(1),
          map((): IStep => ({ secret, kind: 'proven' }))
        )
        return merge(proven, decided, served, refused, closed)
      }

      const linkOf = (identity: IAgentIdentity): IStream<IStep> => {
        const secret = identity.secret
        const knocks: IStream<number | null> = op(
          merge(
            map((): Extract<IAgentCommand, { kind: 'knock' }> => ({ kind: 'knock', secret }), reachable),
            op(
              command,
              filter((next): next is Extract<IAgentCommand, { kind: 'knock' | 'pause' }> => next.secret === secret && next.kind !== 'remove')
            ),
            filter(drop => drop.secret === secret, lost)
          ),
          switchMap(event =>
            event.kind === 'pause'
              ? just(null)
              : event.kind === 'knock'
                ? just(0)
                : op(
                    wait(Math.min(RECONNECT_FIRST_MS * 2 ** event.retry, RECONNECT_CAP_MS)),
                    switchMap(() => reachable),
                    map(() => event.retry + 1)
                  )
          )
        )
        return op(
          knocks,
          map(retry => (retry === null ? just<IStep>({ secret, kind: 'paused' }) : sessionOf(identity, retry))),
          switchLatest,
          steps =>
            merge(
              just<IStep>({
                secret,
                kind: 'searching',
                reason: identity.proven
                  ? 'Your wallet looks for your agent while it is open.'
                  : 'Waiting for its first link: paste its link line into your agent’s .env and start it, with your wallet open.'
              }),
              op(
                merge(
                  access,
                  op(
                    lost,
                    filter(drop => drop.secret === secret),
                    switchMap(() => op(access, take(1)))
                  )
                ),
                filter(reach => reach === 'denied'),
                map((): IStep => ({ secret, kind: 'blocked' }))
              ),
              steps
            )
        )
      }

      const born: IStream<IAgentIdentity> = op(
        identities,
        reduce(
          (was: { keys: readonly string[]; born: readonly IAgentIdentity[] }, list: readonly IAgentIdentity[]) => ({
            keys: list.map(linkKeyOf),
            born: list.filter(identity => !was.keys.includes(linkKeyOf(identity)))
          }),
          { keys: [], born: [] }
        ),
        joinMap(next => fromIterable(next.born))
      )
      const steps: IStream<IStep> = op(
        born,
        joinMap(identity =>
          op(
            linkOf(identity),
            until(
              op(
                identities,
                filter(list => !list.some(entry => linkKeyOf(entry) === linkKeyOf(identity)))
              )
            )
          )
        ),
        repliedTether(
          map((step: IStep): { secret: string; frame: IAppFrame } | null =>
            step.kind === 'grant'
              ? { secret: step.secret, frame: { type: 'linked', user: step.session.user, account: step.session.account, manual: agentManual() } }
              : step.kind === 'served'
                ? { secret: step.secret, frame: step.entry.reply }
                : null
          ),
          filterNull
        ),
        lostTether(filter((step): step is Extract<IStep, { kind: 'lost' }> => step.kind === 'lost')),
        multicast
      )

      const status: IStream<IAgentStatuses> = op(
        steps,
        reduce((statuses: IAgentStatuses, step: IStep): IAgentStatuses => {
          const next: IAgentStatus | null =
            step.kind === 'searching' || step.kind === 'lost'
              ? { kind: 'searching', reason: step.reason }
              : step.kind === 'blocked'
                ? { kind: 'blocked' }
                : step.kind === 'waiting'
                ? { kind: 'waiting', reason: step.reason, sign: step.sign }
                : step.kind === 'grant'
                  ? { kind: 'linked', expiry: step.session.expiry }
                  : step.kind === 'paused'
                    ? { kind: 'paused' }
                    : null
          return next === null ? statuses : { ...statuses, [step.secret]: next }
        }, {}),
        state()
      )

      const log: IStream<readonly IAgentLogEntry[]> = op(
        steps,
        reduce((entries: readonly IAgentLogEntry[], step: IStep): readonly IAgentLogEntry[] => (step.kind === 'served' || step.kind === 'refused' ? [step.entry, ...entries].slice(0, 100) : entries), []),
        state()
      )

      const settled: IStream<readonly ISettledTx[]> = op(
        steps,
        filter((step): step is Extract<IStep, { kind: 'served' }> => step.kind === 'served' && step.settled.length > 0),
        map(step => step.settled)
      )

      const proven: IStream<string> = op(
        steps,
        filter(step => step.kind === 'proven'),
        map(step => step.secret)
      )

      return [never, { status, log, settled, proven }]
    }
  )

export interface I$AgentSection {
  identities: IStream<readonly IAgentIdentity[]>
  status: IStream<IAgentStatuses>
  log: IStream<readonly IAgentLogEntry[]>
  session: IStream<boolean>
}

type IAgentMenuItem = IDropMenuItem & { run: NonNullable<ReturnType<typeof agentActionOf>>['run'] | 'remove' }

export const $AgentSection = ({ identities, status }: I$AgentSection, account: IStream<Address | null>) =>
  component(
    (
      [pick, pickTether]: IBehavior<IAgentMenuItem, { secret: string; run: IAgentMenuItem['run'] }>,
      [armRemove, armRemoveTether]: IBehavior<PointerEvent, string>,
      [clickRemove, clickRemoveTether]: IBehavior<PointerEvent, string>
    ) => {
      const armed: IStream<string | null> = state(
        null,
        merge(
          armRemove,
          op(
            pick,
            filter(next => next.run === 'remove'),
            map(next => next.secret)
          )
        )
      )
      return [
        switchLatest(
          map(({ list, fund, arming }: { list: readonly IAgentIdentity[]; fund: Address | null; arming: string | null }): I$Node => {
            if (fund === null) return empty
            const mine = list.filter(identity => isAddressEqual(identity.fund, fund))
            if (mine.length === 0) return empty
            return $column(spacing.small)(
              ...mine.map(identity => {
                const current = op(
                  status,
                  map(statuses => statuses[identity.secret]),
                  skipRepeats
                )
                return $sessionRow(
                  $fundAvatar(identity.cells, 24),
                  identity.name,
                  switchLatest(map($agentStatus, current)),
                  identity.secret === arming
                    ? $ButtonSecondary({ $container: $defaultMiniButtonSecondary(style({ color: palette.negative })), $content: $text('Confirm') })({ click: clickRemoveTether(map(() => identity.secret)) })
                    : switchLatest(
                        map(
                          action =>
                            action === null
                              ? $ButtonSecondary({ $container: $defaultMiniButtonSecondary(attr({ 'aria-label': `Remove ${identity.name}` })), $content: $text('Remove') })({
                                  click: armRemoveTether(map(() => identity.secret))
                                })
                              : $DropMenu<IAgentMenuItem>({
                                  label: action.label,
                                  optionList: [
                                    { label: action.label, description: action.title, run: action.run },
                                    { label: 'Remove', description: 'Deletes it from this browser, so it can no longer link', run: 'remove' }
                                  ]
                                })({ select: pickTether(map(item => ({ secret: identity.secret, run: item.run }))) }),
                          op(
                            current,
                            map(agentActionOf),
                            skipRepeatsWith((a, b) => a?.run === b?.run)
                          )
                        )
                      )
                )
              })
            )
          }, combine({ list: identities, fund: account, arming: armed }))
        ),
        {
          command: merge(
            op(
              pick,
              filter((next): next is { secret: string; run: 'pause' | 'knock' } => next.run === 'pause' || next.run === 'knock'),
              map((next): IAgentCommand => ({ kind: next.run, secret: next.secret }))
            ),
            map((secret): IAgentCommand => ({ kind: 'remove', secret }), clickRemove)
          ),
          enableSession: filter(next => next.run === 'sign', pick)
        }
      ]
    }
  )
