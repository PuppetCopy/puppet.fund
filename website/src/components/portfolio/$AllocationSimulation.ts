import { HUB_CANONICAL_TOKEN, HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import type { IFund__Allocation, IFund__Price } from '@puppet/contracts/types'
import { type IArrival, quoteRelayFee } from '@puppet/sdk/client'
import { CompactContractError, CompactError, formatThrownError, type IValuationOwner, requestValuation } from '@puppet/sdk/compact'
import { type ChainId, PRICED_DEADLINE_SEC } from '@puppet/sdk/const'
import { getTokenDescription, getUnixTimestamp, readablePercentage } from '@puppet/sdk/core'
import {
  allocationTermsOf,
  clientOf,
  fromChain,
  type IAllocationCandidate,
  type IFundBook,
  type IFundState,
  mandateDigest,
  readAllocationCandidates,
  readCreditBook,
  readFundBook,
  readFundState,
  readMandateWindow
} from '@puppet/sdk/intent'
import { type IAllocatePlan, planAllocate, valuationOf } from '@puppet/sdk/pool'
import type { IFundRow } from '@puppet/sdk/schema'
import { chainTokenOfKey, providerToken, relayFeeOf, tokenKeyOf, walletsOf } from '@puppet/sdk/state'
import { combine, filter, type IStream, map, op, skipRepeatsWith } from 'aelea/stream'
import { type IBehavior, type PromiseState, type PromiseStateDone, type PromiseStateError, PromiseStatus, promiseState, state } from 'aelea/stream-extended'
import { $node, $text, component, type I$Node, type I$Slottable, type INode, nodeEvent, style, styleBehavior } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { type Address, getAddress, isAddressEqual } from 'viem'
import { $amountDisplay, $infoTooltip, $intermediatePromise, $intermediateLine, SEPARATOR_COLOR, text } from '@/ui-components'
import { $jazzicon } from '../../common/$avatar.js'
import { clientDeps } from '../../io/clientDeps.js'
import context, { DISPLAY_QUOTE_TTL_MS } from '../../io/context.js'
import { client } from '../../io/datastore/reads.js'
import { matchmakerUrl } from '../../io/matchmaker/index.js'
import { priceFor, usdOf } from '../../io/price.js'
import { $addressLink } from '../$AccountProfile.js'
import { $miniButton } from './editorUtils.js'

const HUB = HUB_CHAIN_ID as ChainId


export interface IRoundSnapshot {
  token: Address
  state: IFundState
  candidates: IAllocationCandidate[]
  now: bigint
  deadline: bigint
  feeCeiling: bigint
  feeReserve: bigint
}

export interface IPooledRound {
  token: Address
  snapshot: Promise<IRoundSnapshot>
}

interface ISnapshot extends IRoundSnapshot {
  mark: { value: bigint; price: IFund__Price }
  credited: Awaited<ReturnType<typeof readCreditBook>>
}

export interface IRaise {
  token: Address
  fundRow: Pick<IFundRow, 'master' | 'totalShares'>
  joinList: readonly { holder: Address; amount: bigint; shares: bigint }[]
}

export interface IRound {
  rows: IFund__Allocation[]
  plan: IAllocatePlan | null
  error: string | null
  after: IRaise | null
}

const readableRoundError = (err: unknown): string => {
  const feeShort = 'Your allocation does not cover your slice of the relay fee; allocate more'
  if (err instanceof CompactContractError) {
    if (err.code === 'Balance__ZeroAmount') return 'Nothing to allocate: deposit, or wait until a puppet can join'
    if (err.code === 'Intent__RelayFeeRatioExceeded') return feeShort
  }
  if (err instanceof CompactError && err.code === 'POOL_OVERFLOW') return feeShort
  return formatThrownError(err)
}


type IRoundFund = Pick<IFundRow, 'master' | 'shareToken' | 'performanceFee'>

export function readRounds(fundRow: IRoundFund, book: Promise<IFundBook> | null, tokens: readonly Address[]): IPooledRound[] {
  const master = fundRow.master
  const pinnedQuery = fromChain('the latest block', HUB, clientOf(clientDeps, HUB).getBlock())
  const shared = Promise.all([
    pinnedQuery,
    pinnedQuery.then(pinned => readFundState(clientDeps, fundRow, pinned.number)),
    context.getRelayFeeQuote(HUB, HUB_CANONICAL_TOKEN.WETH, DISPLAY_QUOTE_TTL_MS)
  ])
  const priced = tokens.filter(token => !isAddressEqual(token, PROTOCOL.nativeToken))
  const candidateLists =
    priced.length === 0
      ? Promise.resolve([])
      : book === null
        ? Promise.reject(new Error(`a round of ${master} over priced tokens needs its fund book`))
        : Promise.all([pinnedQuery, book]).then(async ([pinned, held]) =>
            readAllocationCandidates(clientDeps, master, fundRow.shareToken, priced, pinned.number, await readMandateWindow(clientDeps, held, priced, pinned))
          )
  return tokens.map(token => ({
    token,
    snapshot: (async (): Promise<IRoundSnapshot> => {
      const [[pinned, fund, feeMap], lists, feeReserve] = await Promise.all([shared, candidateLists, quoteRelayFee(clientDeps, HUB, 'sell', false, token, 0n, 0n, 0n)])
      const at = priced.findIndex(each => isAddressEqual(each, token))
      return {
        token,
        state: fund,
        candidates: at === -1 ? [] : lists[at]!,
        now: pinned.timestamp,
        deadline: BigInt(getUnixTimestamp() + PRICED_DEADLINE_SEC / 2),
        feeCeiling: feeMap('allocate', true, PROTOCOL.maxCohortSize, 0n, 0n),
        feeReserve
      }
    })()
  }))
}

async function planRound(master: Address, snap: ISnapshot, credit: (IArrival & { bound: boolean }) | null): Promise<IRound> {
  const mark = snap.mark
  const amount = credit === null ? 0n : credit.amount
  const allocation = {
    ...snap.state,
    kind: 'allocate' as const,
    master,
    now: snap.now,
    deadline: snap.deadline,
    value: mark.value,
    price: mark.price,
    feeReserve: snap.feeReserve,
    feeCeiling: snap.feeCeiling,
    candidates: snap.candidates
  }
  const rows = allocationTermsOf(allocation, amount)
  if (amount === 0n && rows.length === 0) return { rows, plan: null, error: null, after: null }
  const abroad = credit !== null && amount > 0n && credit.chainId !== HUB
  const payers = BigInt(rows.length) + 1n
  const convert = await context.getFeeConverter(HUB, HUB_CANONICAL_TOKEN.WETH, DISPLAY_QUOTE_TTL_MS)
  const fee = relayFeeOf(convert, HUB, 'allocate', false, BigInt(rows.length), 0n, 0n)
  const release = abroad
    ? relayFeeOf(await context.getFeeConverter(credit.chainId, providerToken(credit.token, credit.chainId), DISPLAY_QUOTE_TTL_MS), credit.chainId, 'fulfil', !credit.bound, 0n, 0n, 0n)
    : 0n
  const credited = credit === null || amount === 0n ? null : snap.credited
  try {
    const plan = planAllocate({
      now: snap.now,
      owner: snap.state.owner,
      supply: snap.state.supply,
      redemption: snap.state.redemption,
      masterShares: snap.state.masterShares,
      value: mark.value,
      fee,
      price: mark.price,
      credit:
        credit === null || credited === null
          ? { chainId: 0n, total: 0n, feeTotal: 0n }
          : { chainId: BigInt(credit.chainId), total: credited.total + amount, feeTotal: credited.feeTotal + ((fee / payers) * mark.price.amount) / mark.price.value + release },
      credited,
      rowList: rows.map(row => {
        const candidate = snap.candidates.find(c => isAddressEqual(c.puppet, row.puppet))
        if (candidate === undefined) throw new Error(`the round names ${row.puppet}, whose balance and holding were not read`)
        return {
          puppet: row.puppet,
          amount: row.amount,
          skin: row.mandate.skin,
          rate: row.mandate.allocationRate,
          exitCap: row.mandate.exitCap,
          cooldownPeriod: row.mandate.cooldownPeriod,
          balance: candidate.available,
          held: candidate.held,
          cost: candidate.cost,
          allocatedAt: candidate.allocatedAt,
          mandated: candidate.epoch !== null && candidate.registered === mandateDigest(row.mandate, candidate.epoch) && row.mandate.expiry > snap.deadline
        }
      })
    })
    const joinList = rows.flatMap((row, i) => {
      const planned = plan.rowList[i]
      return planned === null || planned === undefined ? [] : [{ holder: row.puppet, amount: row.amount, ...planned }]
    })
    const after: IRaise = {
      token: snap.token,
      fundRow: { master, totalShares: snap.state.supply + plan.minted },
      joinList: plan.contributed > 0n ? [...joinList, { holder: master, amount, shares: plan.contributed }] : joinList
    }
    return { rows, plan, error: null, after }
  } catch (err) {
    return { rows, plan: null, error: readableRoundError(err), after: null }
  }
}

const $cell = (minWidth: string) => $node(style({ minWidth, flexShrink: '0', display: 'flex', justifyContent: 'flex-end', whiteSpace: 'nowrap' }))
const $roundRow = ($label: I$Slottable, $stake: I$Slottable, $share: I$Slottable): I$Node =>
  $row(spacing.small, style({ alignItems: 'center', minHeight: '20px' }))(
    $node(style({ flex: 1, minWidth: '0' }))($label),
    $cell('96px')($stake),
    $cell('120px')($share)
  )
const $roundHeader: I$Node = $node(style({ color: palette.foreground, fontSize: text.xs }))($roundRow($node(), $text('Allocated'), $text('Share')))
const $roundGroup = ($header: I$Node, ...$rows: I$Node[]): I$Node =>
  $column(spacing.small, style({ fontSize: text.sm }))($header, ...$rows.map($row => $node(style({ borderTop: `1px solid ${SEPARATOR_COLOR}`, paddingTop: '8px' }))($row)))
const $footer = ($label: I$Slottable, $action: I$Slottable): I$Node =>
  $row(spacing.small, style({ alignItems: 'center', minHeight: '24px' }))(
    $row(spacing.tiny, style({ flex: 1, alignItems: 'center', fontSize: text.xs, color: palette.foreground, whiteSpace: 'nowrap' }))($label),
    $action
  )

export interface I$AllocationSimulation {
  fundRow: IRoundFund
  owner: IValuationOwner
  signed: boolean
  hideBalances: IStream<boolean>
  rounds: IStream<Promise<readonly IPooledRound[] | null>>
  arrival: IStream<IArrival>
  boundChains: ReadonlySet<ChainId>
}

export const $AllocationSimulation = ({ fundRow, owner, signed, hideBalances, rounds, arrival, boundChains }: I$AllocationSimulation) =>
  component(
    (
      [clickRefresh, clickRefreshTether]: IBehavior<INode<HTMLButtonElement>, MouseEvent>,
      [enableSession, enableSessionTether]: IBehavior<INode<HTMLButtonElement>, MouseEvent>
    ) => {
      const master = fundRow.master
      const snapshotQuery: IStream<Promise<ISnapshot>> = op(
        combine({
          leg: op(
            arrival,
            skipRepeatsWith((a, b) => a.chainId === b.chainId && isAddressEqual(a.token, b.token))
          ),
          rounds
        }),
        map(async (p): Promise<ISnapshot> => {
          const hubForm = chainTokenOfKey(HUB, tokenKeyOf(p.leg.chainId, p.leg.token))
          const token = p.leg.chainId === HUB ? hubForm : providerToken(hubForm, HUB)
          const pool = await p.rounds
          const pooled = pool === null ? undefined : pool.find(entry => isAddressEqual(entry.token, token))
          const snap = pooled === undefined ? await readRounds(fundRow, isAddressEqual(token, PROTOCOL.nativeToken) ? null : readFundBook(clientDeps, master), [token])[0]!.snapshot : { ...(await pooled.snapshot), deadline: BigInt(getUnixTimestamp() + PRICED_DEADLINE_SEC / 2) }
          const [quote, credited] = await Promise.all([
            requestValuation(matchmakerUrl, master, snap.state.shareToken, token, owner, null),
            readCreditBook(clientDeps, snap.state.owner, master, p.leg.chainId, providerToken(p.leg.token, p.leg.chainId))
          ])
          return { ...snap, mark: { value: valuationOf(quote.valuation), price: quote.price }, credited }
        }),
        state()
      )
      const walletsQuery = op(
        snapshotQuery,
        map(q => q.then(snap => walletsOf(client, snap.candidates.map(candidate => candidate.puppet)))),
        state()
      )
      const roundQuery: IStream<Promise<IRound>> = op(
        combine({
          query: snapshotQuery,
          arrival: op(
            arrival,
            skipRepeatsWith((a, b) => a.chainId === b.chainId && isAddressEqual(a.token, b.token) && a.amount === b.amount)
          )
        }),
        map(async p => {
          const snap = await p.query
          return planRound(master, snap, { ...p.arrival, bound: boundChains.has(p.arrival.chainId) })
        }),
        state()
      )
      const round: IStream<PromiseState<IRound>> = op(roundQuery, promiseState, state())
      const $intermediateGroup: I$Node = $roundGroup($roundHeader, $roundRow($intermediateLine('7em'), $intermediateLine('5em'), $intermediateLine('3em')))

      const refusalOf = (err: unknown): string => {
        if (err instanceof CompactError && (err.code === 'CHRONICLE_BEHIND' || err.code === 'FUND_UNRECORDED')) return 'Indexing your last action, retry shortly'
        return 'Could not value the fund'
      }

      const $details = (): I$Node => {
        const settled = filter((s): s is PromiseStateDone<IRound> | PromiseStateError => s.status !== PromiseStatus.PENDING, round)
        return $node(
          style({ fontSize: text.xs, color: palette.negative, lineHeight: '1.4' }),
          styleBehavior(map(s => (s.status === PromiseStatus.DONE && s.value.error === null ? { display: 'none' } : null), settled))
        )($text(map(s => (s.status === PromiseStatus.DONE ? (s.value.error ?? '') : readableRoundError(s.error)), settled)))
      }

      const $group = (snap: ISnapshot, round: IRound, wallets: ReadonlyMap<Address, Address>): I$Node => {
        const description = getTokenDescription(HUB, snap.token)
        const after = round.after
        const totalShares = after === null ? snap.state.supply : after.fundRow.totalShares
        const own = after === null ? undefined : after.joinList.find(j => isAddressEqual(j.holder, master))
        const ownAmount = own === undefined ? 0n : own.amount
        return $roundGroup(
          $roundHeader,
          $roundRow(
            $row(spacing.small, style({ alignItems: 'center' }))($jazzicon(owner.user, 20), $text('You')),
            round.error === null
              ? $amountDisplay({
                  hideBalances,
                  usd: map(price => usdOf(ownAmount, price), priceFor(HUB, snap.token)),
                  align: 'flex-end',
                  usdFontSize: text.sm
                })
              : $text('-'),
            $text(
              round.error === null
                ? readablePercentage(totalShares === 0n ? 0n : ((snap.state.masterShares + (own === undefined ? 0n : own.shares)) * 10_000n) / totalShares)
                : '-'
            )
          ),
          ...(round.rows.length === 0
            ? [
                $node(style({ fontSize: text.xs, color: palette.foreground, minHeight: '20px', display: 'flex', alignItems: 'center' }))(
                  $text(`No mandated puppet holds ${description.symbol} on the hub yet`)
                )
              ]
            : (after === null ? [] : after.joinList).flatMap(j => {
                if (isAddressEqual(j.holder, master)) return []
                const held = snap.candidates.find(c => isAddressEqual(c.puppet, j.holder))?.held
                if (held === undefined) throw new Error(`the round names ${j.holder}, whose holding was not read`)
                return [
                  $roundRow(
                    $addressLink(wallets.get(getAddress(j.holder)) ?? getAddress(j.holder)),
                    $amountDisplay({
                      hideBalances,
                      usd: map(price => usdOf(j.amount, price), priceFor(HUB, snap.token)),
                      align: 'flex-end',
                      usdFontSize: text.sm
                    }),
                    $text(readablePercentage(totalShares === 0n ? 0n : ((held + j.shares) * 10_000n) / totalShares))
                  )
                ]
              }))
        )
      }
      const $simulation = $intermediatePromise({
        $loader: $intermediateGroup,
        $$fail: err =>
          $column(spacing.default)(
            signed
              ? $footer(
                  $row(spacing.tiny, style({ alignItems: 'center', color: palette.indeterminate }))(
                    $text(refusalOf(err)),
                    $infoTooltip(err instanceof CompactError ? err.detail : formatThrownError(err))
                  ),
                  $miniButton('Retry', false, clickRefreshTether(nodeEvent('click')))
                )
              : $footer(
                  $row(spacing.tiny, style({ alignItems: 'center' }))(
                    $text('Live value needs a session'),
                    $infoTooltip("The round is priced on your fund's live value, which the attestor serves only to a session on this device. Signing it is free.")
                  ),
                  $miniButton('Sign session', false, enableSessionTether(nodeEvent('click')))
                )
          ),
        $display: map(
          async p => {
            const [snap, live, wallets] = await Promise.all([p.snap, p.live, p.wallets])
            return $column(spacing.default)($group(snap, live, wallets), $details())
          },
          combine({ snap: snapshotQuery, live: roundQuery, wallets: walletsQuery })
        )
      })

      const puppets: IStream<bigint | null> = map(s => (s.status === PromiseStatus.DONE && s.value.plan !== null ? BigInt(s.value.rows.length) : null), round)
      const raise: IStream<IRaise | null> = op(
        round,
        filter(s => s.status !== PromiseStatus.PENDING),
        map(s => (s.status === PromiseStatus.DONE ? s.value.after : null))
      )
      return [$simulation, { puppets, raise, refreshRounds: clickRefresh, enableSession }]
    }
  )
