import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { predictUserAccount } from '@puppet/sdk/account'
import {
  fundRecordsOf,
  type IDepositDraft,
  type IMandateDraft,
  type IRevokeDraft,
  type ISessionDraft,
  type ITradeDraft,
  type IWithdrawDraft,
  passthroughOperate,
  planDappOperate,
  selectedFundOf
} from '@puppet/sdk/client'
import { CompactError, formatThrownError } from '@puppet/sdk/compact'
import TOKEN from '@puppet/contracts/token'
import { getAccountExplorerUrl, readableAddress } from '@puppet/sdk/core'
import { type ChainId, DEFAULT_DEADLINE_SEC, IntervalTime } from '@puppet/sdk/const'
import type { IDigestClient } from '@puppet/sdk/datastore'
import type { IPriceSource } from '@puppet/sdk/evaluate'
import { intentTypedData, requireFolded } from '@puppet/sdk/intent'
import { cashFor } from '@puppet/sdk/pool'
import { ACCOUNT_VENUE, fundMetricTable, type IFundMetricRow } from '@puppet/sdk/schema'
import { combine, constant, empty, filter, filterNull, fromIterable, fromPromise, type IStream, just, map, merge, op, periodic, reduce, sampleMap, skip, skipRepeats, skipRepeatsWith, start, switchLatest, switchMap, switchPromises, take, tap, wait } from 'aelea/stream'
import { fromCallback, type IBehavior, multicast, type PromiseStateDone, type PromiseStateError, PromiseStatus, promiseState, state } from 'aelea/stream-extended'
import { $element, $node, $svg, $text, $wrapNativeElement, attr, attrBehavior, component, effectRun, fromEventTarget, type I$Node, type INode, nodeEvent, style, styleBehavior } from 'aelea/ui'
import { $column, $row, designSheet, isDesktopScreen, isMobileScreen, observer, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { $defaultAnchor, contains, href, isContaining, locationChange, match } from 'aelea/ui-router'
import { type Address, getAddress, type Hex, hashTypedData, isAddress, isAddressEqual } from 'viem'
import { mainnet } from 'viem/chains'
import {
  $anchor,
  $arrowRight,
  $ButtonPrimary,
  $ButtonSecondary,
  $defaultMiniButtonSecondary,
  $icon,
  $intermediatePromise,
  fadeIn,
  softNavClick,
  text
} from '@/ui-components'
import { uiStorage } from '@/ui-storage'
import { agentBookSlot, type IAgentBook, type IAgentIdentity } from '../app/localStoreSchema.js'
import { approvalAnswers, type IReleaseCheck, type IReleaseState, readRelease } from '../app/release.js'
import { routeSchema } from '../app/routeSchema.js'
import { $midContainer } from '../common/$common.js'
import { $ActionDrawer, type IDraft } from '../components/$ActionDrawer.js'
import { $MainMenu } from '../components/$MainMenu.js'
import type { IPerformanceMetric } from '../components/$PerformanceMetric.js'
import { $AgentLink, type IAgentCommand, type IAgentLogEntry, type IAgentStatuses } from '../components/$AgentLink.js'
import { clientDeps } from '../io/clientDeps.js'
import { getPrice, localPrice } from '../io/context.js'
import { escrowSurplus, type IHoldingView, ownHoldingViews } from '../io/datastore/own.js'
import { journal, journalDeps } from '../io/journal/journal.js'
import { askPersistentStorage } from '../utils/pwaInstall.js'
import { accountHeads, accountView, type IJournalEntries, type IOwnState, type ISessionSigner, localAccountView } from '@puppet/sdk/client'
import { matchmakerUrl } from '../io/matchmaker/index.js'
import { setViewCacheOwner } from '../io/onchain/viewRead.js'
import { answerState, client, handoff, localFirst, localReader, notLocal } from '../io/datastore/reads.js'
import { fundLiveOf, type IFundLive, type IOpenPositions, type ISyncFailure, OWNER_SYNC_CHECK_MS, OWNER_SYNC_MS, openPositionsOf } from '../io/venue.js'
import { walletValueUsd } from '../io/walletValue.js'
import { enableSmoothScroll } from '../utils/smoothScroll.js'
import { subject } from '../utils/subject.js'
import type { ISettledTx } from '../wallet/index.js'
import {
  announcedEntryOf,
  askWallet,
  connectEntry,
  connectedWalletOf,
  DISCONNECTED,
  foldEntries,
  foldWallet,
  injectedEntryOf,
  type IWalletControl,
  type IWalletEntry,
  type IWalletEvent,
  type IWalletIntent,
  type IWalletState,
  RESTORE_WAIT_MS,
  WALLET_ANSWER_MS,
  WALLET_ID_KEY
} from '../wallet/connect.js'
import { createWalletKeys, type IConnectedWallet, type IRootState, type IWalletKeys, type IWalletPair, publicClientMap } from '../wallet/index.js'
import { bindWalletReads } from '../wallet/wallet.js'
import { walletConnectEntry, walletConnectProvider } from '../wallet/wcProvider.js'
import { initWalletLink } from '../wallet/walletLink.js'

interface IApp {}

const keyChanges = new EventTarget()
const FOLD_WAIT_MS = 90_000
const FOLD_POLL_MS = 2_000
const foldedPast = async (account: Address, landed: readonly ISettledTx[]): Promise<ISyncFailure[]> => {
  const deadline = Date.now() + FOLD_WAIT_MS
  for (const chainId of new Set(landed.map(tx => tx.chainId))) {
    const landedAt = landed.reduce((top, tx) => (tx.chainId === chainId && tx.block > top ? tx.block : top), 0n)
    for (;;) {
      const behind = await accountHeads(journalDeps, chainId, [account])
        .then(([head]) => (head!.blockNumber < landedAt ? ('unserved' as const) : requireFolded(clientDeps, chainId, account).then(() => null)))
        .catch((error: unknown) => error)
      if (behind === null) break
      const waiting = behind === 'unserved' || (behind instanceof CompactError && behind.code === 'CHRONICLE_BEHIND')
      if (!waiting || Date.now() > deadline) {
        return [{ venue: 'Fund records', reason: behind === 'unserved' ? `chain ${chainId} has not yet served block ${landedAt}, where your last transaction landed` : formatThrownError(behind) }]
      }
      await new Promise(resolve => setTimeout(resolve, FOLD_POLL_MS))
    }
  }
  return []
}
const keyService = createWalletKeys(localStorage, publicClientMap, matchmakerUrl, new Worker('/session-key-worker.js', { type: 'module' }))
const announced =
  <A extends unknown[], R>(change: (...args: A) => Promise<R>) =>
  (...args: A): Promise<R> =>
    change(...args).finally(() => keyChanges.dispatchEvent(new Event('change')))
const walletKeys: IWalletKeys = {
  ...keyService,
  grantSession: announced(keyService.grantSession),
  approveFund: announced(keyService.approveFund),
  forgetSessions: announced(keyService.forgetSessions)
}

export const $Main = (_config: IApp = {}) =>
  component(
    (
      [clickUpdateVersion, clickUpdateVersionTether]: IBehavior<any, bigint>,
      [clickLater, clickLaterTether]: IBehavior<PointerEvent>,
      [clickReopen, clickReopenTether]: IBehavior<PointerEvent>,
      [clickFixes, clickFixesTether]: IBehavior<INode, PointerEvent>,
      [changeActivityTimeframe, changeActivityTimeframeTether]: IBehavior<IntervalTime>,
      [changePerformanceMetric, changePerformanceMetricTether]: IBehavior<IPerformanceMetric>,
      [changeHideBalances, changeHideBalancesTether]: IBehavior<boolean>,
      [changeDraft, changeDraftTether]: IBehavior<IDepositDraft | IWithdrawDraft>,
      [changeMandateDraft, changeMandateDraftTether]: IBehavior<IMandateDraft>,
      [changeTradeDraft, changeTradeDraftTether]: IBehavior<ITradeDraft>,
      [changeRevokeDraft, changeRevokeDraftTether]: IBehavior<IRevokeDraft>,
      [clearDrafts, clearDraftsTether]: IBehavior<null>,
      [releaseDraft, releaseDraftTether]: IBehavior<string>,
      [changeSettled, settledTether]: IBehavior<readonly ISettledTx[]>,
      [drawerSize, drawerSizeTether]: IBehavior<any, number>,
      [changeAgentIdentities, changeAgentIdentitiesTether]: IBehavior<readonly IAgentIdentity[]>,
      [changeAgentPending, changeAgentPendingTether]: IBehavior<IAgentIdentity | null>,
      [agentProven, agentProvenTether]: IBehavior<string>,
      [agentCommand, agentCommandTether]: IBehavior<IAgentCommand>,
      [agentStatus, agentStatusTether]: IBehavior<IAgentStatuses>,
      [agentLog, agentLogTether]: IBehavior<readonly IAgentLogEntry[]>,
      [enableSession, enableSessionTether]: IBehavior<unknown>,
      [drawerInFlight, drawerInFlightTether]: IBehavior<boolean>,
      [walletIntent, walletIntentTether]: IBehavior<IWalletIntent>,
      [dismissStorage, dismissStorageTether]: IBehavior<PointerEvent>
    ) => {
      const runInFlight = state(false, drawerInFlight)
      const dappSettled = subject<ISettledTx>()
      const settledTx: IStream<readonly ISettledTx[]> = merge(
        changeSettled,
        map(tx => [tx], dappSettled.stream)
      )
      const PROMPT_IN = { animation: 'promptIn 320ms cubic-bezier(0.16, 1, 0.3, 1) both' }
      const $promptCard = $column(
        spacing.default,
        style({
          width: '380px',
          maxWidth: 'calc(100% - 24px)',
          boxSizing: 'border-box',
          margin: '12px',
          padding: '18px',
          borderRadius: '16px',
          backgroundColor: palette.middleground,
          border: `1px solid ${palette.horizon}`,
          boxShadow: '0 16px 40px rgba(0, 0, 0, 0.5)',
          overflowWrap: 'anywhere',
          maxHeight: 'calc(100dvh - 96px)'
        })
      )
      const activityTimeframe = op(uiStorage.replayWrite<IntervalTime>('activityTimeframe', IntervalTime.WEEK, changeActivityTimeframe), state(), skipRepeats)
      const performanceMetric = op(uiStorage.replayWrite<IPerformanceMetric>('performanceMetric', 'pnl', changePerformanceMetric), state(), skipRepeats)
      const hideBalances = op(uiStorage.replayWrite('hideBalances', false, changeHideBalances), state(), skipRepeats)

      const storedChoice: IStream<string | null> = op(
        fromEventTarget(window, 'storage'),
        filter(event => event.key === WALLET_ID_KEY),
        map(event => event.newValue),
        start(localStorage.getItem(WALLET_ID_KEY)),
        state()
      )
      const confirmedChain = subject<IWalletEvent>()
      const injectedEntry = injectedEntryOf(window)
      const entries: IStream<readonly IWalletEntry[]> = op(
        merge(
          op(
            fromCallback<Event, [Event]>(cb => {
              window.addEventListener('eip6963:announceProvider', cb)
              window.dispatchEvent(new Event('eip6963:requestProvider'))
              return () => window.removeEventListener('eip6963:announceProvider', cb)
            }),
            map(announcedEntryOf),
            filterNull
          ),
          fromIterable(injectedEntry === null ? [walletConnectEntry] : [injectedEntry, walletConnectEntry])
        ),
        reduce(foldEntries, [] as readonly IWalletEntry[]),
        state()
      )
      const attempts = op(
        walletIntent,
        filter((intent): intent is { connect: string } => intent !== 'disconnect'),
        sampleMap((list: readonly IWalletEntry[], intent: { connect: string }) => {
          const entry = list.find(each => each.id === intent.connect)
          return entry === undefined
            ? { id: intent.connect, entry: null, result: Promise.reject(new Error(`${intent.connect} is no longer available; reload and pick it again`)) }
            : { id: intent.connect, entry, result: connectEntry(entry, true) }
        }, entries),
        multicast
      )
      const disconnectRequest = op(
        walletIntent,
        filter(intent => intent === 'disconnect'),
        multicast
      )
      const watched: IStream<IWalletEntry | null> = op(
        merge(
          op(
            attempts,
            map(attempt => attempt.entry),
            filterNull
          ),
          op(
            storedChoice,
            switchMap(id =>
              id === null
                ? just(null)
                : op(
                    entries,
                    map(list => list.find(each => each.id === id)),
                    filter((entry): entry is IWalletEntry => entry !== undefined),
                    take(1)
                  )
            )
          ),
          constant(null, disconnectRequest)
        ),
        skipRepeatsWith((a, b) => (a === null ? null : a.id) === (b === null ? null : b.id)),
        state()
      )
      const eventsOf = (entry: IWalletEntry): IStream<IWalletEvent> =>
        fromCallback<IWalletEvent, [IWalletEvent]>(cb => {
          const onAccounts = (payload: unknown): void => {
            const [first] = Array.isArray(payload) ? payload : []
            if (typeof first !== 'string') {
              cb({ kind: 'disconnected', entry })
              return
            }
            const address = getAddress(first)
            void connectEntry(entry, false).then(
              found => cb(found === null ? { kind: 'disconnected', entry } : { kind: 'accounts', entry, ...found }),
              () => cb({ kind: 'accounts', entry, address, chainId: null })
            )
          }
          const onChain = (payload: unknown): void => cb({ kind: 'chain', entry, chainId: Number(payload) })
          const onDisconnect = (): void => {
            void askWallet(entry, { method: 'eth_accounts' }, WALLET_ANSWER_MS).then(
              accounts => {
                if (!Array.isArray(accounts) || accounts.length === 0) cb({ kind: 'disconnected', entry })
              },
              () => undefined
            )
          }
          entry.provider.on('accountsChanged', onAccounts)
          entry.provider.on('chainChanged', onChain)
          entry.provider.on('disconnect', onDisconnect)
          return () => {
            entry.provider.removeListener('accountsChanged', onAccounts)
            entry.provider.removeListener('chainChanged', onChain)
            entry.provider.removeListener('disconnect', onDisconnect)
          }
        })
      const providerEvents: IStream<IWalletEvent> = op(
        watched,
        switchMap(entry => (entry === null || entry.id === walletConnectEntry.id ? eventsOf(walletConnectEntry) : merge(eventsOf(entry), eventsOf(walletConnectEntry))))
      )
      const revived: IStream<IWalletEvent> = op(
        watched,
        switchMap(entry =>
          entry === null
            ? empty
            : op(
                fromEventTarget(document, 'visibilitychange'),
                filter(() => document.visibilityState === 'visible'),
                switchMap(() =>
                  fromPromise(
                    connectEntry(entry, false).then(
                      (found): IWalletEvent | null => (found === null ? { kind: 'disconnected', entry } : { kind: 'accounts', entry, ...found }),
                      (): null => null
                    )
                  )
                ),
                filterNull
              )
        )
      )
      const restored: IStream<IWalletEvent> = op(
        storedChoice,
        switchMap(id =>
          id === null
            ? just<IWalletEvent>({ kind: 'disconnected', entry: null })
            : op(
                merge(
                  op(
                    entries,
                    map(list => list.find(each => each.id === id)),
                    filter((entry): entry is IWalletEntry => entry !== undefined)
                  ),
                  constant(null, wait(RESTORE_WAIT_MS))
                ),
                take(1),
                switchMap(
                  (entry): IStream<IWalletEvent> =>
                    entry === null
                      ? just<IWalletEvent>({ kind: 'disconnected', entry: null })
                      : fromPromise(
                          connectEntry(entry, false).then(
                            (found): IWalletEvent => (found === null ? { kind: 'disconnected', entry } : { kind: 'connected', entry, ...found }),
                            (): IWalletEvent => ({ kind: 'disconnected', entry })
                          )
                        )
                )
              )
        )
      )
      const wallet: IStream<IWalletState> = op(
        merge(
          restored,
          op(
            attempts,
            map((attempt): IWalletEvent | null => (attempt.entry === null ? null : { kind: 'connecting', entry: attempt.entry })),
            filterNull
          ),
          op(
            attempts,
            switchMap(attempt => {
              const entry = attempt.entry
              return entry === null
                ? empty
                : fromPromise(
                    attempt.result.then(
                      (found): IWalletEvent => (found === null ? { kind: 'disconnected', entry } : { kind: 'connected', entry, ...found }),
                      (): IWalletEvent => ({ kind: 'disconnected', entry })
                    )
                  )
            })
          ),
          providerEvents,
          revived,
          confirmedChain.stream,
          constant<IWalletEvent>({ kind: 'disconnected', entry: null }, disconnectRequest)
        ),
        reduce(foldWallet, DISCONNECTED),
        skip(1),
        skipRepeatsWith((a, b) =>
          a.status === 'disconnected'
            ? b.status === 'disconnected'
            : a.status === 'connecting'
              ? b.status === 'connecting' && a.entry === b.entry
              : b.status === 'connected' && a.entry === b.entry && a.address === b.address && a.chainId === b.chainId
        ),
        state()
      )
      bindWalletReads(wallet)
      const lastEntry: IStream<IWalletEntry> = op(
        wallet,
        map(current => (current.status === 'connected' ? current.entry : null)),
        filterNull,
        state()
      )
      const releases: IStream<{ entry: IWalletEntry; refused: Promise<{ error: unknown } | null> }> = op(
        disconnectRequest,
        sampleMap((entry: IWalletEntry) => {
          const asked: Promise<unknown> =
            entry.id === walletConnectEntry.id
              ? walletConnectProvider.disconnect()
              : entry.provider.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] })
          return { entry, refused: asked.then((): null => null, (error: unknown) => ({ error })) }
        }, lastEntry),
        state()
      )
      const walletEffects: IStream<never> = op(
        merge(
          op(
            attempts,
            switchMap(attempt => {
              const entry = attempt.entry
              return entry === null ? empty : attempt.result.then(found => (found === null ? null : entry.id), (): null => null)
            }),
            filterNull,
            tap(id => localStorage.setItem(WALLET_ID_KEY, id))
          ),
          op(
            releases,
            tap(() => localStorage.removeItem(WALLET_ID_KEY))
          )
        ),
        filter((_): _ is never => false)
      )
      const walletQuery: IStream<Promise<IConnectedWallet | null>> = op(
        wallet,
        filter(current => current.status !== 'connecting'),
        skipRepeatsWith((a, b) => (a.status === 'connected' && b.status === 'connected' ? a.entry.id === b.entry.id && a.address === b.address : a.status === b.status)),
        map(current =>
          current.status === 'connected' ? Promise.resolve().then(() => connectedWalletOf(current, wallet, event => confirmedChain.push(event))) : Promise.resolve(null)
        ),
        state()
      )
      const walletChainId: IStream<number | null> = op(
        wallet,
        map(current => (current.status === 'connected' ? current.chainId : null)),
        skipRepeats,
        state()
      )
      const walletControl: IWalletControl = {
        query: walletQuery,
        entries,
        attempts: map(attempt => ({ id: attempt.id, result: attempt.result }), attempts),
        releases,
        chainId: walletChainId
      }

      const walletAddress: IStream<string | null> = op(
        walletQuery,
        switchPromises,
        map(w => w?.address.toLowerCase() ?? null),
        state()
      )
      const agentBook: IStream<IAgentBook> = op(
        walletAddress,
        switchMap(address => {
          if (address === null) return just<IAgentBook>({ list: [], pending: null })
          const held = localStorage.getItem(agentBookSlot(address))
          const initial: IAgentBook = held === null ? { list: [], pending: null } : JSON.parse(held)
          let written = initial
          return op(
            merge(
              map(list => (book: IAgentBook): IAgentBook => ({ ...book, list }), changeAgentIdentities),
              map(pending => (book: IAgentBook): IAgentBook => ({ ...book, pending }), changeAgentPending),
              op(
                agentCommand,
                filter((next): next is Extract<IAgentCommand, { kind: 'remove' }> => next.kind === 'remove'),
                map(
                  next =>
                    (book: IAgentBook): IAgentBook => ({
                      list: book.list.filter(identity => identity.secret !== next.secret),
                      pending: book.pending !== null && book.pending.secret === next.secret ? null : book.pending
                    })
                )
              ),
              map(secret => (book: IAgentBook): IAgentBook => (book.pending !== null && book.pending.secret === secret ? { list: [...book.list, book.pending], pending: null } : book), agentProven)
            ),
            reduce((book: IAgentBook, apply: (book: IAgentBook) => IAgentBook) => apply(book), initial),
            tap(book => {
              if (book === written) return
              written = book
              localStorage.setItem(agentBookSlot(address), JSON.stringify(book))
            })
          )
        }),
        state()
      )
      const agentIdentities: IStream<readonly IAgentIdentity[]> = op(
        agentBook,
        map(book => book.list),
        skipRepeats,
        state()
      )
      const agentPending: IStream<IAgentIdentity | null> = op(
        agentBook,
        map(book => book.pending),
        skipRepeats,
        state()
      )

      const walletContext = op(
        walletQuery,
        map(walletPromise => {
          const localNow = () => walletPromise.then((wallet): Promise<IRootState> | null => (wallet === null ? null : journal(predictUserAccount(wallet.address)).localRoot(wallet.address)))
          const local = localNow()
          const seeded = walletPromise.then(async (wallet): Promise<IRootState | null> => {
            setViewCacheOwner(wallet?.address ?? null)
            if (wallet === null) return null
            return journal(predictUserAccount(wallet.address)).root(wallet.address, 'changed')
          })
          const synced: IStream<Promise<IRootState | null>> = op(
            settledTx,
            reduce(
              (last: { fresh: Promise<IRootState | null>; local: boolean }, settled: readonly ISettledTx[]) => ({
                local: true,
                fresh: last.fresh.then(root =>
                  root === null
                    ? null
                    : journal(root.account)
                        .settle(root.user, settled.filter(tx => isAddressEqual(tx.account, root.account)).map(tx => ({ chainId: tx.chainId, block: tx.block })))
                        .then(
                          (next): IRootState => ({
                            ...root,
                            deployed: next.deployed,
                            unreachable: next.unreachable,
                            balances: next.balances,
                            fund: next.fund,
                            funds: next.funds,
                            settled,
                            syncError: null
                          }),
                          (syncError: unknown): IRootState => {
                            console.error('settle fold failed; keeping last-synced state', syncError)
                            return { ...root, settled, syncError: formatThrownError(syncError) }
                          }
                        )
                )
              }),
              { fresh: seeded, local: false }
            ),
            switchMap(step => (step.local ? localFirst(localNow, () => step.fresh) : just(step.fresh))),
            answerState
          )
          return {
            wallet: walletPromise,
            local,
            seeded,
            synced,
            shown: answerState(
              merge(
                just(local),
                op(
                  fromPromise(handoff(local, seeded)),
                  switchMap(() => synced)
                )
              )
            )
          }
        }),
        state()
      )
      const shownRoot: IStream<Promise<IRootState | null>> = op(walletContext, switchMap(c => c.shown))
      const walletPair: IStream<IWalletPair> = op(
        walletContext,
        switchMap(c => op(fromPromise(c.wallet), switchMap(wallet => map((root): IWalletPair => ({ wallet, root, keys: walletKeys }), c.synced)))),
        state()
      )
      const shownPair: IStream<IWalletPair> = op(
        walletContext,
        switchMap(c => op(fromPromise(c.wallet), switchMap(wallet => map((root): IWalletPair => ({ wallet, root, keys: walletKeys }), c.shown))))
      )
      const fundKeysKept: IStream<never> = op(
        walletPair,
        filter(pair => pair.wallet !== null && walletKeys.fundsOf(pair.wallet.address).length > 0),
        take(1),
        tap(() => askPersistentStorage()),
        filter((_): _ is never => false)
      )
      initWalletLink(
        walletPair,
        (pair, root, call, inflight) => {
          let acked!: (hash: Hex) => void
          const ack = new Promise<Hex>(resolve => {
            acked = resolve
          })
          const settled = passthroughOperate(
            {
              ...clientDeps,
              compact: {
                ...clientDeps.compact,
                dispatch: (request, timeoutMs) => {
                  if (request.kind === 'operate') {
                    inflight({ chainId: request.chainId, header: request.input.header, digest: hashTypedData(intentTypedData('operate', request.chainId, request.input)) })
                  }
                  return clientDeps.compact.dispatch(request, timeoutMs).then(frame => {
                    acked(frame.txHash)
                    return frame
                  })
                }
              }
            },
            pair,
            root,
            call
          ).then(attestation => {
            dappSettled.push({ chainId: attestation.request.chainId, account: attestation.result.account, block: attestation.settledBlock, txHash: attestation.result.txHash })
            return attestation.result.txHash
          })
          return { acked: Promise.race([ack, settled]), settled }
        },
        (pair, root, chainId, txList) => planDappOperate(clientDeps, pair, root, chainId, txList),
        map(
          ({ walletRoot, agent }) => ({ walletRoot, promptHost: walletRoot && !agent }),
          combine({ walletRoot: isContaining(routeSchema.wallet), agent: isContaining(routeSchema.wallet.agent) })
        )
      )

      type IHeld = {
        own: IJournalEntries
        bodyList: IJournalEntries[]
        state: IOwnState
        fund: IRootState['fund']
        live: Promise<IFundLive> | null
        metrics: Promise<IFundMetricRow[]> | null
      }
      const recordedLive = (account: Address, metrics: Promise<IFundMetricRow[]>, open: Promise<IOpenPositions>): Promise<IFundLive> =>
        Promise.all([metrics, open]).then(([rows, positions]): IFundLive => {
          const [latest] = [...rows].sort((a, b) => b.lastUpdatedTimestamp - a.lastUpdatedTimestamp)
          return latest === undefined
            ? { worth: { note: `The chronicle has not valued the fund ${account} yet.` }, open: positions }
            : { worth: { value: latest.valuation, time: latest.lastUpdatedTimestamp }, open: positions }
        })
      const heldContext = op(
        walletContext,
        map(c => {
          const deviceReads = c.wallet.then(wallet => {
            if (wallet === null) return null
            const account = selectedFundOf(journalDeps.storage, wallet.address) ?? fundRecordsOf(journalDeps.storage, wallet.address)[0]?.account ?? null
            return account === null ? null : { account, metrics: localReader.select(fundMetricTable, { where: { master: account } }), open: openPositionsOf(localReader, account, [], null, null) }
          })
          const local = c.local.then(async (root): Promise<IHeld | null> => {
            if (root === null) return null
            if (root.fund !== null && 'unknown' in root.fund) return notLocal
            const fund = root.fund
            const reads = fund === null ? null : await deviceReads
            const kept = reads !== null && fund !== null && isAddressEqual(reads.account, fund.account) ? reads : null
            const metrics = fund === null ? null : kept === null ? localReader.select(fundMetricTable, { where: { master: fund.account } }) : kept.metrics
            const live = fund === null || metrics === null ? null : recordedLive(fund.account, metrics, kept === null ? openPositionsOf(localReader, fund.account, [], null, null) : kept.open)
            const view = await localAccountView(journal, root.account, fund === null ? null : fund.account)
            return view.own.entries.size === 0 || view.bodyList.some(body => body.entries.size === 0) ? notLocal : { ...view, fund, live, metrics }
          })
          const syncedHeldOf = (rootPromise: Promise<IRootState | null>): IStream<Promise<IHeld | null>> => {
            const stored = c.wallet.then(wallet => {
              if (wallet === null) return null
              const account = selectedFundOf(journalDeps.storage, wallet.address) ?? fundRecordsOf(journalDeps.storage, wallet.address)[0]?.account ?? null
              return account === null ? null : { account, metrics: client.select(fundMetricTable, { where: { master: account } }), open: openPositionsOf(client, account, [], null, null) }
            })
            const opened = rootPromise.then(async root => {
              if (root === null) return null
              const fund = root.fund === null || 'unknown' in root.fund ? null : root.fund
              if (fund === null) return { root, fund, metrics: null, cached: null, view: await localAccountView(journal, root.account, null) }
              const reads = await stored
              const kept = reads !== null && isAddressEqual(reads.account, fund.account) ? reads : null
              const metrics = kept === null ? client.select(fundMetricTable, { where: { master: fund.account } }) : kept.metrics
              const cached = recordedLive(fund.account, metrics, kept === null ? openPositionsOf(client, fund.account, [], null, null) : kept.open)
              return { root, fund, metrics, cached, view: await localAccountView(journal, root.account, fund.account) }
            })
            return merge(
              just(opened.then((o): IHeld | null => (o === null ? null : { ...o.view, fund: o.root.fund, live: o.cached, metrics: o.metrics }))),
              op(
                fromPromise(opened.then(o => o, () => null)),
                map((o): IStream<Promise<IHeld | null>> => {
                  if (o === null || o.fund === null) return empty
                  const account = o.fund.account
                  let view = o.view
                  let last: Promise<IFundLive> = o.cached
                  const landed = (o.root.settled ?? []).filter(tx => isAddressEqual(tx.account, account))
                  let caughtUp = landed.length === 0 ? Promise.resolve<ISyncFailure[]>([]) : foldedPast(account, landed)
                  let pending = o.root.settled === null ? null : Math.floor(Date.now() / 1000)
                  return op(
                    merge(just(null), map(() => null, periodic(OWNER_SYNC_CHECK_MS)), map(() => null, fromEventTarget(document, 'visibilitychange'))),
                    map(() => ({ now: Date.now(), session: walletKeys.sessionOf(o.root.user, HUB_CHAIN_ID) })),
                    reduce(
                      (gate: { at: number; ticks: number; fresh: boolean; session: ISessionSigner | null }, tick: { now: number; session: ISessionSigner | null }) =>
                        document.visibilityState === 'visible' && tick.session !== null && tick.now - gate.at >= OWNER_SYNC_MS
                          ? { at: tick.now, ticks: gate.ticks + 1, fresh: gate.ticks === 0, session: tick.session }
                          : { at: gate.at, ticks: gate.ticks + 1, fresh: false, session: null },
                      { at: 0, ticks: 0, fresh: false, session: null }
                    ),
                    filter((gate): gate is { at: number; ticks: number; fresh: boolean; session: ISessionSigner } => gate.session !== null),
                    map(gate => {
                      const owner = { user: o.root.user, approve: gate.session.approve }
                      const fresh = gate.fresh && landed.length === 0
                      const metrics = fresh && o.metrics !== null ? o.metrics : client.select(fundMetricTable, { where: { master: account } })
                      const waited = caughtUp
                      caughtUp = Promise.resolve<ISyncFailure[]>([])
                      return waited.then(caught => Promise.all([
                        fresh
                          ? Promise.resolve<ISyncFailure[]>([])
                          : accountView(journal, o.root.account, account, 'changed').then(
                              (latest): ISyncFailure[] => {
                                view = latest
                                return []
                              },
                              (error: unknown): ISyncFailure[] => [{ venue: 'Fund records', reason: formatThrownError(error) }]
                            ),
                        fundLiveOf(account, owner, pending).then(
                          (live): ISyncFailure[] => {
                            if (!live.open.venues.some(entry => entry.waiting)) pending = null
                            last = Promise.resolve(live)
                            return []
                          },
                          (error: unknown): ISyncFailure[] => [{ venue: ACCOUNT_VENUE, reason: formatThrownError(error) }]
                        )
                      ]).then(([records, venues]): IHeld => {
                        const failed = [...caught, ...records, ...venues]
                        return {
                          ...view,
                          fund: o.root.fund,
                          live: failed.length === 0 ? last : last.then(held => ({ ...held, open: { ...held.open, failed: [...held.open.failed, ...failed] } })),
                          metrics
                        }
                      }))
                    }),
                    switchPromises,
                    map((held): Promise<IHeld | null> => Promise.resolve(held))
                  )
                }),
                switchLatest
              )
            )
          }
          const synced = op(c.synced, map(syncedHeldOf), switchLatest, answerState)
          return {
            local,
            seeded: c.seeded,
            synced,
            shown: answerState(
              merge(
                just(local),
                op(
                  fromPromise(handoff(local, c.seeded)),
                  switchMap(() => synced)
                )
              )
            )
          }
        }),
        state()
      )
      const journalQuery: IStream<Promise<IHeld | null>> = op(heldContext, switchMap(h => h.shown))
      const ownStateQuery: IStream<Promise<IOwnState | null>> = op(
        journalQuery,
        map(async q => {
          const held = await q
          return held === null ? null : held.state
        }),
        answerState
      )
      const syncedOwnStateQuery: IStream<Promise<IOwnState | null>> = op(
        heldContext,
        switchMap(h => h.synced),
        map(async q => {
          const held = await q
          return held === null ? null : held.state
        }),
        answerState
      )
      type IPriceOf = (chainId: ChainId, token: Address) => Promise<IPriceSource>
      const ownViews = op(
        heldContext,
        switchMap(h => {
          const viewsOf = (journal: Promise<IHeld | null>, reader: IDigestClient, price: IPriceOf) => {
            const own = journal.then(held => (held === null ? null : held.state))
            return { journal, own, reader, price, list: own.then(state => (state === null ? [] : ownHoldingViews(reader, state, state.account))) }
          }
          return merge(
            just(viewsOf(h.local, localReader, localPrice)),
            op(
              fromPromise(handoff(h.local, h.seeded)),
              switchMap(() => op(h.synced, map(journal => viewsOf(journal, client, getPrice))))
            )
          )
        }),
        state()
      )
      const valueOf = (rootQuery: Promise<IRootState | null>, views: { journal: Promise<IHeld | null>; own: Promise<IOwnState | null> }, listQuery: Promise<IHoldingView[]>, reader: IDigestClient, price: IPriceOf) =>
        Promise.all([views.own, listQuery, rootQuery, views.journal]).then(async ([own, list, root, held]) => {
          if (own === null || root === null || held === null) return null
          if (root.syncError !== null) throw new Error(`your balances did not refresh after your last transaction: ${root.syncError}`)
          const fund = root.fund
          if (fund !== null && 'unknown' in fund) throw new Error(fund.unknown)
          if (fund === null || own.fundRows.some(row => isAddressEqual(row.master, fund.account) && row.totalShares === 0n)) return walletValueUsd(price, list, root.balances, [])
          if (held.live === null) throw new Error(`the live value of the fund ${fund.account} was never requested`)
          const [fundViews, live] = await Promise.all([ownHoldingViews(reader, own, fund.account), held.live])
          if ('note' in live.worth) return { note: live.worth.note }
          const worth = live.worth.value
          return walletValueUsd(
            price,
            [
              ...list,
              ...fundViews.map(view => {
                if (view.standing.kind !== 'current' || !isAddressEqual(view.master, fund.account)) return view
                const supply = view.standing.fundRow.totalShares
                return { ...view, standing: { ...view.standing, value: cashFor(view.shares, supply, worth), queuedValue: cashFor(view.standing.queued, supply, worth) } }
              })
            ],
            root.balances,
            escrowSurplus(own, held.own)
          )
        })
      const accountValueOf = (rootQuery: Promise<IRootState | null>, views: { own: Promise<IOwnState | null> }, listQuery: Promise<IHoldingView[]>, price: IPriceOf) =>
        Promise.all([views.own, listQuery, rootQuery]).then(([own, list, root]) => {
          if (own === null || root === null) return null
          if (root.syncError !== null) throw new Error(`your balances did not refresh after your last transaction: ${root.syncError}`)
          return walletValueUsd(price, list, root.balances, [])
        })
      const holdingsQuery: IStream<Promise<IHoldingView[]>> = op(
        ownViews,
        map(views => views.list),
        answerState
      )
      const walletValueQuery: IStream<Promise<number | { note: string } | null>> = op(
        combine({ root: shownRoot, views: ownViews }),
        map(p => valueOf(p.root, p.views, p.views.list, p.views.reader, p.views.price)),
        answerState
      )
      const accountValueQuery: IStream<Promise<number | null>> = op(
        combine({ root: shownRoot, views: ownViews }),
        map(p => accountValueOf(p.root, p.views, p.views.list, p.views.price)),
        answerState
      )
      const rootContextKept: IStream<never> = op(
        merge(shownPair, journalQuery, ownStateQuery, syncedOwnStateQuery, holdingsQuery, walletValueQuery, accountValueQuery),
        filter((_): _ is never => false)
      )

      type DraftEvent =
        | { type: 'upsert'; draft: IDepositDraft | IWithdrawDraft }
        | { type: 'byId'; draft: IMandateDraft | ITradeDraft | ISessionDraft | IRevokeDraft }
        | { type: 'release'; key: string }
        | { type: 'clear' }
      const KIND_ORDER: Record<IDraft['kind'], number> = { session: -1, deposit: 0, mandate: 1, allocate: 2, operate: 2, fundSwap: 2, operateSwap: 2, sell: 2, venueWithdraw: 2, venueIntent: 2, redeem: 3, escrowReturn: 4, revoke: 4, walletWithdraw: 4, withdraw: 5 }
      const rankOf = (draft: IDraft, list: readonly IDraft[]): number => {
        if (draft.kind !== 'operate' || draft.sweepInto === null) return KIND_ORDER[draft.kind]
        const feederId = `${draft.sweepInto}:deposit:swap`
        return KIND_ORDER[draft.kind] + (list.some(each => each.id === feederId) ? 0.5 : 0)
      }

      const draftList: IStream<IDraft[]> = state(
        [],
        reduce(
          (list: IDraft[], event: DraftEvent): IDraft[] => {
            if (event.type === 'clear') return []
            if (event.type === 'release') return list.filter(d => d.id !== event.key)
            if (event.type === 'byId') {
              const idx = list.findIndex(d => d.id === event.draft.id)
              const next = idx >= 0 ? [...list.slice(0, idx), event.draft, ...list.slice(idx + 1)] : [...list, event.draft]
              return [...next].sort((a, b) => rankOf(a, next) - rankOf(b, next))
            }
            const draftedAmount = event.draft.kind === 'deposit' ? event.draft.deposit.inputAmount : event.draft.output.amount
            if (draftedAmount === 0n) return list.filter(d => d.id !== event.draft.id)
            if (event.draft.kind === 'deposit' && event.draft.expectedOutput <= 0n) {
              return list.filter(d => d.id !== event.draft.id)
            }
            const filtered = list.filter(
              d => (d.kind !== 'deposit' && d.kind !== 'withdraw') || d.id === event.draft.id
            )
            const idx = filtered.findIndex(d => d.id === event.draft.id)
            const next = idx >= 0 ? [...filtered.slice(0, idx), event.draft, ...filtered.slice(idx + 1)] : [...filtered, event.draft]
            return [...next].sort((a, b) => rankOf(a, next) - rankOf(b, next))
          },
          [] as IDraft[],
          merge(
            map((draft): DraftEvent => ({ type: 'upsert', draft }), changeDraft),
            map((draft): DraftEvent => ({ type: 'byId', draft }), changeMandateDraft),
            map((draft): DraftEvent => ({ type: 'byId', draft }), changeTradeDraft),
            map((draft): DraftEvent => ({ type: 'byId', draft }), changeRevokeDraft),
            map((): DraftEvent => ({ type: 'byId', draft: { kind: 'session', id: 'session' } }), enableSession),
            map((key): DraftEvent => ({ type: 'release', key }), releaseDraft),
            map((): DraftEvent => ({ type: 'clear' }), clearDrafts),
            op(
              walletAddress,
              skipRepeats,
              skip(1),
              map((): DraftEvent => ({ type: 'clear' }))
            )
          )
        )
      )

      const draftDepositList: IStream<IDepositDraft[]> = map(list => list.filter((d): d is IDepositDraft => d.kind === 'deposit'), draftList)
      const draftWithdrawList: IStream<IWithdrawDraft[]> = map(list => list.filter((d): d is IWithdrawDraft => d.kind === 'withdraw'), draftList)
      const draftMandateList: IStream<IMandateDraft[]> = map(list => list.filter((d): d is IMandateDraft => d.kind === 'mandate'), draftList)
      const draftTradeList: IStream<ITradeDraft[]> = map(
        list =>
          list.filter(
            (d): d is ITradeDraft =>
              d.kind === 'allocate' || d.kind === 'operate' || d.kind === 'sell' || d.kind === 'redeem' || d.kind === 'fundSwap' || d.kind === 'operateSwap' || d.kind === 'venueWithdraw' || d.kind === 'venueIntent' || d.kind === 'escrowReturn' || d.kind === 'walletWithdraw'
          ),
        draftList
      )

      const sessionOpenOf = (user: Address): IStream<boolean> => {
        const ends = walletKeys.grantedChains(user).flatMap(chainId => {
          const session = walletKeys.sessionOf(user, chainId)
          return session === null ? [] : [Number(session.expiry) - DEFAULT_DEADLINE_SEC]
        })
        if (ends.length === 0) return just(false)
        return merge(
          just(true),
          op(
            wait(Math.max(0, Math.min(...ends) * 1000 - Date.now())),
            switchMap(() => sessionOpenOf(user))
          )
        )
      }
      const sessionOpen: IStream<boolean> = op(
        combine({ pair: walletPair, change: start(null, fromEventTarget(keyChanges, 'change')) }),
        switchMap(p => (p.pair.wallet === null ? just(false) : sessionOpenOf(p.pair.wallet.address))),
        skipRepeats,
        state()
      )
      const agent = { identities: agentIdentities, status: agentStatus, log: agentLog, session: sessionOpen }
      const accountContext = {
        hideBalances,
        walletPair,
        shownPair,
        journalQuery,
        ownStateQuery,
        holdingsQuery,
        accountValueQuery,
        draftDepositList,
        draftWithdrawList,
        draftMandateList,
        draftTradeList,
        activityTimeframe,
        performanceMetric,
        agent,
        walletControl
      }

      const $lazyPage = (load: () => Promise<I$Node>): I$Node =>
        $intermediatePromise({
          $loader: empty,
          $display: map(() => load(), just(null))
        })

      const drawerReserve = op(drawerSize, map(Math.ceil), skipRepeats)

      return [
        $wrapNativeElement(document.body)(
          spacing.big,
          designSheet.customScroll,
          style({
            color: palette.message,
            fill: palette.message,
            backgroundColor: palette.horizon,
            display: 'flex',
            flexDirection: 'column'
          }),
          isMobileScreen ? style({ userSelect: 'none' }) : style({}),
          styleBehavior(map(px => ({ paddingBottom: `${px}px` }), drawerReserve)),
          ...(isMobileScreen
            ? []
            : [
                effectRun(() => {
                  const dispose = enableSmoothScroll()
                  return {
                    [Symbol.dispose]() {
                      dispose()
                    }
                  }
                })
              ])
        )(
          walletEffects,
          fundKeysKept,
          rootContextKept,
          $MainMenu({ hideBalances, walletPair, shownPair, walletValue: walletValueQuery, walletControl })({ enableSession: enableSessionTether(), walletIntent: walletIntentTether() }),

          $AgentLink({ walletPair, identities: agentIdentities, pending: agentPending, command: agentCommand, session: sessionOpen })({
            status: agentStatusTether(),
            log: agentLogTether(),
            settled: settledTether(),
            proven: agentProvenTether()
          }),

          match(routeSchema)($midContainer($lazyPage(() => import('./$Home.js').then(m => fadeIn(m.$Home()({})))))),
          match(routeSchema.traders)(
            $midContainer(
              $lazyPage(() =>
                import('./$Traders.js').then(m =>
                  fadeIn(
                    m.$Traders({ walletRoot: shownRoot, ownStateQuery, draftMandateList, hideBalances, activityTimeframe, performanceMetric })({
                      changeMandateDraft: changeMandateDraftTether(),
                      changeActivityTimeframe: changeActivityTimeframeTether(),
                      changePerformanceMetric: changePerformanceMetricTether()
                    })
                  )
                )
              )
            )
          ),
          match(routeSchema.traders.detail)(
            switchLatest(
              map(
                pathname =>
                  $lazyPage(() =>
                    import('./$TraderPage.js').then(m =>
                      fadeIn(
                        m.$TraderPage({
                          master: getAddress(pathname.slice(pathname.lastIndexOf('/') + 1)),
                          hideBalances,
                          activityTimeframe,
                          performanceMetric,
                          walletRoot: shownRoot,
                          journalQuery,
                          ownStateQuery,
                          draftMandateList
                        })({
                          changeMandateDraft: changeMandateDraftTether(),
                          changeActivityTimeframe: changeActivityTimeframeTether(),
                          changePerformanceMetric: changePerformanceMetricTether()
                        })
                      )
                    )
                  ),
                op(
                  merge(just(null), locationChange),
                  map(() => document.location.pathname),
                  filter(pathname => isAddress(pathname.slice(pathname.lastIndexOf('/') + 1))),
                  skipRepeats
                )
              )
            )
          ),
          match(routeSchema.puppets.detail)(
            switchLatest(
              map(
                pathname =>
                  $midContainer(
                    $lazyPage(() =>
                      import('./$PuppetPage.js').then(m => fadeIn(m.$PuppetPage({ account: getAddress(pathname.slice(pathname.lastIndexOf('/') + 1)), hideBalances })({})))
                    )
                  ),
                op(
                  merge(just(null), locationChange),
                  map(() => document.location.pathname),
                  filter(pathname => isAddress(pathname.slice(pathname.lastIndexOf('/') + 1))),
                  skipRepeats
                )
              )
            )
          ),
          match(routeSchema.portfolio)(
            $midContainer(
              $lazyPage(() =>
                import('./$Portfolio.js').then(m =>
                  fadeIn(
                    m.$Portfolio({ role: 'puppet', ...accountContext })({
                      changeActivityTimeframe: changeActivityTimeframeTether(),
                      changePerformanceMetric: changePerformanceMetricTether(),
                      changeHideBalances: changeHideBalancesTether(),
                      walletIntent: walletIntentTether(),
                      agentCommand: agentCommandTether(),
                      enableSession: enableSessionTether(),
                      changeDraft: changeDraftTether(),
                      changeMandateDraft: changeMandateDraftTether(),
                      changeTradeDraft: changeTradeDraftTether(),
                      changeRevokeDraft: changeRevokeDraftTether(),
                      releaseDraft: releaseDraftTether()
                    })
                  )
                )
              )
            )
          ),
          match(routeSchema.wallet)(
            (isDesktopScreen ? $midContainer(style({ paddingTop: '24px', paddingBottom: '24px' })) : $midContainer)(
              $lazyPage(() =>
                import('./$Portfolio.js').then(m =>
                  fadeIn(
                    m.$Portfolio({ role: 'master', ...accountContext })({
                      settled: settledTether(),
                      changeActivityTimeframe: changeActivityTimeframeTether(),
                      changePerformanceMetric: changePerformanceMetricTether(),
                      changeHideBalances: changeHideBalancesTether(),
                      walletIntent: walletIntentTether(),
                      agentCommand: agentCommandTether(),
                      enableSession: enableSessionTether(),
                      changeDraft: changeDraftTether(),
                      changeMandateDraft: changeMandateDraftTether(),
                      changeTradeDraft: changeTradeDraftTether(),
                      changeRevokeDraft: changeRevokeDraftTether(),
                      releaseDraft: releaseDraftTether()
                    })
                  )
                )
              )
            )
          ),
          match(routeSchema.wallet.agent)(
            $midContainer(
              $row(spacing.small, style({ alignItems: 'center', fontSize: text.sm, color: palette.foreground, paddingTop: '18px' }))(
                $defaultAnchor(attr({ href: href(routeSchema.wallet) }), style({ color: palette.foreground }), softNavClick(href(routeSchema.wallet)))($text('Wallet')),
                $icon({ $content: $arrowRight, fill: palette.foreground, width: '8px' }),
                $node(style({ color: palette.message }))($text('New agent'))
              ),
              $lazyPage(() =>
                import('./$AgentPage.js').then(m =>
                  fadeIn(
                    m.$AgentPage({ walletPair, identities: agentIdentities, pending: agentPending, status: agentStatus, walletControl })({
                      changeIdentities: changeAgentIdentitiesTether(),
                      changePending: changeAgentPendingTether(),
                      command: agentCommandTether(),
                      enableSession: enableSessionTether(),
                      walletIntent: walletIntentTether()
                    })
                  )
                )
              )
            )
          ),
          match(routeSchema.quickstart)($midContainer($lazyPage(() => import('./$QuickstartPage.js').then(m => fadeIn(m.$QuickstartPage()({})))))),
          match(routeSchema.changelog)($midContainer($lazyPage(() => import('./$Changelog.js').then(m => fadeIn(m.$Changelog()({})))))),
          contains(routeSchema.governance)(
            $midContainer(
              $lazyPage(() =>
                import('./$Governance.js').then(m =>
                  fadeIn(
                    m.$Governance({
                      walletQuery,
                      selected: op(
                        merge(just(null), locationChange),
                        map(() => document.location.pathname.slice(document.location.pathname.lastIndexOf('/') + 1)),
                        map(last => (/^\d+$/.test(last) ? BigInt(last) : null)),
                        skipRepeats
                      )
                    })({})
                  )
                )
              )
            )
          ),
          contains(routeSchema)(
            $column(
              style({
                maxWidth: '860px',
                position: 'fixed',
                left: 0,
                right: 0,
                bottom: 0,
                margin: '0 auto',
                width: '100%',
                zIndex: 23
              }),
              drawerSizeTether(
                observer.resize(),
                map(entries => entries[0]?.borderBoxSize?.[0]?.blockSize ?? entries[0]?.contentRect.height ?? 0)
              )
            )(
              switchLatest(
                map(
                  p =>
                    p.failure === null || p.dismissed
                      ? empty
                      : style(
                          PROMPT_IN,
                          $node(style({ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }))(
                            $promptCard(
                              $node(style({ fontWeight: 700 }))($text('Storage refused')),
                              $node(style({ fontSize: text.sm, color: palette.foreground }))(
                                $text(`This browser refused Puppet's storage, so settings may reset when you close the page and data may load slower: ${formatThrownError(p.failure)}`)
                              ),
                              $row(style({ justifyContent: 'flex-end' }))(
                                $ButtonSecondary({ $container: $defaultMiniButtonSecondary, $content: $text('Dismiss') })({ click: dismissStorageTether() })
                              )
                            )
                          )
                        ),
                  combine({ failure: start(null, uiStorage.storageFailure), dismissed: start(false, constant(true, dismissStorage)) })
                )
              ),
              switchMap(update => {
                const $card = $promptCard
                if (update.status === PromiseStatus.ERROR) {
                  return style(
                    PROMPT_IN,
                    $node(style({ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }))(
                      $card(
                        $node(style({ fontWeight: 700 }))($text('Release check failed')),
                        $node(style({ fontSize: text.sm, color: palette.foreground }))($text(formatThrownError(update.error)))
                      )
                    )
                  )
                }
                if (update.value === null) return empty
                const { error } = update.value
                const pending = update.value.update
                if (pending === null) {
                  return error === null
                    ? empty
                    : style(
                        PROMPT_IN,
                        $node(style({ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }))(
                          $card(
                            $node(style({ fontWeight: 700 }))($text('Release check failed')),
                            $node(style({ fontSize: text.sm, color: palette.foreground }))($text(error))
                          )
                        )
                      )
                }
                const open: IStream<boolean> = state(true, merge(constant(false, clickLater), constant(true, clickReopen)))
                const fixesOpen: IStream<boolean> = state(false, reduce((was: boolean) => !was, false, clickFixes))
                const fixes = pending.sections.filter(section => section.title === 'Fixed').flatMap(section => section.changes)
                const $change = (change: string): I$Node => $node(style({ fontSize: text.sm, color: palette.foreground, lineHeight: '1.45' }))($text(change))
                return style(
                  PROMPT_IN,
                  $node(style({ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }))(
                    $card(styleBehavior(map(isOpen => (isOpen ? null : { display: 'none' }), open)))(
                      $column(spacing.tiny)(
                        $node(style({ fontSize: text.xs, fontWeight: 600, color: palette.foreground }))($text('Update ready')),
                        $node(style({ fontWeight: 700 }))($text(pending.title === null ? 'New version ready' : pending.title)),
                        $row(spacing.small, style({ alignItems: 'center', fontSize: text.xs, color: palette.foreground }))(
                          $intermediatePromise({
                            $loader: empty,
                            $$fail: failure => $node(style({ color: palette.negative }))($text(`Approval unread: ${formatThrownError(failure)}`)),
                            $display: op(
                              pending.checked ? approvalAnswers(pending.hash) : just(Promise.resolve<IReleaseCheck | null>(null)),
                              map(answer =>
                                answer.then(approval =>
                                  approval === null
                                    ? $node($text('Local build, not approved on chain'))
                                    : approval.kind === 'unapproved'
                                    ? $node($text('Not approved on chain yet'))
                                    : approval.kind === 'superseded'
                                    ? $node($text('A newer release is approved'))
                                    : $row(spacing.small, style({ alignItems: 'center' }))(
                                        $node($text(new Date(approval.time * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))),
                                        $node($text('·')),
                                        $anchor(
                                          attr({ href: getAccountExplorerUrl(TOKEN.Release.address, mainnet), target: '_blank', title: `Approved on Ethereum in ${approval.transactionHash}` }),
                                          style({ display: 'inline-flex', alignItems: 'center', gap: '4px', color: palette.foreground })
                                        )(
                                          $svg('svg')(
                                            attr({ width: '12', height: '12', viewBox: '0 0 24 24', fill: 'none', 'stroke-width': '2.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
                                            style({ stroke: palette.positive })
                                          )($svg('path')(attr({ d: 'M20 6 9 17l-5-5' }))()),
                                          $node(style({ color: palette.message }))($text('Release')),
                                          $node($text(readableAddress(TOKEN.Release.address)))
                                        )
                                      )
                                )
                              )
                            )
                          })
                        )
                      ),
                      $column(spacing.default, style({ flex: '1 1 auto', minHeight: '0', overflowY: 'auto', overscrollBehavior: 'contain' }))(
                        ...(pending.lead === null ? [] : [$node(style({ fontSize: text.sm, color: palette.message, lineHeight: '1.45' }))($text(pending.lead))]),
                        $column(spacing.small)(
                          ...pending.sections
                            .filter(section => section.title !== 'Fixed')
                            .flatMap(section => [
                              ...(section.title === null ? [] : [$node(style({ fontSize: text.sm, fontWeight: 600, color: palette.message }))($text(section.title))]),
                              ...section.changes.map($change)
                            ])
                        ),
                        ...(fixes.length === 0
                          ? []
                          : [
                              $column(spacing.tiny, style({ borderTop: `1px solid ${palette.horizon}`, paddingTop: '10px' }))(
                                $element('button')(
                                  attr({ type: 'button' }),
                                  attrBehavior(map(isOpen => ({ 'aria-expanded': String(isOpen) }), fixesOpen)),
                                  style({ alignSelf: 'flex-start', padding: '4px 0', border: 'none', background: 'transparent', color: palette.foreground, fontSize: text.sm, fontWeight: 600, cursor: 'pointer' }),
                                  clickFixesTether(nodeEvent('click'))
                                )($text(map(isOpen => `Fixed · ${fixes.length} ${isOpen ? '▴' : '▾'}`, fixesOpen))),
                                switchLatest(map(isOpen => (isOpen ? $column(spacing.tiny)(...fixes.map($change)) : empty), fixesOpen))
                              )
                            ]),
                        ...(error === null ? [] : [$node(style({ fontSize: text.sm, color: palette.negative }))($text(`Last release check failed: ${error}`))]),
                      ),
                      $row(spacing.small, style({ alignItems: 'center' }))(
                        $defaultAnchor(attr({ href: href(routeSchema.changelog) }), style({ fontSize: text.xs, color: palette.foreground, flex: 1 }))($text('Release log')),
                        $ButtonSecondary({ $container: $defaultMiniButtonSecondary, $content: $text('Later') })({ click: clickLaterTether() }),
                        $node(attrBehavior(map(running => ({ title: running ? 'Finishing your submitted transactions first; update once they settle.' : null }), runInFlight)))(
                          $ButtonPrimary({ $content: $text('Update now'), disabled: runInFlight })({ click: clickUpdateVersionTether(tap(() => location.reload())) })
                        )
                      ),
                      filter((_): _ is never => false, clickUpdateVersion)
                    ),
                    $ButtonSecondary({
                      $container: $defaultMiniButtonSecondary(style({ margin: '12px' }), styleBehavior(map(isOpen => (isOpen ? { display: 'none' } : null), open))),
                      $content: $row(spacing.small, style({ alignItems: 'center' }))(
                        $node(style({ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: palette.positive }))(),
                        $text('Update ready')
                      )
                    })({ click: clickReopenTether() })
                  )
                )
              }, op(
                merge(
                  just(null),
                  'serviceWorker' in navigator
                    ? op(
                        fromCallback<MessageEvent, [MessageEvent]>(cb => {
                          navigator.serviceWorker.addEventListener('message', cb)
                          return () => navigator.serviceWorker.removeEventListener('message', cb)
                        }),
                        filter(event => event.data === 'release')
                      )
                    : empty
                ),
                map(() => readRelease()),
                promiseState,
                filter((update): update is PromiseStateDone<IReleaseState | null> | PromiseStateError => update.status !== PromiseStatus.PENDING),
                skipRepeatsWith((a, b) => {
                  const keyOf = (update: PromiseStateDone<IReleaseState | null> | PromiseStateError): string =>
                    update.status === PromiseStatus.ERROR
                      ? `failed:${formatThrownError(update.error)}`
                      : update.value === null
                        ? 'none'
                        : `${update.value.update === null ? '' : update.value.update.hash}:${update.value.error ?? ''}`
                  return keyOf(a) === keyOf(b)
                })
              )),
              $ActionDrawer({ draftList, walletPair, ownStateQuery: syncedOwnStateQuery })({
                clearDrafts: clearDraftsTether(),
                releaseDraft: releaseDraftTether(),
                settled: settledTether(),
                inFlight: drawerInFlightTether()
              })
            )
          )
        )
      ]
    }
  )
