import { HUB_CANONICAL_TOKEN, HUB_CHAIN_ID } from '@puppet/contracts/const'
import { fundSymbolOf, gridOf } from '@puppet/sdk/account'
import { tokenUnitOf } from '@puppet/sdk/client'
import type { ChainId } from '@puppet/sdk/const'
import { getAccountExplorerUrl, getUnixTimestamp, readableDate, readableTokenAmount, readTokenProfiles } from '@puppet/sdk/core'
import { USD_PRICE_DECIMALS } from '@puppet/sdk/evaluate'
import { tokenMetaByChainToken, tokenMetaKey } from '@puppet/sdk/state'
import { robotCellsOf } from '@puppet/sdk/ui-components'
import { combine, combineMap, type IStream, just, map } from 'aelea/stream'
import { $node, $text, attr, component, type I$Node, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { type Address, formatUnits, getAddress, isAddressEqual } from 'viem'
import {
  $amountDisplay,
  $anchor,
  $detailLine,
  $externalMark,
  $infoLabel,
  $intermediatePromise,
  $intermediateText,
  $intermediateLine,
  $intermediateList,
  $intermediateProfile,
  $intermediateRow,
  maskBalance,
  SEPARATOR_COLOR,
  text
} from '@/ui-components'
import { $jazzicon } from '../common/$avatar.js'
import { $tokenProfile, $intermediateTokenProfile, ethUsd } from '../common/$common.js'
import { chainFor } from '../common/$contract.js'
import { $fundAvatar } from '../common/$fundAvatar.js'
import { $card } from '../common/elements/$common.js'
import { $accountLabel, $fundProfile } from '../components/$AccountProfile.js'
import { $avatarStack } from '../components/$avatarStack.js'
import { $mandatePerformance, $mandateTerms, mandateTermsOf } from '../components/$MandatePosition.js'
import { $pnlSpark, $pnlValue, $sparkCell, pnlLabelOf } from '../components/$PerformanceMetric.js'
import { mandatePerformanceOf } from '../io/datastore/own.js'
import { puppetView } from '../io/datastore/puppet.js'
import { formatUsdNumber, priceFor, usdOf } from '../io/price.js'
import { viewCall } from '../io/onchain/viewRead.js'
import { $vital } from './common.js'

const HUB = HUB_CHAIN_ID as ChainId

export interface I$PuppetPage {
  account: Address
  hideBalances: IStream<boolean>
}

export const $PuppetPage = ({ account, hideBalances }: I$PuppetPage) =>
  component(() => {
    const view = puppetView(account)

    const $identity = $intermediatePromise({
      $loader: $intermediateRow($intermediateProfile(64)),
      $display: map(
        answer => answer.then(held =>
          $row(spacing.default, style({ alignItems: 'center', flexWrap: 'wrap', rowGap: '12px' }))(
            $row(spacing.default, style({ alignItems: 'center', minWidth: '0' }))(
              $jazzicon(held.user ?? view.account, 64),
              $column(style({ minWidth: '0', gap: '6px' }))(
                held.user === null
                  ? $node(style({ fontWeight: '600', color: palette.message }))($text('No account on record'))
                  : $node(style({ fontWeight: '700', color: palette.message }))($accountLabel({ address: held.user, primarySize: 1.5 })),
                $row(spacing.tiny, style({ alignItems: 'center', fontSize: text.xs, color: palette.foreground, flexWrap: 'wrap' }))(
                  $accountLabel({ address: view.account, primarySize: 0.75 }),
                  $anchor(attr({ href: getAccountExplorerUrl(view.account, chainFor(HUB_CHAIN_ID)), target: '_blank', rel: 'noopener noreferrer', title: 'Account on the explorer' }))(
                    $externalMark()
                  ),
                  ...(held.since === null ? [] : [$text(`· since ${readableDate(held.since)}`)])
                )
              )
            ),
            $node(style({ flex: 1 }))(),
            ...(held.funds.length === 0
              ? []
              : [
                  $column(style({ alignItems: 'flex-end', gap: '4px' }))(
                    $node(style({ fontSize: text.xs, color: palette.foreground }))($text('Master of')),
                    ...held.funds.map(row => $fundProfile(row.master, gridOf(row), fundSymbolOf(row)))
                  )
                ])
          )
        ),
        view.state
      )
    })

    const $summary = $intermediatePromise({
      $loader: $column(spacing.big)(
        $column(spacing.small, style({ height: '132px', justifyContent: 'center' }))($intermediateLine('5em', text.xxl), $intermediateLine('6em', text.xs)),
        $row(spacing.big)(...[0, 1, 2, 3].map(() => $column(spacing.tiny)($intermediateLine('3em', text.xs), $intermediateLine('4em', text.base)))),
        $intermediateList(1, $intermediateRow($intermediateProfile()))
      ),
      $display: map(
        answer => Promise.all([answer.state, answer.worth]).then(([held, worth]) => {
          const behind = held.holdings.some(holding => holding.standing.kind === 'behind')
          const positionLegs = held.holdings.flatMap(holding => {
            const standing = holding.standing
            if (standing.kind !== 'current') return []
            return [
              { chainId: HUB, token: HUB_CANONICAL_TOKEN.WETH, amount: standing.value + standing.queuedValue },
              ...(standing.payout === null ? [] : [{ chainId: HUB, token: standing.payout.token, amount: standing.payout.amount }])
            ]
          })
          const balanceLegs = held.balances.filter(row => row.balance > 0n).map(row => ({ chainId: row.chainId, token: row.token, amount: row.balance }))
          const totalOf = (legs: readonly { chainId: ChainId; token: Address; amount: bigint }[]): IStream<Promise<string> | string> =>
            maskBalance(
              legs.length === 0
                ? just<Promise<string> | string>(formatUsdNumber(0))
                : combineMap(
                    (...prices: Promise<bigint | null>[]) =>
                      Promise.all(prices).then(known => {
                        const priced = known.flatMap(value => (value === null ? [] : [value]))
                        return priced.length < legs.length ? '-' : formatUsdNumber(legs.reduce((sum, leg, i) => sum + Number(formatUnits(leg.amount * priced[i]!, USD_PRICE_DECIMALS)), 0))
                      }),
                    ...legs.map(leg => priceFor(leg.chainId, leg.token))
                  ),
              hideBalances
            )
          const masters = [...new Set([...held.mandates.map(row => getAddress(row.master)), ...held.holdings.map(row => getAddress(row.master))])].filter(
            master => !isAddressEqual(master, view.account)
          )
          const perfs = masters.flatMap(master => {
            const perf = worth.get(master)
            return perf === undefined || perf === null ? [] : [perf]
          })
          const allocated = perfs.reduce((total, perf) => total + perf.allocated, 0n)
          const paid = perfs.reduce((total, perf) => total + perf.paid, 0n)
          const queued = perfs.reduce((total, perf) => total + (perf.exit === null ? 0n : perf.exit.value), 0n)
          const performance = mandatePerformanceOf(perfs)
          const [firstPnl] = performance.pnlPoints
          const $usd = (wei: bigint): I$Node => $node(style({ color: palette.message }))($intermediateText(maskBalance(ethUsd(wei), hideBalances)))

          return $column(spacing.big)(
            $node(style({ display: 'flex', height: '132px', fontSize: text.xxl }))(
              $sparkCell(
                $pnlSpark(firstPnl === undefined ? getUnixTimestamp() - 86_400 : firstPnl.time, performance, []),
                $pnlValue(perfs.length === 0 ? just('-') : maskBalance(pnlLabelOf(performance.pnl), hideBalances), performance)
              )
            ),
            $row(spacing.big, style({ flexWrap: 'wrap', rowGap: '12px' }))(
              $vital(
                'Value',
                $node(style({ color: palette.message }))($intermediateText(behind ? just('-') : totalOf([...positionLegs, ...balanceLegs]))),
                $column(spacing.tiny, style({ minWidth: '220px', fontSize: text.sm }))(
                  $detailLine('Allocations', behind ? just('syncing') : totalOf(positionLegs)),
                  $detailLine('Balances', totalOf(balanceLegs)),
                  $node(style({ fontSize: text.xs, color: palette.foreground, paddingTop: '4px' }))($text("Positions at the funds' last marks and recorded balances, at today's prices"))
                )
              ),
              $vital('Put in', $usd(allocated), 'What this puppet allocated to its funds.'),
              $vital('Paid out', $usd(paid), 'What its exits have paid back, in ETH.'),
              ...(queued === 0n ? [] : [$vital('Queued', $usd(queued), 'Shares sold into exit queues and not yet paid, valued at the last mark.')]),
              $vital(
                'Funds',
                $avatarStack(
                  masters.map(master => {
                    const fundRow = held.fundRows.find(row => isAddressEqual(row.master, master))
                    return $fundAvatar(fundRow === undefined ? robotCellsOf(master) : gridOf(fundRow), 14)
                  }),
                  null
                )
              )
            ),
            $column(
              $infoLabel(style({ fontSize: text.xs, paddingBottom: '4px' }))($text('Mandates')),
              ...(masters.length === 0
                ? [$node(style({ fontSize: text.sm, color: palette.foreground, padding: '10px 0', borderTop: `1px solid ${SEPARATOR_COLOR}` }))($text('No mandates yet.'))]
                : masters.map(master => {
                    const fundRow = held.fundRows.find(row => isAddressEqual(row.master, master))
                    const perf = worth.get(master)
                    const mandate = held.mandates.find(row => isAddressEqual(row.master, master) && row.epoch === held.epoch)
                    const terms = mandate === undefined ? null : mandateTermsOf(mandate)
                    return $column(spacing.small, style({ padding: '10px 0', borderTop: `1px solid ${SEPARATOR_COLOR}` }))(
                      $row(spacing.default, style({ alignItems: 'center' }))(
                        $fundProfile(master, fundRow === undefined ? robotCellsOf(master) : gridOf(fundRow), fundRow === undefined ? null : fundSymbolOf(fundRow)),
                        $node(style({ flex: 1 }))(),
                        $mandatePerformance(hideBalances, perf === undefined ? null : perf)
                      ),
                      terms === null
                        ? $node(style({ fontSize: text.xs, color: palette.foreground }))($text('No mandate'))
                        : $row(spacing.small, style({ alignItems: 'center', fontSize: text.sm, color: palette.message }))($mandateTerms(terms))
                    )
                  })
              )
            )
          )
        }),
        combine({ state: view.state, worth: view.worth })
      )
    })

    const $balances = $intermediatePromise({
      $loader: $intermediateList(1, $intermediateRow($intermediateTokenProfile())),
      $display: map(
        answer => answer.then(async held => {
          const shown = held.balances
            .filter(row => row.balance > 0n)
            .sort((a, b) => (a.chainId === b.chainId ? 0 : a.chainId === HUB_CHAIN_ID ? -1 : b.chainId === HUB_CHAIN_ID ? 1 : a.chainId - b.chainId))
          const rows = await Promise.all(
            shown.map(async row => ({
              ...row,
              profile: tokenUnitOf(
                row.chainId,
                row.token,
                await readTokenProfiles(viewCall, row.chainId, tokenMetaByChainToken.has(tokenMetaKey(row.chainId, row.token)) ? [] : [row.token])
              )
            }))
          )
          return $column(
            $infoLabel(style({ fontSize: text.xs, paddingBottom: '4px' }))($text('Balances')),
            ...(rows.length === 0
              ? [$node(style({ fontSize: text.sm, color: palette.foreground, padding: '10px 0', borderTop: `1px solid ${SEPARATOR_COLOR}` }))($text('No balances on record.'))]
              : rows.map(row =>
                  $row(spacing.default, style({ alignItems: 'center', padding: '10px 0', borderTop: `1px solid ${SEPARATOR_COLOR}` }))(
                    $tokenProfile(row.chainId, row.token, 28, row.chainId !== HUB_CHAIN_ID, null, row.profile),
                    $node(style({ flex: 1 }))(),
                    $amountDisplay({
                      hideBalances,
                      usd: map(price => usdOf(row.balance, price), priceFor(row.chainId, row.token)),
                      amount: readableTokenAmount(row.profile.decimals, row.balance),
                      align: 'flex-end'
                    })
                  )
                ))
          )
        }),
        view.state
      )
    })

    return [$card(style({ width: '100%', maxWidth: '560px', margin: '0 auto', gap: '28px' }))($identity, $summary, $balances), {}]
  })
