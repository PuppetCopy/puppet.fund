import { predictMasterAccount, predictPuppetAccount } from '@puppet/sdk/account'
import type { IntervalTime } from '@puppet/sdk/const'
import { ignoreAll } from '@puppet/sdk/core'
import { getUserSubaccountList, type IAccountStateRow, type ISubaccountState } from '@puppet/sdk/state'
import {
  combine,
  empty,
  type IStream,
  map,
  merge,
  op,
  reduce,
  sampleMap,
  skip,
  skipRepeats,
  switchLatest,
  switchMap,
  switchPromises,
  tap
} from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $node, $text, $wrapNativeElement, component, style } from 'aelea/ui'
import { $column, $row, designSheet, isMobileScreen, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { contains, match } from 'aelea/ui-router'
import { getAddress } from 'viem'
import type { Address } from 'viem/accounts'
import { $alertPositiveContainer, $ButtonSecondary, $defaultMiniButtonSecondary, fadeIn } from '@/ui-components'
import { uiStorage } from '@/ui-storage'
import { localStoreSchema } from '../app/localStoreSchema.js'
import { routeSchema } from '../app/routeSchema.js'
import { pwaUpgradeNotification } from '../app/sw/swUtils.js'
import { $midContainer } from '../common/$common.js'
import { $ActionDrawer, type IDraft } from '../components/$ActionDrawer.js'
import { $MainMenu } from '../components/$MainMenu.js'
import { $PairBanner } from '../components/$PairBanner.js'
import { $ServicesConnectivity } from '../components/$ServicesConnectivity.js'
import type { ISubscribeRule } from '../components/portfolio/$MatchingRuleEditor.js'
import type {
  IAllocateDraft,
  IClaimDraft,
  ICreateMasterDraft,
  IDepositDraft,
  IFulfillDraft,
  ISellDraft,
  ISubscribeDraft,
  IWithdrawDraft
} from '../components/portfolio/draft.js'
import { computeSignedDelta, type IAttestation } from '../components/portfolio/runner/steps.js'
import { fetchUserSubscriptions } from '../io/indexer/query.js'
import { sqlClient } from '../io/indexer/sql.js'
import { compact } from '../io/matchmaker/index.js'
import { subject } from '../utils/subject.js'
import { type IConnectedWallet, setActiveSubaccount, walletQuery } from '../wallet/index.js'
import { $HelloPage } from './$HelloPage.js'
import { $Home } from './$Home.js'
import { $Leaderboard } from './$Leaderboard.js'
import { $MasterPage } from './$MasterPage.js'
import { $Portfolio } from './$Portfolio.js'

interface IApp {}

const MASTER_ROUTED: ReadonlySet<string> = new Set(['operate', 'allocate', 'fulfill'])

function accountForRequest(req: IAttestation['request']): Address {
  const params = req.input.params
  return MASTER_ROUTED.has(req.kind) ? predictMasterAccount(params) : predictPuppetAccount(params)
}

// Fold an attest into the subaccount list using the intent + actualRelayFee.
// createPuppet/createMaster insert a new standalone leaf from their own params;
// other kinds adjust signedBalance on the dispatched account.
function applySubaccountAttest(list: ISubaccountState[], settled: IAttestation): ISubaccountState[] {
  const { request, result } = settled
  const chainId = (request.intent as { chainId: bigint }).chainId
  const cid = Number(chainId)
  const fee = result.actualRelayFee

  if (request.kind === 'createPuppetAccount') {
    const params = request.input.params
    const account = predictPuppetAccount(params)
    if (list.some(s => s.account === account)) return list
    const initialDeposit = (request.input as { initialDepositAmount: bigint }).initialDepositAmount
    const leaf: IAccountStateRow = {
      id: `${chainId}-${account}`,
      account,
      chainId,
      user: getAddress(params.user),
      signer: getAddress(params.signer),
      name: params.name,
      baseTokenId: params.baseTokenId,
      signedBalance: initialDeposit - fee,
      recordedBalance: initialDeposit - fee,
      positionBalance: 0n,
      isMaster: false,
      lastNonce: (request.intent as { nonce: bigint }).nonce,
      lastEventBlock: 0n,
      lastEventAt: 0,
      lastTransactionHash: result.txHash
    }
    return [...list, { ...leaf, chains: new Map([[cid, leaf]]) }]
  }

  if (request.kind === 'createMaster') {
    const params = request.input.params
    const account = predictMasterAccount(params)
    if (list.some(s => s.account === account)) return list
    const masterAmount = (request.input as { masterAmount: bigint }).masterAmount
    const leaf: IAccountStateRow = {
      id: `${chainId}-${account}`,
      account,
      chainId,
      user: getAddress(params.user),
      signer: getAddress(params.signer),
      name: params.name,
      baseTokenId: params.baseTokenId,
      signedBalance: masterAmount - fee,
      recordedBalance: masterAmount - fee,
      positionBalance: 0n,
      isMaster: true,
      lastNonce: (request.intent as { nonce: bigint }).nonce,
      lastEventBlock: 0n,
      lastEventAt: 0,
      lastTransactionHash: result.txHash
    }
    return [...list, { ...leaf, chains: new Map([[cid, leaf]]) }]
  }

  // Adjust signedBalance on the dispatched account.
  const target = accountForRequest(request)
  const delta = computeSignedDelta(request, fee)
  return list.map(sub => {
    if (sub.account !== target) return sub
    const existing = sub.chains.get(cid)
    if (!existing) return sub
    const next: IAccountStateRow = {
      ...existing,
      signedBalance: existing.signedBalance + delta,
      lastNonce: (request.intent as { nonce: bigint }).nonce,
      lastTransactionHash: result.txHash
    }
    const newChains = new Map(sub.chains)
    newChains.set(cid, next)
    return {
      ...sub,
      chains: newChains,
      signedBalance: next.signedBalance,
      lastNonce: next.lastNonce,
      lastTransactionHash: next.lastTransactionHash
    }
  })
}

export const $Main = (_config: IApp = {}) =>
  component(
    (
      [clickUpdateVersion, clickUpdateVersionTether]: IBehavior<any, bigint>,

      [changeActivityTimeframe, changeActivityTimeframeTether]: IBehavior<IntervalTime>,
      [selectCollateralTokenList, selectCollateralTokenListTether]: IBehavior<Address[]>,
      [selectIndexTokenList, selectIndexTokenListTether]: IBehavior<Address[]>,

      [changeMatchRuleList, changeMatchRuleListTether]: IBehavior<ISubscribeRule[]>,
      [changeDraft, changeDraftTether]: IBehavior<IDepositDraft | IWithdrawDraft>,
      [changeCreateMasterDraft, changeCreateMasterDraftTether]: IBehavior<ICreateMasterDraft>,
      [changeAllocateDraft, changeAllocateDraftTether]: IBehavior<IAllocateDraft>,
      [changeRedeemDraft, changeRedeemDraftTether]: IBehavior<ISellDraft | IClaimDraft>,
      [changeFulfillDraft, changeFulfillDraftTether]: IBehavior<IFulfillDraft>,
      [clearDrafts, clearDraftsTether]: IBehavior<null>,
      [releaseDraft, releaseDraftTether]: IBehavior<string>,
      [changeAttest, changeAttestTether]: IBehavior<IAttestation>,
      [changeActiveSubaccount, changeActiveSubaccountTether]: IBehavior<Address>
    ) => {
      const activityTimeframe = uiStorage.replayWrite(
        localStoreSchema.global.activityTimeframe,
        changeActivityTimeframe
      )
      const collateralTokenList = uiStorage.replayWrite(
        localStoreSchema.global.collateralTokenList,
        selectCollateralTokenList
      )
      const indexTokenList = uiStorage.replayWrite(localStoreSchema.global.indexTokenList, selectIndexTokenList)

      const userSubaccountListQuery: IStream<Promise<ISubaccountState[]>> = op(
        walletQuery,
        map(async query => {
          const wallet: IConnectedWallet | null = await query
          if (!wallet) return [] as ISubaccountState[]
          const res = await getUserSubaccountList(sqlClient, wallet.address)
          return res
        }),
        state()
      )

      const subaccountList: IStream<Promise<ISubaccountState[]>> = op(
        walletQuery,
        switchMap(async walletPromise => {
          const wallet = await walletPromise
          if (!wallet) return empty
          const initial = await getUserSubaccountList(sqlClient, wallet.address)
          const reduced: IStream<ISubaccountState[]> = state(
            initial,
            reduce(applySubaccountAttest, initial, changeAttest)
          )
          return map(list => Promise.resolve(list), reduced)
        }),
        switchLatest,
        state(),
        src => merge(src, userSubaccountListQuery)
      )

      const walletAddress: IStream<string | null> = op(
        walletQuery,
        switchPromises,
        map(w => w?.address.toLowerCase() ?? null)
      )

      let activeMasterByWallet: Record<string, Address | null> = {}

      const autoDefaultActive = subject<Address>()

      const activeMasterMap: IStream<Record<string, Address | null>> = op(
        uiStorage.replayWrite(
          localStoreSchema.global.activeMasterByWallet,
          sampleMap(
            (wallet, addr) =>
              wallet ? (activeMasterByWallet = { ...activeMasterByWallet, [wallet]: addr }) : activeMasterByWallet,
            walletAddress,
            merge(autoDefaultActive.stream, changeActiveSubaccount)
          )
        ),
        tap(m => {
          activeMasterByWallet = m
        }),
        state()
      )

      const subaccountAddressList: IStream<Address[]> = op(
        subaccountList,
        switchPromises,
        map(list => list.map(a => a.account))
      )

      const activeMaster: IStream<Address | null> = op(
        combine({ map: activeMasterMap, wallet: walletAddress, accounts: subaccountAddressList }),
        map(p => {
          if (!p.wallet) return null
          if (p.accounts.length === 0) return null
          const persisted = p.map[p.wallet]
          if (persisted && p.accounts.includes(persisted)) return persisted
          const pick = p.accounts[0]
          autoDefaultActive.push(pick)
          return pick
        }),
        skipRepeats,
        state()
      )

      const selectedSubaccount: IStream<ISubaccountState | null> = op(
        combine({ active: activeMaster, list: switchPromises(subaccountList) }),
        map(p =>
          p.active ? (p.list.find(a => getAddress(a.account) === getAddress(p.active as Address)) ?? null) : null
        ),
        state()
      )

      const $extensionSync = op(
        combine({ addr: activeMaster, wallet: switchPromises(walletQuery) }),
        map(p => {
          setActiveSubaccount(p.addr, p.wallet?.session?.privateKey ?? null).catch(e =>
            console.error('[Puppet] extension sync failed', e)
          )
          return $node(style({ display: 'none' }))()
        })
      )

      const userMatchingRuleQuery = op(
        userSubaccountListQuery,
        map(async query => {
          const accounts = await query
          if (accounts.length === 0) return []
          const lists = await Promise.all(accounts.map(a => fetchUserSubscriptions(a.account)))
          return lists.flat()
        }),
        state()
      )

      type DraftEvent =
        | { type: 'set-subscribes'; list: ISubscribeRule[] }
        | { type: 'upsert'; draft: IDepositDraft | IWithdrawDraft }
        | { type: 'create-master'; draft: ICreateMasterDraft }
        | { type: 'allocate'; draft: IAllocateDraft }
        | { type: 'redeem'; draft: ISellDraft | IClaimDraft }
        | { type: 'fulfill'; draft: IFulfillDraft }
        | { type: 'release'; key: string }
        | { type: 'clear' }

      // Execution-order priority. Deposits run first so they fund the puppet account before
      // any createMaster step (which depends on puppet existing + having balance to cover fees).
      const DRAFT_SORT_KEY: Record<IDraft['kind'], number> = {
        deposit: 0,
        subscribe: 1,
        createMaster: 2,
        allocate: 3,
        sell: 4,
        fulfill: 5,
        claim: 6,
        withdraw: 7
      }
      const normalizeDraftList = (list: IDraft[]): IDraft[] => {
        const sorted = [...list]
          .map((d, i) => ({ d, i }))
          .sort((a, b) => DRAFT_SORT_KEY[a.d.kind] - DRAFT_SORT_KEY[b.d.kind] || a.i - b.i)
          .map(p => p.d)
        const baseTokensFundedByDeposit = new Set<string>(
          sorted.filter((d): d is IDepositDraft => d.kind === 'deposit').map(d => d.inputAmount.baseTokenId)
        )
        return sorted.map(d => {
          if (d.kind !== 'createMaster') return d
          // A pending deposit for the same baseTokenId will deploy + fund the puppet before this
          // master step runs, so the alert from the producer no longer applies.
          if (baseTokensFundedByDeposit.has(d.baseTokenId)) return { ...d, alert: null }
          return d
        })
      }

      const draftList: IStream<IDraft[]> = state(
        [],
        reduce(
          (list: IDraft[], event: DraftEvent): IDraft[] => {
            const next = ((): IDraft[] => {
              if (event.type === 'clear') return []
              if (event.type === 'release') return list.filter(d => d.id !== event.key)
              if (event.type === 'create-master') {
                return list.some(d => d.id === event.draft.id) ? list : [...list, event.draft]
              }
              if (event.type === 'allocate') {
                if (event.draft.masterAmount === 0n) {
                  return list.filter(d => d.id !== event.draft.id)
                }
                const idx = list.findIndex(d => d.id === event.draft.id)
                return idx >= 0 ? [...list.slice(0, idx), event.draft, ...list.slice(idx + 1)] : [...list, event.draft]
              }
              if (event.type === 'redeem') {
                const amount = event.draft.kind === 'sell' ? event.draft.sharesOut : event.draft.amount
                if (amount === 0n) return list.filter(d => d.id !== event.draft.id)
                const idx = list.findIndex(d => d.id === event.draft.id)
                return idx >= 0 ? [...list.slice(0, idx), event.draft, ...list.slice(idx + 1)] : [...list, event.draft]
              }
              if (event.type === 'fulfill') {
                if (event.draft.acceptableShares === 0n) return list.filter(d => d.id !== event.draft.id)
                const idx = list.findIndex(d => d.id === event.draft.id)
                return idx >= 0 ? [...list.slice(0, idx), event.draft, ...list.slice(idx + 1)] : [...list, event.draft]
              }
              if (event.type === 'set-subscribes') {
                const incomingMap = new Map<string, ISubscribeDraft>(
                  event.list.map(d => {
                    const id = `subscribe:${d.master}`
                    return [
                      id,
                      {
                        ...d,
                        kind: 'subscribe' as const,
                        id,
                        account: d.master,
                        title: d.allocationRate === 0n ? 'Unsubscribe' : 'Subscribe',
                        alert: null
                      }
                    ]
                  })
                )
                const kept: IDraft[] = []
                for (const d of list) {
                  if (d.kind !== 'subscribe') {
                    kept.push(d)
                    continue
                  }
                  const next = incomingMap.get(d.id)
                  if (!next) continue
                  kept.push(next)
                  incomingMap.delete(d.id)
                }
                return [...kept, ...incomingMap.values()]
              }
              // upsert: mutual exclusion by slot, then upsert by id.
              // Cancel when there's nothing to credit/withdraw — deposit sweeps surplus with
              // inputAmount.amount=0 but output.amount>0, so checking output covers both top-up and sweep.
              if (event.draft.output.amount === 0n) {
                return list.filter(d => d.id !== event.draft.id)
              }
              const filtered = list.filter(d => {
                if (d.kind === 'deposit' || d.kind === 'withdraw') {
                  return d.id === event.draft.id || d.account !== event.draft.account
                }
                return true
              })
              const idx = filtered.findIndex(d => d.id === event.draft.id)
              return idx >= 0
                ? [...filtered.slice(0, idx), event.draft, ...filtered.slice(idx + 1)]
                : [...filtered, event.draft]
            })()
            return normalizeDraftList(next)
          },
          [] as IDraft[],
          merge(
            map((list): DraftEvent => ({ type: 'set-subscribes', list }), changeMatchRuleList),
            map((draft): DraftEvent => ({ type: 'upsert', draft }), changeDraft),
            map((draft): DraftEvent => ({ type: 'create-master', draft }), changeCreateMasterDraft),
            map((draft): DraftEvent => ({ type: 'allocate', draft }), changeAllocateDraft),
            map((draft): DraftEvent => ({ type: 'redeem', draft }), changeRedeemDraft),
            map((draft): DraftEvent => ({ type: 'fulfill', draft }), changeFulfillDraft),
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

      const draftMatchingRuleList: IStream<ISubscribeRule[]> = map(
        list =>
          list
            .filter((d): d is ISubscribeDraft => d.kind === 'subscribe')
            .map(({ kind: _kind, ...rest }) => rest as ISubscribeRule),
        draftList
      )
      const draftDepositList: IStream<IDepositDraft[]> = map(
        list => list.filter((d): d is IDepositDraft => d.kind === 'deposit'),
        draftList
      )
      const draftWithdrawList: IStream<IWithdrawDraft[]> = map(
        list => list.filter((d): d is IWithdrawDraft => d.kind === 'withdraw'),
        draftList
      )

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
          isMobileScreen ? style({ userSelect: 'none' }) : style({})
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
                  ignoreAll(clickUpdateVersion)
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

          $MainMenu({ subaccountList, selectedSubaccount })({
            changeActiveSubaccount: changeActiveSubaccountTether()
          }),

          $PairBanner({ walletQuery, subaccountList })({}),

          contains(routeSchema.home)($midContainer(fadeIn($Home({})({})))),
          contains(routeSchema.hello)(
            $midContainer(
              fadeIn(
                $HelloPage({ walletQuery, subaccountList, draftDepositList, draftWithdrawList, activeMaster })({
                  changeDraft: changeDraftTether(),
                  changeCreateMasterDraft: changeCreateMasterDraftTether(),
                  changeAllocateDraft: changeAllocateDraftTether(),
                  changeRedeemDraft: changeRedeemDraftTether(),
                  changeFulfillDraft: changeFulfillDraftTether()
                })
              )
            )
          ),
          match(routeSchema)(
            $midContainer(
              fadeIn(
                $Leaderboard({
                  draftMatchingRuleList,
                  activityTimeframe,
                  collateralTokenList,
                  indexTokenList,
                  userMatchingRuleQuery
                })({
                  changeActivityTimeframe: changeActivityTimeframeTether(),
                  selectCollateralTokenList: selectCollateralTokenListTether(),
                  selectIndexTokenList: selectIndexTokenListTether(),
                  changeMatchRuleList: changeMatchRuleListTether()
                })
              )
            )
          ),
          contains(routeSchema.master.detail)(
            fadeIn(
              $MasterPage({
                userMatchingRuleQuery,
                activityTimeframe,
                collateralTokenList,
                indexTokenList,
                draftMatchingRuleList
              })({
                selectCollateralTokenList: selectCollateralTokenListTether(),
                selectIndexTokenList: selectIndexTokenListTether(),
                changeActivityTimeframe: changeActivityTimeframeTether(),
                changeMatchRuleList: changeMatchRuleListTether()
              })
            )
          ),
          match(routeSchema.portfolio)(
            $midContainer(
              fadeIn(
                $Portfolio({
                  draftDepositList,
                  draftWithdrawList,
                  walletQuery,
                  subaccountList,
                  activeMaster,
                  activityTimeframe,
                  collateralTokenList,
                  indexTokenList
                })({
                  selectCollateralTokenList: selectCollateralTokenListTether(),
                  selectIndexTokenList: selectIndexTokenListTether(),
                  changeActivityTimeframe: changeActivityTimeframeTether(),
                  changeDraft: changeDraftTether(),
                  changeRedeemDraft: changeRedeemDraftTether(),
                  changeCreateMasterDraft: changeCreateMasterDraftTether(),
                  changeAllocateDraft: changeAllocateDraftTether(),
                  changeFulfillDraft: changeFulfillDraftTether()
                })
              )
            )
          ),
          $row(style({ position: 'fixed', zIndex: 100, right: '16px', bottom: '16px' }))(
            $ServicesConnectivity({ matchmaker: compact.status })({})
          ),

          switchLatest($extensionSync),

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
              })
            )(
              $ActionDrawer({ draftList, subaccountList })({
                clearDrafts: clearDraftsTether(),
                releaseDraft: releaseDraftTether(),
                changeAttest: changeAttestTether()
              })
            )
          )
        )
      ]
    }
  )
