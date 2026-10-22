import { type Address, getAddress } from 'viem'
import { readContract } from 'viem/actions'
import { USD_DECIMALS, USD_SYMBOL } from '../../const/common.js'
import type { ChainId } from '../../const/index.js'
import { readableAddress } from '../../core/format.js'
import { readableLeverage, readableUsd } from '../../core/readable.js'
import { max } from '../../core/math.js'
import { readTokenProfiles } from '../../core/token.js'
import { usdPriceFromRate } from '../../evaluate/precision.js'
import { valueUnlisted } from '../../evaluate/unlisted.js'
import type { IPriceSource } from '../../evaluate/types.js'
import { type ITokenMetaKey, tokenMetaByChainToken, tokenMetaKey } from '../../state/tokenRegistry.js'
import type { IVenueMarket, IVenuePosition, IVenueValueParams } from '../types.js'
import { GMX_V2_CONTRACT_MAP } from './contractMap.js'
import { GMX_WNT, readGmxMarkets } from './market.js'
import { makeOnchainGmxClaimableProvider, makeOnchainGmxOrderProvider, makeOnchainGmxPositionProvider } from './onchainPositions.js'
import { getPositionPnlUsd } from './position.js'
import type { IGmxClaimableRow, IGmxOrderRow, IGmxPositionRow } from './rows.js'

export type { IGmxClaimableRow, IGmxOrderRow, IGmxPositionRow } from './rows.js'

export const GMX_ORDER_TYPE = {
  MarketSwap: 0,
  LimitSwap: 1,
  MarketIncrease: 2,
  LimitIncrease: 3,
  MarketDecrease: 4,
  LimitDecrease: 5,
  StopLossDecrease: 6,
  StopIncrease: 8
} as const

export const GMX_INCREASE_TYPES: ReadonlySet<number> = new Set([
  GMX_ORDER_TYPE.MarketIncrease,
  GMX_ORDER_TYPE.LimitIncrease,
  GMX_ORDER_TYPE.StopIncrease
])

export const GMX_DECREASE_TYPES: ReadonlySet<number> = new Set([
  GMX_ORDER_TYPE.MarketDecrease,
  GMX_ORDER_TYPE.LimitDecrease,
  GMX_ORDER_TYPE.StopLossDecrease
])

export const GMX_ORDER_CUSTODY_TYPES: ReadonlySet<number> = new Set([
  GMX_ORDER_TYPE.MarketSwap,
  GMX_ORDER_TYPE.LimitSwap,
  GMX_ORDER_TYPE.MarketIncrease,
  GMX_ORDER_TYPE.LimitIncrease,
  GMX_ORDER_TYPE.StopIncrease
])

const GMX_ORDER_EXECUTING_TYPES: ReadonlySet<number> = new Set([
  GMX_ORDER_TYPE.MarketSwap,
  GMX_ORDER_TYPE.MarketIncrease,
  GMX_ORDER_TYPE.MarketDecrease
])


type IGmxPriceMap = Map<ITokenMetaKey, IPriceSource>

function gmxTokensToPrice(
  markets: ReadonlyMap<Address, IVenueMarket>,
  rows: IGmxPositionRow[],
  orders: IGmxOrderRow[],
  claimables: IGmxClaimableRow[]
): Address[] {
  const tokens = new Set<Address>()
  for (const r of rows) {
    const indexToken = markets.get(getAddress(r.market))?.indexToken
    if (indexToken !== undefined) tokens.add(indexToken)
    tokens.add(r.collateralToken)
  }
  for (const o of orders) {
    if (GMX_ORDER_CUSTODY_TYPES.has(o.orderType)) tokens.add(o.collateralToken)
    if (o.executionFee > 0n) tokens.add(GMX_WNT)
  }
  for (const c of claimables) tokens.add(c.token)
  return [...tokens]
}

function tokenAmountToUsd(priceByToken: IGmxPriceMap, chainId: ChainId, token: Address, amount: bigint): bigint | null {
  const entry = priceByToken.get(tokenMetaKey(chainId, token))
  if (!entry || entry.price === 0n) return null
  return amount * entry.price
}

const GMX_ORDER_NAME: Readonly<Record<number, string>> = {
  [GMX_ORDER_TYPE.MarketSwap]: 'Market swap',
  [GMX_ORDER_TYPE.LimitSwap]: 'Limit swap',
  [GMX_ORDER_TYPE.MarketIncrease]: 'Market increase',
  [GMX_ORDER_TYPE.LimitIncrease]: 'Limit increase',
  [GMX_ORDER_TYPE.MarketDecrease]: 'Market decrease',
  [GMX_ORDER_TYPE.LimitDecrease]: 'Limit decrease',
  [GMX_ORDER_TYPE.StopLossDecrease]: 'Stop-loss',
  [GMX_ORDER_TYPE.StopIncrease]: 'Stop increase'
}

export async function gmxPositions({ chainId, account, blockNumber, nowSec, clients, getRate, freshness }: IVenueValueParams): Promise<IVenuePosition[]> {
  const publicClient = clients[chainId]
  if (publicClient === undefined) throw new Error('GMX positions need a chain client')
  const [positions, orders, claimables] = await Promise.all([
    makeOnchainGmxPositionProvider(publicClient, getRate, freshness, blockNumber)(account),
    makeOnchainGmxOrderProvider(publicClient, blockNumber)(account),
    makeOnchainGmxClaimableProvider(publicClient, blockNumber)(account)
  ])
  if (positions.length === 0 && orders.length === 0 && claimables.length === 0) return []
  const markets = await readGmxMarkets(publicClient, [...positions.map(row => row.market), ...orders.map(o => o.market)], blockNumber)
  const indexOf = (market: Address): Address | undefined => markets.get(getAddress(market))?.indexToken
  const priceByToken: IGmxPriceMap = new Map()
  const unlisted = [...new Set([...positions.flatMap(row => [indexOf(row.market), row.collateralToken]), ...orders.map(o => indexOf(o.market))])].filter(
    (token): token is Address => token !== undefined && !tokenMetaByChainToken.has(tokenMetaKey(chainId, token))
  )
  const [profiles] = await Promise.all([
    readTokenProfiles(req => readContract(publicClient, req), chainId, unlisted),
    ...gmxTokensToPrice(markets, positions, orders, claimables).map(async token => {
      const key = tokenMetaKey(chainId, token)
      const meta = tokenMetaByChainToken.get(key)
      if (!meta) return
      const rate = await getRate(meta.symbol, USD_SYMBOL, freshness)
      priceByToken.set(key, { price: usdPriceFromRate(rate, USD_DECIMALS), time: rate.time })
    })
  ])
  const marked = new Map<Address, string>()
  await Promise.all(
    [...new Set(positions.flatMap(row => {
      const token = indexOf(row.market)
      return token === undefined ? [] : [getAddress(token)]
    }))]
      .filter(token => !tokenMetaByChainToken.has(tokenMetaKey(chainId, token)))
      .map(async token => {
        const profile = profiles.get(token)
        if (profile === undefined) return
        const whole = 10n ** BigInt(profile.decimals)
        const priced = await valueUnlisted(publicClient, chainId, token, whole, blockNumber, getRate, USD_SYMBOL, freshness)
        if (priced === null) return
        priceByToken.set(tokenMetaKey(chainId, token), { price: priced.value / whole, time: priced.time })
        marked.set(token, priced.via)
      })
  )
  const symbolOfToken = (token: Address): string =>
    tokenMetaByChainToken.get(tokenMetaKey(chainId, token))?.symbol ?? profiles.get(getAddress(token))?.symbol ?? readableAddress(token)
  const decimalsOf = (token: Address): number => {
    const meta = tokenMetaByChainToken.get(tokenMetaKey(chainId, token))
    if (meta === undefined) throw new Error(`GMX token ${token} is priced but not registered`)
    return meta.decimals
  }
  const rows: IVenuePosition[] = []
  for (const row of positions) {
    const indexToken = indexOf(row.market)
    const indexEntry = indexToken === undefined ? undefined : priceByToken.get(tokenMetaKey(chainId, indexToken))
    const pnlUsd = indexEntry === undefined ? null : getPositionPnlUsd(row.isLong, row.sizeInUsd, row.sizeInTokens, indexEntry.price)
    const indexName = indexToken === undefined ? row.market : symbolOfToken(indexToken)
    const indexDecimals =
      indexToken === undefined ? undefined : (tokenMetaByChainToken.get(tokenMetaKey(chainId, indexToken))?.decimals ?? profiles.get(getAddress(indexToken))?.decimals)
    rows.push({
      holder: account,
      chainId: BigInt(chainId),
      contract: GMX_V2_CONTRACT_MAP.GmxDatastore.address,
      key: row.positionKey,
      kind: 'perp',
      label: `${indexName}/USD ${row.isLong ? 'long' : 'short'}`,
      size: indexDecimals === undefined ? row.sizeInUsd : row.sizeInTokens,
      unit: indexDecimals === undefined ? 'USD' : indexName,
      decimals: indexDecimals === undefined ? USD_DECIMALS : indexDecimals,
      ...(indexDecimals === undefined ? {} : { long: row.isLong, entry: row.sizeInUsd, collateral: row.collateralAmount, collateralUnit: symbolOfToken(row.collateralToken) }),
      cost: row.collateralUsd,
      value: pnlUsd === null ? undefined : max(0n, row.collateralUsd + pnlUsd),
      fieldLabelList: pnlUsd === null ? ['Notional', 'Collateral', 'Priced by'] : ['Notional', 'Leverage', 'Collateral', 'Priced by'],
      fieldValueList:
        pnlUsd === null
          ? [`$${readableUsd(row.sizeInUsd)}`, symbolOfToken(row.collateralToken), `unpriced: no oracle market or Uniswap v3 pool prices ${indexName}`]
          : [
              `$${readableUsd(row.sizeInUsd)}`,
              row.collateralUsd + pnlUsd > 0n ? readableLeverage(row.sizeInUsd, row.collateralUsd + pnlUsd) : 'underwater',
              symbolOfToken(row.collateralToken),
              (indexToken === undefined ? undefined : marked.get(getAddress(indexToken))) ?? 'the oracle'
            ],
      time: indexEntry === undefined ? nowSec : indexEntry.time
    })
  }
  for (const o of orders) {
    const custody = GMX_ORDER_CUSTODY_TYPES.has(o.orderType) && o.collateralDeltaAmount > 0n
    const executing = GMX_ORDER_EXECUTING_TYPES.has(o.orderType)
    if (!custody && !executing && o.executionFee === 0n) continue
    const entry = priceByToken.get(tokenMetaKey(chainId, o.collateralToken))
    if (custody && (entry === undefined || entry.price === 0n)) throw new Error(`no oracle price for resting order collateral ${o.collateralToken}`)
    const executionFeeUsd = o.executionFee === 0n ? 0n : tokenAmountToUsd(priceByToken, chainId as ChainId, GMX_WNT, o.executionFee)
    if (executionFeeUsd === null) throw new Error(`no oracle price for the execution fee GMX holds in ${GMX_WNT}`)
    const value = (custody ? o.collateralDeltaAmount * entry!.price : 0n) + executionFeeUsd
    const indexToken = indexOf(o.market)
    const indexDecimals =
      indexToken === undefined ? undefined : (tokenMetaByChainToken.get(tokenMetaKey(chainId, indexToken))?.decimals ?? profiles.get(getAddress(indexToken))?.decimals)
    const trigger = o.triggerPrice === 0n || indexDecimals === undefined ? null : `$${readableUsd(o.triggerPrice * 10n ** BigInt(indexDecimals))}`
    rows.push({
      holder: account,
      chainId: BigInt(chainId),
      contract: GMX_V2_CONTRACT_MAP.GmxOrderVault.address,
      key: o.orderKey,
      kind: executing ? 'pending' : 'order',
      label: `${GMX_ORDER_NAME[o.orderType] ?? `Order type ${o.orderType}`} ${o.isLong ? 'long' : 'short'}`,
      size: custody ? o.collateralDeltaAmount : o.sizeDeltaUsd,
      unit: custody ? symbolOfToken(o.collateralToken) : 'USD',
      decimals: custody ? decimalsOf(o.collateralToken) : USD_DECIMALS,
      cost: value,
      value,
      fieldLabelList: ['Status', ...(trigger === null ? [] : ['Trigger']), ...(executionFeeUsd === 0n ? [] : ['Execution fee'])],
      fieldValueList: [
        executing ? 'awaiting keeper execution' : o.isFrozen ? 'frozen' : 'resting',
        ...(trigger === null ? [] : [trigger]),
        ...(executionFeeUsd === 0n ? [] : [`$${readableUsd(executionFeeUsd)}`])
      ],
      time: entry?.time ?? nowSec
    })
  }
  for (const c of claimables) {
    if (c.amount === 0n) continue
    const claimUsd = tokenAmountToUsd(priceByToken, chainId as ChainId, c.token, c.amount)
    if (claimUsd === null) throw new Error(`no oracle price for claimable funding token ${c.token}`)
    rows.push({
      holder: account,
      chainId: BigInt(chainId),
      contract: c.market,
      key: `${c.market}:${c.token}`,
      kind: 'cash',
      label: `Claimable funding (${symbolOfToken(c.token)})`,
      size: c.amount,
      unit: symbolOfToken(c.token),
      decimals: decimalsOf(c.token),
      cost: claimUsd,
      value: claimUsd,
      fieldLabelList: [],
      fieldValueList: [],
      time: priceByToken.get(tokenMetaKey(chainId, c.token))!.time
    })
  }
  return rows
}
