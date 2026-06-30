import { HUB_CHAIN_ID, PRECISION } from '@puppet/contracts/const'
import type { ChainId } from '@puppet/sdk/const'
import { getRegisteredTokenDescription, readableTokenAmountLabel } from '@puppet/sdk/core'
import { getMarketDescription, getTokenDescription } from '@puppet/sdk/gmx'
import type { IFund } from '@puppet/sdk/schema'
import { type ITokenRegistryMap, tokenInfoFor } from '@puppet/sdk/state'
import { combine, fromPromise, type IStream, map, merge, switchLatest } from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import { $node, $text, type I$Node, style } from 'aelea/ui'
import { $column, $row, $Tooltip, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { type Address, getAddress, type Hex } from 'viem'
import { $amountDisplay, $icon, $puppeteer, $tooltipDropContainer, text } from '@/ui-components'
import { $jazzicon } from '../../common/$avatar.js'
import { $size } from '../../common/$common.js'
import context from '../../io/context.js'
import { fetchFundAllocationDistribution, fetchMasterPoolState } from '../../io/datastore/query.js'
import { formatUsd, priceFor } from '../../io/gmx/priceFeed.js'
import { fetchOpenPositions } from '../../io/matchmaker/reads.js'
import { readAccountBalances } from '../../io/onchain/balances.js'
import { $accountLabel } from '../$AccountProfile.js'
import { $SwapEditor } from './$SwapEditor.js'
import type { IFundSwapDraft } from './draft.js'

const $hint = (label: string): I$Node =>
  $node(style({ color: palette.foreground, fontSize: text.sm, padding: '4px 0' }))($text(label))

const $separator = (): I$Node =>
  $node(style({ height: '1px', width: '100%', backgroundColor: colorShade(palette.foreground, 12) }))()

const withSeparators = ($rows: I$Node[]): I$Node[] =>
  $rows.flatMap((node, i) => (i === 0 ? [node] : [$separator(), node]))

export const $fundBalances = (
  hideBalances: IStream<boolean>,
  fundAddress: Address,
  tokenRegistry: ITokenRegistryMap,
  swapDraftList: IStream<IFundSwapDraft[]>,
  changeSwapDraftTether: IBehavior<IFundSwapDraft>[1],
  settleTrigger: IStream<unknown>
): I$Node =>
  switchLatest(
    map(
      rows => {
        const rowList = rows
          .filter(r => r.signedBalance > 0n)
          .map(r => ({ chainId: Number(r.chainId) as ChainId, token: r.token as Hex, balance: r.signedBalance }))
        if (rowList.length === 0) return $hint('No balances yet.')
        return $SwapEditor({
          hideBalances,
          fundAddress,
          holdings: rowList,
          tokenRegistry,
          swapDraftList
        })({ changeDraft: changeSwapDraftTether() })
      },
      merge(
        fromPromise(readAccountBalances(tokenRegistry, fundAddress)),
        switchLatest(
          map(() => fromPromise(readAccountBalances(tokenRegistry, fundAddress, true)), settleTrigger)
        )
      )
    )
  )

export const $fundPositions = (fundAddress: Address, settleTrigger: IStream<unknown>): I$Node =>
  switchLatest(
    map(
      positions => {
        const open = positions.filter(pos => pos.sizeInUsd > 0n)
        if (open.length === 0) return $hint('No open positions')
        const $rows = open.map(pos => {
          const symbol = getTokenDescription(getMarketDescription(pos.market).indexToken).symbol
          const directionColor = pos.isLong ? palette.positive : palette.negative
          return $row(spacing.default, style({ alignItems: 'center' }))(
            $row(spacing.small, style({ alignItems: 'center', flex: 1, minWidth: '0' }))(
              $node(style({ fontSize: text.base, color: palette.message, fontWeight: '600' }))($text(symbol)),
              $node(
                style({
                  fontSize: text.xs,
                  fontWeight: '600',
                  padding: '1px 7px',
                  borderRadius: '4px',
                  color: directionColor,
                  backgroundColor: colorShade(directionColor, 12)
                })
              )($text(pos.isLong ? 'Long' : 'Short'))
            ),
            $size(pos.sizeInUsd, pos.collateralInUsd)
          )
        })
        return $column(spacing.small)(...withSeparators($rows))
      },
      switchLatest(map(() => fromPromise(fetchOpenPositions(getAddress(fundAddress)).catch(() => [])), settleTrigger))
    )
  )

export const $allocationDistribution = (
  hideBalances: IStream<boolean>,
  holders: Array<{ user: Address; sharesHeld: bigint; isMaster: boolean }>,
  pool: IFund | undefined,
  tokenRegistry: ITokenRegistryMap
): I$Node => {
  if (!pool || holders.length === 0) return $hint('No allocations yet')
  const total = holders.reduce((acc, s) => acc + s.sharesHeld, 0n)
  const baseToken = tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, pool.baseToken).token
  const desc = getRegisteredTokenDescription(baseToken)
  const ranked = [...holders].sort((a, b) => (b.sharesHeld > a.sharesHeld ? 1 : -1))
  return $column(spacing.default)(
    ...ranked.map(s => {
      const share = total > 0n ? Number((s.sharesHeld * 10000n) / total) / 100 : 0
      const value = (s.sharesHeld * pool.navPerShare) / PRECISION.floatPrecisionExp
      return $column(spacing.tiny)(
        $row(spacing.small, style({ alignItems: 'center' }))(
          $jazzicon(s.user, 26),
          $accountLabel({ address: s.user }),
          s.isMaster
            ? $Tooltip({
                $dropContainer: $tooltipDropContainer,
                $content: $node(
                  $text(
                    'Fund master. This puppet account manages the fund; puppets allocate behind it, and its own allocation is shown alongside theirs.'
                  )
                ),
                $anchor: $icon({
                  $content: $puppeteer,
                  width: '13px',
                  viewBox: '0 0 32 32',
                  fill: palette.foreground,
                  svgOps: style({ display: 'block', cursor: 'help' })
                })
              })({})
            : $node(),
          $node(style({ flex: 1 }))(),
          $amountDisplay({
            hideBalances,
            usd: map(price => formatUsd(value, price), priceFor(baseToken)),
            amount: readableTokenAmountLabel(desc, value),
            align: 'flex-end'
          })
        ),
        $node(style({ height: '4px', borderRadius: '4px', backgroundColor: colorShade(palette.foreground, 20) }))(
          $node(style({ height: '4px', borderRadius: '4px', width: `${share}%`, backgroundColor: palette.primary }))()
        )
      )
    })
  )
}

export const $fundAllocations = (
  hideBalances: IStream<boolean>,
  fundAddress: Address,
  master: Address,
  settleTrigger: IStream<unknown>
): I$Node =>
  switchLatest(
    map(
      p => $allocationDistribution(hideBalances, p.dist, p.pool, p.registry),
      combine({
        dist: switchLatest(map(() => fromPromise(fetchFundAllocationDistribution(fundAddress, master)), settleTrigger)),
        pool: switchLatest(map(() => fromPromise(fetchMasterPoolState(fundAddress)), settleTrigger)),
        registry: fromPromise(context.getTokenRegistry())
      })
    )
  )
