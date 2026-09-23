import { predictUserAccount } from '@puppet/sdk/account'
import type { IntervalTime } from '@puppet/sdk/const'
import type { IMandateRow } from '@puppet/sdk/schema'
import { awaitPromises, combine, filter, fromPromise, type IStream, just, map, merge, op, reduce, skip, skipRepeats, skipRepeatsWith, start, switchLatest, switchMap, switchPromises, tap } from 'aelea/stream'
import { type IBehavior, PromiseStatus, state } from 'aelea/stream-extended'
import { $node, $text, $wrapNativeElement, component, effectRun, style, styleBehavior } from 'aelea/ui'
import { $column, designSheet, isMobileScreen, observer, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { contains, locationChange, match } from 'aelea/ui-router'
import { type Address, getAddress, isAddress, isAddressEqual } from 'viem'
import { $alertPositiveContainer, $ButtonSecondary, $defaultMiniButtonSecondary, fadeIn } from '@/ui-components'
import { uiStorage } from '@/ui-storage'
import { localStoreSchema } from '../app/localStoreSchema.js'
import { routeSchema } from '../app/routeSchema.js'
import { pwaUpgradeNotification } from '../app/sw/swUtils.js'
import { $midContainer } from '../common/$common.js'
import { $ActionDrawer, type IDraft } from '../components/$ActionDrawer.js'
import { $MainMenu } from '../components/$MainMenu.js'
import { $PairBanner } from '../components/$PairBanner.js'
import type { IDepositDraft, IMandateDraft, ITradeDraft, IWithdrawDraft } from '../components/portfolio/draft.js'
import { passthroughOperate, prepareDappTransaction } from '../components/portfolio/runner/passthrough.js'
import { escrowSurplus, type IHoldingView, ownHoldingViews } from '../io/datastore/own.js'
import { accountHistory, type IAccountAction } from '../io/journal/history.js'
import { journal } from '../io/journal/journal.js'
import { foldOwnAccount, type IJournalEntries, type IOwnState } from '../io/journal/localFold.js'
import { matchmakerUrl } from '../io/matchmaker/index.js'
import { setViewCacheOwner } from '../io/onchain/viewRead.js'
import { walletValueUsd } from '../io/walletValue.js'
import { enableSmoothScroll } from '../utils/smoothScroll.js'
import { subject } from '../utils/subject.js'
import { fundedFromStake } from '../wallet/fundedCoordinate.js'
import type { ISettledTx } from '../wallet/index.js'
import {
  createWalletKeys,
  type IFold,
  type IRootState,
  type IWalletPair,
  rootQuery,
  walletQuery
} from '../wallet/index.js'
import { initWalletLink } from '../wallet/walletLink.js'
import { $Home } from './$Home.js'
import { $Portfolio } from './$Portfolio.js'
import { $Quickstart } from './$Quickstart.js'
import { $TraderPage } from './$TraderPage.js'
import { $Traders } from './$Traders.js'

interface IApp {}

const walletKeys = createWalletKeys(matchmakerUrl, fundedFromStake)

export const $Main = (_config: IApp = {}) =>
  component(
    (
      [clickUpdateVersion, clickUpdateVersionTether]: IBehavior<any, bigint>,
      [changeActivityTimeframe, changeActivityTimeframeTether]: IBehavior<IntervalTime>,
      [changeHideBalances, changeHideBalancesTether]: IBehavior<boolean>,
      [changeDraft, changeDraftTether]: IBehavior<IDepositDraft | IWithdrawDraft>,
      [changeMandateDraft, changeMandateDraftTether]: IBehavior<IMandateDraft>,
      [changeTradeDraft, changeTradeDraftTether]: IBehavior<ITradeDraft>,
      [clearDrafts, clearDraftsTether]: IBehavior<null>,
      [releaseDraft, releaseDraftTether]: IBehavior<string>,
      [changeSettled, settledTether]: IBehavior<ISettledTx>,
      [drawerSize, drawerSizeTether]: IBehavior<any, number>
    ) => {
      const dappSettled = subject<ISettledTx>()
      const settledTx: IStream<ISettledTx> = merge(changeSettled, dappSettled.stream)
      const activityTimeframe = uiStorage.replayWrite(localStoreSchema.global.activityTimeframe, changeActivityTimeframe)
      const hideBalances = state(false, uiStorage.replayWrite(localStoreSchema.global.hideBalances, changeHideBalances))

      const walletAddress: IStream<string | null> = op(
        walletQuery,
        switchPromises,
        map(w => w?.address.toLowerCase() ?? null)
      )

      const accountQuery: IStream<Promise<Address | null>> = op(
        combine({ wallet: walletQuery, settled: start(null, settledTx) }),
        map(async p => {
          const wallet = await p.wallet
          return wallet === null ? null : predictUserAccount(wallet.address)
        }),
        state()
      )

      const selectedAccount: IStream<Address | null> = op(
        accountQuery,
        switchPromises,
        skipRepeatsWith((a, b) => (a === null ? b === null : b !== null && isAddressEqual(a, b))),
        state()
      )

      const walletState: IStream<Promise<IRootState | null>> = op(
        combine({ wallet: walletQuery, account: selectedAccount }),
        switchMap(p => {
          const account = p.account
          const seeded = p.wallet.then(async (wallet): Promise<IRootState | null> => {
            setViewCacheOwner(wallet?.address ?? null)
            if (wallet === null || account === null) return null
            return journal(account, wallet.address).root(wallet.address)
          })
          return op(
            fromPromise(seeded),
            switchMap(root => {
              if (root === null) return just(root)
              const settles = op(
                settledTx,
                map(
                  (settled): Promise<IFold> =>
                    journal(root.account, root.user)
                      .settle({ chainId: settled.chainId, block: settled.block })
                      .then(
                        (journal): IFold => ({ settled, journal }),
                        (syncError: unknown): IFold => {
                          console.error('settle fold failed; keeping last-synced state', syncError)
                          return { settled, syncError }
                        }
                      )
                ),
                awaitPromises
              )
              return reduce(
                (acc: IRootState | null, fold: IFold): IRootState | null => {
                  if (acc === null) return null
                  if ('syncError' in fold) return { ...acc, settled: fold.settled }
                  const { balances, deployed, unreachable, chronicle, fund } = fold.journal
                  return { ...acc, deployed, unreachable, chronicle, balances, fund, settled: fold.settled }
                },
                root,
                settles
              )
            }),
            map(root => Promise.resolve(root)),
            start(seeded)
          )
        }),
        state()
      )
      const walletPair: IStream<IWalletPair> = op(
        combine({ wallet: walletQuery, root: walletState }),
        map(async (p): Promise<IWalletPair> => ({ wallet: await p.wallet, root: p.root, keys: walletKeys })),
        switchPromises,
        state()
      )
      const walletRootResolved: IStream<IRootState | null> = op(
        rootQuery(walletPair),
        map(s => (s.status === PromiseStatus.DONE ? s.value : null)),
        skipRepeats,
        state()
      )
      initWalletLink(
        walletPair,
        async (pair, root, chainId, tx) => {
          const attestation = await passthroughOperate(pair, root, chainId, tx)
          dappSettled.push({ chainId: attestation.request.chainId, block: attestation.settledBlock, txHash: attestation.result.txHash })
          return attestation.result.txHash
        },
        prepareDappTransaction
      )

      const settledRoot: IStream<IRootState | null> = op(
        walletRootResolved,
        skipRepeatsWith((a, b) => a?.account === b?.account && a?.settled?.txHash === b?.settled?.txHash),
        state()
      )
      const journalQuery: IStream<Promise<{ own: IJournalEntries; bodyList: IJournalEntries[] } | null>> = op(
        combine({ account: selectedAccount, settled: settledRoot, wallet: walletQuery }),
        map(async p => {
          const wallet = await p.wallet
          if (p.account === null || wallet === null) return null
          const account = getAddress(p.account)
          await journal(account, wallet.address).sync()
          const fund = p.settled === null ? null : p.settled.fund
          if (fund !== null) await journal(fund.account, wallet.address).sync()
          return {
            own: { account, entries: await journal(account, wallet.address).entries() },
            bodyList: fund === null ? [] : [{ account: fund.account, entries: await journal(fund.account, wallet.address).entries() }]
          }
        }),
        state()
      )
      const ownStateQuery: IStream<Promise<IOwnState | null>> = op(
        journalQuery,
        map(async q => {
          const held = await q
          return held === null ? null : foldOwnAccount(held.own, held.bodyList)
        }),
        state()
      )
      const ownValueQuery: IStream<{ holdings: Promise<IHoldingView[]>; value: Promise<number | null> }> = op(
        combine({ own: ownStateQuery, pair: walletPair }),
        map(q => {
          const holdings = q.own.then(own => (own === null ? [] : ownHoldingViews(own, own.account)))
          const value = Promise.all([q.own, holdings, q.pair.root]).then(async ([own, list, root]) => {
            if (own === null || root === null) return null
            const fund = root.fund
            return fund === null
              ? walletValueUsd(list, root.balances, [])
              : walletValueUsd([...list, ...(await ownHoldingViews(own, fund.account))], root.balances, escrowSurplus(own, fund.account))
          })
          return { holdings, value }
        }),
        state()
      )
      const holdingsQuery: IStream<Promise<IHoldingView[]>> = map(p => p.holdings, ownValueQuery)
      const walletValueQuery: IStream<Promise<number | null>> = map(p => p.value, ownValueQuery)
      const historyQuery: IStream<Promise<IAccountAction[]>> = op(
        journalQuery,
        map(async q => {
          const held = await q
          return held === null ? [] : accountHistory([held.own, ...held.bodyList])
        }),
        state()
      )
      const mandatesQuery: IStream<Promise<IMandateRow[]>> = op(
        ownStateQuery,
        map(async q => (await q)?.mandates ?? []),
        state()
      )

      type DraftEvent =
        | { type: 'upsert'; draft: IDepositDraft | IWithdrawDraft }
        | { type: 'byId'; draft: IMandateDraft | ITradeDraft }
        | { type: 'release'; key: string }
        | { type: 'clear' }
      const KIND_ORDER: Record<IDraft['kind'], number> = { deposit: 0, mandate: 1, allocate: 2, operate: 2, fundSwap: 2, sell: 2, redeem: 3, withdraw: 4 }

      const draftList: IStream<IDraft[]> = state(
        [],
        reduce(
          (list: IDraft[], event: DraftEvent): IDraft[] => {
            if (event.type === 'clear') return []
            if (event.type === 'release') return list.filter(d => d.id !== event.key)
            if (event.type === 'byId') {
              const idx = list.findIndex(d => d.id === event.draft.id)
              const next = idx >= 0 ? [...list.slice(0, idx), event.draft, ...list.slice(idx + 1)] : [...list, event.draft]
              return [...next].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
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
            return [...next].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
          },
          [] as IDraft[],
          merge(
            map((draft): DraftEvent => ({ type: 'upsert', draft }), changeDraft),
            map((draft): DraftEvent => ({ type: 'byId', draft }), changeMandateDraft),
            map((draft): DraftEvent => ({ type: 'byId', draft }), changeTradeDraft),
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
              d.kind === 'allocate' || d.kind === 'operate' || d.kind === 'sell' || d.kind === 'redeem' || d.kind === 'fundSwap'
          ),
        draftList
      )

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
          switchMap(cb => {
            return fadeIn(
              $alertPositiveContainer(
                style({
                  backgroundColor: palette.horizon,
                  margin: '12px',
                  placeSelf: 'center',
                  border: `1px solid ${palette.foreground}`,
                  borderRadius: '14px',
                  gap: '10px',
                  alignItems: 'center',
                  padding: '12px 16px',
                  maxWidth: '460px'
                })
              )(
                $column(spacing.tiny)(
                  $node(style({ fontWeight: 700 }))($text('New version available')),
                  $node(style({ color: palette.foreground }))($text('Reload to switch to the new version.')),
                  filter((_): _ is never => false, clickUpdateVersion)
                ),
                $ButtonSecondary({
                  $container: $defaultMiniButtonSecondary,
                  $content: $text('Reload')
                })({
                  click: clickUpdateVersionTether(tap(cb))
                })
              )
            )
          }, pwaUpgradeNotification),

          $MainMenu({ walletPair, walletValue: walletValueQuery })({}),

          $PairBanner({ walletPair })({}),

          match(routeSchema)($midContainer(fadeIn($Home()({})))),
          match(routeSchema.traders)(
            $midContainer(
              fadeIn(
                $Traders({ walletRoot: walletRootResolved, mandatesQuery, draftMandateList })({
                  changeMandateDraft: changeMandateDraftTether(),
                  changeActivityTimeframe: changeActivityTimeframeTether()
                })
              )
            )
          ),
          contains(routeSchema.traders.detail)(
            switchLatest(
              map(
                pathname =>
                  fadeIn(
                    $TraderPage({
                      master: getAddress(pathname.slice(pathname.lastIndexOf('/') + 1)),
                      hideBalances,
                      activityTimeframe,
                      walletRoot: walletRootResolved,
                      mandatesQuery,
                      draftMandateList
                    })({
                      changeMandateDraft: changeMandateDraftTether(),
                      changeActivityTimeframe: changeActivityTimeframeTether()
                    })
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
          match(routeSchema.quickstart)(
            $midContainer(
              fadeIn(
                $Quickstart({ hideBalances, walletPair, ownStateQuery, draftDepositList })({
                  changeDraft: changeDraftTether(),
                  changeTradeDraft: changeTradeDraftTether()
                })
              )
            )
          ),
          match(routeSchema.portfolio)(
            $midContainer(
              fadeIn(
                $Portfolio({
                  hideBalances,
                  walletPair,
                  walletRoot: walletRootResolved,
                  historyQuery,
                  ownStateQuery,
                  holdingsQuery,
                  walletValueQuery,
                  mandatesQuery,
                  draftDepositList,
                  draftWithdrawList,
                  draftMandateList,
                  draftTradeList,
                  activityTimeframe
                })({
                  changeHideBalances: changeHideBalancesTether(),
                  changeDraft: changeDraftTether(),
                  changeMandateDraft: changeMandateDraftTether(),
                  changeTradeDraft: changeTradeDraftTether()
                })
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
                zIndex: 10
              }),
              drawerSizeTether(
                observer.resize(),
                map(entries => entries[0]?.borderBoxSize?.[0]?.blockSize ?? entries[0]?.contentRect.height ?? 0)
              )
            )(
              $ActionDrawer({ draftList, walletPair, walletRoot: walletRootResolved, ownStateQuery })({
                clearDrafts: clearDraftsTether(),
                releaseDraft: releaseDraftTether(),
                settled: settledTether()
              })
            )
          )
        )
      ]
    }
  )
