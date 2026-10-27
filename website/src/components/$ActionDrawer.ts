import { HUB_CANONICAL_TOKEN, HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import { SESSION_REVOKE_DELAY } from '@puppet/contracts/intents'
import { decodeAccountCall, fundSymbolOf, gridOf, predictUserAccount } from '@puppet/sdk/account'
import { awaitRedeemClosed, type IAttestation, type IDraft, type IFundIdentityDraft, type IMandateDraft, type IOperateDraft, type IOperateSwapDraft, type IReportWalletTx, type ISentTx, type IWithdrawDraft, runDraft, runMandateBatch, type StepKind, venueWithdrawOf } from '@puppet/sdk/client'
import { CompactContractError, formatThrownError } from '@puppet/sdk/compact'
import { type ChainId, resolveDispatchChainId } from '@puppet/sdk/const'
import { allocationRowsOf, isAllocationRecord } from '@puppet/sdk/fold'
import { getAccountExplorerUrl, getTokenDescription, getTxExplorerUrl, getUnixTimestamp, readableAddress, readableHash, readablePercentage, readableTokenAmountLabel } from '@puppet/sdk/core'
import { type IActionKind, revokedAtIn, routeCalldataBytes } from '@puppet/sdk/intent'
import { minFundedAmount } from '@puppet/sdk/mpc'
import { fundTable } from '@puppet/sdk/schema'
import { declaredCallGas, dynamicCalldataBytes, type IChainLiveness, type IFeeConvert, providerToken, redeemFeeOf, relayFeeOf, tokenMetaByChainToken, tokenMetaKey, wrappedNativeAddressOf, routeSubcallGas } from '@puppet/sdk/state'
import { robotCellsOf } from '@puppet/sdk/ui-components'
import { acrossBridgeCalls, describeOperate, NO_VENUE_FACTS, uniswapSwapCalls, VENUES, withAllowancePolicy } from '@puppet/sdk/venue'
import { combine, combineMap, constant, delay, empty, filter, filterNull, fromPromise, type IStream, just, map, merge, op, sampleMap, skipRepeats, skipRepeatsWith, start, switchLatest, switchMap, take, tap, toStream, wait } from 'aelea/stream'
import { type IBehavior, multicast, type PromiseState, type PromiseStateDone, type PromiseStateError, PromiseStatus, promiseState, spreadArray, state } from 'aelea/stream-extended'
import { $node, $text, attr, component, effectRun, fromEventTarget, type I$Node, type I$Slottable, style } from 'aelea/ui'
import { $Button, $column, $Popover, $row, designSheet, isMobileScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $defaultAnchor, href } from 'aelea/ui-router'
import { type Address, getAddress, isAddressEqual } from 'viem'
import { $alertIcon, $alertIntermediateContainer, $alertIntermediateSpinnerContainer, $alertNegativeContainer, $alertPositiveContainer, $anchor, $ButtonCircular, $ButtonSecondary, $check, $defaultButtonCircularContainer, $defaultButtonPrimary, $defaultButtonSecondary, $defaultTooltipDropContainer, $errorLabel, $externalMark, $icon, $info, $infoTooltip, $intermediateText, $labeledDivider, $labeledValue, $intermediateLine, $Tooltip, $wallet, $xCross, fadeIn, intermediateState, softNavClick, text } from '@/ui-components'
import { routeSchema } from '../app/routeSchema.js'
import { $jazzicon } from '../common/$avatar.js'
import { $chainIcon, chainName } from '../common/$chain.js'
import { chainFor } from '../common/$contract.js'
import { $fundAvatar } from '../common/$fundAvatar.js'
import { $heading3 } from '../common/$text.js'
import { uiStorage } from '@/ui-storage'
import { $card2 } from '../common/elements/$common.js'
import { operationSummary } from '../common/operation.js'
import { clientDeps } from '../io/clientDeps.js'
import context, { DISPLAY_QUOTE_TTL_MS } from '../io/context.js'
import { answerState, localFirstQuery } from '../io/datastore/reads.js'
import { journal } from '../io/journal/journal.js'
import type { IOwnState } from '@puppet/sdk/client'
import { formatUsd, freshPrice } from '../io/price.js'
import { balanceAt, type IConnectedWallet, type IRootState, type ISettledTx, type IWalletKeys, type IWalletPair } from '../wallet/index.js'
import { $betaAgreement } from './$enableSession.js'
import { $mandateTerms, mandateTermsOf } from './$MandatePosition.js'
import { type IStepShape, planShapes, restoredFundOf } from './portfolio/runner/plan.js'

export type { IDraft }

const SIGNATURE_STEPS: ReadonlySet<StepKind> = new Set<StepKind>(['key', 'session', 'genesis', 'credit'])

const countLabel = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

const walletAsk = (shapes: readonly { kind: StepKind }[], upFront: boolean): string => {
  const signs = shapes.filter(s => SIGNATURE_STEPS.has(s.kind)).length
  const sends = shapes.length - signs
  const parts = [
    ...(signs > 0 ? [countLabel(signs, 'signature', 'signatures')] : []),
    ...(sends > 0 ? [countLabel(sends, 'transaction', 'transactions')] : [])
  ]
  const cost =
    signs > 0 && sends > 0 ? 'Signatures are free; transactions cost gas.' : signs > 0 ? 'Signatures are free.' : 'Transactions cost gas.'
  return `${parts.join(' and ')}${upFront ? (signs + sends > 1 ? ', all up front' : ' up front') : ', some only once earlier steps land'}. ${cost}`
}

interface I$ActionDrawer {
  draftList: IStream<IDraft[]>
  walletPair: IStream<IWalletPair>
  ownStateQuery: IStream<Promise<IOwnState | null>>
  title?: string
}

const chainsForDraft = (d: IDraft): number[] => {
  if (d.kind === 'revoke' || d.kind === 'walletWithdraw' || d.kind === 'escrowReturn') return [d.chainId]
  const chains = new Set<number>([HUB_CHAIN_ID])
  if (d.kind === 'deposit') chains.add(d.deposit.chainId)
  if (d.kind === 'allocate') chains.add(d.escrowChainId)
  if (d.kind === 'operate' || d.kind === 'withdraw' || d.kind === 'operateSwap') chains.add(d.chainId)
  if (d.kind === 'operateSwap' && d.bridge !== null) chains.add(d.bridge.destinationChainId)
  if (d.kind === 'fundSwap') {
    chains.add(d.chainId)
    chains.add(d.destinationChainId)
  }
  return [...chains]
}

const operateCallsOf = (d: IOperateDraft | IOperateSwapDraft, fund: Address | null) => {
  if (d.kind === 'operate') return d.callList
  const swapCalls = uniswapSwapCalls(d.chainId, d.inputToken, d.inputAmount, { fee: d.poolFee, token: d.outputToken }, d.outputAmount)
  if (d.bridge === null) return swapCalls
  if (fund === null) throw new Error('a Valuable ERC-20 swap bridges from your fund, which has not loaded')
  return [...swapCalls, ...acrossBridgeCalls(d.chainId, fund, d.outputToken, d.bridge)]
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

type StepOutcome = ISettledTx | 'signed' | { missed: string }

const settledTxOf = (outcome: StepOutcome | null): ISettledTx | null => (outcome === null || outcome === 'signed' || 'missed' in outcome ? null : outcome)
type Step = {
  key: string
  draft: IDraft
  shapes: IStepShape[]
  query: Promise<IAttestation[]>
  walletTx: Map<StepKind, Promise<StepOutcome | null>>
  sentTx: Map<StepKind, ISentTx>
}
interface Submission {
  steps: Step[]
  plan: IStepShape[][]
  settlement: Promise<{ released: string[]; txs: readonly ISettledTx[] }>
  returning: boolean
  halt: AbortController
  started: Set<string>
}

type SubmitEnv = {
  wallet: IConnectedWallet
  drafts: IDraft[]
  root: IRootState | null
  keys: IWalletKeys | null
  split: ReadonlySet<ChainId>
}

type SubmissionStatus = { kind: 'pending' } | { kind: 'error'; message: string } | { kind: 'done' }

export const $ActionDrawer = ({
  draftList,
  walletPair,
  ownStateQuery,
  title = 'Pending Actions'
}: I$ActionDrawer) =>
  component(
    (
      [clickSubmit, clickSubmitTether]: IBehavior<PointerEvent>,
      [clickCloseRaw, clickCloseTether]: IBehavior<PointerEvent>,
      [clickReadTerms, clickReadTermsTether]: IBehavior<PointerEvent>,
      [clickAgree, clickAgreeTether]: IBehavior<PointerEvent>
    ) => {
      const rootStatus = op(walletPair, map(pair => pair.root), promiseState, state())
      const rootState: IStream<IRootState | null> = op(
        rootStatus,
        filter((root): root is PromiseStateDone<IRootState | null> => root.status === PromiseStatus.DONE),
        map(root => root.value),
        state()
      )
      const operatingFund: IStream<Address | null> = op(
        rootState,
        map(root => (root === null || root.fund === null || !('account' in root.fund) ? null : root.fund.account)),
        skipRepeats,
        state()
      )
      const rootFailure: IStream<string | null> = op(
        rootStatus,
        filter(root => root.status !== PromiseStatus.PENDING),
        map(root => (root.status === PromiseStatus.ERROR ? formatThrownError(root.error) : null)),
        skipRepeats,
        state()
      )
      const inFlightRef = { current: false }
      const lastSubmission: { current: Submission | null } = { current: null }
      const resolvedQueries = new WeakSet<Promise<IAttestation[]>>()
      const stepNameOf = (step: Step): string => {
        const shape = step.shapes[step.shapes.length - 1]
        return shape !== undefined && typeof shape.label === 'string' ? shape.label : step.draft.kind
      }
      const clickClose: IStream<Submission | null> = multicast(
        op(
          clickCloseRaw,
          map(() => lastSubmission.current),
          filter(sub => {
            if (!inFlightRef.current || sub === null) return true
            const waiting = sub.steps.filter(step => !sub.started.has(step.key))
            const sent = sub.steps.filter(step => sub.started.has(step.key)).map(stepNameOf)
            if (waiting.length === 0 || sub.halt.signal.aborted) {
              return window.confirm(`Every step already went out and will still settle (${sent.join(', ')}). Close anyway? The drawer stops showing how they end; your history still will.`)
            }
            const stop = window.confirm(
              `Stop ${waiting.map(stepNameOf).join(', ')} before ${waiting.length === 1 ? 'it starts' : 'they start'}?${sent.length === 0 ? '' : ` ${sent.join(', ')} already went out and will still settle here.`} Stopped drafts stay in the drawer to submit again.`
            )
            if (stop) sub.halt.abort(new Error('Stopped before it started; the draft stays in the drawer to submit again.'))
            return false
          })
        )
      )

      const splitChains: IStream<Set<ChainId>> = op(
        ownStateQuery,
        intermediateState,
        filter((own): own is PromiseStateDone<IOwnState | null> => own.status === PromiseStatus.DONE),
        map(own => {
          const held = own.value
          if (held === null) return new Set<ChainId>()
          const rows = held.accounts.filter(row => isAddressEqual(row.account, held.account))
          const hub = rows.find(row => Number(row.chainId) === HUB_CHAIN_ID)
          return new Set<ChainId>(hub === undefined ? [] : rows.filter(row => row.epoch !== hub.epoch).map(row => Number(row.chainId) as ChainId))
        }),
        start(new Set<ChainId>()),
        state()
      )
      const submitEnv: IStream<SubmitEnv | null> = op(
        combine({ pair: walletPair, drafts: draftList, root: rootState, split: splitChains }),
        map((p): SubmitEnv | null =>
          p.pair.wallet
            ? { wallet: p.pair.wallet, drafts: p.drafts, root: p.root, keys: p.pair.keys, split: p.split }
            : null
        ),
        state(null)
      )

      const rootFactory = (env: SubmitEnv): (() => Promise<IRootState>) => {
        let cached: Promise<IRootState> | null = null
        return (): Promise<IRootState> => (cached ??= journal(predictUserAccount(env.wallet.address)).root(env.wallet.address, 'all'))
      }

      const submitEvent: IStream<Submission> = op(
        clickSubmit,
        sampleMap(env => env, submitEnv),
        filter((env): env is SubmitEnv => env !== null && env.root !== null),
        map((env): Submission => {
          const before = lastSubmission.current
          const sameList = before !== null && before.steps.length === env.drafts.length && before.steps.every((step, i) => step.draft === env.drafts[i])
          const restore = restoredFundOf(env.root, env.wallet, env.keys, env.drafts)
          const plan = sameList ? before.plan : planShapes(env.keys, env.wallet, env.root, env.drafts, env.split)
          const legs = env.drafts.map((draft, i) => {
            const shapes = plan[i]!
            const earlier = before === null ? null : (before.steps.find(step => step.key === draft.id && step.draft === draft) ?? null)
            const settle = new Map<StepKind, (outcome: StepOutcome | null) => void>()
            const walletTx = new Map(
              shapes.map(shape => {
                const fresh = new Promise<StepOutcome | null>(resolve => settle.set(shape.kind, resolve))
                const carried = earlier === null ? undefined : earlier.walletTx.get(shape.kind)
                return [shape.kind, carried === undefined ? fresh : carried.then(outcome => (outcome === null ? fresh : outcome))] as const
              })
            )
            return { draft, shapes, settle, walletTx, earlier, sentTx: new Map(earlier === null ? [] : earlier.sentTx) }
          })
          const loadRoot = rootFactory(env)
          const halt = new AbortController()
          const started = new Set<string>()
          const steps: Step[] = []
          const keyBefore = legs[0]?.earlier?.walletTx.get('key')
          const settleKey = (outcome: StepOutcome | null): void => legs[0]?.settle.get('key')?.(outcome)
          const restoreKey = async (): Promise<void> => {
            if (restore === null || (keyBefore !== undefined && (await keyBefore) !== null)) return
            try {
              halt.signal.throwIfAborted()
              await env.keys!.restoreFund(env.wallet, restore)
              settleKey('signed')
            } catch (error) {
              settleKey(null)
              throw error
            }
          }
          const commits = legs[0]?.shapes.some(shape => shape.kind === 'fund' && shape.wallet === true) === true
          const keyAfterFirst = commits && env.keys !== null && restore !== null
          const signsSession = legs[0]?.shapes.some(shape => shape.kind === 'session') === true
          const sessionBefore = legs[0]?.earlier?.walletTx.get('session')
          let chain: Promise<unknown> = env.keys === null
            ? Promise.resolve()
            : (async () => {
                if (signsSession && (sessionBefore === undefined || (await sessionBefore) === null)) {
                  await env.keys!.grantSession(env.wallet, HUB_CHAIN_ID)
                  legs[0]?.settle.get('session')?.('signed')
                }
                if (!commits) await restoreKey()
              })()
          const reused = new Set(legs.filter(leg => leg.earlier !== null && resolvedQueries.has(leg.earlier.query)))
          const mandateDrafts = legs.flatMap(leg => (leg.draft.kind === 'mandate' && !reused.has(leg) ? [leg.draft] : []))
          let mandateQuery: Promise<IAttestation[]> | null = null
          const ran: Promise<IAttestation[]>[] = []
          for (const leg of legs) {
            const keyLater = keyAfterFirst && leg === legs[0]
            if (leg.earlier !== null && reused.has(leg)) {
              const keyTx = leg.walletTx.get('key')
              started.add(leg.draft.id)
              steps.push(
                keyLater && keyTx !== undefined
                  ? { ...leg.earlier, walletTx: new Map([...leg.earlier.walletTx].map(([kind, tx]) => [kind, kind === 'key' ? keyTx : tx] as const)) }
                  : leg.earlier
              )
              chain = keyLater ? leg.earlier.query.then(restoreKey) : leg.earlier.query
              ran.push(leg.earlier.query)
              continue
            }
            const draft = leg.draft
            const scheduled = leg.shapes.filter(shape => shape.scheduled === true).map(shape => shape.kind)
            const close = (): void => {
              for (const [kind, settle] of leg.settle) if (!scheduled.includes(kind) && !(keyLater && kind === 'key')) settle(null)
            }
            let query: Promise<IAttestation[]>
            if (draft.kind === 'mandate') {
              mandateQuery ??= chain.then<IAttestation[]>(async () => {
                halt.signal.throwIfAborted()
                for (const mandate of mandateDrafts) started.add(mandate.id)
                const root = await loadRoot()
                return [await runMandateBatch(mandateDrafts, { ...clientDeps, wallet: env.wallet, root, loadRoot, keys: env.keys })]
              })
              query = mandateQuery
            } else {
              const report: IReportWalletTx = (kind, landed) => {
                if (landed !== null && 'sent' in landed) {
                  leg.sentTx.set(kind, landed.sent)
                  return
                }
                leg.sentTx.delete(kind)
                leg.settle.get(kind)?.(landed === null ? 'signed' : landed)
              }
              const fundBefore = leg.earlier === null ? undefined : leg.earlier.walletTx.get('fund')
              const upstream = [...ran]
              const feeder = draft.kind === 'operate' && draft.sweepInto !== null ? legs.slice(0, upstream.length).findIndex(each => each.draft.id === `${draft.sweepInto}:deposit:swap`) : -1
              query = chain.then<IAttestation[]>(async () => {
                halt.signal.throwIfAborted()
                started.add(draft.id)
                const [root, funded, prior] = await Promise.all([loadRoot(), fundBefore === undefined ? null : fundBefore, Promise.all(upstream)])
                const settled = settledTxOf(funded)
                const kept = leg.sentTx.get('fund')
                return runDraft(
                  draft,
                  { ...clientDeps, wallet: env.wallet, root, loadRoot, keys: env.keys },
                  settled !== null ? settled : kept === undefined ? null : { sent: kept },
                  feeder === -1 ? [] : prior[feeder]!,
                  report
                )
              })
            }
            ran.push(query)
            const settled = query
            settled.then(
              () => {
                resolvedQueries.add(settled)
                close()
              },
              () => {
                close()
                if (keyLater) settleKey(null)
              }
            )
            if (draft.kind === 'redeem' && scheduled.includes('redeemCohort')) {
              const settleCohorts = (outcome: StepOutcome | null): void => leg.settle.get('redeemCohort')?.(outcome)
              query.then(
                list => {
                  const opened = list.find(a => a.request.kind === 'redeem')
                  if (opened === undefined) return settleCohorts(null)
                  awaitRedeemClosed(clientDeps, getAddress(opened.request.intent.header.account), opened.settledBlock).then(settleCohorts, (error: unknown) => settleCohorts({ missed: formatThrownError(error) }))
                },
                () => settleCohorts(null)
              )
            }
            chain = keyLater ? query.then(restoreKey) : query
            const shapes =
              draft.kind === 'fundSwap'
                ? leg.shapes.map(shape => {
                    if (shape.kind !== 'fundSwap' || typeof shape.label !== 'string') return shape
                    const exact = draft.chainId !== draft.destinationChainId || shape.label.startsWith('Wrap') || shape.label.startsWith('Unwrap')
                    if (!exact) return shape
                    const verb = shape.label.split(' ')[0]!
                    const outToken = getTokenDescription(draft.destinationChainId, draft.outputToken)
                    const delivered = query.then(
                      list => {
                        const swap = list.find(a => a.request.kind === 'fundSwap')
                        return swap === undefined || swap.request.kind !== 'fundSwap' ? null : `${verb} ${readableTokenAmountLabel(outToken, swap.request.intent.swap.outputAmount)}`
                      },
                      () => null
                    )
                    return { ...shape, label: state(shape.label, op(fromPromise(delivered), filterNull)) }
                  })
                : draft.kind !== 'allocate'
                ? leg.shapes
                : leg.shapes.map(shape => {
                    if (shape.kind !== 'allocate' || typeof shape.label !== 'string') return shape
                    const realized = query.then(async list => {
                      for (const { request, result, digest } of list) {
                        if (request.kind !== 'allocate' && request.kind !== 'createFund') continue
                        const entries = (await journal(result.account).entries()).get(request.chainId) ?? []
                        const at = entries.findIndex(e => e.digest === digest)
                        const entry = entries[at]
                        if (entry === undefined) return null
                        const credit = request.intent.credit
                        let prior = 0n
                        for (const earlier of entries.slice(0, at).reverse()) {
                          const record = decodeAccountCall(earlier)
                          if ('ownerSignature' in record && record.credit.chainId === credit.chainId && isAddressEqual(record.credit.token, credit.token)) {
                            prior = record.credit.total
                            break
                          }
                        }
                        return allocationRowsOf(entry, result.account)
                          .map(row => row.record)
                          .filter(isAllocationRecord)
                          .reduce((total, record) => total + record.amount, credit.total === 0n ? 0n : credit.total - prior)
                      }
                      return null
                    }, () => null)
                    const desc = getTokenDescription(draft.escrowChainId, draft.escrowToken)
                    return { ...shape, label: state(shape.label, op(fromPromise(realized), filterNull, map(amount => `Allocate ${readableTokenAmountLabel(desc, amount)}`))) }
                  })
            steps.push({ key: draft.id, draft, shapes, query, walletTx: leg.walletTx, sentTx: leg.sentTx })
          }
          const settlement = Promise.all(
            steps.map(async step => {
              const events = await step.query.then(
                list => list,
                () => null
              )
              const legs = await Promise.all([...step.walletTx].flatMap(([kind, tx]) => (kind === 'fund' || kind === 'fulfil' || kind === 'escrowReturn' || kind === 'revoke' || kind === 'walletWithdraw' ? [tx] : [])))
              return {
                key: events === null ? null : step.key,
                txs: [
                  ...(events === null ? [] : events.map((e): ISettledTx => ({ chainId: e.request.chainId, account: e.result.account, block: e.settledBlock, txHash: e.result.txHash }))),
                  ...legs.flatMap(outcome => {
                    const tx = settledTxOf(outcome)
                    return tx === null ? [] : [tx]
                  })
                ]
              }
            })
          ).then(list => ({ released: list.flatMap(item => (item.key === null ? [] : [item.key])), txs: list.flatMap(item => item.txs) }))
          return { steps, plan, settlement, returning: env.root !== null, halt, started }
        })
      )

      const submission: IStream<Submission | null> = op(
        merge(submitEvent, constant(null, clickClose) as IStream<Submission | null>),
        switchMap((s): IStream<Submission | null> => {
          if (s === null) return just(null)
          const submitted = new Map(s.steps.map(st => [st.key, st.draft]))
          const resetOnNextDraft: IStream<Submission | null> = op(
            fromPromise(s.settlement),
            filter(done => done.released.length === s.steps.length),
            switchMap(done =>
              op(
                rootState,
                filter(root => root !== null && root.settled === done.txs),
                take(1)
              )
            ),
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
        tap(s => {
          lastSubmission.current = s
        }),
        state(null)
      )

      const draftFundRows = op(
        combine({ list: draftList, sub: submission }),
        map(p => [
          ...new Set(
            [...p.list, ...(p.sub === null ? [] : p.sub.steps.map(step => step.draft))].flatMap(d =>
              d.kind === 'mandate' ? [getAddress(d.mandate.master)] : d.kind === 'sell' ? [getAddress(d.master)] : []
            )
          )
        ]),
        filter(masters => masters.length > 0),
        skipRepeatsWith((a, b) => a.length === b.length && a.every(master => b.includes(master))),
        switchMap(masters => localFirstQuery(reader => reader.select(fundTable, { where: { master: { in: masters } } }))),
        answerState
      )

      const chainLivenessValue: IStream<IChainLiveness> = op(
        merge(draftList, submission),
        switchMap(() => fromPromise(context.getChainLiveness())),
        skipRepeatsWith((a, b) => severitySig(a) === severitySig(b)),
        state()
      )

      const isOpen: IStream<boolean> = op(
        combine({ list: draftList, sub: submission }),
        map(p => p.list.length > 0 || p.sub !== null),
        skipRepeats
      )

      const settlementDone: IStream<Awaited<Submission['settlement']>> = op(
        submission,
        switchMap((s): IStream<Awaited<Submission['settlement']>> => (s === null ? empty : fromPromise(s.settlement))),
        multicast
      )
      const settled: IStream<readonly ISettledTx[]> = merge(
        map(done => done.txs, settlementDone),
        constant([] as readonly ISettledTx[], clickClose)
      )
      const releaseDraft: IStream<string> = op(
        settlementDone,
        switchMap(done =>
          op(
            rootState,
            filter(root => root !== null && root.settled === done.txs),
            take(1),
            map(() => done.released),
            spreadArray
          )
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
        skipRepeats,
        state()
      )

      const submissionStatus: IStream<SubmissionStatus | null> = op(
        switchMap(sub => {
          if (!sub || sub.steps.length === 0) return just(null)
          const followUps = sub.steps.flatMap(step =>
            step.shapes.flatMap(shape => {
              const leg = shape.scheduled === true ? step.walletTx.get(shape.kind) : undefined
              return leg === undefined ? [] : [leg]
            })
          )
          const firstMissed = new Promise<string | null>(resolve => {
            let left = followUps.length
            if (left === 0) resolve(null)
            for (const leg of followUps) {
              void leg.then(outcome => {
                if (outcome !== null && outcome !== 'signed' && 'missed' in outcome) resolve(outcome.missed)
                left -= 1
                if (left === 0) resolve(null)
              })
            }
          })
          return map(
            (p): SubmissionStatus => {
              for (const [i, s] of p.queries.entries()) {
                if (s.status !== PromiseStatus.ERROR) continue
                const draft = sub.steps[i]!.draft
                const [fee, , cap] = s.error instanceof CompactContractError && s.error.code === 'Intent__RelayFeeRatioExceeded' ? s.error.args : []
                if (typeof fee === 'bigint' && typeof cap === 'bigint' && draft.kind === 'fundSwap') {
                  return { kind: 'error', message: `Too small to swap: its ${readableTokenAmountLabel(getTokenDescription(draft.chainId, draft.inputToken), fee)} relay fee is over ${readablePercentage(cap)} of the amount` }
                }
                return { kind: 'error', message: formatThrownError(s.error) }
              }
              for (const s of p.queries) {
                if (s.status === PromiseStatus.PENDING) return { kind: 'pending' }
              }
              if (p.missed.status === PromiseStatus.DONE && p.missed.value !== null) return { kind: 'error', message: p.missed.value }
              return { kind: 'done' }
            },
            combine({ queries: combineMap((...states) => states, ...sub.steps.map(s => promiseState(just(s.query)))), missed: promiseState(just(firstMissed)) })
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

      const feeTokenOf = (d: IDraft): Address => {
        switch (d.kind) {
          case 'deposit':
            return d.deposit.inputToken
          case 'withdraw':
            return d.inputAmount.token
          case 'operate':
            return d.feeToken === 'any' ? wrappedNativeAddressOf(d.chainId) : d.feeToken
          case 'fundSwap':
            return d.inputToken
          case 'operateSwap':
            return d.outputToken
          case 'redeem':
            return d.token
          case 'allocate':
          case 'mandate':
          case 'sell':
            return HUB_CANONICAL_TOKEN.WETH
          case 'venueWithdraw':
          case 'venueIntent':
          case 'escrowReturn':
          case 'revoke':
          case 'walletWithdraw':
            throw new Error(`a ${d.kind} is sent by the wallet and pays no relay fee`)
          case 'session':
            throw new Error('a session is signed by the wallet and pays no relay fee')
        }
      }
      const feeChainOf = (d: IDraft): ChainId =>
        d.kind === 'deposit'
          ? d.deposit.chainId
          : d.kind === 'operate' || d.kind === 'withdraw' || d.kind === 'fundSwap' || d.kind === 'operateSwap'
            ? d.chainId
            : HUB_CHAIN_ID
      const feeCoordOf = (d: IDraft): string => `${feeChainOf(d)}:${feeTokenOf(d)}`
      const relayCallOf = (
        d: IDraft,
        list: readonly IDraft[],
        fund: Address | null
      ): {
        kind: IActionKind
        label: string
        genesisChain: ChainId | null
        units: bigint
        innerGasLimit: bigint
        calldataBytes: bigint
      } | null => {
        if (d.kind === 'operate' || d.kind === 'operateSwap') {
          const callList = operateCallsOf(d, fund)
          const priced = withAllowancePolicy(d.chainId, callList)
          return {
            kind: 'operate',
            label: operationSummary(d.chainId, describeOperate(d.chainId, fund, callList, false, undefined, NO_VENUE_FACTS), new Map())
              .actions.filter((a, _, all) => a.venueId !== '' || all.every(b => b.venueId === ''))
              .map(a => `${a.venue} ${a.label}`)
              .join(', '),
            genesisChain: null,
            units: BigInt(priced.length),
            innerGasLimit: declaredCallGas(priced),
            calldataBytes: dynamicCalldataBytes(priced.map(call => call.callData))
          }
        }
        return d.kind === 'deposit'
          ? d.deposit.route === null
            ? null
            : {
                kind: 'depositAcross',
                label: d.deposit.chainId === resolveDispatchChainId(Number(d.deposit.destinationChainId)) ? 'Swap' : 'Crosschain',
                genesisChain: null,
                units: 0n,
                innerGasLimit: routeSubcallGas(d.deposit.route),
                calldataBytes: routeCalldataBytes(d.deposit.route)
              }
          : d.kind === 'allocate'
              ? {
                  kind: 'allocate',
                  label: 'Allocate',
                  genesisChain: HUB_CHAIN_ID,
                  units: d.puppets,
                  innerGasLimit: 0n,
                  calldataBytes: 0n
                }
              : d.kind === 'withdraw'
                ? { kind: 'withdraw', label: 'Withdraw', genesisChain: d.chainId, units: 0n, innerGasLimit: 0n, calldataBytes: 0n }
                : d.kind === 'venueWithdraw' || d.kind === 'venueIntent' || d.kind === 'escrowReturn' || d.kind === 'session' || d.kind === 'revoke' || d.kind === 'walletWithdraw'
                  ? null
                  : d.kind === 'fundSwap'
                    ? {
                        kind: 'fundSwap',
                        label: d.chainId === d.destinationChainId ? 'Swap' : 'Crosschain',
                        genesisChain: null,
                        units: 0n,
                        innerGasLimit: routeSubcallGas(d.route),
                        calldataBytes: routeCalldataBytes(d.route)
                      }
                    : d.kind === 'sell'
                      ? { kind: 'sell', label: 'Sell', genesisChain: null, units: 0n, innerGasLimit: 0n, calldataBytes: 0n }
                      : d.kind === 'redeem'
                        ? {
                            kind: 'redeem',
                            label: 'Redeem',
                            genesisChain: HUB_CHAIN_ID,
                            units: d.holders < PROTOCOL.maxCohortSize ? d.holders : PROTOCOL.maxCohortSize,
                            innerGasLimit: 0n,
                            calldataBytes: 0n
                          }
                        : {
                              kind: 'mandate',
                              label: 'Mandate',
                              genesisChain: HUB_CHAIN_ID,
                              units: BigInt(list.filter(x => x.kind === 'mandate').length),
                              innerGasLimit: 0n,
                              calldataBytes: 0n
                            }
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
        map(list => list.some(d => d.kind !== 'session') && !list.some(d => d.kind === 'deposit')),
        skipRepeats,
        state(true)
      )

      const allocationUnfunded: IStream<boolean> = op(
        combine({ list: draftList, root: rootState }),
        map(
          p =>
            p.root !== null &&
            p.list.some(d => d.kind === 'mandate' && d.mandate.expiry !== 0n) &&
            !p.list.some(d => d.kind === 'deposit' && !d.toEscrow && Number(d.deposit.destinationChainId) === HUB_CHAIN_ID) &&
            !p.root.balances.some(b => b.chainId === HUB_CHAIN_ID && b.balance > 0n)
        ),
        skipRepeats,
        state()
      )

      const deployedChains: IStream<ReadonlySet<ChainId>> = op(
        rootState,
        map(r => (r === null ? new Set<ChainId>() : r.deployed)),
        state(new Set<ChainId>())
      )

      const feeByToken: IStream<PromiseState<Map<string, PromiseSettledResult<IFeeConvert>>>> = op(
        combine({ list: draftList, fund: operatingFund }),
        map(({ list, fund }): Promise<Map<string, PromiseSettledResult<IFeeConvert>>> => {
          const coords = [
            ...new Set(
              list.flatMap(d => {
                const call = relayCallOf(d, list, fund)
                if (call === null) return []
                return [
                  feeCoordOf(d),
                  ...(d.kind === 'redeem' && d.leg !== null ? [`${d.leg.chainId}:${d.leg.inputToken}`] : []),
                  ...(d.kind === 'allocate' && d.contribution > 0n && d.escrowChainId !== HUB_CHAIN_ID ? [`${d.escrowChainId}:${providerToken(d.escrowToken, d.escrowChainId)}`] : []),
                  ...(d.kind === 'deposit' && d.deposit.route !== null
                    ? [`${resolveDispatchChainId(Number(d.deposit.destinationChainId))}:${d.deposit.outputToken}`]
                    : [])
                ]
              })
            )
          ]
          return Promise.allSettled(
            coords.map(coord => {
              const [chainId, token] = coord.split(':')
              const id = resolveDispatchChainId(Number(chainId))
              return context.getFeeConverter(id, token as Address, DISPLAY_QUOTE_TTL_MS)
            })
          ).then(results => new Map<string, PromiseSettledResult<IFeeConvert>>(coords.map((coord, i) => [coord, results[i]!])))
        }),
        promiseState,
        state()
      )

      const keyless: IStream<boolean> = op(
        combine({ root: rootState, pair: walletPair }),
        map(p => p.pair.wallet !== null && p.root !== null && p.root.deployed.size === 0),
        skipRepeats,
        state(false)
      )
      const relaysResumeAt: IStream<number | null> = op(
        ownStateQuery,
        intermediateState,
        filter((own): own is PromiseStateDone<IOwnState | null> => own.status === PromiseStatus.DONE),
        map(own => {
          const held = own.value
          return held === null ? 0 : Number(revokedAtIn(held.accounts.filter(row => isAddressEqual(row.account, held.account)))) + 2 * Number(SESSION_REVOKE_DELAY)
        }),
        skipRepeats,
        switchMap(resumeAt => {
          const left = resumeAt - getUnixTimestamp()
          return left <= 0 ? just(null) : merge(just(resumeAt), op(wait(left * 1000), constant(null)))
        }),
        start(null),
        state()
      )
      const relayed = (d: IDraft): boolean => d.kind !== 'session' && d.kind !== 'revoke' && d.kind !== 'walletWithdraw' && d.kind !== 'escrowReturn'
      const rootPending: IStream<boolean> = op(
        rootStatus,
        map(s => s.status === PromiseStatus.PENDING),
        skipRepeats
      )
      const fundOpened: IStream<PromiseState<boolean>> = op(
        combine({ own: ownStateQuery, root: rootState }),
        map(async p => {
          const own = await p.own
          const fund = p.root === null ? null : p.root.fund
          if (fund !== null && 'unknown' in fund) throw new Error(fund.unknown)
          return fund && own?.fundRows.some(row => isAddressEqual(row.master, fund.account))
        }),
        promiseState,
        state<PromiseState<boolean>>({ status: PromiseStatus.PENDING })
      )
      const fundChains: IStream<PromiseState<ReadonlySet<ChainId>>> = op(
        combine({ own: ownStateQuery, root: rootState }),
        map(async p => {
          const own = await p.own
          const fund = p.root === null ? null : p.root.fund
          if (fund !== null && 'unknown' in fund) throw new Error(fund.unknown)
          return new Set<ChainId>(
            fund === null || own === null ? [] : own.accounts.filter(row => isAddressEqual(row.account, fund.account)).map(row => Number(row.chainId) as ChainId)
          )
        }),
        promiseState,
        state<PromiseState<ReadonlySet<ChainId>>>({ status: PromiseStatus.PENDING })
      )

      type IFeeLeg = { draftId: string; step: StepKind; chainList: ChainId[]; label: string; note: string | null; usd: bigint | null }
      type IRelayLeg = IFeeLeg & { fee: bigint | null }
      type ISwapLeg = IFeeLeg & { sent: bigint | null; exact: boolean }
      type IVenueLeg = IFeeLeg & { venue: string; sent: bigint | null }
      type FeeBreakdown = {
        relayList: IRelayLeg[]
        swapList: ISwapLeg[]
        venueList: IVenueLeg[]
        feeFailure: PromiseRejectedResult | null
        priceFailure: PromiseStateError | null
        pending: boolean
      }
      type IFeeShortfall = { kind: 'short'; leg: IRelayLeg } | { kind: 'unpriced'; leg: IRelayLeg; error: unknown } | { kind: 'unquoted'; error: unknown } | { kind: 'pending' }

      const feeBreakdown: IStream<FeeBreakdown> = state()(switchMap(({ list, fund }) => {
        const priceCoordinates = [
          ...new Map(
            list
              .flatMap((d): { chainId: ChainId; token: Address }[] => {
                const coords = relayCallOf(d, list, fund) === null ? [] : [{ chainId: feeChainOf(d), token: feeTokenOf(d) }]
                if (d.kind === 'deposit' && d.deposit.route !== null) {
                  coords.push({ chainId: resolveDispatchChainId(Number(d.deposit.destinationChainId)), token: d.deposit.outputToken })
                } else if (d.kind === 'withdraw') {
                  if (d.output.approx) {
                    coords.push({ chainId: d.output.chainId, token: d.output.token })
                  }
                } else if (d.kind === 'fundSwap') {
                  coords.push({ chainId: d.destinationChainId, token: d.outputToken })
                } else if (d.kind === 'redeem' && d.leg !== null) {
                  coords.push({ chainId: d.leg.chainId, token: d.leg.inputToken })
                } else if (d.kind === 'allocate' && d.contribution > 0n && d.escrowChainId !== HUB_CHAIN_ID) {
                  coords.push({ chainId: d.escrowChainId, token: providerToken(d.escrowToken, d.escrowChainId) })
                } else if (d.kind === 'venueWithdraw') {
                  const { withdraw } = venueWithdrawOf(d.venueId)
                  coords.push({ chainId: withdraw.chainId, token: withdraw.token })
                } else if (d.kind === 'operate' || d.kind === 'operateSwap') {
                  for (const s of describeOperate(d.chainId, fund, operateCallsOf(d, fund), false, undefined, NO_VENUE_FACTS)) {
                    if (s.kind !== 'venue' || s.fees.length === 0) continue
                    for (const fee of s.fees) coords.push({ chainId: d.chainId, token: fee.token })
                    for (const flow of s.flows) if (flow.delta < 0n) coords.push({ chainId: d.chainId, token: flow.token })
                  }
                }
                return coords
              })
              .map(c => [`${c.chainId}:${c.token}`, c] as const)
          ).values()
        ]

        return combineMap(
          (
            feeRates: PromiseState<Map<string, PromiseSettledResult<IFeeConvert>>>,
            deployed: ReadonlySet<ChainId>,
            opened: PromiseState<boolean>,
            bound: PromiseState<ReadonlySet<ChainId>>,
            ...prices: PromiseState<bigint | null>[]
          ): FeeBreakdown => {
            const priceByCoordinate = new Map<string, PromiseState<bigint | null>>(priceCoordinates.map((c, i) => [`${c.chainId}:${c.token}`, prices[i]!]))
            const toUsd = (chainId: ChainId, token: Address, amount: bigint | null): bigint | null => {
              const price = priceByCoordinate.get(`${chainId}:${token}`)
              return amount === null || price === undefined || price.status !== PromiseStatus.DONE || price.value === null ? null : amount * price.value
            }
            const priceFailure = prices.find((price): price is PromiseStateError => price.status === PromiseStatus.ERROR) ?? null
            const pending = prices.some(price => price.status === PromiseStatus.PENDING) || feeRates.status === PromiseStatus.PENDING
            const rateOf = (coord: string): PromiseSettledResult<IFeeConvert> | undefined => (feeRates.status === PromiseStatus.DONE ? feeRates.value.get(coord) : undefined)
            const relayList: IRelayLeg[] = []
            const swapList: ISwapLeg[] = []
            const venueList: IVenueLeg[] = []
            let feeFailure: PromiseRejectedResult | null = feeRates.status === PromiseStatus.ERROR ? { status: 'rejected', reason: feeRates.error } : null
            for (const d of list) {
              if (d.kind === 'mandate' && list.findIndex(x => x.kind === 'mandate') !== list.indexOf(d)) continue
              const step: StepKind = d.kind === 'deposit' ? 'swap' : d.kind === 'operateSwap' ? 'operate' : d.kind
              if (d.kind === 'venueWithdraw') {
                const { name, withdraw } = venueWithdrawOf(d.venueId)
                venueList.push({
                  draftId: d.id,
                  step,
                  venue: name,
                  chainList: [withdraw.chainId],
                  label: `${name} Withdraw`,
                  note: 'taken from the amount before it reaches your fund',
                  usd: toUsd(withdraw.chainId, withdraw.token, withdraw.feeOf(d.amount)),
                  sent: toUsd(withdraw.chainId, withdraw.token, d.amount)
                })
                continue
              }
              if (d.kind === 'operate' || d.kind === 'operateSwap') {
                for (const s of describeOperate(d.chainId, fund, operateCallsOf(d, fund), false, undefined, NO_VENUE_FACTS)) {
                  if (s.kind !== 'venue' || s.fees.length === 0) continue
                  const venue = VENUES.find(v => v.venueId === s.venueId)
                  if (venue === undefined) throw new Error(`venue ${s.venueId} described a step but is not in VENUES`)
                  let sent: bigint | null = 0n
                  for (const flow of s.flows) {
                    if (flow.delta >= 0n) continue
                    const usd = toUsd(d.chainId, flow.token, -flow.delta)
                    sent = sent === null || usd === null ? null : sent + usd
                  }
                  const label = `${venue.name} ${s.label}`
                  for (const fee of s.fees) {
                    const cap = toUsd(d.chainId, fee.token, fee.amount)
                    if (fee.payee === 'venue') {
                      venueList.push({ draftId: d.id, step, venue: venue.name, chainList: [d.chainId], label, note: 'up to this amount', usd: cap, sent })
                      continue
                    }
                    swapList.push({
                      draftId: d.id,
                      step,
                      chainList: [d.chainId],
                      label,
                      note: fee.expected === null ? 'up to this amount' : cap === null ? null : `up to ${formatUsd(cap, 1n)}`,
                      usd: fee.expected === null ? cap : toUsd(d.chainId, fee.token, fee.expected),
                      sent,
                      exact: fee.expected === null
                    })
                  }
                }
              }
              const call = relayCallOf(d, list, fund)
              if (call === null) continue
              const settled = rateOf(feeCoordOf(d))
              const unquoted: PromiseRejectedResult | null =
                settled?.status === 'rejected' ? settled : d.kind === 'allocate' && opened.status === PromiseStatus.ERROR ? { status: 'rejected', reason: opened.error } : null
              if (unquoted !== null) {
                feeFailure = unquoted
                relayList.push({ draftId: d.id, step, chainList: [feeChainOf(d)], label: call.label, note: null, usd: null, fee: null })
                continue
              }
              const gasKind = d.kind === 'allocate' && opened.status === PromiseStatus.DONE && !opened.value ? 'createFund' : call.kind
              const carriesGenesis = call.genesisChain !== null && !deployed.has(call.genesisChain)
              const stepFee =
                settled === undefined || settled.status === 'rejected' || (d.kind === 'allocate' && opened.status !== PromiseStatus.DONE)
                  ? null
                  : d.kind === 'redeem'
                    ? d.plan === null
                      ? null
                      : d.plan.redemption.masterPay > 0n
                        ? redeemFeeOf(settled.value, { holders: d.holders, masterPaid: true })
                        : 0n
                    : relayFeeOf(
                        settled.value,
                        feeChainOf(d),
                        gasKind,
                        carriesGenesis,
                        call.units,
                        call.innerGasLimit,
                        call.calldataBytes
                      )
              const stepUsd = toUsd(feeChainOf(d), feeTokenOf(d), stepFee)
              const puppets = d.kind === 'allocate' ? d.puppets : 0n
              const puppetsOnly = d.kind === 'allocate' && d.contribution === 0n
              if (d.kind === 'allocate' && d.contribution > 0n && d.escrowChainId !== HUB_CHAIN_ID) {
                const spoke = d.escrowChainId
                const booked = providerToken(d.escrowToken, spoke)
                const settledRelease = rateOf(`${spoke}:${booked}`)
                if (settledRelease?.status === 'rejected') feeFailure = settledRelease
                if (bound.status === PromiseStatus.ERROR) feeFailure = { status: 'rejected', reason: bound.error }
                const releaseFee =
                  settledRelease === undefined || settledRelease.status === 'rejected' || bound.status !== PromiseStatus.DONE
                    ? null
                    : relayFeeOf(settledRelease.value, spoke, 'fulfil', !bound.value.has(spoke), 0n, 0n, 0n)
                relayList.push({ draftId: d.id, step: 'fulfil', chainList: [spoke], label: 'Release', note: 'taken from the escrow it releases', usd: toUsd(spoke, booked, releaseFee), fee: releaseFee })
              }
              relayList.push({
                draftId: d.id,
                step,
                chainList: [feeChainOf(d)],
                label: call.label,
                note:
                  d.kind === 'redeem'
                    ? d.plan !== null && d.plan.redemption.masterPay > 0n
                      ? d.holders === 0n
                        ? 'taken from your payout'
                        : 'your slice; each paid holder carries the same'
                      : 'carried by the paid holders'
                    : puppets === 0n
                    ? null
                    : puppetsOnly
                      ? `paid by the ${countLabel(Number(puppets), 'puppet', 'puppets')}, split evenly`
                      : `your part, split evenly with ${countLabel(Number(puppets), 'puppet', 'puppets')}`,
                usd: stepUsd === null ? null : puppetsOnly ? 0n : stepUsd / (puppets + 1n),
                fee: stepFee === null ? null : puppetsOnly ? 0n : stepFee / (puppets + 1n)
              })
              if (d.kind === 'deposit' && d.toEscrow && d.deposit.route !== null) {
                const spoke = resolveDispatchChainId(Number(d.deposit.destinationChainId))
                const settledEscrow = rateOf(`${spoke}:${d.deposit.outputToken}`)
                if (settledEscrow?.status === 'rejected') feeFailure = settledEscrow
                const escrowFee =
                  settledEscrow === undefined || settledEscrow.status === 'rejected'
                    ? null
                    : relayFeeOf(settledEscrow.value, spoke, 'retireEscrow', !deployed.has(spoke), 0n, 0n, 0n)
                relayList.push({ draftId: d.id, step: 'retireEscrow', chainList: [spoke], label: 'Escrow', note: 'taken from what lands', usd: toUsd(spoke, d.deposit.outputToken, escrowFee), fee: escrowFee })
              }
              const leg = d.kind === 'redeem' ? d.leg : null
              const legLabel = leg === null || leg.chainId !== HUB_CHAIN_ID ? 'Crosschain' : 'Swap'
              if (leg !== null) {
                const settledLeg = rateOf(`${leg.chainId}:${leg.inputToken}`)
                if (settledLeg?.status === 'rejected') feeFailure = settledLeg
                const legFee =
                  settledLeg === undefined || settledLeg.status === 'rejected'
                    ? null
                    : relayFeeOf(settledLeg.value, leg.chainId, 'fundSwap', false, 0n, routeSubcallGas(leg.route), routeCalldataBytes(leg.route))
                relayList.push({ draftId: d.id, step: 'fundSwap', chainList: [leg.chainId], label: legLabel, note: 'taken from what moves', usd: toUsd(leg.chainId, leg.inputToken, legFee), fee: legFee })
              }
              const conversion =
                d.kind === 'deposit' && d.deposit.route !== null
                  ? {
                      step,
                      label: call.label,
                      input: { chainId: d.deposit.chainId, token: d.deposit.inputToken, amount: d.deposit.routeInput },
                      output: { chainId: resolveDispatchChainId(Number(d.deposit.destinationChainId)), token: d.deposit.outputToken, amount: d.toEscrow ? d.deposit.outputAmount : d.expectedOutput }
                    }
                  : d.kind === 'fundSwap'
                    ? {
                        step,
                        label: call.label,
                        input: { chainId: d.chainId, token: d.inputToken, amount: d.routeInput },
                        output: { chainId: d.destinationChainId, token: d.outputToken, amount: d.expectedOutput }
                      }
                    : d.kind === 'withdraw' && d.output.approx
                      ? {
                          step,
                          label: call.label,
                          input: { chainId: d.chainId, token: d.inputAmount.token, amount: d.routeInput },
                          output: { chainId: d.output.chainId, token: d.output.token, amount: d.output.expected }
                        }
                      : leg !== null && d.kind === 'redeem'
                        ? {
                            step: 'fundSwap' as const,
                            label: legLabel,
                            input: { chainId: leg.chainId, token: leg.inputToken, amount: leg.routeInput },
                            output: { chainId: HUB_CHAIN_ID as ChainId, token: d.token, amount: leg.expectedOutput }
                          }
                        : null
              if (conversion === null) continue
              const { input, output } = conversion
              const inKey = tokenMetaByChainToken.get(tokenMetaKey(input.chainId, providerToken(input.token, input.chainId)))?.tokenKey
              const exact = inKey !== undefined && inKey === tokenMetaByChainToken.get(tokenMetaKey(output.chainId, providerToken(output.token, output.chainId)))?.tokenKey
              const sent = toUsd(input.chainId, input.token, input.amount)
              const received = exact ? toUsd(input.chainId, input.token, output.amount) : toUsd(output.chainId, output.token, output.amount)
              swapList.push({
                draftId: d.id,
                step: conversion.step,
                chainList: [...new Set([input.chainId, output.chainId])],
                label: conversion.label,
                note: null,
                usd: sent === null || received === null ? null : sent - received,
                sent,
                exact
              })
            }
            return { relayList, swapList, venueList, feeFailure, priceFailure, pending }
          },
          feeByToken,
          deployedChains,
          fundOpened,
          fundChains,
          ...priceCoordinates.map(c => promiseState(just(freshPrice(c.chainId, c.token))))
        )
      }, combine({ list: draftList, fund: operatingFund })))

      const feeShortfall: IStream<IFeeShortfall | null> = op(
        combine({ breakdown: feeBreakdown, list: draftList, root: rootState }),
        switchMap(p => {
          const root = p.root
          if (root === null || p.list.some(d => d.kind === 'deposit' && !d.toEscrow && Number(d.deposit.destinationChainId) === HUB_CHAIN_ID)) return just<IFeeShortfall | null>(null)
          const weth = balanceAt(root.balances, HUB_CHAIN_ID, HUB_CANONICAL_TOKEN.WETH)
          const native = balanceAt(root.balances, HUB_CHAIN_ID, PROTOCOL.nativeToken)
          const mandateLegs = p.breakdown.relayList.filter(leg => leg.step === 'mandate')
          if (mandateLegs.some(leg => leg.fee === null)) {
            return just<IFeeShortfall | null>(
              p.breakdown.feeFailure !== null ? { kind: 'unquoted', error: p.breakdown.feeFailure.reason } : p.breakdown.pending ? { kind: 'pending' } : { kind: 'unquoted', error: new Error('the relay fee has no quote') }
            )
          }
          const uncovered = mandateLegs.filter(leg => leg.fee !== null && leg.fee > weth && leg.fee > native)
          const unsized = uncovered.find(leg => leg.usd === null)
          if (unsized !== undefined) {
            return just<IFeeShortfall | null>(
              p.breakdown.priceFailure !== null ? { kind: 'unpriced', leg: unsized, error: p.breakdown.priceFailure.error } : p.breakdown.pending ? { kind: 'pending' } : { kind: 'unpriced', leg: unsized, error: new Error('the relay fee token has no price') }
            )
          }
          if (uncovered.length === 0) return just<IFeeShortfall | null>(null)
          return map(
            (prices): IFeeShortfall | null => {
              if (prices.usdc.status === PromiseStatus.PENDING || prices.usdt.status === PromiseStatus.PENDING) return { kind: 'pending' }
              const held = [
                { token: HUB_CANONICAL_TOKEN.USDC, price: prices.usdc },
                { token: HUB_CANONICAL_TOKEN.USDT, price: prices.usdt }
              ].map(stable => (stable.price.status === PromiseStatus.DONE && stable.price.value !== null ? balanceAt(root.balances, HUB_CHAIN_ID, stable.token) * stable.price.value : null))
              const leg = uncovered.find(each => each.usd !== null && held.every(value => value === null || value < each.usd!))
              if (leg === undefined) return null
              const failed = [prices.usdc, prices.usdt].find((price): price is PromiseStateError => price.status === PromiseStatus.ERROR)
              return failed === undefined ? { kind: 'short', leg } : { kind: 'unpriced', leg, error: failed.error }
            },
            combine({ usdc: promiseState(just(freshPrice(HUB_CHAIN_ID, HUB_CANONICAL_TOKEN.USDC))), usdt: promiseState(just(freshPrice(HUB_CHAIN_ID, HUB_CANONICAL_TOKEN.USDT))) })
          )
        }),
        state<IFeeShortfall | null>({ kind: 'pending' })
      )

      const consented: IStream<boolean> = op(
        uiStorage.replayWrite<number | null>('betaTermsConsent:2026-10-16', null, map(() => Date.now(), clickAgree)),
        map(at => at !== null),
        state()
      )

      const submitDisabled = op(
        combine({
          consented,
          keyless,
          list: draftList,
          submission,
          errored: submissionErrored,
          chainLiveness: chainLivenessValue,
          root: rootState,
          rootFailure: start(null, rootFailure),
          rootPending,
          underfunded,
          depositMissing,
          allocationUnfunded,
          feeShortfall,
          relaysResumeAt
        }),
        map(p => {
          if (!p.consented) return true
          if (p.relaysResumeAt !== null && p.list.some(relayed)) return true
          if (p.submission !== null && !p.errored) return true
          if (p.list.length === 0) return true
          if (p.rootPending) return true
          if (p.rootFailure !== null) return true
          if (!p.chainLiveness.reachable) return true
          if (firstStaleChain(p.list, p.chainLiveness) !== null) return true
          if ((p.root === null || p.keyless) && p.depositMissing) return true
          if (p.allocationUnfunded) return true
          if (p.feeShortfall !== null) return true
          if (p.keyless) return p.underfunded !== null
          return p.root === null
        }),
        start(true)
      )

      const $feeCaption = $node(style({ color: palette.foreground, whiteSpace: 'normal' }))
      const feeText = (leg: IFeeLeg | IVenueLeg | ISwapLeg): string => {
        if (leg.usd === null) return '-'
        const cost = leg.usd > 0n ? leg.usd : 0n
        const mark = 'exact' in leg && !leg.exact ? '≈ ' : ''
        if (!('sent' in leg) || leg.sent === null || leg.sent <= 0n) return `${mark}${formatUsd(cost, 1n)}`
        const hundredths = (cost * 10000n + leg.sent / 2n) / leg.sent
        return `${mark}${formatUsd(cost, 1n)} (${cost > 0n && hundredths === 0n ? '< 0.01' : (Number(hundredths) / 100).toFixed(2)}%)`
      }
      const $executionFeesBreakdown = (): I$Node =>
        switchMap(
          p => {
            const $breakdown = $column(spacing.small, style({ minWidth: '280px', fontSize: text.sm }))
            const fees = p.breakdown
            if (fees.relayList.length + fees.swapList.length + fees.venueList.length === 0 && fees.feeFailure === null) {
              return $breakdown($feeCaption($text('Nothing here is relayed or swapped, so the only cost is the gas of your own wallet transactions.')))
            }
            const order = p.list.map(d => d.id)
            const steps = new Map<string, { label: string; chainList: ChainId[]; lines: { leg: IFeeLeg | IVenueLeg | ISwapLeg; caption: string }[] }>()
            for (const line of [
              ...fees.relayList.map(leg => ({ leg, caption: leg.note === null ? 'Relay fee, charged by Puppet' : `Relay fee, charged by Puppet: ${leg.note}` })),
              ...fees.swapList.map(leg => ({ leg, caption: leg.note === null ? 'Charged by the route provider' : `Charged by the route provider, ${leg.note}` })),
              ...fees.venueList.map(leg => ({ leg, caption: leg.note === null ? `Charged by ${leg.venue}` : `Charged by ${leg.venue}, ${leg.note}` }))
            ].sort((a, b) => order.indexOf(a.leg.draftId) - order.indexOf(b.leg.draftId))) {
              const key = `${line.leg.draftId}:${line.leg.step}`
              const step = steps.get(key) ?? { label: line.leg.label, chainList: [], lines: [] }
              for (const chainId of line.leg.chainList) if (!step.chainList.includes(chainId)) step.chainList.push(chainId)
              step.lines.push(line)
              steps.set(key, step)
            }
            return $breakdown(
              ...(fees.feeFailure === null ? [] : [style({ whiteSpace: 'normal' })($errorLabel(fees.feeFailure.reason))]),
              ...(fees.priceFailure === null ? [] : [style({ whiteSpace: 'normal' })($errorLabel(`Price unavailable: ${formatThrownError(fees.priceFailure.error)}`))]),
              ...[...steps.values()].map(step =>
                $column(style({ gap: '2px' }))(
                  $row(spacing.tiny, style({ alignItems: 'center' }))(...step.chainList.map(id => $chainIcon(id, 14)), $text(step.label)),
                  ...step.lines.map(line =>
                    $row(spacing.default, style({ alignItems: 'baseline', justifyContent: 'space-between', fontSize: text.xs, paddingLeft: '18px' }))(
                      $feeCaption(style({ minWidth: '0' }))($text(line.caption)),
                      $node(style({ whiteSpace: 'nowrap' }))($text(feeText(line.leg)))
                    )
                  )
                )
              )
            )
          },
          combine({ breakdown: feeBreakdown, list: draftList })
        )

      const $executionFees = (): I$Node =>
        $labeledValue(
          'Total fees',
          switchMap((p): I$Slottable => {
            if (p.feeFailure !== null) return style({ whiteSpace: 'normal' })($errorLabel(p.feeFailure.reason))
            if (p.priceFailure !== null) return style({ whiteSpace: 'normal' })($errorLabel(`Price unavailable: ${formatThrownError(p.priceFailure.error)}`))
            const legList = [...p.relayList, ...p.swapList, ...p.venueList]
            if (legList.length === 0) return $text('None')
            const total = legList.reduce<bigint | null>((sum, leg) => (sum === null || leg.usd === null ? null : sum + (leg.usd > 0n ? leg.usd : 0n)), 0n)
            if (total === null && p.pending) return $intermediateLine('4em')
            return $text(total === null ? '-' : `${p.swapList.some(leg => !leg.exact) ? '≈ ' : ''}${formatUsd(total, 1n)}`)
          }, feeBreakdown),
          $executionFeesBreakdown()
        )

      const $metaText = (label: string): I$Node =>
        $node(style({ color: palette.foreground, fontSize: text.xs }))($text(label))

      type StepStatus = 'queued' | 'current' | 'done' | 'exception' | 'failed'
      const $trailingGlyph = (status: StepStatus): I$Node => {
        if (status === 'done') {
          return $icon({ $content: $check, viewBox: '0 0 24 24', fill: palette.positive, size: '12px' })
        }
        if (status === 'failed') {
          return $icon({ $content: $xCross, viewBox: '0 0 32 32', fill: palette.negative, size: '12px' })
        }
        if (status === 'exception') {
          return $icon({ $content: $alertIcon, viewBox: '0 0 24 24', fill: palette.indeterminate, size: '12px' })
        }
        return $icon({ $content: $info, viewBox: '0 0 32 32', fill: palette.foreground, size: '12px' })
      }
      const $stepPill = (
        wallet: boolean,
        status: StepStatus,
        tx: ISettledTx | null,
        reason: string | null,
        destination: { chainId: ChainId; address: Address | null } | null,
        label: string | IStream<string>,
        description: string,
        $fee: I$Node,
        origin?: { chainId: ChainId; symbol: string },
        sections?: readonly { label: string; chainId: ChainId | null }[]
      ): I$Node => {
        const $labelText = $node(style({ color: palette.foreground, fontSize: text.xs }))
        const verb = map(l => l.split(' ')[0]!, toStream(label))
        const rest = map(l => l.split(' ').slice(1).join(' '), toStream(label))
        const content: I$Node[] = sections !== undefined
          ? [
              ...(wallet ? [$icon({ $content: $wallet, viewBox: '0 0 32 32', fill: palette.foreground, size: '14px' })] : []),
              ...sections.flatMap((section, i) => [
                ...(i === 0 ? [] : [$node(style({ width: '1px', height: '14px', backgroundColor: colorShade(palette.foreground, 30) }))()]),
                $row(spacing.tiny, style({ alignItems: 'center' }))(
                  $labelText($text(section.label.split(' ')[0]!)),
                  ...(section.chainId === null ? [] : [$chainIcon(section.chainId, 14)]),
                  $labelText($text(section.label.split(' ').slice(1).join(' ')))
                )
              ]),
              $trailingGlyph(status)
            ]
          : destination
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
                ...(origin === undefined || origin.chainId === destination.chainId ? [] : [$labelText($text(chainName(destination.chainId)))]),
                ...(typeof label === 'string' && !label.includes(' ') ? [] : [$labelText($text(rest))])
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
            : status === 'exception'
              ? pillBg($alertIntermediateContainer(...content))
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
            ...(reason === null ? [] : [$node(style({ color: status === 'exception' ? palette.indeterminate : palette.negative, fontSize: text.xs, overflowWrap: 'anywhere' }))($text(reason))]),
            $fee,
            destination && destinationChain && destination.address !== null
              ? $row(spacing.tiny, style({ alignItems: 'center', color: palette.foreground, fontSize: text.xs }))(
                $text('To'),
                $chainIcon(destination.chainId, 14),
                $anchor(attr({ href: getAccountExplorerUrl(destination.address, destinationChain), target: '_blank' }))(
                  $text(readableAddress(destination.address)),
                  $externalMark()
                )
              )
              : $node(),
            tx && txChain
              ? $row(spacing.tiny, style({ alignItems: 'center', color: palette.foreground, fontSize: text.xs }))(
                $text('Tx'),
                $chainIcon(tx.chainId, 14),
                $anchor(attr({ href: getTxExplorerUrl(tx.txHash, txChain), target: '_blank' }))(
                  $text(readableHash(tx.txHash)),
                  $externalMark()
                )
              )
              : $node()
          ),
          $anchor: $pillNode
        })({})
      }

      type PillState = { status: StepStatus; tx: ISettledTx | null; reason: string | null }
      type Row = {
        draft: IDraft
        shapes: readonly IStepShape[]
        query: Promise<IAttestation[]> | null
        priorQuery: Promise<unknown> | null
        walletTx: Map<StepKind, Promise<StepOutcome | null>>
      }

      const progressOf = (row: Row): IStream<PillState[]> => {
        if (row.query === null) return just(row.shapes.map((): PillState => ({ status: 'queued', tx: null, reason: null })))
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
                const shape = row.shapes[i]!
                const priorAllDone = outcomes.slice(0, i).every((_o, j) => done(j))
                if (shape.scheduled === true) {
                  if (outcome !== null && outcome !== 'signed' && 'missed' in outcome) return { status: 'failed', tx: null, reason: outcome.missed }
                  if (outcome !== null) return { status: 'done', tx: settledTxOf(outcome), reason: null }
                  return { status: qs.status === PromiseStatus.DONE || priorAllDone ? 'current' : 'queued', tx: null, reason: null }
                }
                if (qs.status === PromiseStatus.DONE || done(i)) {
                  const own = settledTxOf(outcome)
                  const attested = own === null && qs.status === PromiseStatus.DONE && (shape.kind === 'operate' || shape.kind === 'fundSwap') ? qs.value.find(a => a.request.kind === shape.kind) : undefined
                  const missed = outcome !== null && outcome !== 'signed' && 'missed' in outcome ? outcome.missed : null
                  return {
                    status: missed === null ? 'done' : 'exception',
                    tx: attested === undefined ? own : { chainId: attested.request.chainId, account: attested.result.account, block: attested.settledBlock, txHash: attested.result.txHash },
                    reason: missed
                  }
                }
                if (!active || !priorAllDone) return { status: 'queued', tx: null, reason: null }
                return qs.status === PromiseStatus.ERROR ? { status: 'failed', tx: null, reason: formatThrownError(qs.error) } : { status: 'current', tx: null, reason: null }
              })
            },
            promiseState(just(row.query)),
            active,
            ...legs
          ),
          state()
        )
      }

      const $pillFee = (draftId: string, shape: IStepShape): I$Node =>
        $column(spacing.tiny, style({ color: palette.foreground, fontSize: text.xs }))(
          switchMap(fb => {
            const legs = [
              ...fb.relayList.map(leg => ({ leg, kind: 'Relay fee' })),
              ...fb.swapList.map(leg => ({ leg, kind: 'Route fee' })),
              ...fb.venueList.map(leg => ({ leg, kind: `${leg.venue} fee` }))
            ].filter(
              x => x.leg.draftId === draftId && x.leg.step === shape.kind
            )
            if (legs.length === 0) return shape.wallet === true && !SIGNATURE_STEPS.has(shape.kind) ? $node($text('Your wallet pays the network gas.')) : empty
            return $column(spacing.tiny)(
              ...legs.map(x =>
                $row(spacing.tiny, style({ alignItems: 'center', flexWrap: 'wrap' }))(
                  $text(`${x.kind}: ${feeText(x.leg)}`),
                  ...(x.leg.note === null ? [] : [$text(`(${x.leg.note})`)])
                )
              )
            )
          }, feeBreakdown)
        )

      const $pill = (draftId: string, shape: IStepShape, progress: IStream<PillState[]>, i: number): I$Node =>
        switchMap(p => {
          const pill = p[i]!
          return $stepPill(shape.wallet === true, pill.status, pill.tx, pill.reason, shape.destination, shape.label, shape.description, $pillFee(draftId, shape), shape.origin, shape.sections)
        }, progress)

      const $withdrawDesc = (draft: IWithdrawDraft): I$Node => {
        const desc = getTokenDescription(draft.output.chainId, draft.output.token)
        const approx = draft.output.approx ? '≈ ' : ''
        const amountText = `${approx}${readableTokenAmountLabel(desc, draft.output.amount)}`
        const tooltip = 'Delivered to your wallet; the relay fee is deducted from the withdrawn amount.'
        return $row(spacing.small, style({ alignItems: 'center' }))(
          $node(attr({ title: tooltip }), style({ color: palette.message }))($text(amountText)),
          $row(spacing.small, style({ alignItems: 'center', color: palette.foreground, fontSize: text.xs }))(
            $text('to'),
            $jazzicon(draft.output.receiver, 18),
            $anchor(
              attr({
                href: getAccountExplorerUrl(draft.output.receiver, chainFor(draft.output.chainId)),
                target: '_blank'
              })
            )($text(readableAddress(draft.output.receiver)), $externalMark()),
            $text('on'),
            $chainIcon(draft.output.chainId, 14),
            $text(chainName(draft.output.chainId))
          )
        )
      }

      const $draftFund = (master: Address): I$Node => {
        const url = href(routeSchema.traders.detail, { master })
        const fundRow = map(query => query.then(rows => rows.find(row => isAddressEqual(row.master, master))), draftFundRows)
        return $defaultAnchor(
          attr({ href: url }),
          softNavClick(url),
          style({ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0', color: palette.message, textDecoration: 'none', fontWeight: '600', fontSize: text.base })
        )(
          switchLatest(
            op(
              fundRow,
              intermediateState,
              map(row => (row.status === PromiseStatus.DONE ? $fundAvatar(row.value === undefined ? robotCellsOf(master) : gridOf(row.value), 32) : null)),
              filterNull
            )
          ),
          $intermediateText(map(row => row.then(found => (found === undefined ? readableAddress(master) : fundSymbolOf(found))), fundRow))
        )
      }

      const $mandateDesc = (draft: IMandateDraft): I$Node => {
        const mandate = draft.mandate
        const $master = $draftFund(mandate.master)
        if (mandate.expiry === 0n) {
          return $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap', fontSize: text.base }))(
            $master,
            $metaText('·'),
            $text('stop allocating to this fund')
          )
        }
        return $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap', fontSize: text.base }))($master, $metaText('·'), $mandateTerms(mandateTermsOf(mandate)))
      }

      const $draftDescription = (draft: IDraft): I$Node => {
        if (draft.kind === 'mandate') return $mandateDesc(draft)
        if (draft.kind === 'sell') return $draftFund(draft.master)
        if (draft.kind === 'allocate') {
          const opening: IStream<IFundIdentityDraft | null> =
            draft.identity !== null
              ? just(draft.identity)
              : map(p => {
                  const fund = p.root === null ? null : p.root.fund
                  return fund === null || 'unknown' in fund || p.opened.status !== PromiseStatus.DONE || p.opened.value ? null : fund
                }, combine({ root: rootState, opened: fundOpened }))
          return switchLatest(
            op(
              opening,
              skipRepeatsWith((a, b) => a === b || (a !== null && b !== null && a.symbol === b.symbol && a.cells.join() === b.cells.join())),
              map(identity =>
                identity === null
                  ? empty
                  : $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap', fontSize: text.base }))(
                      $row(spacing.small, style({ alignItems: 'center', color: palette.message, fontWeight: '600' }))($fundAvatar(identity.cells, 32), $text(identity.symbol)),
                      $metaText('·'),
                      $text('written on chain with this round, then fixed')
                    )
              )
            )
          )
        }
        if (draft.kind === 'deposit') return empty
        if (draft.kind === 'withdraw') return $withdrawDesc(draft)
        return empty
      }

      const $plan = (rows: readonly Row[], returning: boolean): I$Node => {
        const tracked = rows.map(row => ({ ...row, progress: progressOf(row) }))
        const walletPills = tracked
          .flatMap(row => row.shapes.flatMap((shape, i) => (shape.wallet === true ? [{ shape, i, progress: row.progress, draftId: row.draft.id }] : [])))
        const relayPills = (row: (typeof tracked)[number]) => row.shapes.flatMap((shape, i) => (shape.wallet === true ? [] : [{ row, shape, i }]))
        const mandates = tracked.filter(row => row.draft.kind === 'mandate')
        const relayRows = tracked.flatMap(row => {
          if (row.draft.kind === 'mandate' && row !== mandates[0]) return []
          const pills = relayPills(row)
          return pills.length === 0 ? [] : [{ row, pills }]
        })
        const signs = walletPills.some(p => SIGNATURE_STEPS.has(p.shape.kind))
        const flow = rows.flatMap(row => row.shapes)
        const lands = flow.findIndex(shape => shape.wallet !== true || shape.kind === 'fund')
        const ask = walletAsk(walletPills.map(p => p.shape), lands === -1 || flow.slice(lands + 1).every(shape => shape.wallet !== true))
        return $column(spacing.default)(
          ...(walletPills.length === 0
            ? []
            : [
                $column(spacing.small)(
                  signs
                    ? $column(spacing.tiny, style({ minWidth: 0 }))(
                        $node(style({ fontSize: text.base, color: palette.message }))($text(returning ? 'Set up this device' : 'Set up your account')),
                        $node(style({ fontSize: text.xs, color: palette.foreground, lineHeight: '1.4' }))(
                          $text(returning ? ask : `One account per wallet, derived from the one you connected. ${ask}`)
                        )
                      )
                    : $row(spacing.tiny, style({ alignItems: 'center', fontSize: text.base, color: palette.message }))($node($text('From your wallet')), $infoTooltip(ask)),
                  $row(spacing.tiny, style({ alignItems: 'center', flexWrap: 'wrap' }))(
                    ...walletPills.map(p => $pill(p.draftId, p.shape, p.progress, p.i))
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
                    const batched = x.row.draft.kind === 'mandate' && mandates.length > 1
                    const $description = batched ? $column(spacing.small)(...mandates.map(m => $draftDescription(m.draft))) : $draftDescription(x.row.draft)
                    return $row(spacing.small, style({ alignItems: batched ? 'flex-start' : 'center', flexWrap: 'wrap' }))(
                      $row(spacing.tiny, style({ alignItems: 'center', flexWrap: 'wrap' }))(
                        ...x.pills.map(p => $pill(p.row.draft.id, batched && p.shape.kind === 'mandate' ? { ...p.shape, label: 'Mandate' } : p.shape, p.row.progress, p.i))
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
          borderRadius: '20px 20px 0 0',
          outline: 'none'
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
                        if (p.drafts.length === 0) return empty
                        const shapesList = planShapes(p.pair.keys, p.pair.wallet, p.root, p.drafts, p.split)
                        const rows = p.drafts.map(
                          (draft, i): Row => ({ draft, shapes: shapesList[i]!, query: null, priorQuery: null, walletTx: new Map() })
                        )
                        return $plan(rows, p.root !== null)
                      },
                      combine({ drafts: draftList, pair: walletPair, root: rootState, split: splitChains })
                    )
                  : $plan(
                      sub.steps.map((st, i): Row => ({ ...st, priorQuery: i === 0 ? null : sub.steps[i - 1]!.query })),
                      sub.returning
                    ),
              submission
            )
          ),

          (() => {
            const $noticeLine = (full: string, tone: 'positive' | 'negative'): I$Node => {
              const color = tone === 'positive' ? palette.positive : palette.negative
              const weight = tone === 'positive' ? '600' : '500'
              const base = isMobileScreen || tone === 'negative'
                ? { color, fontSize: text.xs, fontWeight: weight, minWidth: '0', whiteSpace: 'normal' as const, overflowWrap: 'anywhere' as const }
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

            const depositUrl = href(routeSchema.portfolio)
            const footerNotice: IStream<{ text: string; tone: 'positive' | 'negative'; deposit?: true } | null> = op(
              map(
                (p): { text: string; tone: 'positive' | 'negative'; deposit?: true } | null => {
                  if (p.status?.kind === 'done') return { text: 'Done', tone: 'positive' as const }
                  if (p.status?.kind === 'error') return { text: p.status.message, tone: 'negative' as const }
                  if (p.status?.kind === 'pending') return null
                  if (p.rootFailure !== null) return { text: `Your account could not be read: ${p.rootFailure}`, tone: 'negative' as const }
                  if (p.relaysResumeAt !== null && p.list.some(relayed))
                    return {
                      text: `Sessions revoked: Puppet relays nothing for you until ${new Date(p.relaysResumeAt * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
                      tone: 'negative' as const
                    }
                  if ((p.root === null || p.keyless) && p.depositMissing)
                    return { text: 'Setting up your account needs a deposit', tone: 'negative' as const, deposit: true as const }
                  if (p.keyless && p.underfunded !== null)
                    return { text: `Deposit at least ${p.underfunded} to set up your account`, tone: 'negative' as const }
                  if (p.allocationUnfunded)
                    return { text: `Add a deposit on ${chainName(HUB_CHAIN_ID)} for your mandates to pull funds from`, tone: 'negative' as const, deposit: true as const }
                  if (p.feeShortfall?.kind === 'short')
                    return {
                      text: `Not enough ETH, WETH, USDC or USDT on ${chainName(HUB_CHAIN_ID)} to pay the ${p.feeShortfall.leg.usd === null ? '' : `${formatUsd(p.feeShortfall.leg.usd, 1n)} `}relay fee`,
                      tone: 'negative' as const,
                      deposit: true as const
                    }
                  if (p.feeShortfall?.kind === 'unpriced')
                    return {
                      text: `Your ETH and WETH on ${chainName(HUB_CHAIN_ID)} do not cover the relay fee, and a token price is unavailable, so Puppet cannot tell whether your USDC or USDT does: ${formatThrownError(p.feeShortfall.error)}`,
                      tone: 'negative' as const
                    }
                  if (p.feeShortfall?.kind === 'unquoted')
                    return {
                      text: `The relay fee could not be quoted, so Puppet cannot check that your fund can pay it: ${formatThrownError(p.feeShortfall.error)}`,
                      tone: 'negative' as const
                    }
                  if (p.feeShortfall?.kind === 'pending') return null
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
                  allocationUnfunded,
                  feeShortfall,
                  root: rootState,
                  rootFailure: start(null, rootFailure),
                  relaysResumeAt
                })
              ),
              skipRepeatsWith((a, b) => a?.text === b?.text && a?.tone === b?.tone && a?.deposit === b?.deposit)
            )

            const $fees = switchMap(
              notice =>
                notice === null
                  ? $column(spacing.small, style({ fontSize: text.sm, whiteSpace: 'nowrap', alignItems: 'flex-end' }))($executionFees())
                  : notice.deposit
                    ? $row(spacing.small, style({ alignItems: 'center' }))(
                        $noticeLine(notice.text, notice.tone),
                        $defaultAnchor(
                          attr({ href: depositUrl }),
                          softNavClick(depositUrl),
                          style({ fontSize: text.sm, whiteSpace: 'nowrap' })
                        )($text('Deposit action'))
                      )
                    : $noticeLine(notice.text, notice.tone),
              footerNotice
            )

            const $readTerms = $Popover({
              $container: $node(style({ display: 'flex', flexShrink: '0' })),
              $open: constant(
                $column(spacing.default, style({ maxWidth: '320px' }))(
                  $node(style({ fontSize: text.base, color: palette.message }))($text('Before you begin')),
                  $betaAgreement(),
                  $ButtonSecondary({
                    $container: $defaultButtonSecondary(style({ alignSelf: 'flex-end', minHeight: '40px' })),
                    $content: $text('I agree')
                  })({ click: clickAgreeTether() })
                ),
                clickReadTerms
              ),
              $target: $ButtonSecondary({
                $container: isMobileScreen ? $defaultButtonSecondary(style({ minHeight: '44px' })) : $defaultButtonSecondary,
                $content: $text('Read Terms')
              })({ click: clickReadTermsTether() }),
              dismiss: op(clickAgree, delay(0))
            })({})

            return $row(spacing.small, style({ padding: '0 24px', alignItems: 'center', minWidth: 0 }))(
              $node(style({ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'flex-end' }))($fees),
              switchLatest(map(agreed => (agreed ? empty : $readTerms), consented)),
              $Button({
                $container: isMobileScreen ? $defaultButtonPrimary(style({ minHeight: '44px' })) : $defaultButtonPrimary,
                disabled: submitDisabled,
                $content: $text('Submit')
              })({ click: clickSubmitTether() })
            )
          })()
        )
      )

      return [
        $node(style({ display: 'contents' }))(
          switchMap(open => (open ? fadeIn($drawerContent) : empty), isOpen),
          filter((_): _ is never => false, anyInFlight),
          op(
            fromEventTarget(window, 'beforeunload'),
            tap(event => {
              if (inFlightRef.current) event.preventDefault()
            }),
            filter((_): _ is never => false)
          )
        ),
        {
          clearDrafts: op(
            clickClose,
            filter(sub => sub === null || !sub.halt.signal.aborted),
            constant(null)
          ),
          settled,
          releaseDraft: merge(
            releaseDraft,
            op(
              clickClose,
              filter((sub): sub is Submission => sub !== null && sub.halt.signal.aborted),
              map(sub => sub.steps.flatMap(step => (sub.started.has(step.key) ? [step.key] : []))),
              spreadArray
            )
          ),
          inFlight: anyInFlight
        }
      ]
    }
  )
