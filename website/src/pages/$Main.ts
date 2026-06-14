import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { predictFundAccount, predictPuppetAccount } from '@puppet/sdk/account'
import type { IntervalTime } from '@puppet/sdk/const'
import { ignoreAll } from '@puppet/sdk/core'
import { getWalletState, type IAccountBalanceRow, type ISubaccountState, selectOne } from '@puppet/sdk/state'
import {
  awaitPromises,
  filter,
  type IStream,
  just,
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
import { $column, designSheet, isMobileScreen, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { contains, locationChange, match } from 'aelea/ui-router'
import { getAddress, type Hex } from 'viem'
import type { Address } from 'viem/accounts'
import { $alertPositiveContainer, $ButtonSecondary, $defaultMiniButtonSecondary, fadeIn } from '@/ui-components'
import { uiStorage } from '@/ui-storage'
import { localStoreSchema } from '../app/localStoreSchema.js'
import { routeSchema } from '../app/routeSchema.js'
import { pwaUpgradeNotification } from '../app/sw/swUtils.js'
import { $midContainer } from '../common/$common.js'
import { $ActionDrawer, type IDraft } from '../components/$ActionDrawer.js'
// Browser extension sunset for now; revive with the $ExtensionBanner mount below.
// import { $ExtensionBanner } from '../components/$ExtensionBanner.js'
import { $MainMenu } from '../components/$MainMenu.js'
import { $PairBanner } from '../components/$PairBanner.js'
import type { ISubscribeRule } from '../components/portfolio/$MatchingRuleEditor.js'
import type {
  IAllocateDraft,
  IClaimDraft,
  IDepositDraft,
  IRedeemDraft,
  ISellDraft,
  ISubscribeDraft,
  ISwapDraft,
  IWithdrawDraft
} from '../components/portfolio/draft.js'
import { computeSignedDelta, type IAttestation } from '../components/portfolio/runner/steps.js'
import { fetchUserSubscriptions } from '../io/indexer/query.js'
import { sqlClient } from '../io/indexer/sql.js'
import { type IConnectedWallet, walletQuery } from '../wallet/index.js'
import { $Home } from './$Home.js'
import { $Leaderboard } from './$Leaderboard.js'
import { $Portfolio } from './$Portfolio.js'
import { $PublicFundPage } from './$PublicFundPage.js'

interface IApp {}

const FUND_ROUTED: ReadonlySet<string> = new Set(['operate', 'allocate', 'redeem', 'liquidate', 'createFundAccount'])

const PA_CREDIT_REFRESH: ReadonlySet<string> = new Set(['sell', 'claim', 'redeem', 'liquidate'])

const ZERO_TOKEN = '0x0000000000000000000000000000000000000000' as Address

function accountForRequest(req: IAttestation['request']): Address {
  const account = predictPuppetAccount((req.input as { params: { user: Address; signer: Address } }).params)
  return FUND_ROUTED.has(req.kind) ? predictFundAccount(account) : account
}

function stubBalanceRow(account: Address, chainId: bigint, tokenId: Hex, signedBalance: bigint): IAccountBalanceRow {
  return {
    id: `${chainId}-${account}-${tokenId}:0`,
    account,
    chainId,
    tokenId,
    blockNumber: 0n,
    blockTimestamp: 0,
    signedBalance,
    recordedBalance: signedBalance
  }
}

function applyWalletAttest(state: ISubaccountState | null, settled: IAttestation): ISubaccountState | null {
  if (state === null) return null
  const { request, result } = settled
  const target = accountForRequest(request)
  if (target !== state.account) return { ...state, lastTransactionHash: result.txHash }
  const chainId = (request.intent as { chainId: bigint }).chainId
  const nonce = (request.intent as { nonce: bigint }).nonce
  const tokenId = settled.tokenId
  const delta = computeSignedDelta(request, result.actualRelayFee)
  const existing = state.balances.get(tokenId)
  const nextBalance: IAccountBalanceRow = existing
    ? { ...existing, signedBalance: existing.signedBalance + delta }
    : stubBalanceRow(state.account, chainId, tokenId, delta)
  const balances = new Map(state.balances)
  balances.set(tokenId, nextBalance)
  return { ...state, balances, lastNonce: nonce, lastTransactionHash: result.txHash }
}

type IBalanceRefresh = { refresh: true; tokenId: Hex; row: IAccountBalanceRow }
type IRootFold = IAttestation | IBalanceRefresh

function applyRootFold(state: ISubaccountState | null, fold: IRootFold): ISubaccountState | null {
  if (!('refresh' in fold)) return applyWalletAttest(state, fold)
  if (state === null) return null
  const balances = new Map(state.balances)
  balances.set(fold.tokenId, fold.row)
  return { ...state, balances }
}

export const $Main = (_config: IApp = {}) =>
  component(
    (
      [clickUpdateVersion, clickUpdateVersionTether]: IBehavior<any, bigint>,

      [changeActivityTimeframe, changeActivityTimeframeTether]: IBehavior<IntervalTime>,
      [selectCollateralTokenList, selectCollateralTokenListTether]: IBehavior<Address[]>,

      [changeMatchRuleList, changeMatchRuleListTether]: IBehavior<ISubscribeRule[]>,
      [changeDraft, changeDraftTether]: IBehavior<IDepositDraft | IWithdrawDraft>,
      [changeAllocateDraft, changeAllocateDraftTether]: IBehavior<IAllocateDraft>,
      [changeRedeemDraft, changeRedeemDraftTether]: IBehavior<ISellDraft | IClaimDraft>,
      [changeFulfillDraft, changeFulfillDraftTether]: IBehavior<IRedeemDraft>,
      [changeSwapDraft, changeSwapDraftTether]: IBehavior<ISwapDraft>,
      [clearDrafts, clearDraftsTether]: IBehavior<null>,
      [releaseDraft, releaseDraftTether]: IBehavior<string>,
      [changeAttest, changeAttestTether]: IBehavior<IAttestation>
    ) => {
      const activityTimeframe = uiStorage.replayWrite(
        localStoreSchema.global.activityTimeframe,
        changeActivityTimeframe
      )
      const collateralTokenList = uiStorage.replayWrite(
        localStoreSchema.global.collateralTokenList,
        selectCollateralTokenList
      )

      const loadWalletState = async (wallet: IConnectedWallet | null): Promise<ISubaccountState | null> => {
        if (!wallet) return null
        const signer = wallet.session?.signer ?? (await recoverDeployedSigner(wallet.address))
        if (!signer) return null
        return getWalletState(sqlClient, { user: wallet.address, signer })
      }

      const recoverDeployedSigner = async (user: Address): Promise<Address | undefined> => {
        const row = await selectOne(sqlClient, 'Account__DeployPuppetAccount', {
          where: { user: { _eq: getAddress(user) } },
          fields: ['signer']
        })
        return row?.signer as Address | undefined
      }

      const walletState: IStream<ISubaccountState | null> = op(
        walletQuery,
        switchMap(async walletPromise => {
          const initial = await loadWalletState(await walletPromise)
          const refreshFolds: IStream<IRootFold> = op(
            changeAttest,
            map(async (settled): Promise<IBalanceRefresh | null> => {
              if (initial === null || !PA_CREDIT_REFRESH.has(settled.request.kind)) return null
              const row = await selectOne(sqlClient, 'AccountBalanceCheckpoint', {
                where: {
                  account: { _eq: initial.account },
                  chainId: { _eq: BigInt(HUB_CHAIN_ID) },
                  tokenId: { _eq: settled.tokenId }
                },
                orderBy: { blockTimestamp: 'desc' }
              })
              return row ? { refresh: true, tokenId: settled.tokenId, row } : null
            }),
            awaitPromises,
            filter((r): r is IBalanceRefresh => r !== null)
          )
          return state(initial, reduce(applyRootFold, initial, merge(changeAttest, refreshFolds)))
        }),
        switchLatest,
        state()
      )

      const walletAddress: IStream<string | null> = op(
        walletQuery,
        switchPromises,
        map(w => w?.address.toLowerCase() ?? null)
      )

      const userMatchingRuleQuery = op(
        sampleMap(
          (root: ISubaccountState | null) => (root ? fetchUserSubscriptions(root.account) : Promise.resolve([])),
          walletState,
          merge(
            op(
              walletState,
              map(root => root?.account ?? null),
              skipRepeats
            ),
            op(
              changeAttest,
              filter(settled => settled.request.kind === 'subscribe')
            )
          )
        ),
        state()
      )

      type DraftEvent =
        | { type: 'set-subscribes'; list: ISubscribeRule[] }
        | { type: 'upsert'; draft: IDepositDraft | IWithdrawDraft }
        | { type: 'allocate'; draft: IAllocateDraft }
        | { type: 'swap'; draft: ISwapDraft }
        | { type: 'sell-claim'; draft: ISellDraft | IClaimDraft }
        | { type: 'redeem'; draft: IRedeemDraft }
        | { type: 'release'; key: string }
        | { type: 'clear' }

      // Execution-order priority. Deposits run first so they fund the puppet account before
      // any fund step (which depends on puppet existing + having balance to cover fees).
      const DRAFT_SORT_KEY: Record<IDraft['kind'], number> = {
        deposit: 0,
        subscribe: 1,
        allocate: 2,
        swap: 3,
        sell: 4,
        redeem: 5,
        claim: 6,
        withdraw: 7
      }
      const normalizeDraftList = (list: IDraft[]): IDraft[] =>
        [...list]
          .map((d, i) => ({ d, i }))
          .sort((a, b) => DRAFT_SORT_KEY[a.d.kind] - DRAFT_SORT_KEY[b.d.kind] || a.i - b.i)
          .map(p => p.d)

      const draftList: IStream<IDraft[]> = state(
        [],
        reduce(
          (list: IDraft[], event: DraftEvent): IDraft[] => {
            const next = ((): IDraft[] => {
              if (event.type === 'clear') return []
              if (event.type === 'release') return list.filter(d => d.id !== event.key)
              if (event.type === 'allocate') {
                if (event.draft.masterAmount === 0n) {
                  return list.filter(d => d.id !== event.draft.id)
                }
                const idx = list.findIndex(d => d.id === event.draft.id)
                return idx >= 0 ? [...list.slice(0, idx), event.draft, ...list.slice(idx + 1)] : [...list, event.draft]
              }
              if (event.type === 'swap') {
                if (event.draft.amountIn === 0n) return list.filter(d => d.id !== event.draft.id)
                const idx = list.findIndex(d => d.id === event.draft.id)
                return idx >= 0 ? [...list.slice(0, idx), event.draft, ...list.slice(idx + 1)] : [...list, event.draft]
              }
              if (event.type === 'sell-claim') {
                const amount = event.draft.kind === 'sell' ? event.draft.sharesOut : event.draft.amount
                if (amount === 0n) return list.filter(d => d.id !== event.draft.id)
                const idx = list.findIndex(d => d.id === event.draft.id)
                return idx >= 0 ? [...list.slice(0, idx), event.draft, ...list.slice(idx + 1)] : [...list, event.draft]
              }
              if (event.type === 'redeem') {
                if (event.draft.assetsOut === 0n && !event.draft.fulfill && !event.draft.liquidate)
                  return list.filter(d => d.id !== event.draft.id)
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
            map((draft): DraftEvent => ({ type: 'allocate', draft }), changeAllocateDraft),
            map((draft): DraftEvent => ({ type: 'swap', draft }), changeSwapDraft),
            map((draft): DraftEvent => ({ type: 'sell-claim', draft }), changeRedeemDraft),
            map((draft): DraftEvent => ({ type: 'redeem', draft }), changeFulfillDraft),
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
      const draftAllocateList: IStream<IAllocateDraft[]> = map(
        list => list.filter((d): d is IAllocateDraft => d.kind === 'allocate'),
        draftList
      )
      const draftRedeemList: IStream<IRedeemDraft[]> = map(
        list => list.filter((d): d is IRedeemDraft => d.kind === 'redeem'),
        draftList
      )
      const draftSwapList: IStream<ISwapDraft[]> = map(
        list => list.filter((d): d is ISwapDraft => d.kind === 'swap'),
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

          $MainMenu({ walletState })({}),

          $PairBanner({ walletQuery, walletState })({}),
          // $ExtensionBanner({ walletQuery })({}),

          match(routeSchema)(
            $midContainer(
              fadeIn(
                $Home({
                  walletQuery,
                  walletState,
                  draftAllocateList,
                  draftRedeemList,
                  draftSwapList
                })({
                  changeAllocateDraft: changeAllocateDraftTether(),
                  changeRedeemDraft: changeRedeemDraftTether(),
                  changeFulfillDraft: changeFulfillDraftTether(),
                  changeSwapDraft: changeSwapDraftTether()
                })
              )
            )
          ),
          match(routeSchema.leaderboard)(
            $midContainer(
              fadeIn(
                $Leaderboard({
                  draftMatchingRuleList,
                  activityTimeframe,
                  collateralTokenList,
                  userMatchingRuleQuery
                })({
                  changeActivityTimeframe: changeActivityTimeframeTether(),
                  selectCollateralTokenList: selectCollateralTokenListTether(),
                  changeMatchRuleList: changeMatchRuleListTether()
                })
              )
            )
          ),
          contains(routeSchema.fund.detail)(
            switchLatest(
              map(
                () =>
                  fadeIn(
                    $PublicFundPage({
                      userMatchingRuleQuery,
                      activityTimeframe,
                      collateralTokenList,
                      draftMatchingRuleList
                    })({
                      selectCollateralTokenList: selectCollateralTokenListTether(),
                      changeActivityTimeframe: changeActivityTimeframeTether(),
                      changeMatchRuleList: changeMatchRuleListTether()
                    })
                  ),
                op(
                  merge(just(null), locationChange),
                  map(() => document.location.pathname),
                  skipRepeats
                )
              )
            )
          ),
          match(routeSchema.portfolio)(
            $midContainer(
              fadeIn(
                $Portfolio({
                  draftDepositList,
                  draftWithdrawList,
                  draftAllocateList,
                  draftRedeemList,
                  draftSwapList,
                  draftMatchingRuleList,
                  userMatchingRuleQuery,
                  walletQuery,
                  walletState,
                  activityTimeframe,
                  collateralTokenList
                })({
                  selectCollateralTokenList: selectCollateralTokenListTether(),
                  changeActivityTimeframe: changeActivityTimeframeTether(),
                  changeDraft: changeDraftTether(),
                  changeRedeemDraft: changeRedeemDraftTether(),
                  changeAllocateDraft: changeAllocateDraftTether(),
                  changeFulfillDraft: changeFulfillDraftTether(),
                  changeSwapDraft: changeSwapDraftTether(),
                  changeMatchRuleList: changeMatchRuleListTether()
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
              })
            )(
              $ActionDrawer({ draftList, walletState })({
                clearDrafts: clearDraftsTether(),
                releaseDraft: releaseDraftTether(),
                changeAttest: changeAttestTether(),
                changeDraft: changeDraftTether()
              })
            )
          )
        )
      ]
    }
  )
