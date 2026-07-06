import { HUB_CHAIN_ID, PRECISION } from '@puppet/contracts/const'
import type { IFundAccountLib__FundAccountInitParams } from '@puppet/contracts/types'
import { predictFundAccount, predictPuppetAccount, predictShareToken } from '@puppet/sdk/account'
import { type ChainId, type IntervalTime, VIEM_CHAINS } from '@puppet/sdk/const'
import { ignoreAll, sharesFor } from '@puppet/sdk/core'
import { fundPositionTable, fundTable, type IFund } from '@puppet/sdk/schema'
import {
  composeSubaccount,
  type IAccountBalanceRow,
  type ISubaccountState,
  stubSubaccountState,
  withBalanceRows
} from '@puppet/sdk/state'
import {
  awaitPromises,
  combine,
  empty,
  filter,
  fromPromise,
  type IStream,
  just,
  map,
  merge,
  op,
  reduce,
  sampleMap,
  skip,
  skipRepeats,
  start,
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
import { $MainMenu } from '../components/$MainMenu.js'
import { $PairBanner } from '../components/$PairBanner.js'
import type { ISubscribeRule } from '../components/portfolio/$MatchingRuleEditor.js'
import type {
  IAllocateDraft,
  IClaimDraft,
  IClaimRouteDraft,
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
import { client } from '../io/datastore/reads.js'
import { readSignedBalance } from '../io/onchain/account.js'
import { readAccountBalances } from '../io/onchain/balances.js'
import { discoverMasteredFunds, type IDiscoveredFund, recoverPuppetIdentity } from '../io/onchain/fundDiscovery.js'
import { setViewCacheOwner, viewCode } from '../io/onchain/viewRead.js'
import { enableSmoothScroll } from '../utils/smoothScroll.js'
import { walletQuery } from '../wallet/index.js'
import { $FundQuickstart } from './$FundQuickstart.js'
import { $Home } from './$Home.js'
import { $Leaderboard } from './$Leaderboard.js'
import { $Portfolio } from './$Portfolio.js'
import { $PublicFundPage } from './$PublicFundPage.js'

interface IApp {}

const FUND_ROUTED: ReadonlySet<string> = new Set(['operate', 'allocate', 'redeem', 'liquidate'])

const ZERO_TOKEN = '0x0000000000000000000000000000000000000000' as Address

// The nav-per-share a fund carries before its pool is seeded (1.0 in float/share precision).
const SEED_NAV = PRECISION.floatPrecisionExp / PRECISION.sharePrecisionExp

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
  const lastSettled = { chainId: Number(result.chainId), block: settled.settledBlock }
  if (target !== state.account) {
    const chains = state.chains.has(HUB_CHAIN_ID)
      ? state.chains
      : new Map(state.chains).set(HUB_CHAIN_ID, {
          account: state.account,
          chainId: BigInt(HUB_CHAIN_ID),
          isFund: state.isFund,
          user: state.user,
          signer: state.signer
        })
    const fund = state.funds.find(f => isAddressEqual(f.fund as Address, target))
    if (!fund) {
      const fundParams = (request.input as { fundParams?: IFundAccountLib__FundAccountInitParams }).fundParams
      const seedAum = fundAumDelta(request, result.actualRelayFee, 0n)
      if (request.kind !== 'allocate' || !fundParams || seedAum <= 0n)
        return { ...state, chains, lastTransactionHash: result.txHash, lastSettled }
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
        navPerShare: SEED_NAV,
        seeded: true
      }
      return { ...state, funds: [...state.funds, newFund], chains, lastTransactionHash: result.txHash, lastSettled }
    }
    const nav = fund.navPerShare > 0n ? fund.navPerShare : SEED_NAV
    const aum = (fund.totalShareSupply * nav) / PRECISION.floatPrecisionExp
    if (aum === 0n && fund.totalShareSupply > 0n) return { ...state, chains, lastTransactionHash: result.txHash, lastSettled }
    const minted = sharesFor(fund.totalShareSupply, aum, fundAumDelta(request, result.actualRelayFee, aum))
    const supply = fund.totalShareSupply + minted > 0n ? fund.totalShareSupply + minted : 0n
    const funds = state.funds.map(f =>
      isAddressEqual(f.fund as Address, target) ? { ...f, totalShareSupply: supply, navPerShare: nav } : f
    )
    return { ...state, funds, chains, lastTransactionHash: result.txHash, lastSettled }
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
  return { ...state, balances, lastNonce: nonce, lastTransactionHash: result.txHash, lastSettled }
}

type IBalanceRefresh = { refresh: true; token: Hex; row: IAccountBalanceRow }
type IFundsDiscovered = { discovered: IDiscoveredFund[] }
type IRootFold = IAttestation | IBalanceRefresh | IFundsDiscovered

// A discovered fund carries its identity + the RPC-hydrated on-chain economics (supply/queued/pool/liquidationRate). It
// does NOT carry navPerShare (attested NAV / supply) or totalAllocated (lifetime cumulative) — neither has a getter — so
// those are never overwritten: an existing row keeps its indexer/attest values, and a fund the seed missed is added with
// navPerShare = SEED_NAV / totalAllocated = 0n (the exact fallbacks consumers already apply) until a NAV reconstruction
// lands. `seeded` also stays on the existing row (the indexer flag doesn't reset on full redemption; the RPC proxy does).
function newFundRow(h: IDiscoveredFund): IFund {
  return {
    id: getAddress(h.fund),
    fund: getAddress(h.fund),
    shareToken: getAddress(h.shareToken),
    baseToken: getAddress(h.baseToken),
    name: h.name,
    master: getAddress(h.master),
    totalAllocated: 0n,
    totalShareSupply: h.totalShareSupply,
    queuedShares: h.queuedShares,
    epoch: h.epoch,
    accruedPerWeight: h.accruedPerWeight,
    weight: h.weight,
    liquidationRate: h.liquidationRate,
    navPerShare: SEED_NAV,
    seeded: h.seeded
  }
}

function mergeDiscoveredFunds(state: ISubaccountState | null, discovered: IDiscoveredFund[]): ISubaccountState | null {
  if (state === null || discovered.length === 0) return state
  const byFund = new Map(state.funds.map(f => [getAddress(f.fund as Address), f]))
  for (const h of discovered) {
    const key = getAddress(h.fund)
    const existing = byFund.get(key)
    byFund.set(
      key,
      existing
        ? {
            ...existing,
            totalShareSupply: h.totalShareSupply,
            queuedShares: h.queuedShares,
            epoch: h.epoch,
            accruedPerWeight: h.accruedPerWeight,
            weight: h.weight,
            liquidationRate: h.liquidationRate
          }
        : newFundRow(h)
    )
  }
  return { ...state, funds: [...byFund.values()] }
}

function applyRootFold(state: ISubaccountState | null, fold: IRootFold): ISubaccountState | null {
  if ('discovered' in fold) return mergeDiscoveredFunds(state, fold.discovered)
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
      [changeClaimDraft, changeClaimDraftTether]: IBehavior<IClaimRouteDraft>,
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

      // The root PA state as a stream of PROMISES (like walletQuery): each wallet generation first emits its in-flight
      // seed (session read → chain identity recovery → compose), then a resolved promise per fold. Consumers handle the
      // promise on their end — promiseState/$intermediatePromise for display (real intermediate loading, never a stale
      // replay or finalized empty-state copy mid-seed), switchPromises where only the resolved value matters.
      const walletState: IStream<Promise<ISubaccountState | null>> = op(
        walletQuery,
        switchMap(walletPromise => {
          const seeded = (async (): Promise<{ initial: ISubaccountState | null; folds: IStream<IRootFold> }> => {
          const wallet = await walletPromise
          setViewCacheOwner(wallet?.address ?? null)
          // The signer resolves without ever prompting at boot: an already-stored session first, else the chain's own
          // DeployPuppetAccount record (hub log scan, device-cached) recovers the deployed {user, signer} so a returning
          // wallet on a fresh device still DISPLAYS its state. Still undefined => never deployed AND no session — the
          // account stays unresolved until the user acts, at which point the drawer (bindSession) prompts for the
          // derivation signature, deriving the same signer deterministically.
          let signer = wallet?.session?.signer
          if (wallet && signer === undefined) {
            signer = (await recoverPuppetIdentity(wallet.address).catch(() => undefined))?.signer
          }
          let initial: ISubaccountState | null = null
          // Boot-time RPC discovery of the funds this wallet masters (indexer-free, chain-sourced, device-cached). It
          // resolves independently of the indexer seed and folds in as a one-shot refresh, so first paint isn't gated on
          // the scan and any fund the seed missed still surfaces (union-fills-gaps in mergeDiscoveredFunds).
          let discoveryFold: IStream<IRootFold> = empty
          if (wallet && signer) {
            const params = { user: wallet.address, signer }
            const puppet = predictPuppetAccount(params)
            discoveryFold = op(
              fromPromise(discoverMasteredFunds(puppet).catch(() => [] as IDiscoveredFund[])),
              map((discovered): IRootFold => ({ discovered }))
            )
            // PA existence + per-chain presence via cache-first eth_getCode instead of the indexer identity table: the
            // account address is deterministic from {user, signer} (already known) and isFund is always false for a PA,
            // so the only facts the indexer added were "deployed?" and "on which chains" — both are getCode. A read that
            // throws is excluded (unknown, not proven-absent); no code on any chain => never deployed, so stub.
            const deployedChains = (
              await Promise.all(
                VIEM_CHAINS.map(chain =>
                  viewCode(chain.id as ChainId, puppet)
                    .then(code => (code && code !== '0x' ? (chain.id as ChainId) : null))
                    .catch(() => null)
                )
              )
            ).filter((cid): cid is ChainId => cid !== null)
            if (deployedChains.length === 0) {
              initial = stubSubaccountState(params)
            } else {
              const registry = await context.getTokenRegistry()
              const [balanceRows, fundRows, positionRows] = await Promise.all([
                readAccountBalances(registry, puppet),
                client.select(fundTable, { where: { master: puppet } }),
                client.select(fundPositionTable, { where: { holder: puppet } })
              ])
              const identities = deployedChains.map(chainId => ({
                account: puppet,
                chainId: BigInt(chainId),
                isFund: false,
                user: params.user,
                signer: params.signer
              }))
              initial =
                composeSubaccount(identities, balanceRows, fundRows, positionRows) ??
                withBalanceRows({ ...stubSubaccountState(params), funds: fundRows, positions: positionRows }, balanceRows)
            }
          }
          const refreshFolds: IStream<IRootFold> = op(
            changeAttest,
            map(async (settled): Promise<IBalanceRefresh | null> => {
              if (initial === null) return null
              const target = accountForRequest(settled.request)
              const chainId = Number((settled.request.intent as { chainId: bigint }).chainId) as ChainId
              // Every settlement refresh read is PINNED at the dispatch tx's mined block: a load-balanced node lagging
              // that block errors instead of answering pre-settlement state (which would then be CACHED as fresh — the
              // stale-after-reload withdraw bug). A pinned failure retries briefly; still failing => skip the fold and
              // leave the cache untouched rather than poison it.
              const pinned = async <T>(read: () => Promise<T>): Promise<T | null> => {
                for (let attempt = 0; attempt < 3; attempt++) {
                  try {
                    return await read()
                  } catch {
                    await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)))
                  }
                }
                return null
              }
              const targetSigned = await pinned(() =>
                readSignedBalance(target, chainId, settled.token, true, settled.settledBlock)
              )
              const creditsPuppetAccount = settled.request.kind === 'redeem' || settled.request.kind === 'liquidate'
              const foldAccount = target === initial.account ? target : creditsPuppetAccount ? initial.account : null
              // Rewarm the touched accounts' MULTICALL bundle (fire-and-forget): the single-token refresh above busts
              // only the per-token view key, while boot-time readAccountBalances serves the per-chain aggregate3 bundle
              // — without this, the next reload would read the pre-settlement bundle until something else busts it.
              void context.getTokenRegistry().then(registry =>
                Promise.all(
                  [...new Set([target, ...(creditsPuppetAccount ? [initial.account] : [])])].map(account =>
                    pinned(() =>
                      readAccountBalances(registry, account, true, { chainId: chainId, block: settled.settledBlock })
                    )
                  )
                )
              )
              if (foldAccount === null) return null
              const signed =
                foldAccount === target
                  ? targetSigned
                  : await pinned(() =>
                      readSignedBalance(foldAccount, chainId, settled.token, true, settled.settledBlock)
                    )
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
          const folds: IStream<IRootFold> = merge(changeAttest, refreshFolds, discoveryFold)
          return { initial, folds }
          })()
          return op(
            fromPromise(seeded),
            switchMap(s => reduce(applyRootFold, s.initial, s.folds)),
            map(v => Promise.resolve(v)),
            start(seeded.then(s => s.initial))
          )
        }),
        state()
      )

      const walletAddress: IStream<string | null> = op(
        walletQuery,
        switchPromises,
        map(w => w?.address.toLowerCase() ?? null)
      )

      const walletAccount: IStream<Address | null> = op(
        walletState,
        switchPromises,
        map(root => root?.account ?? null)
      )
      const userMatchingRuleQuery = op(
        sampleMap(
          async (account: Address | null) =>
            account ? fetchUserSubscriptions(await context.getTokenRegistry(), account) : [],
          walletAccount,
          merge(
            op(walletAccount, skipRepeats),
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
        | { type: 'claimRoute'; draft: IClaimRouteDraft }
        | { type: 'allocate'; draft: IAllocateDraft }
        | { type: 'fundSwap'; draft: IFundSwapDraft }
        | { type: 'sell-claim'; draft: ISellDraft | IClaimDraft }
        | { type: 'redeem'; draft: IRedeemDraft }
        | { type: 'recognizeFund'; draft: IRecognizeFundDraft }
        | { type: 'release'; key: string }
        | { type: 'clear' }

      const DRAFT_SORT_KEY: Record<IDraft['kind'], number> = {
        deposit: 0,
        recognizeFund: 1,
        claimRoute: 1,
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
              if (event.type === 'claimRoute') {
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
            map((draft): DraftEvent => ({ type: 'claimRoute', draft }), changeClaimDraft),
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

          match(routeSchema)($midContainer(fadeIn($Home()({})))),
          match(routeSchema.quickstart)(
            $midContainer(
              fadeIn(
                $FundQuickstart({
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
                  changeClaimDraft: changeClaimDraftTether(),
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
              $ActionDrawer({ draftList, walletState, hideBalances })({
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
