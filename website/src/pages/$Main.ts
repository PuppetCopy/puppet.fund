import { HUB_CHAIN_ID, PRECISION } from '@puppet/contracts/const'
import type { IFundAccountLib__FundAccountInitParams } from '@puppet/contracts/types'
import { predictFundAccount, predictPuppetAccount, predictShareToken } from '@puppet/sdk/account'
import type { ChainId, IntervalTime } from '@puppet/sdk/const'
import { ignoreAll, sharesFor } from '@puppet/sdk/core'
import { accountIdentityTable, type IFund } from '@puppet/sdk/schema'
import type { IAccountBalanceRow, ISubaccountState } from '@puppet/sdk/state'
import {
  awaitPromises,
  combine,
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
import { $node, $text, $wrapNativeElement, component, effectRun, style, styleBehavior } from 'aelea/ui'
import { $column, designSheet, isMobileScreen, observer, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { contains, locationChange, match } from 'aelea/ui-router'
import { getAddress, type Hex, isAddressEqual } from 'viem'
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
  IFundSwapDraft,
  IRecognizeFundDraft,
  IRedeemDraft,
  ISellDraft,
  ISubscribeDraft,
  IWithdrawDraft
} from '../components/portfolio/draft.js'
import { computeSignedDelta, type IAttestation } from '../components/portfolio/runner/steps.js'
import context from '../io/context.js'
import { fetchUserSubscriptions } from '../io/datastore/query.js'
import { client } from '../io/matchmaker/reads.js'
import { readWalletState } from '../io/matchmaker/walletState.js'
import { readSignedBalance } from '../io/onchain/account.js'
import { setViewCacheOwner } from '../io/onchain/viewRead.js'
import { enableSmoothScroll } from '../utils/smoothScroll.js'
import { walletQuery } from '../wallet/index.js'
import { $Home } from './$Home.js'
import { $Leaderboard } from './$Leaderboard.js'
import { $Portfolio } from './$Portfolio.js'
import { $PublicFundPage } from './$PublicFundPage.js'

interface IApp {}

const FUND_ROUTED: ReadonlySet<string> = new Set(['operate', 'allocate', 'redeem', 'liquidate'])

const ZERO_TOKEN = '0x0000000000000000000000000000000000000000' as Address

// Fund-routed requests settle against the fund account, derived from input.fundParams under
// multi-key CREATE2; everything else settles on the puppet account.
function accountForRequest(req: IAttestation['request']): Address {
  const input = req.input as {
    params: { user: Address; signer: Address }
    fundParams?: IFundAccountLib__FundAccountInitParams
  }
  if (FUND_ROUTED.has(req.kind)) {
    if (!input.fundParams) throw new Error(`fund-routed ${req.kind} missing fundParams`)
    return predictFundAccount(input.fundParams)
  }
  return predictPuppetAccount(input.params)
}

function stubBalanceRow(account: Address, chainId: bigint, token: Address, signedBalance: bigint): IAccountBalanceRow {
  return {
    id: `${chainId}-${account}-${token}:0`,
    account,
    chainId,
    token,
    blockNumber: 0n,
    blockTimestamp: 0,
    signedBalance
  }
}

// The AUM a fund-routed action optimistically moves: allocate adds the base in, redeem/liquidate drain it out, operate is
// NAV-neutral. Supply is then scaled to hold NAV, mirroring the contract's allocate/redeem math (reload reconciles exact).
function fundAumDelta(request: IAttestation['request'], actualRelayFee: bigint, aum: bigint): bigint {
  const intent = request.intent as unknown as { assetsOut?: bigint }
  switch (request.kind) {
    case 'allocate':
      return computeSignedDelta(request, actualRelayFee)
    case 'redeem':
      return -(intent.assetsOut ?? 0n)
    case 'liquidate':
      return -aum
    default:
      return 0n
  }
}

function applyWalletAttest(state: ISubaccountState | null, settled: IAttestation): ISubaccountState | null {
  if (state === null) return null
  const { request, result } = settled
  const target = accountForRequest(request)
  if (target !== state.account) {
    // Fund-routed op (allocate/operate/redeem/liquidate). All run on the hub, so a successful one means the PA is now
    // deployed there — mark it so the FA card flips off "Fund will be created" at $0.00 on the ACK (a reload reconciles
    // exactly against the fold). The optimistic AUM nudge below keeps the card honest until then.
    const chains = state.chains.has(HUB_CHAIN_ID)
      ? state.chains
      : new Map(state.chains).set(HUB_CHAIN_ID, {
          account: state.account,
          chainId: BigInt(HUB_CHAIN_ID),
          isFund: state.isFund,
          user: state.user,
          signer: state.signer
        })
    const seedNav = PRECISION.floatPrecisionExp / PRECISION.sharePrecisionExp
    const fund = state.funds.find(f => isAddressEqual(f.fund as Address, target))
    if (!fund) {
      // First allocation creates the fund — it is not in the root yet. Seed it (AUM = the allocated base, first-mint
      // supply) so the card shows a real AUM. Only allocate can target a fund that does not exist yet.
      const fundParams = (request.input as { fundParams?: IFundAccountLib__FundAccountInitParams }).fundParams
      const seedAum = fundAumDelta(request, result.actualRelayFee, 0n)
      if (request.kind !== 'allocate' || !fundParams || seedAum <= 0n)
        return { ...state, chains, lastTransactionHash: result.txHash }
      const newFund: IFund = {
        id: getAddress(target),
        fund: getAddress(target),
        shareToken: predictShareToken(fundParams),
        baseToken: fundParams.baseToken,
        name: fundParams.name,
        master: getAddress(state.account),
        totalAllocated: seedAum,
        totalShareSupply: sharesFor(0n, 0n, seedAum),
        queuedShares: 0n,
        epoch: 0n,
        accruedPerWeight: 0n,
        weight: 0n,
        liquidationRate: 0n,
        navPerShare: seedNav,
        seeded: true
      }
      return { ...state, funds: [...state.funds, newFund], chains, lastTransactionHash: result.txHash }
    }
    // Existing fund (incl. one already in the root but not yet seeded): nudge supply to hold NAV across the action. Seed
    // navPerShare when the row is unseeded (nav 0) so the AUM is non-zero and sharesFor never divides by a zero NAV.
    const nav = fund.navPerShare > 0n ? fund.navPerShare : seedNav
    const aum = (fund.totalShareSupply * nav) / PRECISION.floatPrecisionExp
    if (aum === 0n && fund.totalShareSupply > 0n) return { ...state, chains, lastTransactionHash: result.txHash }
    const minted = sharesFor(fund.totalShareSupply, aum, fundAumDelta(request, result.actualRelayFee, aum))
    const supply = fund.totalShareSupply + minted > 0n ? fund.totalShareSupply + minted : 0n
    const funds = state.funds.map(f =>
      isAddressEqual(f.fund as Address, target) ? { ...f, totalShareSupply: supply, navPerShare: nav } : f
    )
    return { ...state, funds, chains, lastTransactionHash: result.txHash }
  }
  const chainId = (request.intent as { chainId: bigint }).chainId
  const nonce = (request.intent as { nonce: bigint }).nonce
  const token = settled.token
  const delta = computeSignedDelta(request, result.actualRelayFee)
  const existing = state.balances.get(token)
  const nextBalance: IAccountBalanceRow = existing
    ? { ...existing, signedBalance: existing.signedBalance + delta }
    : stubBalanceRow(state.account, chainId, token, delta)
  const balances = new Map(state.balances)
  balances.set(token, nextBalance)
  return { ...state, balances, lastNonce: nonce, lastTransactionHash: result.txHash }
}

type IBalanceRefresh = { refresh: true; token: Hex; row: IAccountBalanceRow }
type IRootFold = IAttestation | IBalanceRefresh

function applyRootFold(state: ISubaccountState | null, fold: IRootFold): ISubaccountState | null {
  if (!('refresh' in fold)) return applyWalletAttest(state, fold)
  if (state === null) return null
  const balances = new Map(state.balances)
  balances.set(fold.token, fold.row)
  return { ...state, balances }
}

export const $Main = (_config: IApp = {}) =>
  component(
    (
      [clickUpdateVersion, clickUpdateVersionTether]: IBehavior<any, bigint>,

      [changeActivityTimeframe, changeActivityTimeframeTether]: IBehavior<IntervalTime>,
      [selectCollateralTokenList, selectCollateralTokenListTether]: IBehavior<Address[]>,
      [changeHideBalances, changeHideBalancesTether]: IBehavior<boolean>,

      [changeMatchRuleList, changeMatchRuleListTether]: IBehavior<ISubscribeRule[]>,
      [changeDraft, changeDraftTether]: IBehavior<IDepositDraft | IWithdrawDraft>,
      [changeAllocateDraft, changeAllocateDraftTether]: IBehavior<IAllocateDraft>,
      [changeSwapDraft, changeSwapDraftTether]: IBehavior<IFundSwapDraft>,
      [changeRedeemDraft, changeRedeemDraftTether]: IBehavior<ISellDraft | IClaimDraft>,
      [changeFulfillDraft, changeFulfillDraftTether]: IBehavior<IRedeemDraft | IRecognizeFundDraft>,
      [clearDrafts, clearDraftsTether]: IBehavior<null>,
      [releaseDraft, releaseDraftTether]: IBehavior<string>,
      [changeAttest, changeAttestTether]: IBehavior<IAttestation>,
      [drawerSize, drawerSizeTether]: IBehavior<any, number>
    ) => {
      const activityTimeframe = uiStorage.replayWrite(
        localStoreSchema.global.activityTimeframe,
        changeActivityTimeframe
      )
      const collateralTokenList = uiStorage.replayWrite(
        localStoreSchema.global.collateralTokenList,
        selectCollateralTokenList
      )
      const hideBalances = state(false, uiStorage.replayWrite(localStoreSchema.global.hideBalances, changeHideBalances))

      const recoverDeployedSigner = async (user: Address): Promise<Address | undefined> => {
        const rows = await client.select(accountIdentityTable, { where: { user: getAddress(user) } })
        return rows[0]?.signer as Address | undefined
      }

      const walletState: IStream<ISubaccountState | null> = op(
        walletQuery,
        switchMap(async walletPromise => {
          const wallet = await walletPromise
          setViewCacheOwner(wallet?.address ?? null)
          const signer = wallet ? (wallet.session?.signer ?? (await recoverDeployedSigner(wallet.address))) : undefined
          const initial =
            wallet && signer
              ? await readWalletState(await context.getTokenRegistry(), { user: wallet.address, signer })
              : null
          const refreshFolds: IStream<IRootFold> = op(
            changeAttest,
            map(async (settled): Promise<IBalanceRefresh | null> => {
              if (initial === null) return null
              // Reconcile the SETTLED account's token after the tx mines: re-read signedBalanceOf with the SW view-cache
              // busted (refresh), which re-warms it to the confirmed on-chain value (incl. 0 on a full drain). The settled
              // account is the PA for wallet actions, or the master's FUND account for fund-routed ops (operate/allocate/
              // redeem/liquidate) — so a master operating his fund busts the FA cache too, even when the fund view isn't
              // mounted. A failed read just skips this cycle (the optimistic overlay already applied).
              const target = accountForRequest(settled.request)
              const chainId = Number((settled.request.intent as { chainId: bigint }).chainId) as ChainId
              // Bust the settled account's view cache (fund view freshness on fund-routed ops).
              const targetSigned = await readSignedBalance(target, chainId, settled.token, true).catch(() => null)
              // Only the PA's own balances live in the root state. Most actions settle on the PA (target === account).
              // redeem/liquidate are fund-routed (target = the fund) yet PAY the master PA its claim, so the balance to
              // fold into the root is the PA's, not the fund's — re-read it fresh too, else the received funds never
              // surface until reload.
              const creditsPuppetAccount = settled.request.kind === 'redeem' || settled.request.kind === 'liquidate'
              const foldAccount = target === initial.account ? target : creditsPuppetAccount ? initial.account : null
              if (foldAccount === null) return null
              const signed =
                foldAccount === target
                  ? targetSigned
                  : await readSignedBalance(foldAccount, chainId, settled.token, true).catch(() => null)
              if (signed === null) return null
              const row: IAccountBalanceRow = {
                id: `${chainId}-${foldAccount}-${settled.token}`,
                chainId: BigInt(chainId),
                account: foldAccount,
                token: settled.token,
                blockNumber: 0n,
                blockTimestamp: 0,
                signedBalance: signed
              }
              return { refresh: true, token: settled.token, row }
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
          async (account: Address | null) =>
            account ? fetchUserSubscriptions(await context.getTokenRegistry(), account) : [],
          op(
            walletState,
            map(root => root?.account ?? null)
          ),
          merge(
            op(
              walletState,
              map(root => root?.account ?? null),
              skipRepeats
            ),
            op(
              changeAttest,
              filter(settled => settled.request.kind === 'mandate')
            )
          )
        ),
        state()
      )

      type DraftEvent =
        | { type: 'set-subscribes'; list: ISubscribeRule[] }
        | { type: 'upsert'; draft: IDepositDraft | IWithdrawDraft }
        | { type: 'allocate'; draft: IAllocateDraft }
        | { type: 'fundSwap'; draft: IFundSwapDraft }
        | { type: 'sell-claim'; draft: ISellDraft | IClaimDraft }
        | { type: 'redeem'; draft: IRedeemDraft }
        | { type: 'recognizeFund'; draft: IRecognizeFundDraft }
        | { type: 'release'; key: string }
        | { type: 'clear' }

      // Execution-order priority. Deposits run first so they fund the puppet account before
      // any fund step (which depends on puppet existing + having balance to cover fees).
      const DRAFT_SORT_KEY: Record<IDraft['kind'], number> = {
        deposit: 0,
        recognizeFund: 1,
        mandate: 2,
        allocate: 3,
        fundSwap: 4,
        sell: 5,
        redeem: 6,
        claim: 7,
        withdraw: 8
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
              if (event.type === 'fundSwap') {
                if (event.draft.amountIn === 0n) return list.filter(d => d.id !== event.draft.id)
                const idx = list.findIndex(d => d.id === event.draft.id)
                return idx >= 0 ? [...list.slice(0, idx), event.draft, ...list.slice(idx + 1)] : [...list, event.draft]
              }
              if (event.type === 'sell-claim') {
                if (event.draft.kind === 'sell' && event.draft.sharesOut === 0n) {
                  return list.filter(d => d.id !== event.draft.id)
                }
                const idx = list.findIndex(d => d.id === event.draft.id)
                return idx >= 0 ? [...list.slice(0, idx), event.draft, ...list.slice(idx + 1)] : [...list, event.draft]
              }
              if (event.type === 'redeem') {
                if (event.draft.assetsOut === 0n && !event.draft.fulfill && !event.draft.liquidate)
                  return list.filter(d => d.id !== event.draft.id)
                const idx = list.findIndex(d => d.id === event.draft.id)
                return idx >= 0 ? [...list.slice(0, idx), event.draft, ...list.slice(idx + 1)] : [...list, event.draft]
              }
              if (event.type === 'recognizeFund') {
                if (event.draft.surplus === 0n) return list.filter(d => d.id !== event.draft.id)
                const idx = list.findIndex(d => d.id === event.draft.id)
                return idx >= 0 ? [...list.slice(0, idx), event.draft, ...list.slice(idx + 1)] : [...list, event.draft]
              }
              if (event.type === 'set-subscribes') {
                const incomingMap = new Map<string, ISubscribeDraft>(
                  event.list.map(d => {
                    const id = `mandate:${d.master}`
                    return [
                      id,
                      {
                        ...d,
                        kind: 'mandate' as const,
                        id,
                        account: d.master,
                        title: d.allocationRate === 0n ? 'Stop funding' : 'Fund',
                        alert: null
                      }
                    ]
                  })
                )
                const kept: IDraft[] = []
                for (const d of list) {
                  if (d.kind !== 'mandate') {
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
            map((draft): DraftEvent => ({ type: 'fundSwap', draft }), changeSwapDraft),
            map((draft): DraftEvent => ({ type: 'sell-claim', draft }), changeRedeemDraft),
            map(
              (draft): DraftEvent =>
                draft.kind === 'recognizeFund' ? { type: 'recognizeFund', draft } : { type: 'redeem', draft },
              changeFulfillDraft
            ),
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
            .filter((d): d is ISubscribeDraft => d.kind === 'mandate')
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
      const draftSwapList: IStream<IFundSwapDraft[]> = map(
        list => list.filter((d): d is IFundSwapDraft => d.kind === 'fundSwap'),
        draftList
      )
      const draftRedeemList: IStream<IRedeemDraft[]> = map(
        list => list.filter((d): d is IRedeemDraft => d.kind === 'redeem'),
        draftList
      )

      // The action drawer is fixed at the bottom and OVERLAYS the page, so it covers the tail of the scroll content.
      // Reserve scroll space equal to its measured height (only while there are drafts) as body padding, so the user
      // can scroll the hidden content above it; smoothScroll's content observer picks up the taller body.
      const drawerReserve = op(
        combine({ h: op(drawerSize, state(0)), list: draftList }),
        map(p => (p.list.length > 0 ? Math.ceil(p.h) : 0)),
        skipRepeats
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
                  hideBalances,
                  walletQuery,
                  walletState,
                  draftAllocateList,
                  draftSwapList,
                  draftRedeemList
                })({
                  changeAllocateDraft: changeAllocateDraftTether(),
                  changeSwapDraft: changeSwapDraftTether(),
                  changeRedeemDraft: changeRedeemDraftTether(),
                  changeFulfillDraft: changeFulfillDraftTether()
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
                      hideBalances,
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
                  hideBalances,
                  draftDepositList,
                  draftWithdrawList,
                  draftAllocateList,
                  draftSwapList,
                  draftRedeemList,
                  draftMatchingRuleList,
                  userMatchingRuleQuery,
                  walletQuery,
                  walletState,
                  activityTimeframe,
                  collateralTokenList
                })({
                  selectCollateralTokenList: selectCollateralTokenListTether(),
                  changeActivityTimeframe: changeActivityTimeframeTether(),
                  changeHideBalances: changeHideBalancesTether(),
                  changeDraft: changeDraftTether(),
                  changeRedeemDraft: changeRedeemDraftTether(),
                  changeAllocateDraft: changeAllocateDraftTether(),
                  changeSwapDraft: changeSwapDraftTether(),
                  changeFulfillDraft: changeFulfillDraftTether(),
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
              }),
              drawerSizeTether(
                observer.resize(),
                map(entries => entries[0]?.borderBoxSize?.[0]?.blockSize ?? entries[0]?.contentRect.height ?? 0)
              )
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
