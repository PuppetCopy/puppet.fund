import { type Address, getAddress, isAddressEqual } from 'viem'
import { readContract } from 'viem/actions'
import { IntervalTime, USD_DECIMALS, USD_SYMBOL } from '../../const/common.js'
import { getDuration } from '../../core/date.js'
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
import { GMX_ORDER_CUSTODY_TYPES, GMX_ORDER_TYPE, GMX_REFERRAL_STORAGE, GMX_UI_FEE_RECEIVER } from './contracts.js'
import { GMX_WNT, readGmxMarkets } from './market.js'
import { makeOnchainGmxClaimableProvider, makeOnchainGmxOrderProvider, makeOnchainGmxPositionProvider, readGmxOpenings } from './onchainPositions.js'

export type { IGmxClaimableRow, IGmxOrderRow, IGmxPositionRow } from './rows.js'

const GMX_ORDER_EXECUTING_TYPES: ReadonlySet<number> = new Set([
  GMX_ORDER_TYPE.MarketSwap,
  GMX_ORDER_TYPE.MarketIncrease,
  GMX_ORDER_TYPE.MarketDecrease
])

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

const signedUsd = (usd: bigint): string => `${usd < 0n ? '\u2212\u2060' : usd > 0n ? '+\u2060' : ''}$${readableUsd(usd < 0n ? -usd : usd)}`

export async function gmxPositions({ chainId, account, blockNumber, blockTimestamp, nowSec, clients, getRate, freshness }: IVenueValueParams): Promise<IVenuePosition[]> {
  const publicClient = clients[chainId]
  if (publicClient === undefined) throw new Error('GMX positions need a chain client')
  const [positions, orders, claimables] = await Promise.all([
    makeOnchainGmxPositionProvider(publicClient, blockNumber)(account),
    makeOnchainGmxOrderProvider(publicClient, blockNumber)(account),
    makeOnchainGmxClaimableProvider(publicClient, blockNumber)(account)
  ])
  if (positions.length === 0 && orders.length === 0 && claimables.length === 0) return []
  const [markets, openings] = await Promise.all([
    readGmxMarkets(publicClient, [...positions.map(row => row.market), ...orders.map(o => o.market)], blockNumber),
    readGmxOpenings(publicClient, account, positions, blockNumber)
  ])
  const marketOf = (market: Address): IVenueMarket | undefined => markets.get(getAddress(market))
  const positionTokens = positions.flatMap(row => {
    const market = marketOf(row.market)
    return [row.collateralToken, ...(market === undefined ? [] : [market.indexToken, market.longToken, market.shortToken])]
  })
  const unlisted = [
    ...new Set([...positionTokens, ...orders.flatMap(o => marketOf(o.market)?.indexToken ?? [])].map(token => getAddress(token)))
  ].filter(token => !tokenMetaByChainToken.has(tokenMetaKey(chainId, token)))
  const priceByToken = new Map<ITokenMetaKey, IPriceSource>()
  const [profiles] = await Promise.all([
    readTokenProfiles(req => readContract(publicClient, req), chainId, unlisted),
    ...[
      ...new Set(
        [
          ...positionTokens,
          ...(positions.length === 0 ? [] : [GMX_WNT]),
          ...orders.flatMap(o => [...(GMX_ORDER_CUSTODY_TYPES.has(o.orderType) ? [o.collateralToken] : []), ...(o.executionFee > 0n ? [GMX_WNT] : [])]),
          ...claimables.map(c => c.token)
        ].map(token => getAddress(token))
      )
    ].map(async token => {
      const key = tokenMetaKey(chainId, token)
      const meta = tokenMetaByChainToken.get(key)
      if (!meta) return
      const rate = await getRate(meta.symbol, USD_SYMBOL, freshness)
      priceByToken.set(key, { price: usdPriceFromRate(rate, USD_DECIMALS), time: rate.time })
    })
  ])
  const marked = new Map<Address, string>()
  await Promise.all(
    unlisted
      .filter(token => positionTokens.some(held => isAddressEqual(held, token)))
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
  const priceOf = (token: Address): IPriceSource | undefined => {
    const entry = priceByToken.get(tokenMetaKey(chainId, token))
    return entry === undefined || entry.price === 0n ? undefined : entry
  }
  const symbolOfToken = (token: Address): string =>
    tokenMetaByChainToken.get(tokenMetaKey(chainId, token))?.symbol ?? profiles.get(getAddress(token))?.symbol ?? readableAddress(token)
  const decimalsOf = (token: Address): number => {
    const meta = tokenMetaByChainToken.get(tokenMetaKey(chainId, token))
    if (meta === undefined) throw new Error(`GMX token ${token} is priced but not registered`)
    return meta.decimals
  }
  const valued = positions.flatMap(row => {
    const market = marketOf(row.market)
    if (market === undefined) return []
    const [index, long, short, collateral] = [market.indexToken, market.longToken, market.shortToken, row.collateralToken].map(priceOf)
    return index === undefined || long === undefined || short === undefined || collateral === undefined ? [] : [{ row, index, long, short, collateral }]
  })
  const infos = await publicClient.multicall({
    allowFailure: false,
    blockNumber,
    contracts: valued.map(({ row, index, long, short }) => ({
      address: GMX_V2_CONTRACT_MAP.GmxReaderV2.address,
      abi: GMX_V2_CONTRACT_MAP.GmxReaderV2.abi,
      functionName: 'getPositionInfo' as const,
      args: [
        GMX_V2_CONTRACT_MAP.GmxDatastore.address,
        GMX_REFERRAL_STORAGE,
        row.positionKey,
        { indexTokenPrice: { min: index.price, max: index.price }, longTokenPrice: { min: long.price, max: long.price }, shortTokenPrice: { min: short.price, max: short.price } },
        0n,
        GMX_UI_FEE_RECEIVER,
        true
      ] as const
    }))
  })
  const rows: IVenuePosition[] = []
  for (const row of positions) {
    const market = marketOf(row.market)
    const indexName = market === undefined ? row.market : symbolOfToken(market.indexToken)
    const indexDecimals =
      market === undefined ? undefined : (tokenMetaByChainToken.get(tokenMetaKey(chainId, market.indexToken))?.decimals ?? profiles.get(getAddress(market.indexToken))?.decimals)
    const collateralName = symbolOfToken(row.collateralToken)
    const held = {
      holder: account,
      chainId: BigInt(chainId),
      contract: GMX_V2_CONTRACT_MAP.GmxDatastore.address,
      key: row.positionKey,
      kind: 'perp' as const,
      label: `${indexName}/USD ${row.isLong ? 'long' : 'short'}`,
      size: indexDecimals === undefined ? row.sizeInUsd : row.sizeInTokens,
      unit: indexDecimals === undefined ? 'USD' : indexName,
      decimals: indexDecimals === undefined ? USD_DECIMALS : indexDecimals,
      ...(indexDecimals === undefined ? {} : { long: row.isLong, entry: row.sizeInUsd, collateral: row.collateralAmount, collateralUnit: collateralName })
    }
    const at = valued.findIndex(entry => entry.row === row)
    if (market === undefined || at === -1) {
      const unpriced = market === undefined ? undefined : [market.indexToken, market.longToken, market.shortToken, row.collateralToken].find(token => priceOf(token) === undefined)
      rows.push({
        ...held,
        fieldLabelList: ['Notional', 'Priced by'],
        fieldValueList: [
          `$${readableUsd(row.sizeInUsd)}`,
          unpriced === undefined ? `unpriced: GMX holds no market ${row.market}` : `unpriced: no oracle market or Uniswap v3 pool prices ${symbolOfToken(unpriced)}`
        ],
        time: nowSec
      })
      continue
    }
    const { index, long, short, collateral } = valued[at]!
    const info = infos[at]!
    const fees = info.fees
    const claimable = fees.funding.claimableLongTokenAmount * long.price + fees.funding.claimableShortTokenAmount * short.price
    const holding = fees.borrowing.borrowingFeeAmount + fees.funding.fundingFeeAmount
    const accruedCost = holding * collateral.price - claimable
    const value = max(0n, row.collateralAmount * collateral.price + info.uncappedBasePnlUsd - accruedCost)
    const opening = openings.get(row.positionKey)!
    const wnt = priceOf(GMX_WNT)
    const openingUsd = typeof opening === 'string' || wnt === undefined ? null : opening.fee * collateral.price + opening.executionFee * wnt.price
    const cost = openingUsd === null ? undefined : row.collateralAmount * collateral.price + openingUsd
    const equity = row.collateralAmount * collateral.price + info.basePnlUsd
    const via = marked.get(getAddress(market.indexToken))
    const fields: [string, string][] = [
      ['Realized', ''],
      ...(typeof opening === 'string'
        ? ([['Opening fees', `not tracked: ${opening}`]] as [string, string][])
        : ([
            ['Opening fees', signedUsd(-opening.fee * collateral.price)],
            ['Execution fees', wnt === undefined ? 'unpriced: no oracle price for the execution fee' : signedUsd(-opening.executionFee * wnt.price)]
          ] as [string, string][])),
      [`Recurring \u00b7 past ${getDuration(blockTimestamp - Math.max(row.increasedAtTime, row.decreasedAtTime), IntervalTime.HR, '0 secs')}`, ''],
      ['Borrow fee', signedUsd(-fees.borrowing.borrowingFeeAmount * collateral.price)],
      ['Funding fee', signedUsd(claimable - fees.funding.fundingFeeAmount * collateral.price)],
      ['Notional', `$${readableUsd(row.sizeInUsd)}`],
      ['Leverage', equity > 0n ? readableLeverage(row.sizeInUsd, equity) : 'underwater'],
      ...(via === undefined ? [] : ([['Priced by', via]] as [string, string][]))
    ]
    rows.push({ ...held, cost, value, accruedCost, fieldLabelList: fields.map(([label]) => label), fieldValueList: fields.map(([, text]) => text), time: index.time })
  }
  for (const o of orders) {
    const custody = GMX_ORDER_CUSTODY_TYPES.has(o.orderType) && o.collateralDeltaAmount > 0n
    const executing = GMX_ORDER_EXECUTING_TYPES.has(o.orderType)
    if (!custody && !executing && o.executionFee === 0n) continue
    const entry = priceOf(o.collateralToken)
    if (custody && entry === undefined) throw new Error(`no oracle price for resting order collateral ${o.collateralToken}`)
    const wnt = priceOf(GMX_WNT)
    if (o.executionFee > 0n && wnt === undefined) throw new Error(`no oracle price for the execution fee GMX holds in ${GMX_WNT}`)
    const executionFeeUsd = o.executionFee === 0n ? 0n : o.executionFee * wnt!.price
    const value = (custody ? o.collateralDeltaAmount * entry!.price : 0n) + executionFeeUsd
    const indexToken = marketOf(o.market)?.indexToken
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
    const claim = priceOf(c.token)
    if (claim === undefined) throw new Error(`no oracle price for claimable funding token ${c.token}`)
    const claimUsd = c.amount * claim.price
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
      time: claim.time
    })
  }
  return rows
}
