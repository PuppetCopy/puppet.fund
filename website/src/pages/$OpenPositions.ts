import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { IFund__Position, IFund__Valuation } from '@puppet/contracts/types'
import { requestValuation } from '@puppet/sdk/compact'
import { USD_DECIMALS } from '@puppet/sdk/const'
import { formatFixed, getTokenDescription, readablePercentage, readableTokenAmountLabel, readableUnitAmount, toBasisPoints } from '@puppet/sdk/core'
import { VALUE_KEY } from '@puppet/sdk/evaluate'
import type { IFundRow, IValuationRow } from '@puppet/sdk/schema'
import { bondTokenOf, chainTokenOfKey } from '@puppet/sdk/state'
import { GMX_V2_CHAIN_ID, getGmxTokenDescription, getMarketDescription, getPositionPnlUsd, type IGmxPositionRow, VENUES } from '@puppet/sdk/venue'
import { combine, type IStream, just, map, merge } from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import { $node, $text, component, type I$Node, type INode, nodeEvent, style } from 'aelea/ui'
import { $column, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { type Address, getAddress, type Hex, isAddressEqual, keccak256, toHex } from 'viem'
import { $amountDisplay, $inlineSpinner, $intermediatePromise, text } from '@/ui-components'
import { chainName } from '../common/$chain.js'
import { $pnlDisplay, $size, $tokenIcon } from '../common/$common.js'
import { $venueIcon } from '../common/$operationView.js'
import { $miniButton } from '../components/portfolio/editorUtils.js'
import { fetchFundShare } from '../io/datastore/reads.js'
import { matchmakerUrl } from '../io/matchmaker/index.js'
import { formatUsd, priceFor } from '../io/price.js'
import { $caption, $separator2, ago } from './common.js'

const VALUE_TOKEN = chainTokenOfKey(HUB_CHAIN_ID, VALUE_KEY)
const BOND_TOKEN = bondTokenOf(HUB_CHAIN_ID)
const value = getTokenDescription(HUB_CHAIN_ID, VALUE_TOKEN)
const GMX_VENUE = keccak256(toHex('gmx'))
const ACROSS_VENUE = keccak256(toHex('across'))

const venueName = (hash: Hex): string =>
  VENUES.find(venue => keccak256(toHex(venue.venueId)) === hash)?.name ?? (hash === ACROSS_VENUE ? 'Across transfer' : 'Unknown venue')

const $venueHeader = (name: string, count: number): I$Node =>
  $row(spacing.small, style({ alignItems: 'center' }))(
    $venueIcon(name),
    $node(style({ fontSize: text.sm, fontWeight: '600', color: palette.message }))($text(name)),
    $node(style({ color: palette.foreground, fontSize: text.xs }))($text(`${count}`))
  )

const $venueGroup = (name: string, rows: I$Node[]): I$Node =>
  $column(spacing.default)(
    $venueHeader(name, rows.length),
    $column(spacing.default, style({ paddingLeft: '12px', marginLeft: '8px', borderLeft: `1px solid ${colorShade(palette.foreground, 30)}` }))(...rows)
  )

const $directionPill = (isLong: boolean): I$Node => {
  const color = isLong ? palette.positive : palette.negative
  return $node(style({ fontSize: text.xs, fontWeight: '600', padding: '1px 7px', borderRadius: '4px', color, backgroundColor: colorShade(color, 12) }))(
    $text(isLong ? 'Long' : 'Short')
  )
}

const marketIndexToken = (market: Address): Address | null => {
  try {
    return getMarketDescription(market).indexToken
  } catch {
    return null
  }
}

export type IShownValuation = Pick<IFund__Valuation, 'value' | 'assetList' | 'positionList'> & { time: bigint }

export const markOf = (row: IValuationRow, fundRow: IFundRow | undefined): IShownValuation => {
  const delta = fundRow !== undefined && fundRow.lastBlock === row.block ? fundRow.value - row.value : 0n
  const assets = row.assetChainIdList.map((chainId, i) => ({ chainId, token: getAddress(row.assetTokenList[i]!), amount: row.assetAmountList[i]! }))
  const hub = assets.findIndex(a => Number(a.chainId) === HUB_CHAIN_ID && isAddressEqual(a.token, BOND_TOKEN))
  const assetList =
    delta === 0n
      ? assets
      : hub === -1
        ? [...assets, { chainId: BigInt(HUB_CHAIN_ID), token: BOND_TOKEN, amount: delta }]
        : assets.map((a, i) => (i === hub ? { ...a, amount: a.amount + delta } : a))
  return {
    value: row.value + delta,
    time: BigInt(row.blockTimestamp),
    assetList: assetList.filter(a => a.amount > 0n),
    positionList: row.positionChainIdList.map((chainId, i) => ({
      chainId,
      venue: row.positionVenueList[i]!,
      id: row.positionIdList[i]!,
      valueInUsd: row.positionValueList[i]!
    }))
  }
}

export const valuedLabel = (shown: IShownValuation): string => `After the last round, ${ago(Number(shown.time))}`

export interface I$OpenPositions {
  master: Address
  hideBalances: IStream<boolean>
  positions: IStream<Promise<IGmxPositionRow[]>>
  valuation: IStream<Promise<IShownValuation | null>>
  $empty: I$Node
}

export const $OpenPositions = ({ master, hideBalances, positions, valuation, $empty }: I$OpenPositions) =>
  component(([clickValue, clickValueTether]: IBehavior<INode<HTMLButtonElement>, PointerEvent>) => {
  const $positionRow = (pos: IGmxPositionRow): I$Node => {
    const indexToken = marketIndexToken(pos.market)
    const symbol = indexToken ? getGmxTokenDescription(indexToken).symbol : '?'
    const pnl: IStream<bigint> =
      indexToken === null
        ? just(pos.storedPnlUsd)
        : map(price => (price === null ? pos.storedPnlUsd : getPositionPnlUsd(pos.isLong, pos.sizeInUsd, pos.sizeInTokens, price)), priceFor(GMX_V2_CHAIN_ID, indexToken))
    const roi = map(v => readablePercentage(toBasisPoints(v, pos.collateralUsd)), pnl)
    const netValue = map(v => `$${readableUnitAmount(formatFixed(USD_DECIMALS, pos.collateralUsd + v))}`, pnl)
    return $row(isDesktopScreen ? spacing.big : spacing.default, style({ alignItems: 'center' }))(
      $row(spacing.small, style({ alignItems: 'center', flex: 1, minWidth: '0' }))(
        $tokenIcon(symbol, '28px'),
        $node(style({ fontSize: text.base, color: palette.message, fontWeight: '600' }))($text(symbol)),
        $directionPill(pos.isLong)
      ),
      $size(pos.sizeInUsd, pos.collateralUsd),
      $column(spacing.tiny, style({ alignItems: 'flex-end', minWidth: '64px' }))($pnlDisplay(pnl), $separator2, $node(style({ fontSize: text.xs, color: palette.foreground }))($text(roi))),
      $amountDisplay({
        hideBalances,
        usd: netValue,
        amount: readableTokenAmountLabel(getGmxTokenDescription(pos.collateralToken), pos.collateralAmount),
        align: 'flex-end'
      })
    )
  }
  const $bookRow = (p: IFund__Position): I$Node =>
    $row(spacing.small, style({ alignItems: 'center' }))(
      $node(style({ flex: 1, fontSize: text.sm, color: palette.message }))($text(`on ${chainName(Number(p.chainId))}`)),
      $amountDisplay({
        hideBalances,
        usd: map(price => formatUsd(p.valueInUsd, price), priceFor(HUB_CHAIN_ID, VALUE_TOKEN)),
        amount: readableTokenAmountLabel(value, p.valueInUsd),
        align: 'flex-end'
      })
    )
  const shown: IStream<Promise<IShownValuation | null>> = merge(
    valuation,
    map(() => fetchFundShare(master).then(share => requestValuation(matchmakerUrl, master, share)).then(quote => quote.valuation as IShownValuation), clickValue)
  )
  const $body = $intermediatePromise({
    $loader: $inlineSpinner,
    $display: map(
      async q => {
        const [list, mark] = await Promise.all([q.positions, q.valuation])
        const others = new Map<Hex, IFund__Position[]>()
        for (const p of mark?.positionList ?? []) {
          if (p.venue === GMX_VENUE) continue
          others.set(p.venue, [...(others.get(p.venue) ?? []), p])
        }
        if (list.length === 0 && others.size === 0) return $empty
        return $column(spacing.big)(
          ...(list.length === 0 ? [] : [$venueGroup('GMX', list.map($positionRow))]),
          ...[...others].map(([venue, books]) => $venueGroup(venueName(venue), books.map($bookRow))),
          $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap' }))(
            $caption(`${others.size === 0 || mark === null ? '' : `Venue books: ${valuedLabel(mark).toLowerCase()}. `}Redemptions wait until nothing is left on a venue or in transit.`),
            $miniButton('Value now', false, clickValueTether(nodeEvent('click')))
          )
        )
      },
      combine({ positions, valuation: shown })
    )
  })
  return [$body, {}]
  })
