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
  op,
  sample,
  sampleMap,
  skipRepeats,
  start,
  switchLatest,
  switchMap,
  switchPromises,
  take
} from 'aelea/stream'
import { type IBehavior, multicast, PromiseStatus, promiseState, state } from 'aelea/stream-extended'
import { $node, $text, attr, component, effectRun, type I$Node, type I$Slottable, style } from 'aelea/ui'
import { $Button, $column, $row, designSheet, isMobileScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { type Address, type Hex, isAddressEqual } from 'viem'
import {
  $addressRef,
  $alertIntermediateSpinnerContainer,
  $alertNegativeContainer,
  $alertPositiveContainer,
  $anchor,
  $ButtonCircular,
  $check,
  $defaultButtonCircularContainer,
  $defaultButtonPrimary,
  $defaultTooltipDropContainer,
  $icon,
  $info,
  $labeledValue,
  $Tooltip,
  $xCross,
  fadeIn,
  text
} from '@/ui-components'
import { $jazzicon } from '../common/$avatar.js'
import { $chainIcon, chainName } from '../common/$chain.js'
import { $roboAvatar } from '../common/$roboAvatar.js'
import { $heading3 } from '../common/$text.js'
import { $card2 } from '../common/elements/$common.js'
import * as context from '../io/context.js'
import { findWalletDepositTxByRecipient } from '../io/indexer/query.js'
import { sqlClient } from '../io/indexer/sql.js'
import { compact } from '../io/matchmaker/index.js'
import { subject } from '../utils/subject.js'
import {
  bindSession,
  getStoredSessionKey,
  type IConnectedWallet,
  type ISessionKey,
  walletQuery
} from '../wallet/index.js'
import { $profileDisplay } from './$AccountProfile.js'
import {
  type IAllocateDraft,
  type IClaimDraft,
  type IDepositDraft,
  type IDraft,
  type IFulfillDraft,
  type ISellDraft,
  type ISubscribeDraft,
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
  subaccountList: IStream<Promise<ISubaccountState[]>>
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
  sell: 'Sell',
  claim: 'Claim',
  fulfill: 'Fulfill'
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
  accounts: ISubaccountState[]
}

type SubmissionStatus = { kind: 'pending' } | { kind: 'error'; message: string } | { kind: 'done' }
type ResolvedHash = { txHash: string; chainId: number }

export const $ActionDrawer = ({ subaccountList, draftList, title = 'Pending Actions' }: I$ActionDrawer) =>
  component(
    (
      [clickSubmit, clickSubmitTether]: IBehavior<PointerEvent>,
      [clickEnableSession, clickEnableSessionTether]: IBehavior<PointerEvent>,
      [clickCloseRaw, clickCloseTether]: IBehavior<PointerEvent>
    ) => {
      const tokenRegistryValue = switchPromises(context.tokenRegistryQuery)
      const subaccountListValues: IStream<ISubaccountState[]> = op(subaccountList, switchPromises, state())
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
          accounts: subaccountListValues
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
                subaccountList: subaccountListValues
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
          matchmaker: compact.status
        }),
        map(p => {
          if (p.submission !== null && !p.errored) return true
          if (p.list.length === 0) return true
          if (p.needsBind) return true
          if (p.indexerHealth.worstSeverity === 'unreachable') return true
          if (p.indexerHealth.worstSeverity === 'stale') return true
          if (p.matchmaker !== 'open') return true
          if (p.list.some(d => d.alert !== null)) return true
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
        if (d.kind === 'subscribe') return null
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
                else if (d.kind === 'sell') addRelay(token, feeMap.sell.relayFee)
                else if (d.kind === 'claim') addRelay(token, feeMap.claim.relayFee)
                else if (d.kind === 'fulfill') addRelay(token, feeMap.fulfill.relayFee)
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

      const $executionFees = $labeledValue(
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

      const $pill = (label: string, color: string): I$Node =>
        $node(
          style({
            backgroundColor: color,
            color: palette.background,
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: text.xs,
            fontWeight: '600'
          })
        )($text(label))

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
        hasAlert: boolean
      ): I$Node => {
        // An alert is a failure to proceed — render it with the same dashed-border + ✕ treatment
        // as a runtime failure so the drawer has one failure design, not two.
        const effectiveStatus: StepStatus = hasAlert ? 'failed' : status
        const content: I$Node[] = [
          $node(style({ color: palette.foreground, fontSize: text.xs }))($text(STEP_LABEL[kind])),
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
                  $anchor(attr({ href: getAccountExplorerUrl(recipient.address, recipientChain), target: '_blank' }))(
                    $text(readableAddress(recipient.address))
                  )
                )
              : $node(),
            tx && txChain
              ? $row(spacing.tiny, style({ alignItems: 'center', color: palette.foreground, fontSize: text.xs }))(
                  $text('Tx'),
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
        }>,
        query: Promise<unknown> | null,
        submitBlockByChain: Map<number, bigint>,
        hasAlert: boolean
      ): I$Node => {
        const $container = $row(spacing.tiny, style({ alignItems: 'center', flexWrap: 'wrap' }))
        if (query === null) {
          return $container(...steps.map(s => $stepPill(s.kind, 'queued', null, s.recipient, hasAlert)))
        }
        const txStreams: IStream<ResolvedHash | null>[] = steps.map(s => {
          if (s.nonce !== null) {
            return op(
              subaccountListValues,
              map((accounts): ResolvedHash | null => {
                for (const acc of accounts) {
                  for (const row of acc.chains.values()) {
                    if (row.lastNonce === s.nonce) {
                      return { txHash: row.lastTransactionHash, chainId: Number(row.chainId) }
                    }
                  }
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
              subaccountListValues,
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
        const combined = combineMap(
          (qs, ...txs: (ResolvedHash | null)[]) => ({ qs, txs }),
          promiseState(just(query)),
          ...txStreams
        )
        return $container(
          ...steps.map((step, i) =>
            switchMap(p => {
              const stepDone = (j: number) => p.txs[j] !== null || p.txs.slice(j + 1).some(t => t !== null)
              if (p.qs.status === PromiseStatus.DONE || stepDone(i))
                return $stepPill(step.kind, 'done', p.txs[i], step.recipient, false)
              const priorAllDone = p.txs.slice(0, i).every((_t, j) => stepDone(j))
              if (p.qs.status === PromiseStatus.ERROR)
                return $stepPill(step.kind, priorAllDone ? 'failed' : 'queued', null, step.recipient, false)
              return $stepPill(step.kind, priorAllDone ? 'current' : 'queued', null, step.recipient, hasAlert)
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
          map(list => {
            const acc = list.find(a => isAddressEqual(a.account, address))
            return acc && !acc.isFund
              ? $profileDisplay({ address, isFund: false, user: acc.user, profileSize: 24 })
              : $profileDisplay({
                  address,
                  name: fundName,
                  profileSize: 24,
                  $avatar: avatarSeed ? $roboAvatar(avatarSeed, 24) : undefined
                })
          }, subaccountListValues)
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

      const $subscribeDesc = (draft: ISubscribeDraft): I$Node =>
        $row(spacing.small, style({ alignItems: 'center' }))(
          $text(readableAddress(draft.master)),
          $metaText(getTokenDescription(draft.baseToken).symbol),
          $metaText(
            draft.allocationRate === 0n
              ? 'Revoke rule'
              : `${readablePercentage(draft.allocationRate)} · ${getDuration(Number(draft.throttlePeriod))}`
          )
        )

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

      const $fulfillDesc = (draft: IFulfillDraft, registry: ITokenRegistryMap): I$Node => {
        const { desc } = renderToken(registry, draft.baseTokenId)
        return $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap' }))(
          $text(`${readableTokenAmount(SHARE_DECIMALS, draft.acceptableShares)} shares`),
          ...(draft.sharesOut > 0n
            ? [$metaText(`incl. ${readableTokenAmount(SHARE_DECIMALS, draft.sharesOut)} of yours queued`)]
            : []),
          $metaText('retired by'),
          $addressOnChain(draft.masterAccount, HUB_CHAIN_ID)
        )
      }

      const $draftDescription = (draft: IDraft, registry: ITokenRegistryMap): I$Node => {
        if (draft.kind === 'subscribe') return $subscribeDesc(draft)
        if (draft.kind === 'deposit') return $depositDesc(draft, registry)
        if (draft.kind === 'withdraw') return $withdrawDesc(draft, registry)
        if (draft.kind === 'allocate') return $allocateDesc(draft, registry)
        if (draft.kind === 'sell') return $sellDesc(draft)
        if (draft.kind === 'claim') return $claimDesc(draft, registry)
        if (draft.kind === 'fulfill') return $fulfillDesc(draft, registry)
        return $metaText((draft as { title?: string; kind: string }).title ?? (draft as { kind: string }).kind)
      }

      const $draftBadge = (draft: IDraft, query: Promise<unknown> | null, submitBlockByChain: Map<number, bigint>) => {
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
            const account =
              step.kind === 'createFundAccount'
                ? predictFundAccount(predictPuppetAccount(step.input.params))
                : step.input.params.signer
            return {
              kind: step.kind,
              nonce: stepNonce(step),
              recipient: { address: predictDepositRoute(account), chainId: Number(step.input.chainId) }
            }
          })
          const trailingKind: StepKind = draft.kind === 'allocate' ? 'allocate' : 'createFundAccount'
          return $sequencedStepRow(
            [...fundSteps, { kind: trailingKind, nonce: null, recipient: null }],
            query,
            submitBlockByChain,
            draft.alert !== null
          )
        }
        if (draft.kind !== 'deposit' && draft.kind !== 'withdraw') {
          return $sequencedStepRow(
            [{ kind: draft.kind, nonce: null, recipient: null }],
            query,
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
        return $sequencedStepRow(steps, query, submitBlockByChain, draft.alert !== null)
      }

      const $item = (
        step: PlannedStep | Step,
        idx: number | null,
        registry: ITokenRegistryMap,
        query: Promise<unknown> | null,
        submitBlockByChain: Map<number, bigint>,
        showIndex: boolean
      ): I$Node => {
        if (step.kind === 'bind') {
          return $row(
            spacing.small,
            style({ alignItems: 'center', padding: '4px 0', opacity: '0.85', fontSize: text.xs })
          )(
            $pill('Authorize', palette.foreground),
            $column(style({ gap: '2px' }))(
              $node(style({ color: palette.message }))($text('One-time signature for this device')),
              $node(style({ color: palette.foreground, fontSize: text.xs }))(
                $text('Future actions on this device sign automatically without wallet popups.')
              )
            )
          )
        }
        const draft = step.draft
        return $row(spacing.small, style({ alignItems: 'center', padding: '6px 0' }))(
          ...(showIndex ? [$stepIndex(idx ?? 0)] : []),
          $draftBadge(draft, query, submitBlockByChain),
          $node(style({ flex: 1, minWidth: '16px' }))(),
          $node(style({ color: palette.message, fontWeight: '600' }))($text(DRAFT_VERB[draft.kind])),
          $draftDescription(draft, registry)
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
                return $column(spacing.small)(
                  ...steps.map(s => {
                    const stepIdx = s.kind === 'draft' ? idx++ : null
                    const query = 'query' in s ? s.query : null
                    const submitBlocks = 'submitBlockByChain' in s ? s.submitBlockByChain : new Map<number, bigint>()
                    return $item(s, stepIdx, p.registry, query, submitBlocks, showIndex)
                  })
                )
              },
              combine({ submission, planned: plannedSteps, registry: tokenRegistryValue })
            )
          ),

          (() => {
            // The status / error one-liner. On touch (mobile) there is no hover,
            // so the ellipsised + tooltip-only treatment is dropped in favour of
            // a full-width, wrapping message on its own line.
            const $statusMessage = switchMap(
              p => {
                if (p.status?.kind === 'done') {
                  return $node(style({ color: palette.positive, fontSize: text.xs, fontWeight: '600' }))($text('Done'))
                }
                const submissionError = p.status?.kind === 'error' ? p.status.message : null
                const matchmakerAlert =
                  p.matchmaker === 'connecting'
                    ? 'Reconnecting to relay…'
                    : p.matchmaker !== 'open'
                      ? 'Service offline, cannot submit'
                      : null
                const $oneLiner = (full: string, $tooltip?: I$Slottable): I$Node =>
                  isMobileScreen
                    ? $node(
                        style({
                          color: palette.negative,
                          fontSize: text.xs,
                          minWidth: 0,
                          whiteSpace: 'normal'
                        })
                      )($text(full))
                    : $Tooltip({
                        $dropContainer: $defaultTooltipDropContainer,
                        $content: $tooltip ?? $node($text(full)),
                        $anchor: $node(
                          style({
                            color: palette.negative,
                            fontSize: text.xs,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            minWidth: 0,
                            maxWidth: '320px',
                            cursor: 'help'
                          })
                        )($text(full))
                      })({})
                if (submissionError) return $oneLiner(submissionError)
                if (matchmakerAlert) return $oneLiner(matchmakerAlert)
                if (p.indexerHealth.worstSeverity === 'unreachable')
                  return $oneLiner('Service unreachable, cannot submit')
                if (p.indexerHealth.worstSeverity === 'stale') return $oneLiner('Data out of sync, cannot submit yet')
                const offending = p.list.find(d => d.alert !== null)
                if (!offending) return empty
                return $oneLiner(offending.alert!)
              },
              combine({
                list: draftList,
                status: submissionStatus,
                matchmaker: compact.status,
                indexerHealth: context.indexerHealth
              })
            )

            // Execution fees. On desktop the breakdown lives in the hover tooltip
            // ($executionFees). Touch has no hover, so on mobile render the
            // summary plus the breakdown inline and let it wrap.
            const $fees = switchMap(
              list =>
                list.length > 0 && !list.some(d => d.alert !== null)
                  ? isMobileScreen
                    ? $column(spacing.small, style({ fontSize: text.sm, minWidth: 0, whiteSpace: 'normal' }))(
                        $executionFees,
                        $executionFeesBreakdown()
                      )
                    : $node(style({ fontSize: text.sm, whiteSpace: 'nowrap' }))($executionFees)
                  : empty,
              draftList
            )

            const $enableSessionButton = switchMap(
              show =>
                show
                  ? $Button({
                      $container: isMobileScreen
                        ? $defaultButtonPrimary(style({ width: '100%', minHeight: '44px' }))
                        : $defaultButtonPrimary,
                      disabled: enableSessionPending,
                      $content: switchMap(
                        pending => $node($text(pending ? 'Enabling…' : 'Enable Session')),
                        enableSessionPending
                      )
                    })({ click: clickEnableSessionTether() })
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
                  $statusMessage,
                  $enableSessionButton,
                  $submitButton
                )
              : $row(spacing.small, style({ padding: '0 24px', alignItems: 'center', minWidth: 0 }))(
                  $fees,
                  $node(style({ flex: 1 }))(),
                  $statusMessage,
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
          changeAttest: attestSubject.stream
        }
      ]
    }
  )
