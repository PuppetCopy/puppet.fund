import { HUB_CHAIN_ID, PRECISION, PROTOCOL } from '@puppet/contracts/const'
import type { IFund__Allocation } from '@puppet/contracts/types'
import { allocationRoom, cooledDown } from '@puppet/sdk/allocation'
import { CompactContractError, CompactError, formatThrownError, type IComposedValuation, requestValuation } from '@puppet/sdk/compact'
import type { ChainId } from '@puppet/sdk/const'
import { getDuration, getTokenDescription, readableDate, readablePercentage, readableTokenAmountLabel } from '@puppet/sdk/core'
import { DEFAULT_EVALUATION_CONFIG, VALUE_KEY } from '@puppet/sdk/evaluate'
import {
  allocationTermsOf,
  type IAllocationCandidate,
  type IFundState,
  mandateDigest,
  readAllocationBlock,
  readAllocationCandidates,
  readFundState,
  valuationRatesOf
} from '@puppet/sdk/intent'
import { floorOf, type IAllocatePlan, planAllocate } from '@puppet/sdk/pool'
import { bondTokenOf, chainTokenOfKey, type IRelayFeeQuote } from '@puppet/sdk/state'
import { combine, filter, type IStream, just, map, merge, op } from 'aelea/stream'
import { type IBehavior, type PromiseState, type PromiseStateDone, type PromiseStateError, PromiseStatus, promiseState, state } from 'aelea/stream-extended'
import { $node, $text, component, type I$Node, type I$Slottable, type INode, nodeEvent, style, styleBehavior } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { type Address, isAddressEqual } from 'viem'
import { $amountDisplay, $infoTooltip, $intermediatePromise, text } from '@/ui-components'
import context, { DISPLAY_QUOTE_TTL_MS, getRate } from '../../io/context.js'
import { fetchFundShare } from '../../io/datastore/reads.js'
import { matchmakerUrl } from '../../io/matchmaker/index.js'
import { formatUsd, priceFor } from '../../io/price.js'
import { $addressLink } from '../$AccountProfile.js'
import { $detailLine, } from './$SourceAmountInput.js'
import type { IArrival } from './draft.js'
import { $miniButton } from './editorUtils.js'
import { quoteRelayFee, terms } from './runner/_shared.js'

const HUB = HUB_CHAIN_ID as ChainId
const valueToken = chainTokenOfKey(HUB, VALUE_KEY)
const value = getTokenDescription(HUB, valueToken)
const bond = getTokenDescription(HUB, bondTokenOf(HUB))

const shareOf = (part: bigint, whole: bigint): bigint => (whole === 0n ? 0n : (part * 10_000n) / whole)

interface ISnapshot {
  quote: IComposedValuation
  state: IFundState
  candidates: IAllocationCandidate[]
  blocked: string | null
  feeMap: IRelayFeeQuote
  feeReserve: bigint
}

interface IRound {
  value: bigint
  rows: IFund__Allocation[]
  plan: IAllocatePlan | null
  error: string | null
}

const readableRoundError = (err: unknown): string => {
  if (err instanceof CompactContractError) {
    if (err.code === 'Fund__SkinBelowFloor') return 'Your ownership would fall below the pool floor; contribute more so the puppets fit'
    if (err.code === 'Balance__ZeroAmount') return 'Nothing to fund: deposit, or wait until a puppet can join'
  }
  return formatThrownError(err)
}


const $stubBar = (width: string): I$Node =>
  $node(style({ width, height: '12px', borderRadius: '6px', background: colorShade(palette.foreground, 15) }))()
const $cell = (minWidth: string) => $node(style({ minWidth, flexShrink: '0', display: 'flex', justifyContent: 'flex-end', whiteSpace: 'nowrap' }))
const $roundRow = ($label: I$Slottable, $stake: I$Slottable, $share: I$Slottable): I$Node =>
  $row(spacing.small, style({ alignItems: 'center', fontSize: text.sm, minHeight: '20px' }))(
    $node(style({ flex: 1, minWidth: '0' }))($label),
    $cell('96px')($stake),
    $cell('120px')($share)
  )
const $roundHeader = ($label: I$Slottable): I$Node =>
  $node(style({ color: palette.foreground, fontSize: text.xs }))($roundRow($label, $text('Stake'), $text('Share')))
const $totals = (...$lines: I$Node[]): I$Node =>
  $column(spacing.small, style({ borderTop: `1px solid ${palette.horizon}`, paddingTop: '12px' }))(...$lines)
const $stubStake = (): I$Node => $column(style({ gap: '4px', alignItems: 'flex-end' }))($stubBar('64px'), $stubBar('48px'))
const $roundGroup = (...$rows: I$Node[]): I$Node => $column(spacing.small)(...$rows)
const $footer = ($label: I$Slottable, $action: I$Slottable): I$Node =>
  $row(spacing.small, style({ alignItems: 'center', minHeight: '24px' }))(
    $row(spacing.tiny, style({ flex: 1, alignItems: 'center', fontSize: text.xs, color: palette.foreground, whiteSpace: 'nowrap' }))($label),
    $action
  )

export interface I$AllocationSimulation {
  master: Address
  hideBalances: IStream<boolean>
  arrival: IStream<IArrival>
}

export const $AllocationSimulation = ({ master, hideBalances, arrival }: I$AllocationSimulation) =>
  component(
    ([clickRefresh, clickRefreshTether]: IBehavior<INode<HTMLButtonElement>, MouseEvent>) => {
      const bondToken = bondTokenOf(HUB)
      const snapshotQuery: IStream<Promise<ISnapshot>> = op(
        merge(just(null), clickRefresh),
        map(async (): Promise<ISnapshot> => {
          const share = await fetchFundShare(master)
          const [quote, fundState, candidates, blocked, feeMap, feeReserve] = await Promise.all([
            requestValuation(matchmakerUrl, master, share),
            readFundState(terms, master, share),
            readAllocationCandidates(terms, master),
            readAllocationBlock(terms, master),
            context.getRelayFeeQuote(HUB, bondToken, DISPLAY_QUOTE_TTL_MS),
            quoteRelayFee(HUB, 'sell', false, bondToken, 0n, 0n, 0n, null)
          ])
          return { quote, state: fundState, candidates, blocked, feeMap, feeReserve }
        }),
        state()
      )
      const roundOf = async (snap: ISnapshot, arrived: IArrival): Promise<IRound> => {
        const rates = await valuationRatesOf(getRate, [arrived])
        const marked = rates.toValue(arrived.chainId, arrived.token, arrived.amount)
        const value = isAddressEqual(arrived.token, bondTokenOf(arrived.chainId))
          ? marked
          : (marked * (PRECISION.basisPoints - DEFAULT_EVALUATION_CONFIG.driftToleranceBps)) / PRECISION.basisPoints
        const rows = allocationTermsOf(
          {
            ...snap.state,
            master,
            nowSec: BigInt(Math.floor(Date.now() / 1000)),
            value: snap.quote.valuation.value,
            blocked: snap.blocked,
            feeReserve: snap.feeReserve,
            feeCeiling: snap.feeMap('allocate', true, PROTOCOL.maxCohortSize, 0n, 0n),
            candidates: snap.candidates
          },
          value
        )
        if (arrived.amount === 0n && rows.length === 0) return { value, rows, plan: null, error: null }
        const fee = await quoteRelayFee(HUB, 'allocate', false, bondToken, BigInt(rows.length), 0n, 0n, arrived.amount > 0n ? arrived.chainId : null)
        try {
          const plan = planAllocate({
            skin: snap.state.skin,
            supply: snap.state.supply,
            queued: snap.state.queued,
            masterUnits: snap.state.masterUnits,
            value: snap.quote.valuation.value,
            fee,
            credit: { chainId: BigInt(arrived.chainId), amount: arrived.amount, value },
            rowList: rows.map(row => {
              const candidate = snap.candidates.find(c => isAddressEqual(c.puppet, row.puppet))
              if (candidate === undefined) throw new Error(`the round names ${row.puppet}, whose balance and holding were not read`)
              return { stake: row.stake, skin: row.mandate.skin, rate: row.mandate.allocationRate, balance: candidate.available, basis: candidate.basis }
            })
          })
          return { value, rows, plan, error: null }
        } catch (err) {
          return { value, rows, plan: null, error: readableRoundError(err) }
        }
      }
      const round: IStream<PromiseState<IRound>> = op(
        combine({ query: snapshotQuery, arrival }),
        map(async p => roundOf(await p.query, p.arrival)),
        promiseState,
        state()
      )

      const $detailStub = (...$extra: I$Node[]): I$Node => $column(spacing.default)(
        $roundGroup(
          $roundHeader($stubBar('90px')),
          $roundRow($stubBar('110px'), $stubStake(), $stubBar('50px'))
        ),
        $totals(
          $detailLine('Funded', $stubBar('110px'), "Everyone in the round buys in at the fund's value as of this valuation."),
          $detailLine('Your share', $stubBar('50px'))
        ),
        ...$extra
      )
      const refusalOf = (err: unknown): string => {
        if (err instanceof CompactError && err.code === 'CHRONICLE_BEHIND') return 'Indexing your last action, retry shortly'
        if (err instanceof CompactError && err.code === 'MARK_TOO_SOON') return 'Fund was just valued, retry shortly'
        return 'Could not value the fund'
      }

      const $details = (snap: ISnapshot): I$Node => {
        const v = snap.quote.valuation
        const before = snap.state.masterUnits
        const floorBefore = floorOf(snap.state.skin, snap.state.supply - snap.state.queued, before)
        const nowSec = BigInt(Math.floor(Date.now() / 1000))
        const stakeOf = (rows: readonly IFund__Allocation[]): bigint => rows.reduce((total, row) => total + row.stake, 0n)
        const settled = filter((s): s is PromiseStateDone<IRound> | PromiseStateError => s.status !== PromiseStatus.PENDING, round)
        const cell = (fn: (r: IRound) => string): I$Slottable => $text(map(s => (s.status === PromiseStatus.DONE ? fn(s.value) : '-'), settled))
        const priced = combine({ s: settled, price: priceFor(HUB, valueToken) })
        const joinedRows = (r: IRound): IFund__Allocation[] => {
          const plan = r.plan
          return plan === null ? [] : r.rows.filter((_, i) => plan.rowList[i] !== null)
        }
        const joinedStake = (r: IRound): bigint => stakeOf(joinedRows(r))
        const joinedCount = (r: IRound): number => joinedRows(r).length
        const reasonOf = (c: IAllocationCandidate, floor: bigint): string => {
          if (snap.blocked !== null) return snap.blocked
          if (!c.delegated) return 'account not set up on the hub'
          if (c.registered !== mandateDigest(c.puppet, c.mandate)) return 'not registered yet'
          if (c.mandate.expiry <= nowSec) return 'mandate expired'
          if (!cooledDown(c.allocatedAt, c.mandate.cooldownPeriod, nowSec)) {
            const end = c.allocatedAt + c.mandate.cooldownPeriod
            return `${readableDate(Number(end), { month: 'short', day: 'numeric' })} · in ${getDuration(end - nowSec)}`
          }
          if (allocationRoom(c.mandate, c.available > snap.feeReserve ? c.available - snap.feeReserve : 0n, c.basis) === 0n) return 'nothing available'
          if (c.mandate.skin > floor) return `wants ${readablePercentage(c.mandate.skin)} floor`
          return 'no room at this amount'
        }
        const $candidate = (c: IAllocationCandidate): I$Node => {
          const at = (r: IRound): number => r.rows.findIndex(row => isAddressEqual(row.puppet, c.puppet))
          const joined = (r: IRound): { units: bigint; total: bigint } | null => {
            if (at(r) < 0 || r.plan === null) return null
            const row = r.plan.rowList[at(r)]
            return row === null || row === undefined ? null : { units: row.units, total: snap.state.supply + r.plan.minted }
          }
          const why = (r: IRound): string =>
            at(r) >= 0 && r.plan !== null ? 'too small for its fee share' : reasonOf(c, r.plan === null ? floorBefore : r.plan.skin)
          return $roundRow(
            $addressLink(c.puppet),
            $amountDisplay({
              hideBalances,
              usd: map(p => (p.s.status !== PromiseStatus.DONE ? '-' : joined(p.s.value) === null ? '' : formatUsd(p.s.value.rows[at(p.s.value)]!.stake, p.price)), priced),
              amount: map(s => (s.status !== PromiseStatus.DONE ? '-' : joined(s.value) === null ? '' : readableTokenAmountLabel(bond, s.value.rows[at(s.value)]!.stake)), settled),
              align: 'flex-end',
              usdFontSize: text.sm
            }),
            $node(
              styleBehavior(
                map(s => (s.status === PromiseStatus.DONE && joined(s.value) !== null ? null : { color: palette.foreground, fontSize: text.xs }), settled)
              )
            )(cell(r => {
              const row = joined(r)
              return row === null ? why(r) : readablePercentage(shareOf(row.units, row.total))
            }))
          )
        }
        return $column(spacing.default)(
          $roundGroup(
            $roundHeader(cell(r => `Round · ${joinedCount(r)} joining`)),
            ...(snap.candidates.length === 0
              ? [$node(style({ fontSize: text.xs, color: palette.foreground }))($text('No puppets mandate you yet; the round is yours alone.'))]
              : snap.candidates.map($candidate))
          ),
          $totals(
            $detailLine(
              'Funded',
              $text(map(p => (p.s.status === PromiseStatus.DONE && p.s.value.plan !== null ? formatUsd(joinedStake(p.s.value) + p.s.value.value, p.price) : '-'), priced)),
              `Everyone in the round buys in at the fund's value as of this valuation, ${readableTokenAmountLabel(value, v.value)}. A contribution in another token counts at its market price less ${readablePercentage(DEFAULT_EVALUATION_CONFIG.driftToleranceBps)}, the margin the attestor accepts.`
            ),
            $detailLine(
              'Your share',
              cell(r => (r.plan === null ? '-' : readablePercentage(shareOf(r.plan.masterUnits, snap.state.supply + r.plan.minted)))),
              'Your ownership of the fund once this round lands.'
            ),
            $node(
              style({ fontSize: text.xs, color: palette.negative, lineHeight: '1.4' }),
              styleBehavior(map(s => (s.status === PromiseStatus.DONE && s.value.error === null ? { display: 'none' } : null), settled))
            )($text(map(s => (s.status === PromiseStatus.DONE ? (s.value.error ?? '') : readableRoundError(s.error)), settled)))
          )
        )
      }

      const $simulation = $intermediatePromise({
        $loader: $detailStub(),
        $$fail: err =>
          $detailStub(
            $footer(
              $row(spacing.tiny, style({ alignItems: 'center', color: palette.indeterminate }))(
                $text(refusalOf(err)),
                $infoTooltip(err instanceof CompactError ? err.detail : formatThrownError(err))
              ),
              $miniButton('Retry', false, clickRefreshTether(nodeEvent('click')))
            )
          ),
        $display: map(async query => $details(await query), snapshotQuery)
      })

      const backers: IStream<bigint | null> = map(s => (s.status === PromiseStatus.DONE && s.value.plan !== null ? BigInt(s.value.rows.length) : null), round)
      return [$simulation, { backers }]
    }
  )
