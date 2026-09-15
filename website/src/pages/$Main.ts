import type { ChainId, IntervalTime } from '@puppet/sdk/const'
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
import type { IDepositDraft, IMandateDraft, ITradeDraft, IUnbondDraft, IWithdrawDraft } from '../components/portfolio/draft.js'
import { passthroughOperate } from '../components/portfolio/runner/passthrough.js'
import type { IAttestation } from '../components/portfolio/runner/steps.js'
import { ownBackingViews, ownMarks, ownTradeViews } from '../io/datastore/own.js'
import { fetchOwnedAccount } from '../io/datastore/reads.js'
import { accountHistory, type IAccountAction } from '../io/journal/history.js'
import { journal } from '../io/journal/journal.js'
import type { IOwnState } from '../io/journal/localFold.js'
import { matchmakerUrl } from '../io/matchmaker/index.js'
import { setViewCacheOwner } from '../io/onchain/viewRead.js'
import { walletValueUsd } from '../io/walletValue.js'
import { enableSmoothScroll } from '../utils/smoothScroll.js'
import { subject } from '../utils/subject.js'
import { fundedFromChronicle } from '../wallet/fundedCoordinate.js'
import {
  applyAttest,
  balanceId,
  createBodyKeys, 
  type IFold,
  type IPendingCredit,
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

const bodyKeys = createBodyKeys(matchmakerUrl, fundedFromChronicle)

export const $Main = (_config: IApp = {}) =>
  component(
    (
      [clickUpdateVersion, clickUpdateVersionTether]: IBehavior<any, bigint>,
      [changeActivityTimeframe, changeActivityTimeframeTether]: IBehavior<IntervalTime>,
      [changeHideBalances, changeHideBalancesTether]: IBehavior<boolean>,
      [changeDraft, changeDraftTether]: IBehavior<IDepositDraft | IWithdrawDraft>,
      [changeMandateDraft, changeMandateDraftTether]: IBehavior<IMandateDraft>,
      [changeUnbondDraft, changeUnbondDraftTether]: IBehavior<IUnbondDraft>,
      [changeTradeDraft, changeTradeDraftTether]: IBehavior<ITradeDraft>,
      [clearDrafts, clearDraftsTether]: IBehavior<null>,
      [releaseDraft, releaseDraftTether]: IBehavior<string>,
      [changeAttest, attestTether]: IBehavior<IAttestation>,
      [deriveAccount, deriveAccountTether]: IBehavior<Address>,
      [drawerSize, drawerSizeTether]: IBehavior<any, number>
    ) => {
      const dappAttest = subject<IAttestation>()
      const attested: IStream<IAttestation> = merge(changeAttest, dappAttest.stream)
      const activityTimeframe = uiStorage.replayWrite(localStoreSchema.global.activityTimeframe, changeActivityTimeframe)
      const hideBalances = state(false, uiStorage.replayWrite(localStoreSchema.global.hideBalances, changeHideBalances))

      const walletAddress: IStream<string | null> = op(
        walletQuery,
        switchPromises,
        map(w => w?.address.toLowerCase() ?? null)
      )

      const accountQuery: IStream<Promise<Address | null>> = op(
        combine({ wallet: walletQuery, derived: start(null, deriveAccount), settled: start(null, attested) }),
        map(async p => {
          const wallet = await p.wallet
          if (wallet === null) return null
          return bodyKeys.accountOf(wallet.address) ?? (await fetchOwnedAccount(wallet.address))
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
            return journal(account).root(wallet.address)
          })
          return op(
            fromPromise(seeded),
            switchMap(root => {
              if (root === null) return just(root)
              const attests = op(attested, map((settled): IFold => ({ attest: settled })))
              const settles = op(
                attested,
                map(
                  (): Promise<IFold> =>
                    journal(root.account)
                      .settle()
                      .then(
                        (journal): IFold => ({ journal }),
                        (err: unknown): IFold => {
                          console.error('settle fold failed; keeping last-synced state', err)
                          return { syncFailed: true }
                        }
                      )
                ),
                awaitPromises
              )
              return reduce(
                (acc: IRootState | null, fold: IFold): IRootState | null => {
                  if (acc === null) return null
                  if ('syncFailed' in fold) return { ...acc }
                  if ('journal' in fold) {
                    const { balances, deployed, unreachable, chronicle, heads } = fold.journal
                    const stillPending: IPendingCredit[] = []
                    const deltaByCoordinate = new Map<string, { chainId: ChainId; token: Address; delta: bigint }>()
                    for (const p of acc.pending) {
                      if (p.block > (heads.get(p.chainId) ?? 0n)) {
                        stillPending.push(p)
                        const key = balanceId(p)
                        const d = deltaByCoordinate.get(key)
                        deltaByCoordinate.set(key, { chainId: p.chainId, token: p.token, delta: (d?.delta ?? 0n) + p.delta })
                      }
                    }
                    const merged = [...balances]
                    for (const { chainId, token, delta } of deltaByCoordinate.values()) {
                      const i = merged.findIndex(b => b.chainId === chainId && isAddressEqual(b.token, token))
                      const row = i < 0 ? undefined : merged[i]!
                      const balance = (row?.balance ?? 0n) + delta
                      if (balance <= 0n) {
                        if (i >= 0) merged.splice(i, 1)
                      } else if (row === undefined) merged.push({ chainId, token, balance })
                      else merged[i] = { ...row, balance }
                    }
                    return { ...acc, deployed, unreachable, chronicle, balances: merged, pending: stillPending }
                  }
                  return applyAttest(acc, fold.attest)
                },
                root,
                merge(attests, settles)
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
        map(async (p): Promise<IWalletPair> => ({ wallet: await p.wallet, root: p.root, bodyKeys })),
        switchPromises,
        state()
      )
      const walletRootResolved: IStream<IRootState | null> = op(
        rootQuery(walletPair),
        map(s => (s.status === PromiseStatus.DONE ? s.value : null)),
        skipRepeats,
        state()
      )
      initWalletLink(walletPair, async (wallet, root, bodyKeys, chainId, tx) => {
        const attestation = await passthroughOperate(wallet, root, bodyKeys, chainId, tx)
        dappAttest.push(attestation)
        return attestation.result.txHash
      })

      const settledRoot: IStream<IRootState | null> = op(
        walletRootResolved,
        skipRepeatsWith((a, b) => a?.account === b?.account && a?.settled?.txHash === b?.settled?.txHash && a?.settled?.nonce === b?.settled?.nonce),
        state()
      )
      const syncedAccountQuery: IStream<Promise<Address | null>> = op(
        combine({ account: selectedAccount, settled: settledRoot }),
        map(async p => {
          if (p.account === null) return null
          const account = getAddress(p.account)
          await journal(account).sync()
          return account
        }),
        state()
      )
      const ownStateQuery: IStream<Promise<IOwnState | null>> = op(
        syncedAccountQuery,
        map(async q => {
          const account = await q
          return account === null ? null : journal(account).own()
        }),
        state()
      )
      const walletValueQuery: IStream<Promise<number | null>> = op(
        ownStateQuery,
        map(async q => {
          const own = await q
          if (own === null) return null
          const [views, backings] = await Promise.all([ownTradeViews(own), ownBackingViews(own)])
          return walletValueUsd(views, backings, own.deposits, own.bonds)
        }),
        state()
      )
      const historyQuery: IStream<Promise<IAccountAction[]>> = op(
        combine({ account: syncedAccountQuery, own: ownStateQuery }),
        map(async p => {
          const [account, own] = await Promise.all([p.account, p.own])
          if (account === null || own === null) return []
          return accountHistory([{ account, entries: await journal(account).entries() }], ids => ownMarks(own, ids))
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
        | { type: 'byId'; draft: IMandateDraft | IUnbondDraft | ITradeDraft }
        | { type: 'release'; key: string }
        | { type: 'clear' }
      const KIND_ORDER: Record<IDraft['kind'], number> = { deposit: 0, credit: 0, mandate: 1, unbond: 1, operate: 2, settle: 2, withdraw: 3 }

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
            map((draft): DraftEvent => ({ type: 'byId', draft }), changeUnbondDraft),
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
      const draftUnbondList: IStream<IUnbondDraft[]> = map(list => list.filter((d): d is IUnbondDraft => d.kind === 'unbond'), draftList)
      const draftTradeList: IStream<ITradeDraft[]> = map(
        list => list.filter((d): d is ITradeDraft => d.kind === 'credit' || d.kind === 'operate' || d.kind === 'settle'),
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
                $Quickstart({ hideBalances, walletPair, walletRoot: walletRootResolved, ownStateQuery, draftDepositList })({
                  changeDraft: changeDraftTether(),
                  deriveAccount: deriveAccountTether()
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
                  mandatesQuery,
                  draftDepositList,
                  draftWithdrawList,
                  draftMandateList,
                  draftUnbondList,
                  draftTradeList,
                  activityTimeframe
                })({
                  changeHideBalances: changeHideBalancesTether(),
                  changeDraft: changeDraftTether(),
                  changeMandateDraft: changeMandateDraftTether(),
                  changeUnbondDraft: changeUnbondDraftTether(),
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
              $ActionDrawer({ draftList, walletPair, walletRoot: walletRootResolved })({
                clearDrafts: clearDraftsTether(),
                deriveAccount: deriveAccountTether(),
                releaseDraft: releaseDraftTether(),
                attest: attestTether()
              })
            )
          )
        )
      ]
    }
  )
