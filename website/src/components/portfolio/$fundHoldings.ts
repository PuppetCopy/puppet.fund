import { HUB_CHAIN_ID, PRECISION } from '@puppet/contracts/const'
import { predictDepositRoute } from '@puppet/sdk/account'
import type { ChainId } from '@puppet/sdk/const'
import { getChainTokenDescription, readableTokenAmountLabel } from '@puppet/sdk/core'
import { getMarketDescription, getTokenDescription } from '@puppet/sdk/gmx'
import type { IFund } from '@puppet/sdk/schema'
import { type ITokenRegistryMap, tokenInfoFor } from '@puppet/sdk/state'
import { aggregate, combine, fromPromise, type IStream, map, switchLatest } from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import { $node, $text, type I$Node, style, } from 'aelea/ui'
import { $column, $row, $Tooltip, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { type Address, getAddress, type Hex } from 'viem'
import { $amountDisplay, $ButtonSecondary, $icon, $puppeteer, $tooltipDropContainer, text } from '@/ui-components'
import { $jazzicon } from '../../common/$avatar.js'
import { chainName } from '../../common/$chain.js'
import { $size } from '../../common/$common.js'
import context from '../../io/context.js'
import { fetchFundAllocationDistribution, fetchMasterPoolState } from '../../io/datastore/query.js'
import { fetchOpenPositions } from '../../io/datastore/reads.js'
import { type IRouteBalanceRow, readAccountBalances, readRouteBalances } from '../../io/onchain/balances.js'
import { formatUsd, priceFor } from '../../io/price.js'
import { $accountLabel } from '../$AccountProfile.js'
import { $FundSwapEditor } from './$FundSwapEditor.js'
import type { IClaimRouteDraft, IFundSwapDraft } from './draft.js'

const $hint = (label: string): I$Node =>
  $node(style({ color: palette.foreground, fontSize: text.sm, padding: '4px 0' }))($text(label))

const $separator = (): I$Node =>
  $node(style({ height: '1px', width: '100%', backgroundColor: colorShade(palette.foreground, 12) }))()

const withSeparators = ($rows: I$Node[]): I$Node[] =>
  $rows.flatMap((node, i) => (i === 0 ? [node] : [$separator(), node]))

// A route balance is money mid-journey (a bridge delivery whose recognize never ran): surface it as a claimable row so
// a partial cross-chain failure is always visible and one tap resumes it — the claim is the SAME dest-chain recognize
// the swap flow runs (create-fund-on-missing + sweep the FULL route balance).
const $claimRow = (
  hideBalances: IStream<boolean>,
  fundAddress: Address,
  tokenRegistry: ITokenRegistryMap,
  row: IRouteBalanceRow,
  changeClaimDraftTether: IBehavior<PointerEvent, IClaimRouteDraft>[1]
): I$Node => {
  const token = tokenInfoFor(tokenRegistry, row.chainId, row.token).token
  const desc = getChainTokenDescription(row.chainId, token)
  const draft: IClaimRouteDraft = {
    kind: 'claimRoute',
    id: `claimRoute:${fundAddress}:${row.chainId}:${row.token}`,
    account: fundAddress,
    title: 'Claim',
    alert: null,
    chainId: row.chainId,
    token: row.token,
    amount: row.amount
  }
  return $row(spacing.default, style({ alignItems: 'center' }))(
    $column(style({ flex: 1, minWidth: '0', gap: '2px' }))(
      $node(style({ fontSize: text.base, color: palette.message, fontWeight: '600' }))(
        $text(`${desc.symbol} in transit`)
      ),
      $node(style({ fontSize: text.xs, color: palette.foreground }))($text(chainName(row.chainId)))
    ),
    $ButtonSecondary({ $content: $text('Claim') })({
      click: changeClaimDraftTether(map(() => draft))
    }),
    $amountDisplay({
      hideBalances,
      usd: map(price => formatUsd(row.amount, price), priceFor(token)),
      amount: readableTokenAmountLabel(desc, row.amount),
      align: 'flex-end'
    })
  )
}

// A settle-triggered re-read is PINNED at the settle's (chain, block): unpinned refresh at `latest` can hit a
// load-balanced node lagging the settle block, read the PRE-settlement balance, and cache it as fresh — the panel then
// never shows the settled funds. The pin retries (a lagging node throws loud) and falls back to unpinned only after.
const readBalancesPinned = async (
  tokenRegistry: ITokenRegistryMap,
  fundAddress: Address,
  refresh: boolean,
  pin: { chainId: number; block: bigint } | null
) => {
  if (!refresh || pin === null) return readAccountBalances(tokenRegistry, fundAddress, refresh)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await readAccountBalances(tokenRegistry, fundAddress, true, {
        chainId: pin.chainId as ChainId,
        block: pin.block
      })
    } catch {
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
    }
  }
  return readAccountBalances(tokenRegistry, fundAddress, true)
}

export const $fundBalances = (
  hideBalances: IStream<boolean>,
  fundAddress: Address,
  tokenRegistry: ITokenRegistryMap,
  swapDraftList: IStream<IFundSwapDraft[]>,
  changeSwapDraftTether: IBehavior<IFundSwapDraft>[1],
  changeClaimDraftTether: IBehavior<PointerEvent, IClaimRouteDraft>[1],
  settleTrigger: IStream<{ chainId: number; block: bigint } | null>
): I$Node =>
  switchLatest(
    map(
      p => {
        const rowList = p.rows
          .filter(r => r.signedBalance > 0n)
          .map(r => ({ chainId: Number(r.chainId) as ChainId, token: r.token as Hex, balance: r.signedBalance }))
        const $claims = p.pending.map(row =>
          $claimRow(hideBalances, fundAddress, tokenRegistry, row, changeClaimDraftTether)
        )
        if (rowList.length === 0 && $claims.length === 0) return $hint('No balances yet.')
        const $balances =
          rowList.length === 0
            ? []
            : [
                $FundSwapEditor({
                  hideBalances,
                  fundAddress,
                  holdings: rowList,
                  tokenRegistry,
                  swapDraftList
                })({ changeDraft: changeSwapDraftTether() })
              ]
        return $column(spacing.default)(...$balances, ...withSeparators($claims))
      },
      switchLatest(
        map(
          read =>
            combine({
              rows: fromPromise(readBalancesPinned(tokenRegistry, fundAddress, read.refresh, read.pin)),
              pending: fromPromise(readRouteBalances(tokenRegistry, predictDepositRoute(fundAddress)).catch(() => []))
            }),
          aggregate<
            { chainId: number; block: bigint } | null,
            boolean,
            { refresh: boolean; pin: { chainId: number; block: bigint } | null }
          >((seed, pin) => ({ seed: true, value: { refresh: seed, pin } }), false, settleTrigger)
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
  const desc = getChainTokenDescription(HUB_CHAIN_ID, baseToken)
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
