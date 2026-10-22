import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { IFund__Price } from '@puppet/contracts/types'
import { predictUserAccount } from '@puppet/sdk/account'
import { cohortOf, composeAllocation, raisableOf } from '@puppet/sdk/allocation'
import { PRECISION, PRICED_DEADLINE_SEC } from '@puppet/sdk/const'
import { getTokenDescription, getUnixTimestamp, readableDate } from '@puppet/sdk/core'
import { exitingSharesOf, type IFundBook, mandateOfRow, mandateStandingOf } from '@puppet/sdk/intent'
import { cashFor, claimOf, exitingOf, type IRedeemPlan, isOpen, valueFor } from '@puppet/sdk/pool'
import type { IFundRow, IHoldingRow, IMandateRow } from '@puppet/sdk/schema'
import { combine, empty, type IStream, just, map, op, skipRepeats, switchLatest } from 'aelea/stream'
import { state } from 'aelea/stream-extended'
import { $node, $text, type I$Node, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { href } from 'aelea/ui-router'
import { type Address, getAddress, isAddressEqual } from 'viem'
import { $amountDisplay, $icon, $infoTooltip, $intermediateFailure, $labeledDivider, $intermediateText, $puppeteer, maskBalance, SEPARATOR_COLOR, text } from '@/ui-components'
import { routeSchema } from '../app/routeSchema.js'
import { $avatarBadge } from '../common/$avatar.js'
import { $tokenMark, ethPrice, ethUsd } from '../common/$common.js'
import { formatUsd, usdOf } from '../io/price.js'
import { ago, shortDuration } from '../pages/common.js'
import { $holderRow } from './$holderRow.js'
import { mandateTermsOf } from './$MandatePosition.js'

const $mandateRules = (
  hideBalances: IStream<boolean>,
  row: IMandateRow | undefined,
  standing: ReturnType<typeof mandateStandingOf> | { kind: 'unrecorded' } | null,
  raiseNow: IStream<bigint>,
  deposited: boolean,
  redeeming: boolean
): I$Node => {
  if (row === undefined || standing === null) return $node(style({ fontSize: text.xs, color: palette.foreground }))($text('no mandate'))
  const terms = mandateTermsOf(row)
  const at = BigInt(getUnixTimestamp())
  const $value = (value: string | IStream<Promise<string> | string>): I$Node =>
    $node(style({ display: 'inline', color: palette.message, fontSize: text.sm }))(typeof value === 'string' ? $text(value) : $intermediateText(value))
  return $row(spacing.tiny, style({ alignItems: 'center', fontSize: text.xs, color: palette.foreground, whiteSpace: 'nowrap' }))(
    $node(
      $value(terms.perRound),
      $text(' Rate · '),
      $value(terms.skin),
      $text(' skin · '),
      ...(standing.kind === 'unrecorded'
        ? [$text('-')]
        : standing.kind === 'open' && redeeming
        ? [$text('settling')]
        : standing.kind === 'open'
        ? !deposited
          ? [$text('no deposit')]
          : [
              switchLatest(
                op(
                  raiseNow,
                  map(now => now === 0n),
                  skipRepeats,
                  map(capped =>
                    capped
                      ? $text('capped')
                      : $node(style({ display: 'inline' }))(
                          $value(
                            maskBalance(
                              switchLatest(
                                op(
                                  raiseNow,
                                  skipRepeats,
                                  map(now => ethUsd(now))
                                )
                              ),
                              hideBalances
                            )
                          ),
                          $text(' now')
                        )
                  )
                )
              )
            ]
        : standing.kind === 'cooldown'
          ? [$text('next in '), $value(shortDuration(Number(standing.until - at)))]
          : [$text('ended')])
    )
  )
}

export const $fundHolders = (
  hideBalances: IStream<boolean>,
  you: Address | null,
  wallets: ReadonlyMap<Address, Address>,
  row: IFundRow,
  holdings: readonly Pick<IHoldingRow, 'holder' | 'shares' | 'allocatedAt'>[],
  book: IFundBook,
  balances: readonly { puppet: Address; token: Address; amount: bigint }[],
  quotes: IStream<readonly { token: Address; price: IFund__Price }[]>,
  worth: { wei: IStream<bigint>; price: IStream<Promise<bigint | null>> } | null,
  redeem: IStream<IRedeemPlan | null>
): I$Node => {
  const valuation: IStream<{ wei: bigint; price: Promise<bigint | null> } | null> =
    worth === null ? just(null) : op(combine({ wei: worth.wei, price: worth.price }), state())
  const masterHolding = book.holdings.find(h => isAddressEqual(h.holder, book.master))
  const redeeming = book.redemption !== undefined && isOpen(book.redemption)
  const fund = {
    supply: row.totalShares,
    value: row.value,
    masterShares: masterHolding === undefined ? 0n : masterHolding.shares,
    exiting: exitingOf(book.redemption === undefined ? 0n : book.redemption.queued, row.totalShares)
  }
  return $column(spacing.default)(
    ...holdings
      .map(h => ({ ...h, exiting: exitingSharesOf(book, h.holder) }))
      .sort((a, b) => (b.shares > a.shares ? 1 : b.shares < a.shares ? -1 : 0))
      .map(h => {
        const isTrader = isAddressEqual(h.holder, row.master)
        const mandate = book.mandates.find(row => isAddressEqual(row.puppet, h.holder))
        const holding = book.holdings.find(row => isAddressEqual(row.holder, h.holder))
        const epoch = book.epochs.get(getAddress(h.holder))
        const standing =
          mandate === undefined
            ? null
            : epoch === undefined
              ? { kind: 'unrecorded' as const }
              : mandateStandingOf({ mandate: mandateOfRow(mandate), epoch: mandate.epoch }, epoch, holding, BigInt(getUnixTimestamp()))
        const deposits = balances.filter(b => isAddressEqual(b.puppet, h.holder))
        const raiseNow: IStream<bigint> =
          mandate === undefined
            ? just(0n)
            : map(
                list =>
                  deposits.reduce((best, b) => {
                    const quote = list.find(q => isAddressEqual(q.token, b.token))
                    if (quote === undefined) throw new Error(`no hub price for ${b.token}, held by ${h.holder}`)
                    const now = raisableOf(fund, { mandate: mandateOfRow(mandate), available: valueFor(b.amount, quote.price), held: holding === undefined ? 0n : holding.shares }).now
                    return now > best ? now : best
                  }, 0n),
                quotes
              )
        return $holderRow({
          hideBalances,
          pool: op(
            combine({ worth: valuation, plan: redeem }),
            map(({ worth, plan }) => {
              const totalShares = row.totalShares
              const owned = h.shares
              const value = worth === null ? '-' : usdOf(cashFor(owned, totalShares, worth.wei), worth.price)
              if (plan === null || (book.redemption !== undefined && book.redemption.id >= plan.redemption.id)) return { totalShares, owned, value, after: null }
              const sharesAfter = isTrader
                ? plan.masterShares - plan.masterPart
                : h.shares - claimOf({ queued: h.exiting === null ? 0n : h.exiting }, h.shares, plan.redemption.fraction) / PRECISION.basisPoints
              return {
                totalShares,
                owned,
                value,
                after: {
                  totalShares: plan.supply - plan.masterPart - plan.burnBudget,
                  owned: sharesAfter,
                  value: worth === null ? '-' : usdOf(valueFor((sharesAfter * plan.nav) / plan.base, plan.rate), worth.price)
                }
              }
            }),
            state()
          ),
          wallet: wallets.get(getAddress(h.holder)) ?? getAddress(h.holder),
          href: isTrader
            ? `https://debank.com/profile/${wallets.get(getAddress(h.holder)) ?? getAddress(h.holder)}`
            : href(routeSchema.puppets.detail, { account: getAddress(h.holder) }),
          external: isTrader,
          badge: isTrader ? $avatarBadge($icon({ $content: $puppeteer, width: '11px', viewBox: '0 0 32 32', fill: palette.message, svgOps: style({ display: 'block' }) })) : null,
          isYou: you !== null && isAddressEqual(h.holder, you),
          held: h.shares,
          exiting: h.exiting,
          $caption: isTrader ? null : $mandateRules(hideBalances, mandate, standing, raiseNow, deposits.length > 0, redeeming),
          title: isTrader ? 'Portfolio on DeBank' : h.allocatedAt > 0n ? `Last round ${ago(Number(h.allocatedAt))} · open puppet page` : 'Open puppet page'
        })
      })
  )
}

export const raisableGroupsOf = (
  row: IFundRow,
  book: IFundBook,
  wallets: ReadonlyMap<Address, Address>,
  balances: readonly { puppet: Address; token: Address; amount: bigint }[],
  quotes: readonly { token: Address; price: IFund__Price; reserve: bigint }[],
  feeCeiling: bigint
) => {
  const at = BigInt(getUnixTimestamp())
  const masterHolding = book.holdings.find(h => isAddressEqual(h.holder, book.master))
  const masterShares = masterHolding === undefined ? 0n : masterHolding.shares
  const redeeming = book.redemption !== undefined && isOpen(book.redemption)
  const fund = {
    supply: row.totalShares,
    value: row.value,
    masterShares,
    exiting: exitingOf(book.redemption === undefined ? 0n : book.redemption.queued, row.totalShares)
  }
  const mandated = book.mandates
    .filter(row => !isAddressEqual(row.puppet, book.master))
    .map(row => {
      const puppet = getAddress(row.puppet)
      const mandate = mandateOfRow(row)
      const holding = book.holdings.find(h => isAddressEqual(h.holder, puppet))
      const epoch = book.epochs.get(puppet)
      if (epoch === undefined) throw new Error(`the chronicle holds no hub account record for ${puppet}, who mandates ${book.master}`)
      return {
        puppet,
        mandate,
        held: holding === undefined ? 0n : holding.shares,
        allocatedAt: holding === undefined ? 0n : holding.allocatedAt,
        standing: mandateStandingOf({ mandate, epoch: row.epoch }, epoch, holding, at)
      }
    })
  const counted = mandated.filter(m => m.standing.kind === 'open' || m.standing.kind === 'cooldown')
  const masterWallet = wallets.get(book.master)
  if (masterWallet === undefined) throw new Error(`no wallet is known for the master ${book.master}`)
  const owner = predictUserAccount(masterWallet)
  const groups = quotes
    .map(quote => {
      const candidates = counted.flatMap(m => {
        const held = balances.find(b => isAddressEqual(b.puppet, m.puppet) && isAddressEqual(b.token, quote.token))
        if (held === undefined) return []
        const wallet = wallets.get(m.puppet)
        if (wallet === undefined) throw new Error(`the chronicle holds no account record for ${m.puppet}, who mandates ${book.master}`)
        const available = valueFor(held.amount > quote.reserve ? held.amount - quote.reserve : 0n, quote.price)
        return [
          {
            ...m,
            available,
            raisable: raisableOf(fund, { mandate: m.mandate, available, held: m.held })
          }
        ]
      })
      const rows = composeAllocation({
        kind: 'allocate',
        master: book.master,
        owner,
        now: at,
        deadline: at + BigInt(PRICED_DEADLINE_SEC / 2),
        ...fund,
        sliceAt: n => feeCeiling / BigInt(n),
        candidates
      })
      const full = cohortOf(
        candidates.flatMap(c => (c.standing.kind === 'open' && c.raisable.potential > 0n ? [{ c, cap: c.raisable.potential }] : [])),
        n => feeCeiling / BigInt(n + 1)
      )
      const cooling = candidates.flatMap(c => (c.standing.kind === 'cooldown' && c.raisable.potential > 0n ? [c.standing.until] : []))
      return {
        token: quote.token,
        description: getTokenDescription(HUB_CHAIN_ID, quote.token),
        members: full.length > rows.length ? full.length : rows.length,
        raiseNow: rows.reduce((total, r) => total + r.stake, 0n),
        raiseMax: full.reduce((total, row) => total + row.cap, 0n),
        cooling: cooling.length,
        readyAt: cooling.reduce<bigint | null>((first, until) => (first === null || until < first ? until : first), null)
      }
    })
    .filter(group => group.raiseNow > 0n)
    .sort((a, b) => (b.raiseNow > a.raiseNow ? 1 : b.raiseNow < a.raiseNow ? -1 : 0))
  return { at, redeeming, groups, ended: mandated.length - counted.length }
}
export type IRaisableGroups = ReturnType<typeof raisableGroupsOf>

export const $fundRaisable = (
  hideBalances: IStream<boolean>,
  raisable: IRaisableGroups,
  failure: IStream<{ error: unknown } | null>,
  $allocate: (token: Address, amount: bigint, $rowOf: ($button: I$Node) => I$Node) => I$Node
): I$Node => {
  const at = raisable.at
  if (raisable.redeeming || raisable.groups.length === 0) return empty
  const $group = (group: IRaisableGroups['groups'][number]): I$Node =>
    $column(spacing.small, style({ paddingBottom: '12px', borderBottom: `1px solid ${SEPARATOR_COLOR}` }))(
      $allocate(group.token, 0n, $button =>
        $row(spacing.small, style({ alignItems: 'center' }))(
          $tokenMark(HUB_CHAIN_ID, group.token, group.description, 28, true),
          $button,
          $node(style({ flex: 1 }))(),
          $node(style({ whiteSpace: 'nowrap' }))(
            $amountDisplay({
              hideBalances: just(false),
              usd: maskBalance(
                group.raiseMax <= group.raiseNow
                  ? ethUsd(group.raiseNow)
                  : map(price => price.then(at => `${formatUsd(group.raiseNow, at)} – ${formatUsd(group.raiseMax, at)}`), ethPrice()),
                hideBalances
              ),
              amount: `${group.members} ${group.members === 1 ? 'puppet' : 'puppets'}`,
              align: 'flex-end'
            })
          )
        )
      ),
      ...(group.readyAt === null
        ? []
        : [
            $node(style({ fontSize: text.xs, color: palette.foreground }))(
              $text(
                `${group.cooling} more ready at ${readableDate(Number(group.readyAt), group.readyAt - at < 86_400n ? { timeStyle: 'short' } : { dateStyle: 'short', timeStyle: 'short' })}`
              )
            )
          ])
    )
  const ended = raisable.ended
  return $column(spacing.default)(
    $labeledDivider(
      $row(spacing.tiny, style({ alignItems: 'center' }))(
        switchLatest(map(failed => (failed === null ? $text('Raisable') : $intermediateFailure(failed.error, $text('Raisable'), true)), failure)),
        $infoTooltip(
          "Puppet capital your next round can take: least without your contribution, most once yours covers every ready puppet.",
          palette.foreground
        )
      )
    ),
    ...raisable.groups.map($group),
    ...(ended === 0 ? [] : [$node(style({ fontSize: text.xs, color: palette.foreground }))($text(`${ended} ended ${ended === 1 ? 'mandate' : 'mandates'} not counted`))])
  )
}
