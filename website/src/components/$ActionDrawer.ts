import { HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import { predictUserAccount } from '@puppet/sdk/account'
import { formatThrownError } from '@puppet/sdk/compact'
import { type ChainId, resolveDispatchChainId } from '@puppet/sdk/const'
import {
  getAccountExplorerUrl,
  getDuration,
  getTokenDescription,
  getTxExplorerUrl,
  readableAddress,
  readableDate,
  readableHash,
  readablePercentage,
  readableTokenAmountLabel
} from '@puppet/sdk/core'
import { VALUE_KEY } from '@puppet/sdk/evaluate'
import { type IActionKind, routeCalldataBytes } from '@puppet/sdk/intent'
import { minFundedAmount } from '@puppet/sdk/mpc'
import {
  bondTokenOf,
  chainTokenOfKey,
  computeRelayFee,
  declaredCallGas,
  dynamicCalldataBytes,
  FEE_MARGIN_BPS,
  followUpOf,
  type IChainLiveness,
  type IFollowUp,
  type ITokenRegistryMap,
  tokenInfoFor,
  tokenKeyOf
} from '@puppet/sdk/state'
import {
  combine,
  combineMap,
  constant,
  empty,
  filter,
  filterNull,
  fromPromise,
  type IStream,
  just,
  map,
  merge,
  op,
  sampleMap,
  skipRepeats,
  skipRepeatsWith,
  start,
  switchMap,
  take
} from 'aelea/stream'
import { type IBehavior, multicast, type PromiseState, PromiseStatus, promiseState, spreadArray, state } from 'aelea/stream-extended'
import { $node, $text, attr, component, effectRun, type I$Node, type I$Slottable, style, } from 'aelea/ui'
import { $Button, $column, $Popover, $row, designSheet, isMobileScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $defaultAnchor, $Link } from 'aelea/ui-router'
import { type Address, getAddress, isAddressEqual } from 'viem'
import {
  $alertIntermediateSpinnerContainer,
  $alertNegativeContainer,
  $alertPositiveContainer,
  $anchor,
  $ButtonCircular,
  $ButtonSecondary,
  $check,
  $defaultButtonCircularContainer,
  $defaultButtonPrimary,
  $defaultButtonSecondary,
  $defaultTooltipDropContainer,
  $errorLabel,
  $icon,
  $info,
  $inlineSpinner,
  $labeledDivider,
  $labeledValue,
  $Tooltip,
  $wallet,
  $xCross,
  fadeIn,
  text
} from '@/ui-components'
import { routeSchema } from '../app/routeSchema.js'
import { $jazzicon } from '../common/$avatar.js'
import { $chainIcon, chainName } from '../common/$chain.js'
import { chainFor } from '../common/$contract.js'
import { $heading3 } from '../common/$text.js'
import { $card2, } from '../common/elements/$common.js'
import context, { DISPLAY_QUOTE_TTL_MS } from '../io/context.js'
import { journal } from '../io/journal/journal.js'
import type { IOwnState } from '../io/journal/localFold.js'
import { formatUsd, priceFor } from '../io/price.js'
import { subject } from '../utils/subject.js'
import { type IConnectedWallet, type IFund, type IRootState, type ISettledTx, type IWalletKeys, type IWalletPair, rootQuery } from '../wallet/index.js'
import { $betaAgreement } from './$enableSession.js'
import type { IDraft, IMandateDraft, IReportWalletTx, IWithdrawDraft, StepKind } from './portfolio/draft.js'
import { type IStepShape, planShapes } from './portfolio/runner/plan.js'
import { type IAttestation, runDraft, runMandateBatch } from './portfolio/runner/steps.js'

export type { IDraft }

const SIGNATURE_STEPS: ReadonlySet<StepKind> = new Set<StepKind>(['key', 'session'])

const restoreFundOf = (root: IRootState | null, wallet: IConnectedWallet, keys: IWalletKeys | null): IFund | null =>
  root === null || root.fund === null || keys === null || keys.fundSignerOf(wallet.address, root.fund.account) !== null ? null : root.fund

const countLabel = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

const walletAsk = (shapes: readonly { kind: StepKind }[]): string => {
  const signs = shapes.filter(s => SIGNATURE_STEPS.has(s.kind)).length
  const sends = shapes.length - signs
  const parts = [
    ...(signs > 0 ? [countLabel(signs, 'signature', 'signatures')] : []),
    ...(sends > 0 ? [countLabel(sends, 'transaction', 'transactions')] : [])
  ]
  const cost =
    signs > 0 && sends > 0 ? 'Signatures are free; transactions cost gas.' : signs > 0 ? 'Signatures are free.' : 'Transactions cost gas.'
  return `${parts.join(' and ')}${signs + sends > 1 ? ', all up front' : ' up front'}. ${cost}`
}

interface I$ActionDrawer {
  draftList: IStream<IDraft[]>
  walletPair: IStream<IWalletPair>
  walletRoot: IStream<IRootState | null>
  ownStateQuery: IStream<Promise<IOwnState | null>>
  title?: string
}

const chainsForDraft = (d: IDraft): number[] => {
  const chains = new Set<number>([HUB_CHAIN_ID])
  if (d.kind === 'deposit') chains.add(d.deposit.chainId)
  if (d.kind === 'operate' || d.kind === 'withdraw') chains.add(d.chainId)
  if (d.kind === 'fundSwap') {
    chains.add(d.chainId)
    chains.add(d.destinationChainId)
  }
  return [...chains]
}

const staleChainFor = (d: IDraft, health: IChainLiveness): number | null => {
  for (const chainId of chainsForDraft(d)) {
    if (!health.chains[resolveDispatchChainId(chainId)]) return chainId
  }
  return null
}

const firstStaleChain = (drafts: IDraft[], health: IChainLiveness): number | null =>
  drafts.reduce<number | null>((found, d) => found ?? staleChainFor(d, health), null)

const severitySig = (h: IChainLiveness): string =>
  h.reachable ? Object.keys(h.chains).sort().join('|') : 'unreachable'

type StepOutcome = ISettledTx | 'signed'
type Step = {
  key: string
  draft: IDraft
  shapes: IStepShape[]
  query: Promise<IAttestation[]>
  walletTx: Map<StepKind, Promise<StepOutcome | null>>
}
interface Submission {
  steps: Step[]
  account: Promise<Address | null>
  returning: boolean
}

type SubmitEnv = {
  wallet: IConnectedWallet
  drafts: IDraft[]
  root: IRootState | null
  rootQuery: Promise<IRootState | null>
  keys: IWalletKeys | null
}

type SubmissionStatus = { kind: 'pending' } | { kind: 'error'; message: string } | { kind: 'done' }

export const $ActionDrawer = ({
  draftList,
  walletPair,
  walletRoot: rootState,
  ownStateQuery,
  title = 'Pending Actions'
}: I$ActionDrawer) =>
  component(
    (
      [clickSubmit, clickSubmitTether]: IBehavior<PointerEvent>,
      [clickCloseRaw, clickCloseTether]: IBehavior<PointerEvent>,
      [clickOnboard, clickOnboardTether]: IBehavior<PointerEvent>
    ) => {
      const tokenRegistryValue = op(promiseState(just(context.getTokenRegistry())), state())

      const inFlightRef = { current: false }
      const escapeRequest = subject<unknown>()
      const clickClose: IStream<unknown> = multicast(
        op(
          merge(clickCloseRaw, escapeRequest.stream),
          filter(
            () =>
              !inFlightRef.current ||
              window.confirm('Close drawer and abandon in-flight transactions? On-chain state may still settle.')
          )
        )
      )

      const submitEnv: IStream<SubmitEnv | null> = op(
        combine({ pair: walletPair, drafts: draftList, root: rootState }),
        map((p): SubmitEnv | null =>
          p.pair.wallet
            ? { wallet: p.pair.wallet, drafts: p.drafts, root: p.root, rootQuery: p.pair.root, keys: p.pair.keys }
            : null
        ),
        state(null)
      )

      const rootFactory = (env: SubmitEnv, loaded: (root: IRootState) => void): (() => Promise<IRootState>) => {
        let cached: Promise<IRootState> | null = null
        return (): Promise<IRootState> => {
          cached ??= (async (): Promise<IRootState> => {
            const account = predictUserAccount(env.wallet.address)
            const built = await journal(account, env.wallet.address).root(env.wallet.address)
            if (built === null) throw new Error(`the state of ${account} could not be read`)
            loaded(built)
            return built
          })()
          return cached
        }
      }

      const submitEvent: IStream<Submission> = op(
        merge(constant('click' as const, clickSubmit), constant('proceed' as const, clickOnboard)),
        sampleMap((env, trigger) => ({ env, trigger }), submitEnv),
        filter(p => p.env !== null),
        map(p => p.env),
        filterNull,
        map((env): Submission => {
          const prep = Promise.all([context.getChainLiveness(), context.getTokenRegistry()]).then(
            ([chainLiveness, tokenRegistry]) => ({ chainLiveness, tokenRegistry })
          )
          const account = predictUserAccount(env.wallet.address)
          const restore = restoreFundOf(env.root, env.wallet, env.keys)
          const shapesList = planShapes(env.drafts, account, {
            granted: env.keys !== null && env.keys.grantedChains(env.wallet.address).length > 0,
            restoreKey: restore !== null
          })
          const legs = env.drafts.map((draft, i) => {
            const shapes = shapesList[i]!
            const settle = new Map<StepKind, (outcome: StepOutcome | null) => void>()
            const walletTx = new Map(
              shapes.map(shape => [shape.kind, new Promise<StepOutcome | null>(resolve => settle.set(shape.kind, resolve))] as const)
            )
            return { draft, shapes, settle, walletTx }
          })
          let created!: (account: Address | null) => void
          const derived = new Promise<Address | null>(resolve => {
            created = resolve
          })
          const loadRoot = rootFactory(env, root => created(root.account))
          const steps: Step[] = []
          let chain: Promise<unknown> = env.keys === null
            ? prep
            : prep.then(async ctx => {
                await env.keys!.grantSession(env.wallet, HUB_CHAIN_ID)
                legs[0]?.settle.get('session')?.('signed')
                if (restore !== null && legs[0]?.shapes.some(shape => shape.kind === 'key')) {
                  await env.keys!.restoreFund(env.wallet, restore)
                  legs[0].settle.get('key')?.('signed')
                }
                return ctx
              })
          const mandateDrafts = legs.flatMap(leg => (leg.draft.kind === 'mandate' ? [leg.draft] : []))
          let mandateQuery: Promise<IAttestation[]> | null = null
          for (const leg of legs) {
            const draft = leg.draft
            const close = (): void => {
              for (const settle of leg.settle.values()) settle(null)
            }
            let query: Promise<IAttestation[]>
            if (draft.kind === 'mandate') {
              mandateQuery ??= chain.then<IAttestation[]>(async () => {
                const [ctx, root] = await Promise.all([prep, env.rootQuery])
                return [await runMandateBatch(mandateDrafts, { ...ctx, wallet: env.wallet, root, loadRoot, keys: env.keys })]
              })
              query = mandateQuery
            } else {
              const report: IReportWalletTx = (kind, landed) => leg.settle.get(kind)?.(landed === null ? 'signed' : landed)
              query = chain.then<IAttestation[]>(async () => {
                const [ctx, root] = await Promise.all([prep, env.rootQuery])
                return runDraft(draft, { ...ctx, wallet: env.wallet, root, loadRoot, keys: env.keys }, report)
              })
            }
            query.then(close, close)
            chain = query
            steps.push({ key: draft.id, draft, shapes: leg.shapes, query, walletTx: leg.walletTx })
          }
          Promise.allSettled(steps.map(st => st.query)).then(() => created(null))
          return { steps, account: derived, returning: env.root !== null }
        })
      )

      const submission: IStream<Submission | null> = op(
        merge(submitEvent, constant(null, clickClose) as IStream<Submission | null>),
        switchMap((s): IStream<Submission | null> => {
          if (s === null) return just(null)
          const submitted = new Map(s.steps.map(st => [st.key, st.draft]))
          const resetOnNextDraft: IStream<Submission | null> = op(
            fromPromise(Promise.all(s.steps.map(st => st.query)).then(() => true, () => false)),
            filter(ok => ok),
            switchMap(() =>
              op(
                draftList,
                filter(list => list.some(d => submitted.get(d.id) !== d)),
                take(1),
                constant(null as Submission | null)
              )
            )
          )
          return merge(just(s), resetOnNextDraft)
        }),
        state(null)
      )

      const chainLivenessValue: IStream<IChainLiveness> = op(
        merge(draftList, submission),
        switchMap(() => fromPromise(context.getChainLiveness())),
        skipRepeatsWith((a, b) => severitySig(a) === severitySig(b)),
        multicast
      )

      const isOpen: IStream<boolean> = op(
        combine({ list: draftList, sub: submission }),
        map(p => p.list.length > 0 || p.sub !== null),
        skipRepeats
      )

      type DraftResolve = { key: string; events: IAttestation[] }
      const draftSuccess: IStream<DraftResolve> = multicast(
        op(
          submission,
          switchMap((s): IStream<DraftResolve | null> => {
            if (!s) return empty
            return merge(
              ...s.steps.map(step =>
                fromPromise(
                  step.query.then(
                    events => ({ key: step.key, events }) as DraftResolve,
                    () => null
                  )
                )
              )
            )
          }),
          filterNull
        )
      )

      const releaseDraft: IStream<string> = map(ev => ev.key, draftSuccess)
      const settled: IStream<ISettledTx> = merge(
        op(
          draftSuccess,
          map(ev => ev.events.map((e): ISettledTx => ({ chainId: e.request.chainId, block: e.settledBlock, txHash: e.result.txHash }))),
          spreadArray
        ),
        op(
          submission,
          switchMap((s): IStream<StepOutcome | null> => {
            const landing = s === null ? [] : s.steps.flatMap(st => [...st.walletTx].flatMap(([kind, tx]) => (kind === 'fund' ? [fromPromise(tx)] : [])))
            return landing.length === 0 ? empty : merge(...landing)
          }),
          filter((o): o is ISettledTx => o !== null && o !== 'signed')
        )
      )

      const anyInFlight: IStream<boolean> = op(
        submission,
        map(s => Promise.allSettled(s ? s.steps.map(st => st.query) : [])),
        promiseState,
        map(st => {
          const inFlight = st.status === PromiseStatus.PENDING
          inFlightRef.current = inFlight
          return inFlight
        }),
        skipRepeats
      )

      const submissionStatus: IStream<SubmissionStatus | null> = op(
        switchMap(sub => {
          if (!sub || sub.steps.length === 0) return just(null)
          return combineMap(
            (...states) => {
              for (const s of states) {
                if (s.status === PromiseStatus.ERROR) {
                  return { kind: 'error' as const, message: formatThrownError(s.error) }
                }
              }
              for (const s of states) {
                if (s.status === PromiseStatus.PENDING) return { kind: 'pending' as const }
              }
              return { kind: 'done' as const }
            },
            ...sub.steps.map(s => promiseState(just(s.query)))
          )
        }, submission),
        state(null)
      )

      const submissionErrored: IStream<boolean> = op(
        submissionStatus,
        map(s => s?.kind === 'error'),
        skipRepeats,
        state(false)
      )

      const feeTokenOf = (d: IDraft): Address =>
        d.kind === 'deposit'
          ? d.deposit.inputToken
          : d.kind === 'withdraw'
            ? d.inputAmount.token
            : d.kind === 'operate'
              ? d.feeToken
              : d.kind === 'fundSwap'
                ? d.inputToken
                : d.kind === 'sell' || d.kind === 'redeem' || d.kind === 'allocate'
                  ? bondTokenOf(HUB_CHAIN_ID)
                  : chainTokenOfKey(HUB_CHAIN_ID, VALUE_KEY)
      const feeChainOf = (d: IDraft): ChainId =>
        d.kind === 'deposit'
          ? d.deposit.chainId
          : d.kind === 'operate' || d.kind === 'withdraw' || d.kind === 'fundSwap'
            ? d.chainId
            : HUB_CHAIN_ID
      const feeCoordOf = (d: IDraft): string => `${feeChainOf(d)}:${feeTokenOf(d)}`
      const escrowCoordOf = (d: IDraft): { chainId: ChainId; token: Address } | null =>
        d.kind === 'deposit' && d.toEscrow && d.deposit.route !== null
          ? { chainId: resolveDispatchChainId(Number(d.deposit.destinationChainId)), token: d.deposit.outputToken }
          : null
      const followUpCoordOf = (d: IDraft, next: IFollowUp): string =>
        `${next.chainId}:${chainTokenOfKey(next.chainId, tokenKeyOf(feeChainOf(d), feeTokenOf(d)))}`
      const relayCallOf = (
        d: IDraft,
        list: readonly IDraft[]
      ): {
        kind: IActionKind
        label: string
        genesisChain: ChainId | null
        units: bigint
        innerGasLimit: bigint
        calldataBytes: bigint
        creditChainId: ChainId | null
      } | null =>
        d.kind === 'deposit'
          ? d.deposit.route === null
            ? null
            : {
                kind: 'depositAcross',
                label: d.deposit.chainId === resolveDispatchChainId(Number(d.deposit.destinationChainId)) ? 'Swap' : 'Crosschain',
                genesisChain: null,
                units: 0n,
                innerGasLimit: 0n,
                calldataBytes: routeCalldataBytes(d.deposit.route),
                creditChainId: null
              }
          : d.kind === 'allocate'
              ? {
                  kind: 'allocate',
                  label: 'Fund a round',
                  genesisChain: HUB_CHAIN_ID,
                  units: d.backers,
                  innerGasLimit: 0n,
                  calldataBytes: 0n,
                  creditChainId: d.contribution > 0n ? d.escrowChainId : null
                }
              : d.kind === 'withdraw'
                ? { kind: 'withdraw', label: 'Withdraw', genesisChain: null, units: 0n, innerGasLimit: 0n, calldataBytes: 0n, creditChainId: null }
                : d.kind === 'operate'
                  ? {
                      kind: 'operate',
                      label: 'Operate',
                      genesisChain: null,
                      units: 0n,
                      innerGasLimit: declaredCallGas(d.callList),
                      calldataBytes: dynamicCalldataBytes(d.callList.map(c => c.callData)),
                      creditChainId: null
                    }
                  : d.kind === 'fundSwap'
                    ? {
                        kind: 'depositAcross',
                        label: d.chainId === d.destinationChainId ? 'Swap' : 'Crosschain',
                        genesisChain: null,
                        units: 0n,
                        innerGasLimit: 0n,
                        calldataBytes: routeCalldataBytes(d.route),
                        creditChainId: null
                      }
                    : d.kind === 'sell'
                      ? { kind: 'sell', label: 'Sell', genesisChain: null, units: 0n, innerGasLimit: 0n, calldataBytes: 0n, creditChainId: null }
                      : d.kind === 'redeem'
                        ? { kind: 'redeem', label: 'Redeem', genesisChain: HUB_CHAIN_ID, units: 0n, innerGasLimit: 0n, calldataBytes: 0n, creditChainId: null }
                        : {
                            kind: 'mandate',
                            label: 'Mandate',
                            genesisChain: HUB_CHAIN_ID,
                            units: BigInt(list.filter(x => x.kind === 'mandate').length),
                            innerGasLimit: 0n,
                            calldataBytes: 0n,
                            creditChainId: null
                          }

      const underfunded: IStream<string | null> = op(
        draftList,
        map(list => {
          const dep = list.find((d): d is Extract<IDraft, { kind: 'deposit' }> => d.kind === 'deposit')
          if (dep === undefined) return null
          const token = getAddress(dep.deposit.inputToken)
          const min = minFundedAmount(dep.deposit.chainId, token)
          return dep.deposit.inputAmount < min ? readableTokenAmountLabel(getTokenDescription(dep.deposit.chainId, token), min) : null
        }),
        skipRepeats,
        state(null)
      )

      const depositMissing: IStream<boolean> = op(
        draftList,
        map(list => !list.some(d => d.kind === 'deposit')),
        skipRepeats,
        state(true)
      )

      const deployedChains: IStream<ReadonlySet<ChainId>> = op(
        rootState,
        map(r => (r === null ? new Set<ChainId>() : r.deployed)),
        state(new Set<ChainId>())
      )

      type IFeeRate = { gasPrice: bigint; tokenPerNativeToken: bigint }
      const feeByToken: IStream<Map<string, PromiseSettledResult<IFeeRate>>> = op(
        switchMap((list: IDraft[]) => {
          const coords = [
            ...new Set(
              list.flatMap(d => {
                const call = relayCallOf(d, list)
                const next = call === null ? null : followUpOf(call.kind, call.creditChainId)
                return [
                  feeCoordOf(d),
                  ...(next === null ? [] : [followUpCoordOf(d, next)]),
                  ...(d.kind === 'deposit' && d.deposit.route !== null
                    ? [`${resolveDispatchChainId(Number(d.deposit.destinationChainId))}:${d.deposit.outputToken}`]
                    : [])
                ]
              })
            )
          ]
          if (coords.length === 0) return just(new Map<string, PromiseSettledResult<IFeeRate>>())
          return fromPromise(
            Promise.allSettled(
              coords.map(coord => {
                const [chainId, token] = coord.split(':')
                const id = resolveDispatchChainId(Number(chainId))
                return Promise.all([
                  context.getChainGasPrice(id, DISPLAY_QUOTE_TTL_MS),
                  context.getTokenPerNativeToken(id, token as Address, DISPLAY_QUOTE_TTL_MS)
                ]).then(([gasPrice, tokenPerNativeToken]): IFeeRate => ({ gasPrice, tokenPerNativeToken }))
              })
            ).then(results => new Map<string, PromiseSettledResult<IFeeRate>>(coords.map((coord, i) => [coord, results[i]!])))
          )
        }, draftList),
        state(new Map<string, PromiseSettledResult<IFeeRate>>())
      )

      const derivedAccount: IStream<Address> = op(
        submission,
        filterNull,
        switchMap(s => fromPromise(s.account)),
        filterNull,
        skipRepeats,
        multicast
      )
      const keyless: IStream<boolean> = op(
        combine({ root: rootState, pair: walletPair, derived: start(null, derivedAccount) }),
        map(p => p.pair.wallet !== null && p.root === null),
        skipRepeats,
        state(false)
      )
      const rootPending: IStream<boolean> = op(
        rootQuery(walletPair),
        map(s => s.status === PromiseStatus.PENDING),
        skipRepeats
      )
      const submitDisabled = op(
        combine({
          keyless,
          list: draftList,
          submission,
          errored: submissionErrored,
          chainLiveness: chainLivenessValue,
          root: rootState,
          rootPending,
          underfunded,
          depositMissing
        }),
        map(p => {
          if (p.submission !== null && !p.errored) return true
          if (p.list.length === 0) return true
          if (p.rootPending) return true
          if (!p.chainLiveness.reachable) return true
          if (firstStaleChain(p.list, p.chainLiveness) !== null) return true
          if (p.root === null && p.depositMissing) return true
          if (p.keyless) return p.root === null && p.underfunded !== null
          return p.root === null
        })
      )

      const fundOpened: IStream<PromiseState<boolean>> = op(
        combine({ own: ownStateQuery, root: rootState }),
        map(async p => {
          const own = await p.own
          const fund = p.root === null ? null : p.root.fund
          return fund !== null && own !== null && own.fundRows.some(row => isAddressEqual(row.master, fund.account))
        }),
        promiseState,
        state<PromiseState<boolean>>({ status: PromiseStatus.PENDING })
      )

      type IFeeLeg = { chainList: ChainId[]; label: string; note: string | null; usd: bigint | null }
      type FeeBreakdown = {
        relayList: IFeeLeg[]
        swapList: IFeeLeg[]
        feeFailure: PromiseRejectedResult | null
      }

      const feeBreakdown: IStream<FeeBreakdown> = switchMap((list: IDraft[]) => {
        const priceCoordinates = [
          ...new Map(
            list
              .flatMap((d): { chainId: ChainId; token: Address }[] => {
                const coords = [{ chainId: feeChainOf(d), token: feeTokenOf(d) }]
                if (d.kind === 'deposit' && d.deposit.route !== null) {
                  coords.push({ chainId: resolveDispatchChainId(Number(d.deposit.destinationChainId)), token: d.deposit.outputToken })
                } else if (d.kind === 'withdraw') {
                  if (d.output.approx) {
                    coords.push({ chainId: d.output.chainId, token: d.output.token })
                  }
                } else if (d.kind === 'fundSwap') {
                  coords.push({ chainId: d.destinationChainId, token: d.outputToken })
                }
                return coords
              })
              .map(c => [`${c.chainId}:${c.token}`, c] as const)
          ).values()
        ]

        return combineMap(
          (
            feeMapByToken: Map<string, PromiseSettledResult<IFeeRate>>,
            deployed: ReadonlySet<ChainId>,
            opened: PromiseState<boolean>,
            ...prices: (bigint | null)[]
          ): FeeBreakdown => {
            const priceByCoordinate = new Map<string, bigint | null>(
              priceCoordinates.map((c, i) => [`${c.chainId}:${c.token}`, prices[i] ?? null])
            )
            const toUsd = (chainId: ChainId, token: Address, amount: bigint | null): bigint | null => {
              const price = priceByCoordinate.get(`${chainId}:${token}`)
              return amount === null || price === undefined || price === null ? null : amount * price
            }
            const relayList: IFeeLeg[] = []
            const swapList: IFeeLeg[] = []
            let feeFailure: PromiseRejectedResult | null = null
            for (const d of list) {
              if (d.kind === 'mandate' && list.findIndex(x => x.kind === 'mandate') !== list.indexOf(d)) continue
              const call = relayCallOf(d, list)
              if (call === null) continue
              const next = followUpOf(call.kind, call.creditChainId)
              const escrowCoord = escrowCoordOf(d)
              const settled = feeMapByToken.get(feeCoordOf(d))
              const settledNext = next === null ? undefined : feeMapByToken.get(followUpCoordOf(d, next))
              const settledEscrow = escrowCoord === null ? undefined : feeMapByToken.get(`${escrowCoord.chainId}:${escrowCoord.token}`)
              const rejected = [settled, settledNext, settledEscrow].find((r): r is PromiseRejectedResult => r?.status === 'rejected')
              if (rejected !== undefined) {
                feeFailure = rejected
                continue
              }
              if (d.kind === 'allocate' && opened.status === PromiseStatus.ERROR) {
                feeFailure = { status: 'rejected', reason: opened.error }
                continue
              }
              const stepFee =
                settled === undefined || settled.status === 'rejected' || (d.kind === 'allocate' && opened.status !== PromiseStatus.DONE)
                  ? null
                  : computeRelayFee(
                      feeChainOf(d),
                      d.kind === 'allocate' && opened.status === PromiseStatus.DONE && !opened.value ? 'createFund' : call.kind,
                      call.genesisChain !== null && !deployed.has(call.genesisChain),
                      settled.value.gasPrice,
                      settled.value.tokenPerNativeToken,
                      call.units,
                      call.innerGasLimit,
                      call.calldataBytes
                    )
              const stepUsd = toUsd(feeChainOf(d), feeTokenOf(d), stepFee)
              const backers = d.kind === 'allocate' ? d.backers : 0n
              const backersOnly = d.kind === 'allocate' && d.contribution === 0n
              relayList.push({
                chainList: [feeChainOf(d)],
                label: call.label,
                note:
                  backers === 0n
                    ? null
                    : backersOnly
                      ? `paid by the ${countLabel(Number(backers), 'backer', 'backers')}, split evenly`
                      : `your part, split evenly with ${countLabel(Number(backers), 'backer', 'backers')}`,
                usd: stepUsd === null ? null : backersOnly ? 0n : stepUsd / (backers + 1n)
              })
              if (next !== null) {
                const followUpUsd = toUsd(
                  feeChainOf(d),
                  feeTokenOf(d),
                  settledNext === undefined || settledNext.status === 'rejected'
                    ? null
                    : computeRelayFee(next.chainId, next.kind, false, settledNext.value.gasPrice, settledNext.value.tokenPerNativeToken, 0n, 0n, 0n)
                )
                relayList.push({
                  chainList: [next.chainId],
                  label: next.kind === 'fulfil' ? 'Fulfil' : 'Claim',
                  note: 'follows by itself',
                  usd: followUpUsd === null ? null : followUpUsd / (backers + 1n)
                })
              }
              if (escrowCoord !== null) {
                relayList.push({
                  chainList: [escrowCoord.chainId],
                  label: 'Escrow',
                  note: null,
                  usd: toUsd(
                    escrowCoord.chainId,
                    escrowCoord.token,
                    settledEscrow === undefined || settledEscrow.status === 'rejected'
                      ? null
                      : computeRelayFee(
                          escrowCoord.chainId,
                          'escrow',
                          !deployed.has(escrowCoord.chainId) && escrowCoord.chainId !== feeChainOf(d),
                          settledEscrow.value.gasPrice,
                          settledEscrow.value.tokenPerNativeToken,
                          0n,
                          0n,
                          0n
                        )
                  )
                })
              }
              const conversion =
                d.kind === 'deposit' && d.deposit.route !== null
                  ? {
                      chainList: [d.deposit.chainId, resolveDispatchChainId(Number(d.deposit.destinationChainId))],
                      sent: toUsd(d.deposit.chainId, d.deposit.inputToken, d.deposit.routeInput),
                      received: toUsd(resolveDispatchChainId(Number(d.deposit.destinationChainId)), d.deposit.outputToken, d.expectedOutput)
                    }
                  : d.kind === 'fundSwap'
                    ? {
                        chainList: [d.chainId, d.destinationChainId],
                        sent: toUsd(d.chainId, d.inputToken, stepFee === null ? null : d.inputAmount - stepFee),
                        received: toUsd(d.destinationChainId, d.outputToken, d.expectedOutput)
                      }
                    : d.kind === 'withdraw' && d.output.approx
                      ? {
                          chainList: [d.chainId, d.output.chainId],
                          sent: toUsd(d.chainId, d.inputAmount.token, stepFee === null ? null : d.inputAmount.amount - stepFee),
                          received: toUsd(d.output.chainId, d.output.token, d.output.expected)
                        }
                      : null
              if (conversion === null) continue
              swapList.push({
                chainList: [...new Set(conversion.chainList)],
                label: call.label,
                note: null,
                usd: conversion.sent === null || conversion.received === null ? null : conversion.sent - conversion.received
              })
            }
            return { relayList, swapList, feeFailure }
          },
          feeByToken,
          deployedChains,
          fundOpened,
          ...priceCoordinates.map(c => priceFor(c.chainId, c.token))
        )
      }, draftList)

      const $feeCaption = $node(style({ color: palette.foreground, whiteSpace: 'normal' }))
      const $feeLegs = (legList: readonly IFeeLeg[]): I$Node[] =>
        legList.map(leg =>
          $row(spacing.default, style({ alignItems: 'flex-start', justifyContent: 'space-between' }))(
            $column(style({ gap: '2px', minWidth: '0' }))(
              $row(spacing.tiny, style({ alignItems: 'center' }))(...leg.chainList.map(id => $chainIcon(id, 14)), $text(leg.label)),
              ...(leg.note === null ? [] : [$feeCaption(style({ fontSize: text.xs }))($text(leg.note))])
            ),
            $node(style({ color: leg.usd === null || leg.usd === 0n ? palette.message : leg.usd > 0n ? palette.negative : palette.positive }))(
              $text(leg.usd === null ? '-' : leg.usd < 0n ? `+${formatUsd(-leg.usd, 1n)}` : formatUsd(leg.usd, 1n))
            )
          )
        )

      const $executionFeesBreakdown = (): I$Node =>
        switchMap(p => {
          const $breakdown = $column(spacing.small, style({ minWidth: '240px', fontSize: text.sm }))
          if (p.feeFailure !== null) {
            return $breakdown(
              $feeCaption($text('Relay fee, paid from your funds (no gas)')),
              style({ whiteSpace: 'normal' })($errorLabel(p.feeFailure.reason))
            )
          }
          if (p.relayList.length + p.swapList.length === 0) {
            return $breakdown($feeCaption($text('Nothing here is relayed or swapped, so the only cost is the gas of your own wallet transactions.')))
          }
          return $breakdown(
            ...(p.relayList.length === 0
              ? []
              : [
                  $feeCaption($text('Relay fee, paid from your funds (no gas)')),
                  ...$feeLegs(p.relayList),
                  $feeCaption(style({ fontSize: text.xs }))(
                    $text(`Each step is sent for you and repays the gas of its chain plus ${readablePercentage(FEE_MARGIN_BPS)}.`)
                  )
                ]),
            ...(p.swapList.length === 0
              ? []
              : [
                  $feeCaption($text('Swap fee, paid to the route provider')),
                  ...$feeLegs(p.swapList),
                  $feeCaption(style({ fontSize: text.xs }))($text('What you send minus what arrives, at current prices.'))
                ])
          )
        }, feeBreakdown)

      const $executionFees = (): I$Node =>
        $labeledValue(
          'Net fee',
          switchMap((p): I$Slottable => {
            if (p.feeFailure !== null) return style({ whiteSpace: 'normal' })($errorLabel(p.feeFailure.reason))
            const legList = [...p.relayList, ...p.swapList]
            const total = legList.reduce<bigint | null>((sum, leg) => (sum === null || leg.usd === null ? null : sum + leg.usd), 0n)
            return $text(total === null || legList.length === 0 ? '-' : formatUsd(total, 1n))
          }, feeBreakdown),
          $executionFeesBreakdown()
        )

      const $metaText = (label: string): I$Node =>
        $node(style({ color: palette.foreground, fontSize: text.xs }))($text(label))

      type StepStatus = 'queued' | 'current' | 'done' | 'failed'
      const $trailingGlyph = (status: StepStatus): I$Node => {
        if (status === 'done') {
          return $icon({ $content: $check, viewBox: '0 0 24 24', fill: palette.positive, size: '12px' })
        }
        if (status === 'failed') {
          return $icon({ $content: $xCross, viewBox: '0 0 32 32', fill: palette.negative, size: '12px' })
        }
        return $icon({ $content: $info, viewBox: '0 0 32 32', fill: palette.foreground, size: '12px' })
      }
      const $stepPill = (
        wallet: boolean,
        status: StepStatus,
        tx: ISettledTx | null,
        destination: { chainId: ChainId; address: Address | null } | null,
        label: string,
        description: string,
        origin?: { chainId: ChainId; symbol: string }
      ): I$Node => {
        const $labelText = $node(style({ color: palette.foreground, fontSize: text.xs }))
        const [verb, ...symbolRest] = label.split(' ')
        const content: I$Node[] = destination
          ? [
              wallet
                ? $row(spacing.tiny, style({ alignItems: 'center' }))(
                    $icon({ $content: $wallet, viewBox: '0 0 32 32', fill: palette.foreground, size: '14px' }),
                    $labelText($text(verb))
                  )
                : $labelText($text(verb)),
              $row(spacing.tiny, style({ alignItems: 'center' }))(
                ...(origin === undefined
                  ? []
                  : [
                      ...(origin.chainId === destination.chainId ? [] : [$chainIcon(origin.chainId, 14)]),
                      $labelText($text(origin.symbol)),
                      $labelText($text('→'))
                    ]),
                $chainIcon(destination.chainId, 14),
                ...(symbolRest.length > 0 ? [$labelText($text(symbolRest.join(' ')))] : [])
              ),
              $trailingGlyph(status)
            ]
          : [
              wallet
                ? $row(spacing.tiny, style({ alignItems: 'center' }))(
                    $icon({ $content: $wallet, viewBox: '0 0 32 32', fill: palette.foreground, size: '14px' }),
                    $labelText($text(label))
                  )
                : $labelText($text(label)),
              $trailingGlyph(status)
            ]
        const pillBg = style({ backgroundColor: palette.background, cursor: 'help' })
        const $pillNode =
          status === 'done'
            ? pillBg($alertPositiveContainer(...content))
            : status === 'failed'
              ? pillBg($alertNegativeContainer(...content))
              : status === 'current'
                ? pillBg($alertIntermediateSpinnerContainer(...content))
                : $row(
                  spacing.small,
                  style({
                    alignItems: 'center',
                    padding: '8px 12px',
                    borderRadius: '100px',
                    border: '1px dashed transparent',
                    backgroundColor: colorShade(palette.background, 25),
                    fontSize: text.xs,
                    cursor: 'help'
                  })
                )(...content)
        const destinationChain = destination ? chainFor(destination.chainId) : null
        const txChain = tx ? chainFor(tx.chainId) : null
        return $Tooltip({
          $dropContainer: $defaultTooltipDropContainer,
          $content: $column(spacing.tiny, style({ maxWidth: '260px', fontSize: text.sm, whiteSpace: 'normal' }))(
            $text(description),
            destination && destinationChain && destination.address !== null
              ? $row(spacing.tiny, style({ alignItems: 'center', color: palette.foreground, fontSize: text.xs }))(
                $text('To'),
                $chainIcon(destination.chainId, 14),
                $anchor(attr({ href: getAccountExplorerUrl(destination.address, destinationChain), target: '_blank' }))(
                  $text(readableAddress(destination.address))
                )
              )
              : $node(),
            tx && txChain
              ? $row(spacing.tiny, style({ alignItems: 'center', color: palette.foreground, fontSize: text.xs }))(
                $text('Tx'),
                $chainIcon(tx.chainId, 14),
                $anchor(attr({ href: getTxExplorerUrl(tx.txHash, txChain), target: '_blank' }))(
                  $text(readableHash(tx.txHash))
                )
              )
              : $node()
          ),
          $anchor: $pillNode
        })({})
      }

      type PillState = { status: StepStatus; tx: ISettledTx | null }
      type Row = {
        draft: IDraft
        shapes: readonly IStepShape[]
        query: Promise<unknown> | null
        priorQuery: Promise<unknown> | null
        walletTx: Map<StepKind, Promise<StepOutcome | null>>
      }

      const progressOf = (row: Row): IStream<PillState[]> => {
        if (row.query === null) return just(row.shapes.map((): PillState => ({ status: 'queued', tx: null })))
        const legs = row.shapes.map(shape => {
          const leg = row.walletTx.get(shape.kind)
          return leg === undefined ? just(null as StepOutcome | null) : op(fromPromise(leg), start(null as StepOutcome | null))
        })
        const active: IStream<boolean> =
          row.priorQuery === null
            ? just(true)
            : op(
              promiseState(just(row.priorQuery)),
              map(s => s.status === PromiseStatus.DONE),
              skipRepeats
            )
        return op(
          combineMap(
            (qs, active: boolean, ...outcomes: (StepOutcome | null)[]): PillState[] => {
              const done = (j: number): boolean => outcomes[j] !== null || outcomes.slice(j + 1).some(o => o !== null)
              return outcomes.map((outcome, i): PillState => {
                if (row.shapes[i]!.scheduled === true) return { status: 'queued', tx: null }
                if (qs.status === PromiseStatus.DONE || done(i)) return { status: 'done', tx: outcome === null || outcome === 'signed' ? null : outcome }
                const priorAllDone = outcomes.slice(0, i).every((_o, j) => done(j))
                if (!active || !priorAllDone) return { status: 'queued', tx: null }
                return { status: qs.status === PromiseStatus.ERROR ? 'failed' : 'current', tx: null }
              })
            },
            promiseState(just(row.query)),
            active,
            ...legs
          ),
          state()
        )
      }

      const $pill = (shape: IStepShape, progress: IStream<PillState[]>, i: number): I$Node =>
        switchMap(p => {
          const pill = p[i]!
          return $stepPill(shape.wallet === true, pill.status, pill.tx, shape.destination, shape.label, shape.description, shape.origin)
        }, progress)

      const $withdrawDesc = (draft: IWithdrawDraft, registry: ITokenRegistryMap): I$Node => {
        const desc = getTokenDescription(draft.output.chainId, isAddressEqual(draft.output.token, PROTOCOL.nativeToken) ? draft.output.token : tokenInfoFor(registry, draft.output.chainId, draft.output.token).token)
        const approx = draft.output.approx ? '≈ ' : ''
        const amountText = `${approx}${readableTokenAmountLabel(desc, draft.output.amount)}`
        const tooltip = 'Delivered to your wallet; the relay fee is deducted from the withdrawn amount.'
        return $row(spacing.small, style({ alignItems: 'center' }))(
          $node(attr({ title: tooltip }))($text(amountText)),
          $row(spacing.small, style({ alignItems: 'center', color: palette.foreground, fontSize: text.xs }))(
            $text('to'),
            $jazzicon(draft.output.receiver, 18),
            $anchor(
              attr({
                href: getAccountExplorerUrl(draft.output.receiver, chainFor(draft.output.chainId)),
                target: '_blank'
              })
            )($text(readableAddress(draft.output.receiver))),
            $text('on'),
            $chainIcon(draft.output.chainId, 14),
            $text(chainName(draft.output.chainId))
          )
        )
      }

      const $mandateDesc = (draft: IMandateDraft, registry: ITokenRegistryMap): I$Node => {
        const mandate = draft.mandate
        const percent = (value: bigint): string => readablePercentage(value).replace(/\.0+%$/, '%')
        const $rule = (value: string, label: string): I$Node => $row(spacing.tiny, style({ alignItems: 'baseline' }))($text(value), $metaText(label))
        if (mandate.expiry === 0n) {
          return $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap' }))(
            $text(readableAddress(mandate.master)),
            $metaText('·'),
            $text('stop backing this trader')
          )
        }
        return $row(spacing.small, style({ alignItems: 'baseline', flexWrap: 'wrap' }))(
          $text(readableAddress(mandate.master)),
          $metaText('·'),
          $rule(percent(mandate.allocationRate), 'share'),
          $metaText('·'),
          $rule(percent(mandate.skin), 'skin'),
          $metaText('·'),
          $rule(getDuration(Number(mandate.cooldownPeriod)), 'cooldown'),
          $metaText('·'),
          $rule(readableDate(Number(mandate.expiry)), 'until')
        )
      }

      const $draftDescription = (draft: IDraft, registry: ITokenRegistryMap): I$Node => {
        if (draft.kind === 'mandate') return $mandateDesc(draft, registry)
        if (draft.kind === 'deposit') return empty
        if (draft.kind === 'withdraw') return $withdrawDesc(draft, registry)
        return empty
      }

      const $plan = (rows: readonly Row[], registry: ITokenRegistryMap, returning: boolean): I$Node => {
        const tracked = rows.map(row => ({ ...row, progress: progressOf(row) }))
        const walletPills = tracked
          .flatMap(row => row.shapes.flatMap((shape, i) => (shape.wallet === true ? [{ shape, i, progress: row.progress }] : [])))
        const relayRows = tracked.flatMap(row => {
          const pills = row.shapes.flatMap((shape, i) => (shape.wallet === true ? [] : [{ shape, i }]))
          return pills.length === 0 ? [] : [{ row, pills }]
        })
        const signs = walletPills.some(p => SIGNATURE_STEPS.has(p.shape.kind))
        const ask = walletAsk(walletPills.map(p => p.shape))
        return $column(spacing.default)(
          ...(walletPills.length === 0
            ? []
            : [
                $column(spacing.small)(
                  $column(spacing.tiny, style({ minWidth: 0 }))(
                    $node(style({ fontSize: text.base, color: palette.message }))(
                      $text(signs ? (returning ? 'Derive your account on this device' : 'Set up your account') : 'From your wallet')
                    ),
                    $node(style({ fontSize: text.xs, color: palette.foreground, lineHeight: '1.4' }))(
                      $text(
                        signs
                          ? `${returning ? 'The same wallet signature derives the same account.' : 'One account per wallet, derived from the one you connected.'} ${ask}`
                          : ask
                      )
                    )
                  ),
                  $row(spacing.tiny, style({ alignItems: 'center', flexWrap: 'wrap' }))(
                    ...walletPills.map(p => $pill(p.shape, p.progress, p.i))
                  )
                )
              ]),
          ...(walletPills.length > 0 && relayRows.length > 0
            ? [$labeledDivider($node(style({ fontSize: text.xs, whiteSpace: 'nowrap' }))($text('Rest is relayed for you')))]
            : []),
          ...(relayRows.length === 0
            ? []
            : [
                $column(spacing.small)(
                  ...relayRows.map(x => {
                    const $description = $draftDescription(x.row.draft, registry)
                    return $column(spacing.tiny)(
                      $row(spacing.tiny, style({ alignItems: 'center', flexWrap: 'wrap' }))(
                        ...x.pills.map(p => $pill(p.shape, x.row.progress, p.i))
                      ),
                      ...($description === empty ? [] : [$node(style({ fontSize: text.xs, color: palette.foreground, lineHeight: '1.4' }))($description)])
                    )
                  })
                )
              ])
        )
      }

      const drawerTitleId = 'action-drawer-title'

      const focusTrap = (root: unknown): Disposable | void => {
        if (!(root instanceof HTMLElement)) return
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const focusables = (): HTMLElement[] =>
          Array.from(
            root.querySelectorAll<HTMLElement>(
              'a[href], button, textarea, input, select, [tabindex]:not([tabindex="-1"])'
            )
          ).filter(el => !el.hasAttribute('disabled') && el.tabIndex !== -1 && el.offsetParent !== null)
        const first = focusables()[0]
          ; (first ?? root).focus()
        const onKeyDown = (ev: KeyboardEvent): void => {
          if (ev.key === 'Escape') {
            ev.preventDefault()
            escapeRequest.push(ev)
            return
          }
          if (ev.key !== 'Tab') return
          const items = focusables()
          if (items.length === 0) {
            ev.preventDefault()
            root.focus()
            return
          }
          const head = items[0]
          const tail = items[items.length - 1]
          const active = document.activeElement
          if (ev.shiftKey && (active === head || !root.contains(active))) {
            ev.preventDefault()
            tail.focus()
          } else if (!ev.shiftKey && active === tail) {
            ev.preventDefault()
            head.focus()
          }
        }
        root.addEventListener('keydown', onKeyDown)
        return {
          [Symbol.dispose]() {
            root.removeEventListener('keydown', onKeyDown)
            previouslyFocused?.focus()
          }
        }
      }

      const $drawerContent = $card2(
        style({
          border: `1px solid ${colorShade(palette.foreground, 40)}`,
          padding: '12px 0',
          borderBottom: 'none',
          borderRadius: '20px 20px 0 0'
        }),
        attr({ role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': drawerTitleId, tabindex: '-1' }),
        effectRun(focusTrap)
      )(
        $column(spacing.default)(
          $row(spacing.small, style({ alignItems: 'center', padding: '0 24px' }))(
            $heading3(attr({ id: drawerTitleId }))($text(title)),
            $node(style({ flex: 1 }))(),
            $ButtonCircular({
              $iconPath: $xCross,
              $container: $defaultButtonCircularContainer(attr({ 'aria-label': 'Close' }))
            })({ click: clickCloseTether() })
          ),

          $column(
            designSheet.customScroll,
            style({ overflow: 'auto', maxHeight: '35vh', padding: '0 24px' })
          )(
            switchMap(
              sub =>
                sub === null
                  ? switchMap(
                      p => {
                        if (p.registry.status === PromiseStatus.PENDING) return $inlineSpinner
                        if (p.registry.status === PromiseStatus.ERROR) return $errorLabel(p.registry.error)
                        if (p.drafts.length === 0) return empty
                        const wallet = p.pair.wallet
                        const account = wallet === null ? null : predictUserAccount(wallet.address)
                        const granted = wallet !== null && p.pair.keys !== null && p.pair.keys.grantedChains(wallet.address).length > 0
                        const shapesList = planShapes(p.drafts, account, {
                          granted,
                          restoreKey: wallet !== null && restoreFundOf(p.root, wallet, p.pair.keys) !== null
                        })
                        const rows = p.drafts.map(
                          (draft, i): Row => ({ draft, shapes: shapesList[i]!, query: null, priorQuery: null, walletTx: new Map() })
                        )
                        return $plan(rows, p.registry.value, p.root !== null)
                      },
                      combine({ drafts: draftList, registry: tokenRegistryValue, pair: walletPair, root: rootState })
                    )
                  : switchMap(registry => {
                      if (registry.status === PromiseStatus.PENDING) return $inlineSpinner
                      if (registry.status === PromiseStatus.ERROR) return $errorLabel(registry.error)
                      let prior: Promise<unknown> | null = null
                      const rows = sub.steps.map((st): Row => {
                        const row: Row = { ...st, priorQuery: prior }
                        prior = st.query
                        return row
                      })
                      return $plan(rows, registry.value, sub.returning)
                    }, tokenRegistryValue),
              submission
            )
          ),

          (() => {
            const $noticeLine = (full: string, tone: 'positive' | 'negative'): I$Node => {
              const color = tone === 'positive' ? palette.positive : palette.negative
              const weight = tone === 'positive' ? '600' : '500'
              const base = isMobileScreen
                ? { color, fontSize: text.xs, fontWeight: weight, minWidth: '0', whiteSpace: 'normal' as const }
                : {
                    display: 'block',
                    color,
                    fontSize: text.xs,
                    fontWeight: weight,
                    whiteSpace: 'nowrap' as const,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    minWidth: '0'
                  }
              return $node(style(base))($text(full))
            }

            const footerNotice: IStream<{ text: string; tone: 'positive' | 'negative'; deposit?: true } | null> = op(
              map(
                p => {
                  if (p.status?.kind === 'done') return { text: 'Done', tone: 'positive' as const }
                  if (p.status?.kind === 'error') return { text: p.status.message, tone: 'negative' as const }
                  if (p.status?.kind === 'pending') return null
                  if (p.root === null && p.depositMissing)
                    return { text: 'Setting up your account needs a deposit', tone: 'negative' as const, deposit: true as const }
                  if (p.keyless && p.root === null && p.underfunded !== null)
                    return { text: `Deposit at least ${p.underfunded} to set up your account`, tone: 'negative' as const }
                  if (!p.chainLiveness.reachable)
                    return { text: 'Service unreachable, cannot submit', tone: 'negative' as const }
                  const staleChain = firstStaleChain(p.list, p.chainLiveness)
                  if (staleChain !== null)
                    return { text: `${chainName(staleChain)} out of sync, cannot submit yet`, tone: 'negative' as const }
                  return null
                },
                combine({
                  list: draftList,
                  status: submissionStatus,
                  chainLiveness: chainLivenessValue,
                  keyless,
                  underfunded,
                  depositMissing,
                  root: rootState
                })
              ),
              skipRepeatsWith((a, b) => a?.text === b?.text && a?.tone === b?.tone && a?.deposit === b?.deposit)
            )

            const $feesContent = (): I$Node =>
              isMobileScreen
                ? $column(spacing.small, style({ fontSize: text.sm, minWidth: 0, whiteSpace: 'normal' }))(
                  $executionFees(),
                  $executionFeesBreakdown()
                )
                : $column(spacing.small, style({ fontSize: text.sm, whiteSpace: 'nowrap', alignItems: 'flex-end' }))($executionFees())
            const $fees = switchMap(
              notice =>
                notice === null
                  ? $feesContent()
                  : notice.deposit
                    ? $row(spacing.small, style({ alignItems: 'center' }))(
                        $noticeLine(notice.text, notice.tone),
                        $Link({
                          route: routeSchema.portfolio,
                          $anchor: $defaultAnchor(style({ fontSize: text.sm, textDecoration: 'underline', whiteSpace: 'nowrap' })),
                          $content: $text('Deposit')
                        })({})
                      )
                    : $noticeLine(notice.text, notice.tone),
              footerNotice
            )

            const agreementOpens = op(
              sampleMap((k: boolean, _click: PointerEvent) => k, keyless, clickSubmit),
              filter(k => k)
            )
            const $submitButton = $Popover({
              $container: $node(style({ display: 'flex', flexShrink: '0', ...(isMobileScreen ? { width: '100%' } : {}) })),
              $open: constant(
                $column(spacing.default, style({ maxWidth: '320px' }))(
                  $node(style({ fontSize: text.base, color: palette.message }))($text('Before you begin')),
                  $betaAgreement(),
                  $ButtonSecondary({
                    $container: $defaultButtonSecondary(style({ alignSelf: 'flex-end', minHeight: '40px' })),
                    $content: $text('Proceed')
                  })({ click: clickOnboardTether() })
                ),
                agreementOpens
              ),
              $target: $Button({
                $container: isMobileScreen
                  ? $defaultButtonPrimary(style({ width: '100%', minHeight: '44px' }))
                  : $defaultButtonPrimary,
                disabled: submitDisabled,
                $content: $text('Submit')
              })({ click: clickSubmitTether() }),
              dismiss: clickOnboard
            })({})

            return isMobileScreen
              ? $column(spacing.small, style({ padding: '0 24px', minWidth: 0 }))($fees, $submitButton)
              : $row(spacing.small, style({ padding: '0 24px', alignItems: 'center', minWidth: 0 }))(
                $node(style({ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'flex-end' }))($fees),
                $submitButton
              )
          })()
        )
      )

      return [
        $node(style({ display: 'contents' }))(
          switchMap(open => (open ? fadeIn($drawerContent) : empty), isOpen),
          filter((_): _ is never => false, anyInFlight)
        ),
        {
          clearDrafts: constant(null, clickClose),
          settled,
          releaseDraft
        }
      ]
    }
  )
