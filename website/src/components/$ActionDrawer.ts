import { HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import { predictDepositRoute } from '@puppet/sdk/account'
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
import { routeCalldataBytes } from '@puppet/sdk/intent'
import { minFundedAmount } from '@puppet/sdk/mpc'
import { bondTokenOf, chainTokenOfKey, declaredCallGas, dynamicCalldataBytes, type IChainLiveness, type IRelayFeeQuote, type ITokenRegistryMap, listedTokenAddresses, tokenInfoFor } from '@puppet/sdk/state'
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
import { type IBehavior, multicast, PromiseStatus, promiseState, spreadArray, state } from 'aelea/stream-extended'
import { $node, $text, attr, component, effectRun, type I$Node, type I$Slottable, style, } from 'aelea/ui'
import { $Button, $column, $Popover, $row, designSheet, isMobileScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
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
import { $jazzicon } from '../common/$avatar.js'
import { $chainIcon, chainName } from '../common/$chain.js'
import { chainFor } from '../common/$contract.js'
import { $heading3 } from '../common/$text.js'
import { $card2, } from '../common/elements/$common.js'
import context, { DISPLAY_QUOTE_TTL_MS } from '../io/context.js'
import { journal } from '../io/journal/journal.js'
import { formatUsd, priceFor } from '../io/price.js'
import { subject } from '../utils/subject.js'
import { type IBodyKeys, type IConnectedWallet, type IRootState, type IWalletPair, rootQuery } from '../wallet/index.js'
import { accountDisplayName } from './$AccountProfile.js'
import { $betaAgreement } from './$enableSession.js'
import type { IDraft, IMandateDraft, IReportWalletTx, ITradeDraft, IUnbondDraft, IWithdrawDraft, StepKind } from './portfolio/draft.js'
import { type IStepShape, planShape } from './portfolio/runner/plan.js'
import { type IAttestation, runDraft, runMandateBatch } from './portfolio/runner/steps.js'

export type { IDraft }

const SIGNATURE_STEPS: ReadonlySet<StepKind> = new Set<StepKind>(['key', 'session'])

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

const STEP_LABEL: Record<StepKind, string> = {
  approve: 'Approve',
  fund: 'Fund',
  key: 'Sign account key',
  session: 'Create session',
  deposit: 'Deposit',
  swap: 'Swap',
  credit: 'Credit',
  withdraw: 'Withdraw',
  mandate: 'Mandate',
  unbond: 'Unbond',
  operate: 'Operate',
  settle: 'Settle'
}

const STEP_DESCRIPTION: Record<StepKind, string> = {
  approve: 'Lets Puppet move this token from your wallet into your account.',
  fund: 'Sends the amount to your deposit route so the relayer can spend it for you. The route address is fixed by your wallet.',
  key: 'Derives your account key from your wallet and stores it in this browser. The signature never leaves this device, and each wallet derives a different account.',
  session: 'Authorises a signer to act for this wallet, for 7 days. One chainless signature, reused on every chain.',
  deposit: 'Moves funds from your wallet straight into your account in one transaction of your own.',
  swap: 'Converts or bridges funds from your deposit route; the output lands back on the route and is swept into your account under the same signature.',
  credit:
    'Sweeps a token that arrived on your deposit route into your account on that chain, recording it as an inflow of your own capital.',
  withdraw: 'Moves funds from your account to your wallet.',
  mandate:
    'Signs the backing rules you set with your account key and broadcasts them once on the hub, together with any bond you are adding. A mandate is chainless: it binds wherever the master operates. The latest broadcast per master wins, and leaving is the same broadcast with an expiry of zero.',
  unbond:
    'Releases bond that is not backing an open cycle back into your account on the hub. Bond behind a running cycle stays locked until that cycle settles.',
  operate:
    'Runs a cycle action on your trading account: opening a cycle locks the credited capital and the matched backers; a trade within a cycle executes against the venue from the trading account. The attestor co-signs the marks it can verify.',
  settle:
    'Closes the cycle in two dispatches: on the trading chain the attestor values the book at flat and pays every backer that gained out of what the account holds there, taking your fee; then on the hub every backer that lost is drawn from the hub tokens their mandate put at risk. Positions must be closed first.'
}

interface I$ActionDrawer {
  draftList: IStream<IDraft[]>
  walletPair: IStream<IWalletPair>
  walletRoot: IStream<IRootState | null>
  title?: string
}

const chainsForDraft = (d: IDraft): number[] => {
  const chains = new Set<number>([HUB_CHAIN_ID])
  if (d.kind === 'deposit') chains.add(d.deposit.chainId)
  if (d.kind === 'credit' || d.kind === 'operate') chains.add(d.chainId)
  if (d.kind === 'withdraw') chains.add(d.chainId)
  if (d.kind === 'settle') chains.add(d.spokeChainId)
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

type ResolvedHash = { txHash: string; chainId: ChainId }
type StepOutcome = ResolvedHash | 'signed'
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
  bodyKeys: IBodyKeys | null
}

type SubmissionStatus = { kind: 'pending' } | { kind: 'error'; message: string } | { kind: 'done' }

export const $ActionDrawer = ({
  draftList,
  walletPair,
  walletRoot: rootState,
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
          p.pair.wallet ? { wallet: p.pair.wallet, drafts: p.drafts, root: p.root, rootQuery: p.pair.root, bodyKeys: p.pair.bodyKeys } : null
        ),
        state(null)
      )

      const accountFactory = (
        env: SubmitEnv,
        signed: (step: 'key' | 'session') => void,
        created: (root: IRootState) => void
      ): (() => Promise<IRootState>) => {
        let cached: Promise<IRootState> | null = null
        return (): Promise<IRootState> => {
          cached ??= (async (): Promise<IRootState> => {
            if (env.bodyKeys === null) throw new Error('this build carries no body key service; an account cannot be created')
            const known = env.bodyKeys.accountOf(env.wallet.address)
            const funding = env.drafts.flatMap(d => (d.kind === 'deposit' ? [d.deposit] : []))[0]
            const funded =
              funding === undefined
                ? undefined
                : {
                    chainId: funding.chainId,
                    token: isAddressEqual(funding.inputToken, PROTOCOL.nativeToken) ? funding.inputToken : tokenInfoFor(await context.getTokenRegistry(), funding.chainId, funding.inputToken).token
                  }
            const account = known ?? (await env.bodyKeys.derive(env.wallet, funded, signed)).account
            const built = await journal(account).root(env.wallet.address)
            if (built === null) throw new Error(`derived ${account} but its account state could not be read`)
            created(built)
            return built
          })()
          return cached
        }
      }

      const submitEvent: IStream<Submission> = op(
        merge(constant('click' as const, clickSubmit), constant('proceed' as const, clickOnboard)),
        sampleMap((env, trigger) => ({ env, trigger }), submitEnv),
        filter(p => p.env !== null && (p.trigger === 'proceed' || (p.env.bodyKeys !== null && p.env.bodyKeys.accountOf(p.env.wallet.address) !== null))),
        map(p => p.env),
        filterNull,
        map((env): Submission => {
          const prep = Promise.all([context.getChainLiveness(), context.getTokenRegistry()]).then(
            ([chainLiveness, tokenRegistry]) => ({ chainLiveness, tokenRegistry })
          )
          const account = env.bodyKeys === null ? null : env.bodyKeys.accountOf(env.wallet.address)
          const route = predictDepositRoute(env.wallet.address)
          const deployed = env.root === null ? new Set<ChainId>() : env.root.deployed
          const legs = env.drafts.map(draft => {
            const shapes = planShape(draft, account, route, deployed)
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
          const createAccount = accountFactory(
            env,
            step => {
              for (const leg of legs) leg.settle.get(step)?.('signed')
            },
            root => created(root.account)
          )
          const steps: Step[] = []
          let chain: Promise<unknown> = prep
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
                return [await runMandateBatch(mandateDrafts, { ...ctx, wallet: env.wallet, root, createAccount, bodyKeys: env.bodyKeys }, 'balance')]
              })
              query = mandateQuery
            } else {
              const report: IReportWalletTx = (kind, hash, chainId) => leg.settle.get(kind)?.(hash === null ? null : { txHash: hash, chainId })
              query = chain.then<IAttestation[]>(async () => {
                const [ctx, root] = await Promise.all([prep, env.rootQuery])
                return runDraft(draft, { ...ctx, wallet: env.wallet, root, createAccount, bodyKeys: env.bodyKeys }, report)
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
      const attest: IStream<IAttestation> = spreadArray(map(ev => ev.events, draftSuccess))

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
            : d.kind === 'credit'
              ? d.creditList[0]!
              : d.kind === 'operate'
                ? d.feeToken
                : chainTokenOfKey(HUB_CHAIN_ID, VALUE_KEY)
      const feeChainOf = (d: IDraft): ChainId =>
        d.kind === 'deposit' ? d.deposit.chainId : d.kind === 'credit' || d.kind === 'operate' || d.kind === 'withdraw' ? d.chainId : HUB_CHAIN_ID
      const feeCoordOf = (d: IDraft): string => `${feeChainOf(d)}:${feeTokenOf(d)}`

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

      const deployedChains: IStream<ReadonlySet<ChainId>> = op(
        rootState,
        map(r => (r === null ? new Set<ChainId>() : r.deployed)),
        state(new Set<ChainId>())
      )

      const feeByToken: IStream<Map<string, PromiseSettledResult<IRelayFeeQuote>>> = op(
        switchMap((list: IDraft[]) => {
          const coords = [...new Set(list.map(feeCoordOf))]
          if (coords.length === 0) return just(new Map<string, PromiseSettledResult<IRelayFeeQuote>>())
          return fromPromise(
            Promise.allSettled(
              coords.map(coord => {
                const [chainId, token] = coord.split(':')
                return context.getRelayFeeQuote(resolveDispatchChainId(Number(chainId)), token as Address, DISPLAY_QUOTE_TTL_MS)
              })
            ).then(results => new Map<string, PromiseSettledResult<IRelayFeeQuote>>(coords.map((coord, i) => [coord, results[i]!])))
          )
        }, draftList),
        state(new Map<string, PromiseSettledResult<IRelayFeeQuote>>())
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
        map(p => p.pair.wallet !== null && (p.pair.bodyKeys === null || p.pair.bodyKeys.accountOf(p.pair.wallet.address) === null)),
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
          underfunded
        }),
        map(p => {
          if (p.submission !== null && !p.errored) return true
          if (p.list.length === 0) return true
          if (p.rootPending) return true
          if (!p.chainLiveness.reachable) return true
          if (firstStaleChain(p.list, p.chainLiveness) !== null) return true
          if (p.keyless) return p.root === null && p.underfunded !== null
          return p.root === null
        })
      )

      type FeeBreakdown = {
        relayUsd: bigint
        swapFeeUsd: bigint
        feeUnavailable: boolean
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
                }
                return coords
              })
              .map(c => [`${c.chainId}:${c.token}`, c] as const)
          ).values()
        ]

        return combineMap(
          (
            feeMapByToken: Map<string, PromiseSettledResult<IRelayFeeQuote>>,
            deployed: ReadonlySet<ChainId>,
            ...prices: (bigint | null)[]
          ): FeeBreakdown => {
            const priceByCoordinate = new Map<string, bigint | null>(
              priceCoordinates.map((c, i) => [`${c.chainId}:${c.token}`, prices[i] ?? null])
            )
            const toUsd = (chainId: ChainId, token: Address, amount: bigint): bigint | null => {
              const price = priceByCoordinate.get(`${chainId}:${token}`)
              return price === undefined || price === null ? null : amount * price
            }
            let relayUsd = 0n
            let swapFeeUsd = 0n
            let feeUnavailable = false
            let feeFailure: PromiseRejectedResult | null = null
            for (const d of list) {
              const settled = feeMapByToken.get(feeCoordOf(d))
              if (settled === undefined) {
                feeUnavailable = true
                continue
              }
              if (settled.status === 'rejected') {
                feeFailure = settled
                continue
              }
              const feeMap = settled.value
              if (d.kind === 'mandate' && list.findIndex(x => x.kind === 'mandate') !== list.indexOf(d)) continue
              const relayToken =
                d.kind === 'deposit'
                  ? d.deposit.route === null
                    ? deployed.has(feeChainOf(d))
                      ? 0n
                      : feeMap('credit', true, 0n, 0n, 0n)
                    : feeMap('depositAcross', !deployed.has(feeChainOf(d)), 0n, 0n, routeCalldataBytes(d.deposit.route))
                  : d.kind === 'credit'
                    ? feeMap('credit', !deployed.has(feeChainOf(d)), 0n, 0n, 0n)
                    : d.kind === 'withdraw'
                      ? feeMap('withdraw', false, 0n, 0n, 0n)
                      : d.kind === 'operate'
                        ? feeMap('operate', false, 0n, declaredCallGas(d.callList), dynamicCalldataBytes(d.callList.map(c => c.callData)))
                        : d.kind === 'settle'
                          ? feeMap('settle', false, 0n, 0n, 0n)
                          : feeMap('mandate', !deployed.has(HUB_CHAIN_ID), BigInt(list.filter(x => x.kind === 'mandate').length), 0n, 0n)
              const charged = toUsd(feeChainOf(d), feeTokenOf(d), relayToken)
              if (charged === null) {
                feeUnavailable = true
                continue
              }
              relayUsd += charged
              const conversion =
                d.kind === 'deposit' && d.deposit.route !== null
                  ? {
                      sent: toUsd(d.deposit.chainId, d.deposit.inputToken, d.deposit.inputAmount),
                      received: toUsd(resolveDispatchChainId(Number(d.deposit.destinationChainId)), d.deposit.outputToken, d.expectedOutput)
                    }
                  : null
              if (conversion === null) continue
              if (conversion.sent === null || conversion.received === null) {
                feeUnavailable = true
                continue
              }
              const lost = conversion.sent - conversion.received - charged
              if (lost > 0n) swapFeeUsd += lost
            }
            return { relayUsd, swapFeeUsd, feeUnavailable, feeFailure }
          },
          feeByToken,
          deployedChains,
          ...priceCoordinates.map(c => priceFor(c.chainId, c.token))
        )
      }, draftList)

      const $executionFeesBreakdown = (): I$Node =>
        switchMap(p => {
          const rows: I$Node[] = []
          if (p.swapFeeUsd > 0n) rows.push($labeledValue('Swap fee', formatUsd(p.swapFeeUsd, 1n)))
          rows.push(
            $labeledValue('Relay fee, paid from your funds (no gas)', p.feeFailure !== null ? style({ whiteSpace: 'normal' })($errorLabel(p.feeFailure.reason)) : p.feeUnavailable || p.relayUsd === 0n ? '-' : formatUsd(p.relayUsd, 1n))
          )
          return $column(spacing.small, style({ minWidth: '200px', fontSize: text.sm }))(...rows)
        }, feeBreakdown)

      const $executionFees = (): I$Node =>
        $labeledValue(
          'Net fee',
          switchMap((p): I$Slottable => {
            if (p.feeFailure !== null) return style({ whiteSpace: 'normal' })($errorLabel(p.feeFailure.reason))
            if (p.feeUnavailable) return $text('-')
            const total = p.relayUsd + p.swapFeeUsd
            return $text(total === 0n ? '-' : formatUsd(total, 1n))
          }, feeBreakdown),
          $executionFeesBreakdown()
        )

      const $metaText = (label: string): I$Node =>
        $node(style({ color: palette.foreground, fontSize: text.xs }))($text(label))

      const branchLine = `1px solid ${colorShade(palette.foreground, 60)}`
      const $branch = (isLast: boolean, $content: I$Node): I$Node =>
        $row(style({ marginLeft: '10px', minWidth: '0' }))(
          $column(style({ width: '14px', flexShrink: '0', alignSelf: 'stretch' }))(
            $node(
              style({
                flex: '1 1 50%',
                borderLeft: branchLine,
                borderBottom: branchLine,
                borderBottomLeftRadius: '6px'
              })
            )(),
            $node(style({ flex: '1 1 50%', ...(isLast ? {} : { borderLeft: branchLine }) }))()
          ),
          $row(style({ flex: '1', minWidth: '0', alignItems: 'center', padding: '5px 0 5px 8px' }))($content)
        )
      const $branchList = ($children: I$Node[]): I$Node =>
        $column(style({ minWidth: '0', marginTop: '-14px' }))(
          $node(style({ height: '14px', marginLeft: '10px', borderLeft: branchLine }))(),
          ...$children.map(($c, i) => $branch(i === $children.length - 1, $c))
        )

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
        kind: StepKind,
        wallet: boolean,
        status: StepStatus,
        tx: ResolvedHash | null,
        destination: { chainId: ChainId; address: Address | null } | null,
        label: string,
        origin?: { chainId: ChainId; symbol: string },
        description?: string
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
            $text(description ?? STEP_DESCRIPTION[kind]),
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

      type PillState = { status: StepStatus; tx: ResolvedHash | null }
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
          return $stepPill(
            shape.kind,
            shape.wallet === true,
            pill.status,
            pill.tx,
            shape.destination,
            shape.label ?? STEP_LABEL[shape.kind],
            shape.origin,
            shape.description
          )
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
        const bondToken = getTokenDescription(HUB_CHAIN_ID, bondTokenOf(HUB_CHAIN_ID))
        if (mandate === null) {
          return $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap' }))(
            $text(`bond ${readableTokenAmountLabel(bondToken, draft.bond)}`),
            $metaText('·'),
            $text('moves into the bond pool on the hub, matchable by every trader you name')
          )
        }
        const symbols = listedTokenAddresses(registry, HUB_CHAIN_ID, mandate.tokenIdList)
          .map(t => getTokenDescription(HUB_CHAIN_ID, t).symbol)
          .join('/')
        return $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap' }))(
          $text(accountDisplayName(mandate.master)),
          $metaText('·'),
          mandate.expiry === 0n
            ? $text('stop backing this trader')
            : $text(
                `${readablePercentage(mandate.allocationRate)} of your matchable bond per match in ${symbols} · ≤ ${readablePercentage(mandate.skin)} of the trader's own · until ${readableDate(Number(mandate.expiry))}`
              ),
          ...(draft.bond > 0n ? [$metaText(`bond +${readableTokenAmountLabel(bondToken, draft.bond)}`)] : []),
          ...(mandate.expiry !== 0n && mandate.cooldownPeriod > 0n ? [$metaText(`cooldown ${getDuration(Number(mandate.cooldownPeriod))}`)] : [])
        )
      }

      const $unbondDesc = (draft: IUnbondDraft): I$Node =>
        $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap' }))(
          $text(`release ${readableTokenAmountLabel(getTokenDescription(HUB_CHAIN_ID, bondTokenOf(HUB_CHAIN_ID)), draft.amount)} of bond`)
        )

      const $tradeDesc = (draft: ITradeDraft): I$Node => {
        if (draft.kind === 'settle') {
          return $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap' }))(
            $text(`close the cycle on ${chainFor(draft.spokeChainId).name}, pay gains there and draw losses on the hub`)
          )
        }
        if (draft.kind === 'credit') {
          const symbols = draft.creditList.map(t => getTokenDescription(draft.chainId, t).symbol).join(', ')
          return $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap' }))(
            $text(`sweep the ${symbols} that arrived on your deposit route on ${chainFor(draft.chainId).name}`)
          )
        }
        return $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap' }))(
          $text(`${draft.callList.length} venue call${draft.callList.length === 1 ? '' : 's'} on ${chainFor(draft.chainId).name}`)
        )
      }

      const $draftDescription = (draft: IDraft, registry: ITokenRegistryMap): I$Node => {
        if (draft.kind === 'mandate') return $mandateDesc(draft, registry)
        if (draft.kind === 'unbond') return $unbondDesc(draft)
        if (draft.kind === 'credit' || draft.kind === 'operate' || draft.kind === 'settle') return $tradeDesc(draft)
        if (draft.kind === 'deposit') return empty
        return $withdrawDesc(draft, registry)
      }

      const $plan = (rows: readonly Row[], registry: ITokenRegistryMap, returning: boolean): I$Node => {
        const tracked = rows.map(row => ({ ...row, progress: progressOf(row) }))
        const walletPills = tracked.flatMap(row =>
          row.shapes.flatMap((shape, i) => (shape.wallet === true ? [{ shape, i, progress: row.progress }] : []))
        )
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
                      $text(signs ? (returning ? 'Restore your account on this device' : 'Set up your account') : 'From your wallet')
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
                  ...relayRows.map(x =>
                    $row(spacing.small, style({ alignItems: 'center', padding: '6px 0' }))(
                      $row(spacing.tiny, style({ alignItems: 'center', flexWrap: 'wrap' }))(
                        ...x.pills.map(p => $pill(p.shape, x.row.progress, p.i))
                      ),
                      $node(style({ flex: 1, minWidth: '16px' }))(),
                      $draftDescription(x.row.draft, registry)
                    )
                  )
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
                        const account = wallet === null || p.pair.bodyKeys === null ? null : p.pair.bodyKeys.accountOf(wallet.address)
                        const route = wallet === null ? null : predictDepositRoute(wallet.address)
                        const deployed = p.root === null ? new Set<ChainId>() : p.root.deployed
                        const rows = p.drafts.map(
                          (draft): Row => ({ draft, shapes: planShape(draft, account, route, deployed), query: null, priorQuery: null, walletTx: new Map() })
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

            const footerNotice: IStream<{ text: string; tone: 'positive' | 'negative' } | null> = op(
              map(
                p => {
                  if (p.status?.kind === 'done') return { text: 'Done', tone: 'positive' as const }
                  if (p.status?.kind === 'error') return { text: p.status.message, tone: 'negative' as const }
                  if (p.status?.kind === 'pending') return null
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
                  root: rootState
                })
              ),
              skipRepeatsWith((a, b) => a?.text === b?.text && a?.tone === b?.tone)
            )

            const $feesContent = (): I$Node =>
              isMobileScreen
                ? $column(spacing.small, style({ fontSize: text.sm, minWidth: 0, whiteSpace: 'normal' }))(
                  $executionFees(),
                  $executionFeesBreakdown()
                )
                : $node(style({ fontSize: text.sm, whiteSpace: 'nowrap' }))($executionFees())
            const $fees = switchMap(notice => (notice === null ? $feesContent() : $noticeLine(notice.text, notice.tone)), footerNotice)

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
          deriveAccount: derivedAccount,
          attest,
          releaseDraft
        }
      ]
    }
  )
