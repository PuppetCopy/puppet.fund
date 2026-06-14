import { HUB_CHAIN_ID, TOKEN_ID } from '@puppet/contracts/const'
import {
  predictDepositRoute,
  predictFundAccount,
  predictPuppetAccount,
  predictShareToken,
  symbolForBaseTokenId
} from '@puppet/sdk/account'
import { resolveDispatchChainId, resolveDispatchNetwork } from '@puppet/sdk/attestation'
import { formatThrownError } from '@puppet/sdk/compact'
import { CHAIN_MAP, HUB_CHAIN } from '@puppet/sdk/const'
import {
  getAccountExplorerUrl,
  getDuration,
  getTxExplorerUrl,
  ignoreAll,
  readableAddress,
  readableHash,
  readablePercentage,
  readableTokenAmount,
  readableTokenAmountLabel
} from '@puppet/sdk/core'
import { getTokenDescription } from '@puppet/sdk/gmx'
import {
  type IndexerHealth,
  type ISubaccountState,
  type ITokenRegistryMap,
  indexerBlock,
  type RelayFeeMap,
  type RelayMethod,
  stubSubaccountState,
  tokenInfoFor
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
  nowWith,
  op,
  sample,
  sampleMap,
  skipRepeats,
  skipRepeatsWith,
  start,
  switchLatest,
  switchMap,
  switchPromises,
  take
} from 'aelea/stream'
import { type IBehavior, multicast, PromiseStatus, promiseState, state } from 'aelea/stream-extended'
import { $node, $text, attr, component, effectProp, effectRun, type I$Node, style } from 'aelea/ui'
import { $Button, $column, $Popover, $row, designSheet, isMobileScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { pushUrl } from 'aelea/ui-router'
import { type Address, getAddress, type Hex, isAddressEqual } from 'viem'
import {
  $addressRef,
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
  $icon,
  $info,
  $labeledValue,
  $popoverCaret,
  $Tooltip,
  $xCross,
  fadeIn,
  text
} from '@/ui-components'
import { $jazzicon } from '../common/$avatar.js'
import { $route } from '../common/$common.js'
import { $chainIcon, chainName } from '../common/$chain.js'
import { $roboAvatar } from '../common/$roboAvatar.js'
import { $heading3 } from '../common/$text.js'
import { $card2 } from '../common/elements/$common.js'
import * as context from '../io/context.js'
import { fetchMasterPoolState, findWalletDepositTxByRecipient } from '../io/indexer/query.js'
import { sqlClient } from '../io/indexer/sql.js'
import { matchmakerStatus } from '../io/matchmaker/index.js'
import { subject } from '../utils/subject.js'
import {
  bindSession,
  getStoredSessionKey,
  type IConnectedWallet,
  type ISessionKey,
  walletQuery
} from '../wallet/index.js'
import { $profileDisplay } from './$AccountProfile.js'
import { $enableSessionDisclaimer } from './$enableSession.js'
import {
  type IAllocateDraft,
  type IClaimDraft,
  type IDepositDraft,
  type IDraft,
  type IRedeemDraft,
  type ISellDraft,
  type ISubscribeDraft,
  type ISwapDraft,
  type IWithdrawDraft,
  SHARE_DECIMALS,
  STEP_DESCRIPTION,
  STEP_LABEL,
  type StepKind,
  stepNonce
} from './portfolio/draft.js'
import { SESSION_BIND_KEY } from './portfolio/runner/_shared.js'
import { type IAttestation, runDraft } from './portfolio/runner/steps.js'

export type { IDraft }

interface I$ActionDrawer {
  walletState: IStream<ISubaccountState | null>
  draftList: IStream<IDraft[]>
  title?: string
}

type PlannedStep = { kind: 'bind' } | { kind: 'draft'; draft: IDraft }

const chainFor = (id: number) => (CHAIN_MAP as Record<number, typeof HUB_CHAIN>)[id] ?? HUB_CHAIN

const DRAFT_VERB: Record<IDraft['kind'], string> = {
  deposit: 'Deposit',
  withdraw: 'Withdraw',
  subscribe: 'Subscribe',
  allocate: 'Allocate',
  swap: 'Swap',
  sell: 'Sell',
  claim: 'Claim',
  redeem: 'Redeem'
}

function subscribeNeedsFunding(d: IDraft, root: ISubaccountState | null, list: IDraft[]): boolean {
  if (d.kind !== 'subscribe' || d.allocationRate === 0n) return false
  if ((root?.balances.get(d.baseTokenId)?.signedBalance ?? 0n) > 0n) return false
  return !list.some(x => x.kind === 'deposit' && x.output.baseTokenId === d.baseTokenId)
}

type BindStep = { kind: 'bind'; key: typeof SESSION_BIND_KEY; query: Promise<ISessionKey> }
type DraftStep = {
  kind: 'draft'
  key: string
  draft: IDraft
  query: Promise<IAttestation[]>
  submitBlockByChain: Map<number, bigint>
}
type Step = BindStep | DraftStep
interface Submission {
  steps: Step[]
}

type SubmitEnv = {
  wallet: IConnectedWallet
  planned: PlannedStep[]
  gasPrice: bigint
  indexerHealth: IndexerHealth
  registry: ITokenRegistryMap
  root: ISubaccountState | null
}

type SubmissionStatus = { kind: 'pending' } | { kind: 'error'; message: string } | { kind: 'done' }
type ResolvedHash = { txHash: string; chainId: number }

export const $ActionDrawer = ({ walletState: rootState, draftList, title = 'Pending Actions' }: I$ActionDrawer) =>
  component(
    (
      [clickSubmit, clickSubmitTether]: IBehavior<PointerEvent>,
      [clickEnableSession, clickEnableSessionTether]: IBehavior<PointerEvent>,
      [popEnableSession, popEnableSessionTether]: IBehavior<PointerEvent>,
      [clickCloseRaw, clickCloseTether]: IBehavior<PointerEvent>,
      [changeDraft, _changeDraftTether]: IBehavior<IDepositDraft | IWithdrawDraft>
    ) => {
      const tokenRegistryValue = switchPromises(context.tokenRegistryQuery)
      const walletState: IStream<IConnectedWallet | null> = op(walletQuery, switchPromises, state())

      // Attestation rows captured from each runDraft return value, fed up to
      // the parent so it can fold them into account state without the indexer.
      const attestSubject = subject<IAttestation>()

      const enableSessionFlow = op(
        clickEnableSession,
        sample(walletState),
        filter((w): w is IConnectedWallet => w !== null),
        switchMap(w => promiseState(just(bindSession(w)))),
        state()
      )
      const sessionTick = start(
        null,
        op(
          enableSessionFlow,
          filter(s => s.status === PromiseStatus.DONE)
        )
      )
      const enableSessionPending: IStream<boolean> = op(
        enableSessionFlow,
        map(s => s.status === PromiseStatus.PENDING),
        skipRepeats,
        state(false)
      )
      const needsBind: IStream<boolean> = op(
        combine({ wallet: walletState, tick: sessionTick }),
        map(p => p.wallet !== null && getStoredSessionKey(p.wallet.address) === null),
        skipRepeats,
        state()
      )

      const plannedSteps: IStream<PlannedStep[]> = op(
        combine({
          wallet: walletState,
          list: draftList,
          tick: sessionTick
        }),
        map(({ wallet, list }): PlannedStep[] => {
          context.setIndexerUrgency(list.length > 0 ? 'high' : 'idle')
          const plan: PlannedStep[] = []
          if (!wallet) return list.map(d => ({ kind: 'draft', draft: d }))
          if (!getStoredSessionKey(wallet.address)) plan.push({ kind: 'bind' })
          for (const d of list) plan.push({ kind: 'draft', draft: d })
          return plan
        }),
        state([])
      )

      const inFlightRef = { current: false }
      // Escape key inside the drawer feeds the same close path as the X button,
      // so the in-flight confirm guard below applies uniformly to both.
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
        combine({
          wallet: walletState,
          planned: plannedSteps,
          gasPrice: context.gasPrice,
          indexerHealth: context.indexerHealth,
          registry: tokenRegistryValue,
          root: rootState
        }),
        map((p): SubmitEnv | null => (p.wallet ? (p as SubmitEnv) : null)),
        state(null)
      )

      const submitEvent: IStream<Submission> = op(
        clickSubmit,
        sampleMap((env, _click) => env, submitEnv),
        filterNull,
        map((env): Submission => {
          const sessionPromise: Promise<ISessionKey> = bindSession(env.wallet)
          const steps: Step[] = []
          let chain: Promise<unknown> = sessionPromise
          for (const planStep of env.planned) {
            if (planStep.kind === 'bind') {
              steps.push({ kind: 'bind', key: SESSION_BIND_KEY, query: sessionPromise })
              continue
            }
            const draft = planStep.draft
            const query = chain.then<IAttestation[]>(async () => {
              const session = await sessionPromise
              const events = await runDraft(draft, {
                gasPrice: env.gasPrice,
                indexerHealth: env.indexerHealth,
                tokenRegistry: env.registry,
                sql: sqlClient,
                wallet: env.wallet,
                session,
                walletState: rootState
              })
              for (const event of events) attestSubject.push(event)
              return events
            })
            const submitBlockByChain = new Map<number, bigint>()
            if (draft.kind === 'deposit' || draft.kind === 'withdraw') {
              for (const s of draft.inputSteps) {
                if (s.kind !== 'walletDeposit' && s.kind !== 'walletDepositWnt') continue
                const chainId = s.input.chainId
                if (submitBlockByChain.has(chainId)) continue
                try {
                  submitBlockByChain.set(
                    chainId,
                    indexerBlock(env.indexerHealth, resolveDispatchNetwork(resolveDispatchChainId(chainId)))
                  )
                } catch {
                  // chain not in indexerHealth; txByRecipient falls back to 0n
                }
              }
            }
            steps.push({ kind: 'draft', key: draft.id, draft, query, submitBlockByChain })
            chain = query
          }
          return { steps }
        })
      )

      const submission: IStream<Submission | null> = op(
        merge(submitEvent, constant(null, clickClose) as IStream<Submission | null>),
        state(null)
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
            const drafts = s.steps.filter((st): st is DraftStep => st.kind === 'draft')
            return merge(
              ...drafts.map(step =>
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
      const settled: IStream<unknown> = constant(null, draftSuccess)

      // Promise.allSettled([]) resolves immediately so empty submissions report not-in-flight.
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

      // A failed submission is recoverable: it must NOT permanently block Submit,
      // so we can retry the remaining (unreleased) drafts. Only a pending or done
      // submission blocks re-submission.
      const submissionErrored: IStream<boolean> = op(
        submissionStatus,
        map(s => s?.kind === 'error'),
        skipRepeats,
        state(false)
      )

      const submitDisabled = op(
        combine({
          list: draftList,
          submission,
          errored: submissionErrored,
          needsBind,
          indexerHealth: context.indexerHealth,
          matchmaker: matchmakerStatus,
          root: rootState
        }),
        map(p => {
          if (p.submission !== null && !p.errored) return true
          if (p.list.length === 0) return true
          if (p.needsBind) return true
          if (p.indexerHealth.worstSeverity === 'unreachable') return true
          if (p.indexerHealth.worstSeverity === 'stale') return true
          if (p.matchmaker !== 'open') return true
          if (p.list.some(d => d.alert !== null)) return true
          if (p.list.some(d => subscribeNeedsFunding(d, p.root, p.list))) return true
          return false
        })
      )

      const showEnableSession: IStream<boolean> = op(
        combine({ needsBind, submission }),
        map(p => p.needsBind && p.submission === null),
        skipRepeats
      )

      const baseTokenIdFor = (d: IDraft): Hex | null => {
        if (d.kind === 'deposit' || d.kind === 'withdraw') return d.inputAmount.baseTokenId
        if (d.kind === 'swap') return d.tokenInId
        if (d.kind === 'subscribe') return d.baseTokenId
        if ('baseTokenId' in d) return d.baseTokenId
        return null
      }

      type FeeBreakdown = {
        relay: Map<Hex, bigint>
        bridge: Map<Hex, bigint>
        descOf: (token: Hex) => ReturnType<typeof getTokenDescription>
      }

      const feeBreakdown: IStream<FeeBreakdown> = switchMap(list => {
        const tokens = [...new Set(list.map(baseTokenIdFor).filter((t): t is Hex => t !== null))]
        const tokenFeeStreams = tokens.map(t => context.relayFeeMapForToken(t))

        return op(
          combineMap(
            (_gas: bigint, registry: ITokenRegistryMap, ...feeMaps: RelayFeeMap[]): FeeBreakdown => {
              const feeMapByToken = new Map<Hex, RelayFeeMap>()
              tokens.forEach((t, i) => {
                feeMapByToken.set(t, feeMaps[i]!)
              })
              const relay = new Map<Hex, bigint>()
              const bridge = new Map<Hex, bigint>()
              const addRelay = (token: Hex, fee: bigint) => relay.set(token, (relay.get(token) ?? 0n) + fee)
              const addBridge = (token: Hex, fee: bigint) => bridge.set(token, (bridge.get(token) ?? 0n) + fee)
              for (const d of list) {
                const token = baseTokenIdFor(d)
                const feeMap = token ? feeMapByToken.get(token) : undefined
                if (!feeMap || !token) continue
                if (d.kind === 'subscribe') addRelay(token, feeMap.subscribe.relayFee)
                else if (d.kind === 'allocate') addRelay(token, feeMap.allocate.relayFee)
                else if (d.kind === 'swap') addRelay(token, feeMap.operate.relayFee)
                else if (d.kind === 'sell') addRelay(token, feeMap.sell.relayFee)
                else if (d.kind === 'claim') addRelay(token, feeMap.claim.relayFee)
                else if (d.kind === 'redeem') addRelay(token, feeMap.redeem.relayFee)
                else if (d.kind === 'deposit' || d.kind === 'withdraw') {
                  for (const step of d.inputSteps) {
                    if (step.kind === 'walletDeposit' || step.kind === 'walletDepositWnt') continue
                    const fee = feeMap[step.kind as RelayMethod]?.relayFee
                    if (fee) addRelay(token, fee)
                  }
                  if (d.output.approx && token === TOKEN_ID.USDC) {
                    const f = d.inputAmount.amount - d.output.amount
                    if (f > 0n) addBridge(token, f)
                  }
                }
              }
              const descOf = (token: Hex) => getTokenDescription(tokenInfoFor(registry, HUB_CHAIN_ID, token).token)
              return { relay, bridge, descOf }
            },
            context.gasPrice,
            tokenRegistryValue,
            ...tokenFeeStreams
          )
        )
      }, draftList)

      // The fee breakdown (per-token bridge/relay + gas). Used as the hover
      // tooltip on desktop and rendered inline on touch (mobile) where there is
      // no hover. A factory so each placement gets a fresh node.
      const $executionFeesBreakdown = (): I$Node =>
        switchMap(p => {
          const tokens = new Set<Hex>([...p.relay.keys(), ...p.bridge.keys()])
          if (tokens.size === 0) {
            return $column(
              spacing.small,
              style({ minWidth: '200px', fontSize: text.sm })
            )($labeledValue('Relay fees', $text('-')))
          }
          return $column(
            spacing.small,
            style({ minWidth: '200px', fontSize: text.sm })
          )(
            ...[...tokens].flatMap(t => {
              const bridgeFee = p.bridge.get(t) ?? 0n
              const relayFee = p.relay.get(t) ?? 0n
              const desc = p.descOf(t)
              const rows: I$Node[] = []
              if (bridgeFee > 0n) rows.push($labeledValue('Bridge fees', readableTokenAmountLabel(desc, bridgeFee)))
              rows.push($labeledValue('Relay fees', relayFee === 0n ? '-' : readableTokenAmountLabel(desc, relayFee)))
              return rows
            })
          )
        }, feeBreakdown)

      const $executionFees = (): I$Node =>
        $labeledValue(
          'Execution fees',
          $text(
            map(p => {
              const tokens = new Set<Hex>([...p.relay.keys(), ...p.bridge.keys()])
              if (tokens.size === 0) return '-'
              return [...tokens]
                .map(t => readableTokenAmountLabel(p.descOf(t), (p.relay.get(t) ?? 0n) + (p.bridge.get(t) ?? 0n)))
                .join(' + ')
            }, feeBreakdown)
          ),
          $executionFeesBreakdown()
        )

      // ── render primitives ─────────────────────────────────────────────────

      const $addressOnChain = (addr: Address, chainId: number): I$Node =>
        $row(spacing.small, style({ alignItems: 'center', color: palette.foreground, fontSize: text.xs }))(
          $chainIcon(chainId, 14),
          $addressRef(addr, chainFor(chainId))
        )

      const $metaText = (label: string): I$Node =>
        $node(style({ color: palette.foreground, fontSize: text.xs }))($text(label))

      const $stepIndex = (i: number): I$Node =>
        $node(
          style({
            minWidth: '22px',
            height: '22px',
            borderRadius: '50%',
            backgroundColor: colorShade(palette.foreground, 15),
            color: palette.foreground,
            fontSize: text.xs,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: '600'
          })
        )($text(String(i + 1)))

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
        status: StepStatus,
        tx: ResolvedHash | null,
        recipient: { address: Address; chainId: number } | null,
        hasAlert: boolean,
        label: string
      ): I$Node => {
        // An alert is a failure to proceed — render it with the same dashed-border + ✕ treatment
        // as a runtime failure so the drawer has one failure design, not two.
        const effectiveStatus: StepStatus = hasAlert ? 'failed' : status
        const content: I$Node[] = [
          $node(style({ color: palette.foreground, fontSize: text.xs }))($text(label)),
          $trailingGlyph(effectiveStatus)
        ]
        const pillBg = style({ backgroundColor: palette.background, cursor: 'help' })
        const $pillNode =
          effectiveStatus === 'done'
            ? pillBg($alertPositiveContainer(...content))
            : effectiveStatus === 'failed'
              ? pillBg($alertNegativeContainer(...content))
              : effectiveStatus === 'current'
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
        const recipientChain = recipient ? chainFor(recipient.chainId) : null
        const txChain = tx ? chainFor(tx.chainId) : null
        return $Tooltip({
          $dropContainer: $defaultTooltipDropContainer,
          $content: $column(spacing.tiny, style({ maxWidth: '260px', fontSize: text.sm, whiteSpace: 'normal' }))(
            $text(STEP_DESCRIPTION[kind]),
            recipient && recipientChain
              ? $row(spacing.tiny, style({ alignItems: 'center', color: palette.foreground, fontSize: text.xs }))(
                  $text(
                    kind === 'createPuppetAccount'
                      ? 'Account'
                      : kind === 'walletDeposit' || kind === 'walletDepositWnt'
                        ? 'To'
                        : 'From'
                  ),
                  $chainIcon(recipient.chainId, 14),
                  $anchor(attr({ href: getAccountExplorerUrl(recipient.address, recipientChain), target: '_blank' }))(
                    $text(readableAddress(recipient.address))
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

      const $sequencedStepRow = (
        steps: ReadonlyArray<{
          kind: StepKind
          nonce: bigint | null
          recipient: { address: Address; chainId: number } | null
          label?: string
        }>,
        query: Promise<unknown> | null,
        priorQuery: Promise<unknown> | null,
        submitBlockByChain: Map<number, bigint>,
        hasAlert: boolean
      ): I$Node => {
        const $container = $row(spacing.tiny, style({ alignItems: 'center', flexWrap: 'wrap' }))
        const labelOf = (s: { kind: StepKind; label?: string }): string => s.label ?? STEP_LABEL[s.kind]
        if (query === null) {
          return $container(...steps.map(s => $stepPill(s.kind, 'queued', null, s.recipient, hasAlert, labelOf(s))))
        }
        const txStreams: IStream<ResolvedHash | null>[] = steps.map(s => {
          if (s.nonce !== null) {
            return op(
              rootState,
              map((root): ResolvedHash | null => {
                if (root?.lastNonce === s.nonce) {
                  return { txHash: root.lastTransactionHash, chainId: Number(root.chainId) }
                }
                return null
              }),
              filterNull,
              take(1),
              start(null as ResolvedHash | null)
            )
          }
          if (s.recipient !== null && (s.kind === 'walletDeposit' || s.kind === 'walletDepositWnt')) {
            const recipient = s.recipient
            const minBlock = submitBlockByChain.get(recipient.chainId) ?? 0n
            return op(
              rootState,
              switchMap(async (): Promise<ResolvedHash | null> => {
                const txHash = await findWalletDepositTxByRecipient(recipient.address, recipient.chainId, minBlock)
                return txHash ? { txHash, chainId: recipient.chainId } : null
              }),
              filterNull,
              take(1),
              start(null as ResolvedHash | null)
            )
          }
          return just(null as ResolvedHash | null)
        })
        const draftActive$: IStream<boolean> =
          priorQuery === null
            ? just(true)
            : op(
                promiseState(just(priorQuery)),
                map(s => s.status === PromiseStatus.DONE),
                skipRepeats
              )
        const combined = combineMap(
          (qs, draftActive: boolean, ...txs: (ResolvedHash | null)[]) => ({ qs, draftActive, txs }),
          promiseState(just(query)),
          draftActive$,
          ...txStreams
        )
        return $container(
          ...steps.map((step, i) =>
            switchMap(p => {
              const stepDone = (j: number) => p.txs[j] !== null || p.txs.slice(j + 1).some(t => t !== null)
              if (p.qs.status === PromiseStatus.DONE || stepDone(i))
                return $stepPill(step.kind, 'done', p.txs[i], step.recipient, false, labelOf(step))
              const priorAllDone = p.txs.slice(0, i).every((_t, j) => stepDone(j))
              if (p.qs.status === PromiseStatus.ERROR)
                return $stepPill(
                  step.kind,
                  priorAllDone ? 'failed' : 'queued',
                  null,
                  step.recipient,
                  false,
                  labelOf(step)
                )
              return $stepPill(
                step.kind,
                p.draftActive && priorAllDone ? 'current' : 'queued',
                null,
                step.recipient,
                hasAlert,
                labelOf(step)
              )
            }, combined)
          )
        )
      }

      // ── per-draft-kind description ────────────────────────────────────────

      const renderToken = (registry: ITokenRegistryMap, baseTokenId: Hex) => {
        const homeToken = tokenInfoFor(registry, HUB_CHAIN_ID, baseTokenId).token
        const desc = getTokenDescription(homeToken)
        return { symbol: symbolForBaseTokenId(baseTokenId) ?? desc.symbol, desc }
      }

      const $accountProfile = (address: Address, fundName?: Hex, avatarSeed?: Address): I$Node =>
        switchLatest(
          map(root => {
            return root && isAddressEqual(root.account, address)
              ? $profileDisplay({ address, isFund: false, user: root.user, profileSize: 24 })
              : $profileDisplay({
                  address,
                  name: fundName,
                  profileSize: 24,
                  $avatar: avatarSeed ? $roboAvatar(avatarSeed, 24) : undefined
                })
          }, rootState)
        )

      const fundStateCache = new Map<string, ReturnType<typeof fetchMasterPoolState>>()
      const $fundIdentity = (fundAccount: Address): I$Node =>
        switchLatest(
          map(root => {
            const owned = root?.funds.find(f => isAddressEqual(f.fund as Address, fundAccount)) ?? null
            if (owned) return $accountProfile(fundAccount, owned.name as Hex, getAddress(owned.shareToken as Address))
            const key = fundAccount.toLowerCase()
            let fetched = fundStateCache.get(key)
            if (!fetched) {
              fetched = fetchMasterPoolState(fundAccount)
              fundStateCache.set(key, fetched)
            }
            return switchLatest(
              map(
                fund =>
                  fund
                    ? $accountProfile(fundAccount, fund.name as Hex, getAddress(fund.shareToken as Address))
                    : $addressOnChain(fundAccount, HUB_CHAIN_ID),
                op(just(fetched), switchPromises, start(undefined))
              )
            )
          }, rootState)
        )

      const $depositDesc = (draft: IDepositDraft, registry: ITokenRegistryMap): I$Node => {
        const { symbol, desc } = renderToken(registry, draft.inputAmount.baseTokenId)
        const isSweep = draft.inputAmount.amount === 0n
        const approx = draft.output.approx ? '≈ ' : ''
        const sweep = isSweep ? 'Sweep all · ' : ''
        const amountText = `${sweep}${approx}${readableTokenAmount(desc, draft.output.amount)} ${symbol}`
        return $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap' }))($text(amountText))
      }

      const $withdrawDesc = (draft: IWithdrawDraft, registry: ITokenRegistryMap): I$Node => {
        const step = draft.inputSteps[0]!
        const isBridge = step.kind === 'withdrawToBridge'
        const isSweep = isBridge && step.input.inputAmount === 0n
        const { symbol, desc } = renderToken(registry, draft.inputAmount.baseTokenId)
        const approx = draft.output.approx ? '≈ ' : ''
        const sweep = isSweep ? 'Sweep all · ' : ''
        const amountText = `${sweep}${approx}${readableTokenAmount(desc, draft.output.amount)} ${symbol}`
        const tooltip = isSweep
          ? isBridge
            ? 'Sweeps puppet balance at execution; includes late-arriving deposits or reward drips. The bridge fill may deliver slightly less after bridge fees.'
            : 'Sweeps puppet balance at execution; includes late-arriving deposits or reward drips.'
          : isBridge
            ? 'The bridge fill may deliver slightly less after bridge fees.'
            : 'Exact partial withdraw; relay fee is paid separately from the puppet balance.'
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

      const $subscribeDesc = (draft: ISubscribeDraft, registry: ITokenRegistryMap): I$Node => {
        const trader = $fundIdentity(predictFundAccount(draft.master))
        if (draft.allocationRate === 0n) {
          return $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap' }))($text('Stop copying'), trader)
        }
        const { symbol, desc } = renderToken(registry, draft.baseTokenId)
        return $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap' }))(
          trader,
          $metaText('·'),
          $text(`${readablePercentage(draft.allocationRate)} of your ${symbol} per trade`),
          ...(draft.throttlePeriod > 0n ? [$metaText(`max 1 / ${getDuration(Number(draft.throttlePeriod))}`)] : []),
          ...(draft.rateLimit > 0n ? [$metaText(`cap ${readableTokenAmount(desc, draft.rateLimit)}`)] : []),
          ...(draft.symmetry > 0n ? [$metaText('≤ trader')] : [])
        )
      }

      const $allocateDesc = (draft: IAllocateDraft, registry: ITokenRegistryMap): I$Node => {
        const { symbol, desc } = renderToken(registry, draft.baseTokenId)
        return $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap' }))(
          $text(`${readableTokenAmount(desc, draft.masterAmount)} ${symbol}`),
          $metaText('to'),
          $accountProfile(
            draft.master,
            draft.name,
            predictShareToken(draft.masterSigner, draft.baseTokenId, draft.name)
          )
        )
      }

      const $swapDesc = (draft: ISwapDraft, registry: ITokenRegistryMap): I$Node => {
        const tokenIn = renderToken(registry, draft.tokenInId)
        if (draft.destinationChainId !== draft.chainId) {
          return $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap' }))(
            $text(`${readableTokenAmount(tokenIn.desc, draft.amountIn)} ${tokenIn.symbol}`),
            $metaText('to'),
            $fundIdentity(draft.account),
            $metaText('on'),
            $chainIcon(draft.destinationChainId, 14),
            $text(chainName(draft.destinationChainId))
          )
        }
        const tokenOut = renderToken(registry, draft.tokenOutId)
        return $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap' }))(
          $text(`${readableTokenAmount(tokenIn.desc, draft.amountIn)} ${tokenIn.symbol}`),
          $metaText('to at least'),
          $text(`${readableTokenAmount(tokenOut.desc, draft.minOut)} ${tokenOut.symbol}`),
          $metaText('in'),
          $fundIdentity(draft.account)
        )
      }

      const $sellDesc = (draft: ISellDraft): I$Node =>
        $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap' }))(
          $text(`${readableTokenAmount(SHARE_DECIMALS, draft.sharesOut)} shares`),
          $metaText('queued from'),
          $addressOnChain(draft.masterAccount, HUB_CHAIN_ID)
        )

      const $claimDesc = (draft: IClaimDraft, registry: ITokenRegistryMap): I$Node => {
        const { symbol, desc } = renderToken(registry, draft.baseTokenId)
        return $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap' }))(
          $text(`${readableTokenAmount(desc, draft.amount)} ${symbol}`),
          $metaText('from'),
          $addressOnChain(draft.masterAccount, HUB_CHAIN_ID)
        )
      }

      const $redeemDesc = (draft: IRedeemDraft, registry: ITokenRegistryMap): I$Node => {
        const { symbol, desc } = renderToken(registry, draft.baseTokenId)
        return $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap' }))(
          $text(
            draft.liquidate
              ? 'entire fund at the closing price, all assets'
              : draft.fulfill
                ? 'full queue'
                : `${readableTokenAmount(desc, draft.assetsOut)} ${symbol}`
          ),
          ...(draft.sharesOut > 0n
            ? [$metaText(`incl. ${readableTokenAmount(SHARE_DECIMALS, draft.sharesOut)} of your shares queued`)]
            : []),
          $metaText('from'),
          $fundIdentity(draft.masterAccount)
        )
      }

      const $draftDescription = (draft: IDraft, registry: ITokenRegistryMap): I$Node => {
        if (draft.kind === 'subscribe') return $subscribeDesc(draft, registry)
        if (draft.kind === 'deposit') return $depositDesc(draft, registry)
        if (draft.kind === 'withdraw') return $withdrawDesc(draft, registry)
        if (draft.kind === 'allocate') return $allocateDesc(draft, registry)
        if (draft.kind === 'swap') return $swapDesc(draft, registry)
        if (draft.kind === 'sell') return $sellDesc(draft)
        if (draft.kind === 'claim') return $claimDesc(draft, registry)
        if (draft.kind === 'redeem') return $redeemDesc(draft, registry)
        return $metaText((draft as { title?: string; kind: string }).title ?? (draft as { kind: string }).kind)
      }

      const $draftBadge = (
        draft: IDraft,
        query: Promise<unknown> | null,
        priorQuery: Promise<unknown> | null,
        submitBlockByChain: Map<number, bigint>
      ) => {
        if (draft.kind === 'allocate') {
          const fundSteps = draft.inputSteps.map(step => {
            if (step.kind === 'transferToMaster' || step.kind === 'transferToMasterWnt') {
              return {
                kind: step.kind,
                nonce: null,
                recipient: {
                  address: predictDepositRoute(step.input.params.signer),
                  chainId: step.input.chainId
                }
              }
            }
            if (step.kind === 'createPuppetAccount') {
              return {
                kind: step.kind,
                nonce: stepNonce(step),
                recipient: { address: draft.masterSigner, chainId: Number(step.input.chainId) }
              }
            }
            const account =
              step.kind === 'createFundAccount'
                ? predictFundAccount(predictPuppetAccount(step.input.params))
                : step.input.params.signer
            return {
              kind: step.kind,
              nonce: step.kind === 'createFundAccount' ? null : stepNonce(step),
              recipient: { address: predictDepositRoute(account), chainId: Number(step.input.chainId) }
            }
          })
          const trailingKind: StepKind = draft.kind === 'allocate' ? 'allocate' : 'createFundAccount'
          return $sequencedStepRow(
            [...fundSteps, { kind: trailingKind, nonce: null, recipient: null }],
            query,
            priorQuery,
            submitBlockByChain,
            draft.alert !== null
          )
        }
        if (draft.kind !== 'deposit' && draft.kind !== 'withdraw') {
          const kind: StepKind =
            draft.kind === 'redeem' && draft.liquidate
              ? 'liquidate'
              : draft.kind === 'swap' && draft.destinationChainId !== draft.chainId
                ? 'bridge'
                : draft.kind
          const label = draft.kind === 'subscribe' && draft.allocationRate === 0n ? 'Unsubscribe' : undefined
          return $sequencedStepRow(
            [{ kind, nonce: null, recipient: null, label }],
            query,
            priorQuery,
            submitBlockByChain,
            draft.alert !== null
          )
        }
        const steps = draft.inputSteps.map(step => {
          if (step.kind === 'createPuppetAccount') {
            return {
              kind: step.kind,
              nonce: stepNonce(step),
              recipient: { address: predictPuppetAccount(step.input.params), chainId: Number(step.input.chainId) }
            }
          }
          const depositRoute = predictDepositRoute(predictPuppetAccount(step.input.params))
          const hasChainId =
            step.kind === 'walletDeposit' ||
            step.kind === 'walletDepositWnt' ||
            step.kind === 'recognize' ||
            step.kind === 'bridge'
          const recipient = hasChainId ? { address: depositRoute, chainId: Number(step.input.chainId) } : null
          return { kind: step.kind, nonce: stepNonce(step), recipient }
        })
        return $sequencedStepRow(steps, query, priorQuery, submitBlockByChain, draft.alert !== null)
      }

      const $item = (
        step: PlannedStep | Step,
        idx: number | null,
        registry: ITokenRegistryMap,
        query: Promise<unknown> | null,
        priorQuery: Promise<unknown> | null,
        submitBlockByChain: Map<number, bigint>,
        showIndex: boolean
      ): I$Node => {
        if (step.kind === 'bind') return empty
        const draft = step.draft
        const isMultiStep = draft.kind === 'deposit' || draft.kind === 'withdraw' || draft.kind === 'allocate'
        return $row(spacing.small, style({ alignItems: 'center', padding: '6px 0' }))(
          ...(showIndex ? [$stepIndex(idx ?? 0)] : []),
          $draftBadge(draft, query, priorQuery, submitBlockByChain),
          $node(style({ flex: 1, minWidth: '16px' }))(),
          ...(isMultiStep
            ? [$node(style({ color: palette.message, fontWeight: '600' }))($text(DRAFT_VERB[draft.kind]))]
            : []),
          $draftDescription(draft, registry)
        )
      }

      const $depositHeader = (
        tokenId: Hex,
        wallet: IConnectedWallet,
        root: ISubaccountState | null,
        registry: ITokenRegistryMap
      ): I$Node => {
        const signer = wallet.session?.signer ?? root?.signer ?? wallet.address
        const accountState: IStream<ISubaccountState> = op(
          rootState,
          map(r => r ?? stubSubaccountState({ user: wallet.address, signer }))
        )
        return op(
          accountState,
          skipRepeatsWith(
            (a, b) =>
              (a.balances.get(tokenId)?.signedBalance ?? 0n) === (b.balances.get(tokenId)?.signedBalance ?? 0n)
          ),
          map(metric => {
            const token = tokenInfoFor(registry, HUB_CHAIN_ID, tokenId).token
            const tokenDescription = getTokenDescription(token)
            const balance = metric.balances.get(tokenId)?.signedBalance ?? 0n
            return $row(spacing.default, style({ padding: '4px', alignItems: 'center', flex: 1 }))(
              $route(tokenDescription, true),
              $node(style({ flex: 1 }))(),
              balance === 0n
                ? $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))(
                    $icon({ $content: $info, width: '12px', fill: palette.indeterminate }),
                    $node(
                      style({
                        color: palette.foreground,
                        fontSize: text.xs,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        minWidth: '0'
                      })
                    )($text('Funds your account, not the trader'))
                  )
                : $node(style({ flex: 1 }))(),
              $node(
                style({ cursor: 'pointer', color: palette.message, fontSize: text.sm, whiteSpace: 'nowrap' }),
                effectProp(
                  'onclick',
                  nowWith(() => (ev: MouseEvent) => {
                    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return
                    ev.preventDefault()
                    pushUrl('/portfolio')
                  })
                )
              )($text('Wallet Page'))
            )
          }),
          switchLatest
        )
      }

      // ── layout ────────────────────────────────────────────────────────────

      const drawerTitleId = 'action-drawer-title'

      // Modal dialog behavior: trap Tab/Shift+Tab within the drawer, route
      // Escape to the close path, move focus in on open and restore it on close.
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
        ;(first ?? root).focus()
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
              p => {
                const steps: ReadonlyArray<PlannedStep | Step> = p.submission ? p.submission.steps : p.planned
                if (steps.length === 0) return empty
                const showIndex = steps.filter(s => s.kind === 'draft').length > 1
                let idx = 0
                const priorQueryByDraft = new Map<string, Promise<unknown> | null>()
                let prevQuery: Promise<unknown> | null = null
                for (const st of steps) {
                  const q = 'query' in st ? st.query : null
                  if (st.kind === 'draft' && q) priorQueryByDraft.set(st.draft.id, prevQuery)
                  if (q) prevQuery = q
                }
                const renderStep = (s: PlannedStep | Step): I$Node => {
                  const stepIdx = s.kind === 'draft' ? idx++ : null
                  const query = 'query' in s ? s.query : null
                  const priorQuery =
                    s.kind === 'draft' && 'query' in s ? (priorQueryByDraft.get(s.draft.id) ?? null) : null
                  const submitBlocks = 'submitBlockByChain' in s ? s.submitBlockByChain : new Map<number, bigint>()
                  return $item(s, stepIdx, p.registry, query, priorQuery, submitBlocks, showIndex)
                }
                const isSub = (s: PlannedStep | Step): boolean => s.kind === 'draft' && s.draft.kind === 'subscribe'
                const firstSub = steps.findIndex(isSub)
                if (firstSub < 0) return $column(spacing.small)(...steps.map(renderStep))
                const lastSub = steps.reduce((acc, s, i) => (isSub(s) ? i : acc), firstSub)
                const groups = new Map<Hex, (PlannedStep | Step)[]>()
                for (const s of steps.slice(firstSub, lastSub + 1)) {
                  if (!isSub(s)) continue
                  const tid = ((s as DraftStep).draft as ISubscribeDraft).baseTokenId
                  const g = groups.get(tid) ?? []
                  g.push(s)
                  groups.set(tid, g)
                }
                return $column(spacing.small)(
                  ...steps.slice(0, firstSub).map(renderStep),
                  ...[...groups.entries()].map(([tokenId, group]) => {
                    return $column(spacing.small)(
                      ...(p.wallet ? [$depositHeader(tokenId, p.wallet, p.root, p.registry)] : []),
                      $column(
                        spacing.small,
                        style({
                          paddingLeft: '14px',
                          marginLeft: '10px',
                          borderLeft: `1px solid ${colorShade(palette.foreground, 15)}`
                        })
                      )(...group.map(renderStep))
                    )
                  }),
                  ...steps.slice(lastSub + 1).map(renderStep)
                )
              },
              combine({
                submission,
                planned: plannedSteps,
                registry: tokenRegistryValue,
                wallet: walletState,
                root: rootState
              })
            )
          ),

          (() => {
            // The status / error one-liner. On touch (mobile) there is no hover,
            // so the ellipsised + tooltip-only treatment is dropped in favour of
            // a full-width, wrapping message on its own line.
            const $noticeLine = (full: string, positive: boolean): I$Node => {
              const color = positive ? palette.positive : palette.negative
              const weight = positive ? '600' : '500'
              return isMobileScreen
                ? $node(style({ color, fontSize: text.xs, fontWeight: weight, minWidth: 0, whiteSpace: 'normal' }))(
                    $text(full)
                  )
                : $node(
                    style({
                      display: 'block',
                      color,
                      fontSize: text.xs,
                      fontWeight: weight,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      minWidth: 0
                    })
                  )($text(full))
            }

            const footerNotice: IStream<{ text: string; positive: boolean } | null> = op(
              map(
                p => {
                  if (p.status?.kind === 'done') return { text: 'Done', positive: true }
                  if (p.status?.kind === 'error') return { text: p.status.message, positive: false }
                  if (p.matchmaker === 'connecting') return { text: 'Reconnecting to relay…', positive: false }
                  if (p.matchmaker !== 'open') return { text: 'Service offline, cannot submit', positive: false }
                  if (p.indexerHealth.worstSeverity === 'unreachable')
                    return { text: 'Service unreachable, cannot submit', positive: false }
                  if (p.indexerHealth.worstSeverity === 'stale')
                    return { text: 'Data out of sync, cannot submit yet', positive: false }
                  const offending = p.list.find(d => d.alert !== null)
                  if (offending) return { text: offending.alert as string, positive: false }
                  const unfunded = p.list.find(d => subscribeNeedsFunding(d, p.root, p.list))
                  if (unfunded && unfunded.kind === 'subscribe') {
                    const sym =
                      symbolForBaseTokenId(unfunded.baseTokenId) ?? getTokenDescription(unfunded.baseToken).symbol
                    return { text: `Deposit ${sym} above to fund this copy before you can submit`, positive: false }
                  }
                  return null
                },
                combine({
                  list: draftList,
                  status: submissionStatus,
                  matchmaker: matchmakerStatus,
                  indexerHealth: context.indexerHealth,
                  root: rootState
                })
              ),
              skipRepeatsWith((a, b) => a?.text === b?.text && a?.positive === b?.positive)
            )

            const $feesContent = (): I$Node =>
              isMobileScreen
                ? $column(spacing.small, style({ fontSize: text.sm, minWidth: 0, whiteSpace: 'normal' }))(
                    $executionFees(),
                    $executionFeesBreakdown()
                  )
                : $node(style({ fontSize: text.sm, whiteSpace: 'nowrap' }))($executionFees())
            const $fees = switchMap(
              notice => (notice === null ? $feesContent() : $noticeLine(notice.text, notice.positive)),
              footerNotice
            )

            const $enableSessionButton = switchMap(
              show =>
                show
                  ? $Popover({
                      $container: isMobileScreen
                        ? $node(style({ display: 'flex', width: '100%' }))
                        : $node(style({ display: 'flex' })),
                      $open: map(
                        () =>
                          $column(spacing.default, style({ maxWidth: '320px' }))(
                            ...$enableSessionDisclaimer(),
                            $Button({
                              $container: $defaultButtonPrimary(style({ width: '100%', minHeight: '40px' })),
                              disabled: enableSessionPending,
                              $content: switchMap(
                                pending => $node($text(pending ? 'Enabling…' : 'Enable session')),
                                enableSessionPending
                              )
                            })({ click: clickEnableSessionTether() })
                          ),
                        popEnableSession
                      ),
                      dismiss: op(
                        enableSessionFlow,
                        filter(s => s.status === PromiseStatus.DONE)
                      ),
                      $target: $ButtonSecondary({
                        $container: isMobileScreen
                          ? $defaultButtonSecondary(style({ width: '100%', minHeight: '44px' }))
                          : $defaultButtonSecondary,
                        $content: $row(spacing.tiny, style({ alignItems: 'center' }))(
                          $text('Enable Session'),
                          $popoverCaret()
                        )
                      })({ click: popEnableSessionTether() })
                    })({})
                  : empty,
              showEnableSession
            )

            const $submitButton = $Button({
              $container: isMobileScreen
                ? $defaultButtonPrimary(style({ width: '100%', minHeight: '44px' }))
                : $defaultButtonPrimary,
              disabled: submitDisabled,
              $content: switchMap(list => {
                if (list.some(d => d.alert !== null)) return $node($text('Resolve alerts'))
                return $node($text(list.length > 1 ? `Submit ${list.length} actions` : 'Submit'))
              }, draftList)
            })({
              click: clickSubmitTether()
            })

            return isMobileScreen
              ? $column(spacing.small, style({ padding: '0 24px', minWidth: 0 }))(
                  $fees,
                  $enableSessionButton,
                  $submitButton
                )
              : $row(spacing.small, style({ padding: '0 24px', alignItems: 'center', minWidth: 0 }))(
                  $node(style({ flex: 1, minWidth: 0 }))($fees),
                  $enableSessionButton,
                  $submitButton
                )
          })()
        )
      )

      return [
        $node(style({ display: 'contents' }))(
          switchMap(open => (open ? fadeIn($drawerContent) : empty), isOpen),
          ignoreAll(anyInFlight)
        ),
        {
          clearDrafts: constant(null, clickClose),
          settled,
          releaseDraft,
          changeAttest: attestSubject.stream,
          changeDraft
        }
      ]
    }
  )
