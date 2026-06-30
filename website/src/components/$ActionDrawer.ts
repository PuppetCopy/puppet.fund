import { HUB_CHAIN_ID, PRECISION } from '@puppet/contracts/const'
import {
  predictFundAccount,
  predictShareToken,
  symbolForBaseTokenId
} from '@puppet/sdk/account'
import { resolveDispatchChainId } from '@puppet/sdk/attestation'
import { formatThrownError } from '@puppet/sdk/compact'
import { CHAIN_MAP, HUB_CHAIN } from '@puppet/sdk/const'
import {
  getAccountExplorerUrl,
  getDuration,
  getRegisteredTokenDescription,
  getTxExplorerUrl,
  ignoreAll,
  readableAddress,
  readableHash,
  readablePercentage,
  readableTokenAmount
} from '@puppet/sdk/core'
import {
  chainHeadBlock,
  type IChainLiveness,
  type ISubaccountState,
  type ITokenRegistryMap,
  symbolByAddress,
  type RelayFeeMap,
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
import { $node, $text, attr, component, effectRun, type I$Node, style } from 'aelea/ui'
import { $Button, $column, $Popover, $row, designSheet, isMobileScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
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
import { $chainIcon, chainName } from '../common/$chain.js'
import { $route } from '../common/$common.js'
import { $roboAvatar } from '../common/$roboAvatar.js'
import { $heading3 } from '../common/$text.js'
import { $card2, $navText } from '../common/elements/$common.js'
import context, { displayRelayFeeMap } from '../io/context.js'
import { fetchMasterPoolState, findWalletDepositTxByRecipient } from '../io/datastore/query.js'
import { formatUsd, priceFor } from '../io/gmx/priceFeed.js'
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
  type IFundSwapDraft,
  type IRedeemDraft,
  type ISellDraft,
  type ISubscribeDraft,
  type IWithdrawDraft,
  STEP_DESCRIPTION,
  STEP_LABEL,
  type StepKind,
} from './portfolio/draft.js'
import { SESSION_BIND_KEY } from './portfolio/runner/_shared.js'
import { type PlannedStep, planExecution, planShape, shouldRecognize } from './portfolio/runner/plan.js'
import { type IAttestation, runDraft, runMandateBatch } from './portfolio/runner/steps.js'

export type { IDraft }

interface I$ActionDrawer {
  walletState: IStream<ISubaccountState | null>
  draftList: IStream<IDraft[]>
  title?: string
}

const chainFor = (id: number) => (CHAIN_MAP as Record<number, typeof HUB_CHAIN>)[id] ?? HUB_CHAIN

const DRAFT_VERB: Record<IDraft['kind'], string> = {
  deposit: 'Deposit',
  withdraw: 'Withdraw',
  mandate: 'Fund',
  allocate: 'Allocate',
  fundSwap: 'Swap',
  sell: 'Sell',
  claim: 'Claim',
  redeem: 'Redeem',
  recognizeFund: 'Recognize'
}

function subscribeNeedsFunding(d: IDraft, root: ISubaccountState | null, list: IDraft[]): boolean {
  if (d.kind !== 'mandate' || d.allocationRate === 0n) return false
  if ((root?.balances.get(d.baseToken)?.signedBalance ?? 0n) > 0n) return false
  return !list.some(x => x.kind === 'deposit' && x.output.baseToken === d.baseToken)
}

const chainsForDraft = (d: IDraft): number[] => {
  const chains = new Set<number>([HUB_CHAIN_ID])
  if (d.kind === 'deposit' || d.kind === 'allocate') {
    if (d.wallet) chains.add(d.wallet.chainId)
    if (d.swap) chains.add(Number(d.swap.chainId))
  } else if (d.kind === 'fundSwap') {
    chains.add(d.chainId)
  }
  return [...chains]
}

const staleChainFor = (d: IDraft, health: IChainLiveness): number | null => {
  for (const chainId of chainsForDraft(d)) {
    const chain = health.chains[resolveDispatchChainId(chainId)]
    if (chain && !chain.reachable) return chainId
  }
  return null
}

const firstStaleChain = (drafts: IDraft[], health: IChainLiveness): number | null =>
  drafts.reduce<number | null>((found, d) => found ?? staleChainFor(d, health), null)

const severitySig = (h: IChainLiveness): string =>
  h.reachable
    ? Object.entries(h.chains)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, c]) => `${id}:${c.reachable}`)
        .join('|')
    : 'unreachable'

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
      const tokenRegistryValue = fromPromise(context.getTokenRegistry())
      const walletState: IStream<IConnectedWallet | null> = op(walletQuery, switchPromises, state())

      // Attestation rows captured from each runDraft return value, fed up to
      // the parent so it can fold them into account state without a datastore round-trip.
      const attestSubject = subject<IAttestation>()

      const enableSessionFlow = op(
        clickEnableSession,
        sample(walletState),
        filter((w): w is IConnectedWallet => w !== null),
        switchMap(w => promiseState(just(bindSession(w)))),
        state()
      )
      const enableSessionError: IStream<string | null> = op(
        enableSessionFlow,
        map(s => (s.status === PromiseStatus.ERROR ? formatThrownError(s.error) : null)),
        state(null)
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
          root: rootState
        }),
        map((p): SubmitEnv | null => (p.wallet ? (p as SubmitEnv) : null)),
        state(null)
      )

      const submitEvent: IStream<Submission> = op(
        clickSubmit,
        sampleMap((env, _click) => env, submitEnv),
        filterNull,
        switchMap((env): IStream<Submission> => {
          const sessionPromise: Promise<ISessionKey> = bindSession(env.wallet)
          const submissionPromise: Promise<Submission> = (async (): Promise<Submission> => {
            const [gasPrice, chainLiveness, registry] = await Promise.all([
              context.getChainGasPrice(HUB_CHAIN_ID),
              context.getChainLiveness(),
              context.getTokenRegistry()
            ])
            const steps: Step[] = []
            const runCtx = (session: ISessionKey) => ({
              gasPrice,
              chainLiveness,
              tokenRegistry: registry,
              wallet: env.wallet,
              session
            })
            const submitBlocksFor = (draft: IDraft): Map<number, bigint> => {
              const submitBlockByChain = new Map<number, bigint>()
              if (draft.kind === 'deposit' && draft.wallet) {
                const chainId = draft.wallet.chainId
                try {
                  submitBlockByChain.set(
                    chainId,
                    chainHeadBlock(chainLiveness, resolveDispatchChainId(chainId))
                  )
                } catch {
                  // chain not in chainLiveness; txByRecipient falls back to 0n
                }
              }
              return submitBlockByChain
            }

            const queryByBase = new Map<Hex, Promise<IAttestation[]>>()
            const draftsInOrder: IDraft[] = []
            for (const ps of env.planned) if (ps.kind === 'draft') draftsInOrder.push(ps.draft)

            let chain: Promise<unknown> = sessionPromise
            for (const entry of planExecution(env.planned)) {
              if (entry.kind === 'bind') {
                steps.push({ kind: 'bind', key: SESSION_BIND_KEY, query: sessionPromise })
                continue
              }
              const draft = entry.draft
              let query: Promise<IAttestation[]>
              if (draft.kind === 'mandate' && !entry.lead) {
                query = queryByBase.get(draft.baseToken) as Promise<IAttestation[]>
              } else {
                const group = entry.batch
                query = chain.then<IAttestation[]>(async () => {
                  const session = await sessionPromise
                  const events =
                    draft.kind === 'mandate'
                      ? await runMandateBatch(group as ISubscribeDraft[], runCtx(session))
                      : await runDraft(draft, runCtx(session), shouldRecognize(draft, draftsInOrder))
                  for (const event of events) attestSubject.push(event)
                  return events
                })
                chain = query
                if (draft.kind === 'mandate') queryByBase.set(draft.baseToken, query)
              }
              steps.push({ kind: 'draft', key: draft.id, draft, query, submitBlockByChain: submitBlocksFor(draft) })
            }
            return { steps }
          })()
          return fromPromise(submissionPromise)
        })
      )

      const submission: IStream<Submission | null> = op(
        merge(submitEvent, constant(null, clickClose) as IStream<Submission | null>),
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
          chainLiveness: chainLivenessValue,
          root: rootState
        }),
        map(p => {
          if (p.submission !== null && !p.errored) return true
          if (p.list.length === 0) return true
          if (p.needsBind) return true
          if (!p.chainLiveness.reachable) return true
          if (firstStaleChain(p.list, p.chainLiveness) !== null) return true
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

      const baseTokenIdFor = (d: IDraft): Address | null => {
        if (d.kind === 'deposit' || d.kind === 'withdraw') return d.inputAmount.baseToken
        if (d.kind === 'mandate') return d.baseToken
        if (d.kind === 'fundSwap') return d.tokenIn
        if ('baseToken' in d) return d.baseToken
        return null
      }

      type FeeBreakdown = {
        relayUsd: bigint
        swapFeeUsd: bigint
        // true if any pending draft's relay fee is unpriceable (oracle has no rate) -> the total can't be summed
        // honestly, so the row shows '-' rather than an understated figure.
        feeUnavailable: boolean
      }

      const feeBreakdown: IStream<FeeBreakdown> = switchMap(({ list }) => {
        // Price EVERY token toUsd touches below, not just baseTokenIdFor: bridge legs price step.input.token,
        // and deposit/withdraw approx prices the input and output base tokens. A narrower set silently zeroes those
        // swap-fee terms (the old shared price map covered all registered tokens). Deduped, so extras are harmless.
        const tokens = [
          ...new Set(
            list.flatMap((d): Address[] => {
              const ts: Address[] = []
              const base = baseTokenIdFor(d)
              if (base !== null) ts.push(base)
              if (d.kind === 'allocate') {
                if (d.swap) ts.push(d.swap.inputToken, d.baseToken)
              } else if (d.kind === 'deposit' || d.kind === 'withdraw') {
                ts.push(d.inputAmount.baseToken)
                if (d.output.approx) ts.push(d.output.baseToken)
              }
              return ts
            })
          )
        ]
        const tokenFeeStreams = tokens.map(t => fromPromise(displayRelayFeeMap(t)))

        // Per-token prices arrive as their own 10s-refreshing streams. The hub
        // addresses come from the registry, so resolve it first then fan the
        // distinct base tokens out into priceFor streams (positional, by index).
        return switchMap((registry: ITokenRegistryMap) => {
          const tokenPriceStreams = tokens.map(t => {
            const info = registry.get(HUB_CHAIN_ID)?.get(getAddress(t))
            return info ? priceFor(getAddress(info.token)) : just<bigint | null>(null)
          })
          return op(
            combineMap(
              (_gas: bigint, ...rest: (RelayFeeMap | bigint | null)[]): FeeBreakdown => {
                const feeMaps = rest.slice(0, tokens.length) as (RelayFeeMap | null)[]
                const prices = rest.slice(tokens.length) as (bigint | null)[]
                const feeMapByToken = new Map<Address, RelayFeeMap | null>()
                const priceByToken = new Map<Address, bigint | null>()
                tokens.forEach((t, i) => {
                  feeMapByToken.set(t, feeMaps[i]!)
                  priceByToken.set(t, prices[i] ?? null)
                })
                const toUsd = (amount: bigint, token: Address): bigint => {
                  const price = priceByToken.get(token) ?? null
                  return price === null ? 0n : amount * price
                }
                let relayUsd = 0n
                let swapFeeUsd = 0n
                let feeUnavailable = false
                for (const d of list) {
                  const token = baseTokenIdFor(d)
                  if (!token) continue
                  const feeMap = feeMapByToken.get(token)
                  if (feeMap === undefined) continue
                  // Unpriceable fee for a pending draft -> the summed total is incomplete; flag it so the row shows '-'.
                  if (feeMap === null) {
                    feeUnavailable = true
                    continue
                  }
                  let relayToken = 0n
                  if (d.kind === 'mandate') relayToken = feeMap.mandate.relayFee
                  else if (d.kind === 'allocate') {
                    relayToken = feeMap.allocate.relayFee
                    if (d.swap) {
                      relayToken += feeMap.swap?.relayFee ?? 0n
                      const lost = toUsd(d.swap.inputAmount, d.swap.inputToken) - toUsd(d.swap.outputAmount, d.baseToken)
                      if (lost > 0n) swapFeeUsd += lost
                    }
                  } else if (d.kind === 'fundSwap') relayToken = feeMap.swap.relayFee
                  else if (d.kind === 'sell') relayToken = feeMap.sell.relayFee
                  else if (d.kind === 'claim') relayToken = feeMap.claim.relayFee
                  else if (d.kind === 'redeem') relayToken = feeMap.redeem.relayFee
                  else if (d.kind === 'deposit') {
                    if (d.swap) relayToken += feeMap.swap?.relayFee ?? 0n
                    if (shouldRecognize(d, list)) relayToken += feeMap.recognize?.relayFee ?? 0n
                    if (d.output.approx) {
                      const lost =
                        toUsd(d.inputAmount.amount, d.inputAmount.baseToken) -
                        toUsd(d.output.amount, d.output.baseToken)
                      if (lost > 0n) swapFeeUsd += lost
                    }
                  } else if (d.kind === 'withdraw') {
                    relayToken += feeMap.withdraw?.relayFee ?? 0n
                  }
                  relayUsd += toUsd(relayToken, token)
                }
                return { relayUsd, swapFeeUsd, feeUnavailable }
              },
              fromPromise(context.getChainGasPrice(HUB_CHAIN_ID)),
              ...tokenFeeStreams,
              ...tokenPriceStreams
            )
          )
        }, tokenRegistryValue)
      }, combine({ list: draftList }))

      // The fee breakdown (per-token bridge/relay + gas). Used as the hover
      // tooltip on desktop and rendered inline on touch (mobile) where there is
      // no hover. A factory so each placement gets a fresh node.
      const $executionFeesBreakdown = (): I$Node =>
        switchMap(p => {
          const rows: I$Node[] = []
          if (p.swapFeeUsd > 0n) rows.push($labeledValue('Swap fee', formatUsd(p.swapFeeUsd, 1n)))
          rows.push(
            $labeledValue('Relay fees', p.feeUnavailable || p.relayUsd === 0n ? '-' : formatUsd(p.relayUsd, 1n))
          )
          return $column(spacing.small, style({ minWidth: '200px', fontSize: text.sm }))(...rows)
        }, feeBreakdown)

      const $executionFees = (): I$Node =>
        $labeledValue(
          'Execution fees',
          $text(
            map(p => {
              if (p.feeUnavailable) return '-'
              const total = p.relayUsd + p.swapFeeUsd
              return total === 0n ? '-' : formatUsd(total, 1n)
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
                $text(kind === 'walletTransfer' ? 'To' : 'From'),
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
          if (s.recipient !== null && s.kind === 'walletTransfer') {
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
                  p.draftActive && priorAllDone ? 'failed' : 'queued',
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

      const renderToken = (registry: ITokenRegistryMap, token: Address) => {
        const homeToken = tokenInfoFor(registry, HUB_CHAIN_ID, token).token
        const desc = getRegisteredTokenDescription(homeToken)
        return { symbol: symbolByAddress(token), desc }
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
              // Never cache a not-yet-indexed (undefined) fund or a getPriceead forever: evict so a later render
              // re-queries once the fund is indexed, instead of pinning the bare on-chain address for the session.
              void fetched.then(
                fund => {
                  if (!fund) fundStateCache.delete(key)
                },
                () => fundStateCache.delete(key)
              )
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
        if (draft.inputAmount.amount === 0n) {
          return $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap' }))($text('Sweep all'))
        }
        return $row(
          spacing.small,
          style({ alignItems: 'center', flexWrap: 'wrap' })
        )($text(map(price => `≈ ${formatUsd(draft.inputAmount.amount, price)}`, priceFor(draft.inputAmount.baseToken))))
      }

      const $withdrawDesc = (draft: IWithdrawDraft, registry: ITokenRegistryMap): I$Node => {
        const input = draft.input
        const isBridge = input.route.kind === 'across'
        const isSweep = isBridge && input.inputAmount === 0n
        const { symbol, desc } = renderToken(registry, draft.inputAmount.baseToken)
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
        const trader = $fundIdentity(
          predictFundAccount({ master: draft.master, baseToken: draft.baseToken, name: draft.name })
        )
        if (draft.allocationRate === 0n) {
          return $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap' }))($text('Stop funding'), trader)
        }
        const { symbol, desc } = renderToken(registry, draft.baseToken)
        return $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap' }))(
          trader,
          $metaText('·'),
          $text(`${readablePercentage(draft.allocationRate)} of your ${symbol} per funding request`),
          ...(draft.throttlePeriod > 0n ? [$metaText(`max 1 / ${getDuration(Number(draft.throttlePeriod))}`)] : []),
          ...(draft.rateLimit > 0n ? [$metaText(`cap ${readableTokenAmount(desc, draft.rateLimit)}`)] : []),
          ...(draft.symmetry > 0n ? [$metaText('≤ trader')] : [])
        )
      }

      const $allocateDesc = (draft: IAllocateDraft, registry: ITokenRegistryMap): I$Node => {
        const { symbol, desc } = renderToken(registry, draft.baseToken)
        return $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap' }))(
          $text(`${readableTokenAmount(desc, draft.masterAmount)} ${symbol}`),
          $metaText('to'),
          $accountProfile(
            draft.master,
            draft.name,
            predictShareToken({ master: draft.masterSigner, baseToken: draft.baseToken, name: draft.name })
          )
        )
      }

      const $sellDesc = (draft: ISellDraft): I$Node =>
        $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap' }))(
          $text(`${readableTokenAmount(PRECISION.shareTokenDecimals, draft.sharesOut)} shares`),
          $metaText('queued from'),
          $addressOnChain(draft.masterAccount, HUB_CHAIN_ID)
        )

      const $claimDesc = (draft: IClaimDraft, registry: ITokenRegistryMap): I$Node => {
        const { symbol } = renderToken(registry, draft.baseToken)
        return $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap' }))(
          $text(`all claimable ${symbol}`),
          $metaText('from'),
          $addressOnChain(draft.masterAccount, HUB_CHAIN_ID)
        )
      }

      const $redeemDesc = (draft: IRedeemDraft, registry: ITokenRegistryMap): I$Node => {
        const { symbol, desc } = renderToken(registry, draft.baseToken)
        return $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap' }))(
          $text(
            draft.liquidate
              ? 'entire fund at the closing price, all assets'
              : draft.fulfill
                ? 'full queue'
                : `${readableTokenAmount(desc, draft.assetsOut)} ${symbol}`
          ),
          ...(draft.sharesOut > 0n
            ? [$metaText(`incl. ${readableTokenAmount(PRECISION.shareTokenDecimals, draft.sharesOut)} of your shares queued`)]
            : []),
          $metaText('from'),
          $fundIdentity(draft.masterAccount)
        )
      }

      const $swapDesc = (draft: IFundSwapDraft, registry: ITokenRegistryMap): I$Node => {
        const tokenIn = renderToken(registry, draft.tokenIn)
        const tokenOut = renderToken(registry, draft.tokenOut)
        return $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap' }))(
          $text(`${readableTokenAmount(tokenIn.desc, draft.amountIn)} ${tokenIn.symbol}`),
          $metaText('to at least'),
          $text(`${readableTokenAmount(tokenOut.desc, draft.minOut)} ${tokenOut.symbol}`),
          $metaText('in'),
          $fundIdentity(draft.account)
        )
      }

      const $draftDescription = (draft: IDraft, registry: ITokenRegistryMap): I$Node => {
        if (draft.kind === 'mandate') return $subscribeDesc(draft, registry)
        if (draft.kind === 'deposit') return $depositDesc(draft, registry)
        if (draft.kind === 'withdraw') return $withdrawDesc(draft, registry)
        if (draft.kind === 'allocate') return $allocateDesc(draft, registry)
        if (draft.kind === 'fundSwap') return $swapDesc(draft, registry)
        if (draft.kind === 'sell') return $sellDesc(draft)
        if (draft.kind === 'claim') return $claimDesc(draft, registry)
        if (draft.kind === 'redeem') return $redeemDesc(draft, registry)
        return $metaText((draft as { title?: string; kind: string }).title ?? (draft as { kind: string }).kind)
      }

      const $draftBadge = (
        draft: IDraft,
        registry: ITokenRegistryMap,
        query: Promise<unknown> | null,
        priorQuery: Promise<unknown> | null,
        submitBlockByChain: Map<number, bigint>,
        recognize: boolean
      ) =>
        $sequencedStepRow(
          planShape(draft, registry, recognize),
          query,
          priorQuery,
          submitBlockByChain,
          draft.alert !== null
        )

      const $item = (
        step: PlannedStep | Step,
        idx: number | null,
        registry: ITokenRegistryMap,
        query: Promise<unknown> | null,
        priorQuery: Promise<unknown> | null,
        submitBlockByChain: Map<number, bigint>,
        showIndex: boolean,
        recognize: boolean
      ): I$Node => {
        if (step.kind === 'bind') return empty
        const draft = step.draft
        const isMultiStep = draft.kind === 'deposit' || draft.kind === 'withdraw' || draft.kind === 'allocate'
        return $row(spacing.small, style({ alignItems: 'center', padding: '6px 0' }))(
          ...(showIndex ? [$stepIndex(idx ?? 0)] : []),
          $draftBadge(draft, registry, query, priorQuery, submitBlockByChain, recognize),
          $node(style({ flex: 1, minWidth: '16px' }))(),
          ...(isMultiStep
            ? [$node(style({ color: palette.message, fontWeight: '600' }))($text(DRAFT_VERB[draft.kind]))]
            : []),
          $draftDescription(draft, registry)
        )
      }

      const $depositHeader = (
        token: Hex,
        wallet: IConnectedWallet,
        root: ISubaccountState | null,
        registry: ITokenRegistryMap,
        depositQueued: boolean
      ): I$Node => {
        const signer = wallet.session?.signer ?? root?.signer ?? wallet.address
        const accountState: IStream<ISubaccountState> = op(
          rootState,
          map(r => r ?? stubSubaccountState({ user: wallet.address, signer }))
        )
        return op(
          accountState,
          skipRepeatsWith(
            (a, b) => (a.balances.get(token)?.signedBalance ?? 0n) === (b.balances.get(token)?.signedBalance ?? 0n)
          ),
          map(metric => {
            const tokenDescription = getRegisteredTokenDescription(token)
            const balance = metric.balances.get(token)?.signedBalance ?? 0n
            return $row(spacing.default, style({ padding: '4px', alignItems: 'center', flex: 1 }))(
              $route(tokenDescription, true),
              balance === 0n && !depositQueued
                ? $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))(
                    $Tooltip({
                      $dropContainer: $defaultTooltipDropContainer,
                      $content: $column(spacing.tiny, style({ maxWidth: '260px', fontSize: text.sm, whiteSpace: 'normal' }))(
                        $text(
                          'Matching pulls from your own deposited balance when this trader opens a position. Your funds stay in your account, in your custody. You are funding yourself, not paying the trader.'
                        )
                      ),
                      $anchor: $icon({ $content: $info, width: '12px', fill: palette.indeterminate })
                    })({}),
                    $node(style({ color: palette.foreground, fontSize: text.xs, whiteSpace: 'nowrap' }))(
                      $text('Deposit to your account to enable matching')
                    ),
                    $navText(
                      `/portfolio?action=deposit-${symbolForBaseTokenId(token) ?? tokenDescription.symbol}`,
                      'Portfolio',
                      undefined,
                      text.xs
                    )
                  )
                : $node()
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
              p => {
                const steps: ReadonlyArray<PlannedStep | Step> = p.submission ? p.submission.steps : p.planned
                if (steps.length === 0) return empty
                const isSub = (s: PlannedStep | Step): boolean => s.kind === 'draft' && s.draft.kind === 'mandate'

                const priorQueryByDraft = new Map<string, Promise<unknown> | null>()
                let prevQuery: Promise<unknown> | null = null
                for (const st of steps) {
                  const q = 'query' in st ? st.query : null
                  if (st.kind === 'draft' && q) priorQueryByDraft.set(st.draft.id, prevQuery)
                  if (q) prevQuery = q
                }

                const firstSub = steps.findIndex(isSub)
                const lastSub = firstSub < 0 ? -1 : steps.reduce((acc, s, i) => (isSub(s) ? i : acc), firstSub)
                const groups = new Map<Hex, (PlannedStep | Step)[]>()
                for (const s of steps.slice(firstSub < 0 ? 0 : firstSub, lastSub + 1)) {
                  if (!isSub(s)) continue
                  const tid = ((s as DraftStep).draft as ISubscribeDraft).baseToken
                  groups.set(tid, [...(groups.get(tid) ?? []), s])
                }
                const nonSubDraftCount = steps.filter(s => s.kind === 'draft' && !isSub(s)).length
                const showIndex = nonSubDraftCount + groups.size > 1

                const draftsInOrder: IDraft[] = []
                for (const s of steps) if (s.kind === 'draft') draftsInOrder.push(s.draft)

                let idx = 0
                const renderStep = (s: PlannedStep | Step): I$Node => {
                  const stepIdx = s.kind === 'draft' ? idx++ : null
                  const query = 'query' in s ? s.query : null
                  const priorQuery =
                    s.kind === 'draft' && 'query' in s ? (priorQueryByDraft.get(s.draft.id) ?? null) : null
                  const submitBlocks = 'submitBlockByChain' in s ? s.submitBlockByChain : new Map<number, bigint>()
                  const recognize = s.kind === 'draft' ? shouldRecognize(s.draft, draftsInOrder) : true
                  return $item(s, stepIdx, p.registry, query, priorQuery, submitBlocks, showIndex, recognize)
                }
                if (firstSub < 0) return $column(spacing.small)(...steps.map(renderStep))

                const $group = (token: Hex, group: (PlannedStep | Step)[]): I$Node => {
                  const first = group[0]!
                  const draft = (first as DraftStep).draft
                  const query = 'query' in first ? first.query : null
                  const priorQuery = priorQueryByDraft.get(draft.id) ?? null
                  const stepIdx = idx++
                  const depositQueued = draftsInOrder.some(d => d.kind === 'deposit' && d.output.baseToken === token)
                  return $column(spacing.small)(
                    ...(p.wallet ? [$depositHeader(token, p.wallet, p.root, p.registry, depositQueued)] : []),
                    $row(spacing.small, style({ alignItems: 'center', padding: '6px 0' }))(
                      ...(showIndex ? [$stepIndex(stepIdx)] : []),
                      $draftBadge(draft, p.registry, query, priorQuery, new Map<number, bigint>(), true)
                    ),
                    $column(
                      spacing.small,
                      style({
                        paddingLeft: '14px',
                        marginLeft: '10px',
                        borderLeft: `1px solid ${colorShade(palette.foreground, 15)}`
                      })
                    )(...group.map(s => $draftDescription((s as DraftStep).draft, p.registry)))
                  )
                }
                return $column(spacing.small)(
                  ...steps.slice(0, firstSub).map(renderStep),
                  ...[...groups.entries()].map(([token, group]) => $group(token, group)),
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
                  if (!p.chainLiveness.reachable)
                    return { text: 'Service unreachable, cannot submit', positive: false }
                  const staleChain = firstStaleChain(p.list, p.chainLiveness)
                  if (staleChain !== null)
                    return { text: `${chainName(staleChain)} out of sync, cannot submit yet`, positive: false }
                  const offending = p.list.find(d => d.alert !== null)
                  if (offending) return { text: offending.alert as string, positive: false }
                  const unfunded = p.list.find(d => subscribeNeedsFunding(d, p.root, p.list))
                  if (unfunded && unfunded.kind === 'mandate') {
                    const sym = getRegisteredTokenDescription(unfunded.baseToken).symbol
                    return {
                      text: `Deposit ${sym} above to fund this allocation before you can submit`,
                      positive: false
                    }
                  }
                  return null
                },
                combine({
                  list: draftList,
                  status: submissionStatus,
                  chainLiveness: chainLivenessValue,
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
                          })({ click: clickEnableSessionTether() }),
                          switchMap(
                            err => (err ? $alertNegativeContainer(style({ fontSize: text.sm }))($text(err)) : empty),
                            enableSessionError
                          )
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
              $content: switchMap(planned => {
                if (planned.some(ps => ps.kind === 'draft' && ps.draft.alert !== null)) {
                  return $node($text('Resolve alerts'))
                }
                const count = planExecution(planned).filter(e => e.kind === 'exec' && e.lead).length
                return $node($text(count > 1 ? `Submit ${count} actions` : 'Submit'))
              }, plannedSteps)
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
