import { PROTOCOL } from '@puppet/contracts/const'
import { type Address, erc20Abi, isAddressEqual, keccak256, type PublicClient, toHex } from 'viem'
import { USD_SYMBOL } from '../const/common.js'
import { type ChainId, TOKEN_META } from '../const/index.js'
import { symbolOf } from '../state/tokenRegistry.js'
import { VENUES } from '../venue/venues.js'
import { DEFAULT_EVALUATION_CONFIG, type IGetRate, type INavGateReason, type INavHolding, type INavPosition, type INavResult } from './types.js'
import { valueUnlisted } from './unlisted.js'

interface IFundValuationParams {
  clients: Readonly<Record<number, PublicClient>>
  chainId: ChainId
  account: Address
  listedTokenList: readonly Address[]
  unlistedTokenList: readonly Address[]
  blockNumber: bigint
  blockTimestamp: number
  venueIdList: readonly string[]
  getRate: IGetRate
  freshness: number
}

export async function evaluateFundAt(p: IFundValuationParams): Promise<INavResult> {
  const client = p.clients[p.chainId]
  if (client === undefined) throw new Error(`no client for chain ${p.chainId} to value the fund of ${p.account}`)
  const { maxPriceAgeSec } = DEFAULT_EVALUATION_CONFIG
  const nowSec = Math.floor(Date.now() / 1000)
  const native = p.listedTokenList.some(t => isAddressEqual(t, PROTOCOL.nativeToken))
  const erc20 = [...p.listedTokenList.filter(t => !isAddressEqual(t, PROTOCOL.nativeToken)), ...p.unlistedTokenList]
  const [{ holdings, unpriced }, venueList] = await Promise.all([
    Promise.all([
      erc20.length === 0
        ? Promise.resolve([] as bigint[])
        : client.multicall({
            contracts: erc20.map(token => ({ address: token, abi: erc20Abi, functionName: 'balanceOf' as const, args: [p.account] as const })),
            allowFailure: false,
            blockNumber: p.blockNumber
          }),
      native ? client.getBalance({ address: p.account, blockNumber: p.blockNumber }) : Promise.resolve(0n)
    ]).then(async ([balances, nativeBalance]) => {
      const held = [...erc20.map((token, i) => ({ token, balance: balances[i]! })), ...(native ? [{ token: PROTOCOL.nativeToken, balance: nativeBalance }] : [])].filter(
        h => h.balance !== 0n
      )
      const valued = await Promise.all(
        held.map(async (h): Promise<{ token: Address; holding: INavHolding | null }> => {
          if (p.unlistedTokenList.some(t => isAddressEqual(t, h.token))) {
            const exit = await valueUnlisted(client, p.chainId, h.token, h.balance, p.blockNumber, p.getRate, TOKEN_META.WETH.symbol, p.freshness)
            return {
              token: h.token,
              holding:
                exit === null
                  ? null
                  : { chainId: p.chainId, token: h.token, label: h.token, balance: h.balance, mark: { value: exit.value, priceAgeSec: Math.max(0, nowSec - exit.time) } }
            }
          }
          const symbol = symbolOf(p.chainId, h.token)
          const rate = await p.getRate(symbol, TOKEN_META.WETH.symbol, p.freshness)
          if (rate.token1 === 0n) throw new Error(`rate ${symbol}/${TOKEN_META.WETH.symbol} has a zero denominator`)
          return {
            token: h.token,
            holding: {
              chainId: p.chainId,
              token: h.token,
              label: symbol,
              balance: h.balance,
              mark: { value: (h.balance * rate.token0) / rate.token1, priceAgeSec: Math.max(0, nowSec - rate.time) }
            }
          }
        })
      )
      return {
        holdings: valued.flatMap(v => (v.holding === null ? [] : [v.holding])),
        unpriced: valued.flatMap(v => (v.holding === null ? [v.token] : []))
      }
    }),
    Promise.all(
      VENUES.filter(venue => venue.positions !== undefined && venue.chains.includes(p.chainId) && p.venueIdList.includes(venue.venueId)).map(venue =>
        venue.positions!({
          chainId: p.chainId,
          account: p.account,
          blockNumber: p.blockNumber,
          blockTimestamp: p.blockTimestamp,
          nowSec,
          clients: p.clients,
          getRate: p.getRate,
          freshness: p.freshness,
          sharedReads: false
        }).then(
          rows => ({ venue: venue.venueId, rows, refusal: null }),
          (err: unknown) => ({ venue: venue.venueId, rows: [], refusal: err instanceof Error ? err.message : String(err) })
        )
      )
    )
  ])

  const reasons: INavGateReason[] = unpriced.map(token => ({
    code: 'ASSET_UNPRICED',
    detail: `${token} on chain ${p.chainId} is not registered and no Uniswap v3 pool against a registered token gives it both a full-size exit and a price history over the last 30 minutes`
  }))
  const positions: INavPosition[] = []
  const usd = venueList.some(venue => venue.rows.length > 0) ? await p.getRate(USD_SYMBOL, TOKEN_META.WETH.symbol, p.freshness) : null
  if (usd !== null && Math.max(0, nowSec - usd.time) > maxPriceAgeSec) {
    reasons.push({ code: 'STALE_ORACLE', detail: `${USD_SYMBOL}/${TOKEN_META.WETH.symbol} priced ${nowSec - usd.time}s old (max ${maxPriceAgeSec}s)` })
  }
  let navMark = 0n
  for (const h of holdings) {
    navMark += h.mark.value
    if (h.mark.priceAgeSec > maxPriceAgeSec) {
      reasons.push({ code: 'STALE_ORACLE', detail: `holding ${h.label} on chain ${h.chainId} priced ${h.mark.priceAgeSec}s old (max ${maxPriceAgeSec}s)` })
    }
  }
  for (const { venue, rows, refusal } of venueList) {
    const missing = rows.find(row => row.value === undefined)
    const unavailable = refusal ?? (missing === undefined ? null : `${missing.label} (${missing.key}) has no exit price`)
    if (unavailable !== null) {
      reasons.push({ code: 'PLATFORM_UNAVAILABLE', detail: `platform ${venue} cannot value its positions: ${unavailable}` })
      continue
    }
    const accounts = new Map<string, bigint>()
    for (const row of rows) {
      const value = (row.value! * usd!.token0) / usd!.token1
      const priceAgeSec = Math.max(0, nowSec - row.time)
      if (priceAgeSec > maxPriceAgeSec) {
        reasons.push({ code: 'STALE_ORACLE', detail: `${venue} position ${row.key} priced ${priceAgeSec}s old (max ${maxPriceAgeSec}s)` })
      }
      if (row.kind === 'pending') reasons.push({ code: 'PENDING_ORDER', detail: `${venue} in-flight (${row.key}): ${row.label}` })
      const account = `${venue}:${row.holder}`
      accounts.set(account, (accounts.get(account) ?? 0n) + value)
    }
    for (const [account, value] of accounts) {
      navMark += value
      if (value !== 0n) positions.push({ venue, id: keccak256(toHex(account)), value })
    }
  }
  return reasons.length === 0 ? { ok: true, navMark, holdings, positions } : { ok: false, reasons }
}
