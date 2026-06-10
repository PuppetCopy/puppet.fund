import { createOperatorCore, runOperator } from '@puppet.fund/operator'
import { formatUsd, formatWeth, GMX_BASE_TOKEN_ID, gmxOperator, gmxPrice, usd, weth } from '@puppet.fund/operator/gmx'
import { type Address, type Hex, isAddressEqual } from 'viem'

// A complete autonomous, long/flat trend-following agent on ETH (no LLM). Perceive (price +
// indicators + account + positions) → decide (EMA trend, RSI filter) → size (risk budget) →
// execute. One position at a time, with a cooldown. A STARTING POINT with real risk controls —
// NOT a profit guarantee; no signal is. Edit PARAMS and the `wantLong` rule freely. Long/flat
// only for clarity (shorts are possible but add collateral nuance).

const ETH = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' as Address
const PARAMS = {
  riskPerTradeBps: 100, // risk 1% of equity per trade
  stopLossPct: 3, // assumed stop distance, used only to turn risk into a size
  leverage: 2,
  maxPositionUsd: 250,
  minPositionUsd: 25
}
const SLIPPAGE_BPS = 30
const TICK_MS = 60_000
const COOLDOWN_MS = 5 * 60_000

const core = await createOperatorCore({
  baseTokenId: GMX_BASE_TOKEN_ID,
  siteUrl: Bun.env.SITE_URL,
  matchmakerUrl: Bun.env.MATCHMAKER_WS_URL,
  indexerUrl: Bun.env.INDEXER_ENDPOINT,
  rpcUrl: Bun.env.ARBITRUM_RPC_URL,
  signerKey: Bun.env.OPERATOR_SIGNER_KEY as Hex | undefined,
  user: Bun.env.OPERATOR_USER as Address | undefined,
  pairPort: Bun.env.PAIR_PORT ? Number(Bun.env.PAIR_PORT) : undefined
})
const gmx = gmxOperator(core)
const market = gmx.getMarket(ETH)
let lastTradeAt = 0

await runOperator(core, async signal => {
  console.log(
    `trend agent live on ${market} · risk ${PARAMS.riskPerTradeBps / 100}%/trade · ${PARAMS.leverage}x · Ctrl-C to stop`
  )
  while (!signal.aborted) {
    try {
      await tick()
    } catch (err) {
      console.error('tick error:', err instanceof Error ? err.message : err)
    }
    await Bun.sleep(TICK_MS)
  }
})

async function tick(): Promise<void> {
  if (!core.isOpen()) return

  // perceive (fund balance = deployable base; collateral GMX frees on a close returns
  // to the fund on its own and shows up here next tick)
  const closes = (await fetchCandles('ETHUSDT', '5m', 200)).map(c => c.close)
  const price = closes[closes.length - 1]
  const freeWeth = Number(formatWeth(await core.getFundBalance()))
  const longPos = (await gmx.getPositions()).find(p => isAddressEqual(p.addresses.market, market) && p.flags.isLong)
  const inLong = !!longPos && longPos.numbers.sizeInUsd > 0n

  // decide (swap this rule for your own signal)
  const fast = ema(closes, 12)
  const slow = ema(closes, 26)
  const momentum = rsi(closes, 14)
  const wantLong = fast > slow && momentum < 72 // ride the uptrend unless overbought
  console.log(
    `$${price.toFixed(2)} ema12=${fast.toFixed(0)} ema26=${slow.toFixed(0)} rsi=${momentum.toFixed(0)} inLong=${inLong} -> ${wantLong ? 'LONG' : 'FLAT'}`
  )

  // act (one position at a time, throttled by a cooldown)
  if (Date.now() - lastTradeAt < COOLDOWN_MS) return
  if (wantLong && !inLong) {
    const s = sizePosition(freeWeth, price)
    if (!s) {
      console.log('skip open: free balance below the minimum position size')
      return
    }
    console.log(`OPEN long $${s.sizeUsd.toFixed(0)} (collateral ${s.collateralWeth.toFixed(5)} WETH)`)
    await gmx.createOrder({
      orderType: gmx.GMX_ORDER_TYPE.MarketIncrease,
      market,
      isLong: true,
      sizeDeltaUsd: usd(s.sizeUsd.toFixed(2)),
      collateralDelta: weth(s.collateralWeth.toFixed(8)),
      acceptablePrice: gmxPrice(price * (1 + SLIPPAGE_BPS / 10_000), 18)
    })
    lastTradeAt = Date.now()
  } else if (!wantLong && inLong && longPos) {
    console.log(`CLOSE long $${formatUsd(longPos.numbers.sizeInUsd)}`)
    await gmx.createOrder({
      orderType: gmx.GMX_ORDER_TYPE.MarketDecrease,
      market,
      isLong: true,
      sizeDeltaUsd: longPos.numbers.sizeInUsd, // whole size = full close
      collateralDelta: 0n, // GMX returns the position's collateral to the fund on a full close
      acceptablePrice: gmxPrice(price * (1 - SLIPPAGE_BPS / 10_000), 18)
    })
    lastTradeAt = Date.now()
  }
}

// ── helpers (price feed, indicators, sizing — all inline) ───────────────────────────────────
interface ICandle {
  high: number
  low: number
  close: number
}
async function fetchCandles(symbol = 'ETHUSDT', interval = '5m', limit = 200): Promise<ICandle[]> {
  const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`)
  if (!res.ok) throw new Error(`price feed ${res.status}`)
  const rows = (await res.json()) as (string | number)[][]
  return rows.map(r => ({ high: +r[2], low: +r[3], close: +r[4] }))
}
function ema(values: number[], period: number): number {
  const k = 2 / (period + 1)
  let e = values[0]
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k)
  return e
}
function rsi(closes: number[], period = 14): number {
  let gain = 0
  let loss = 0
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    if (d >= 0) gain += d
    else loss -= d
  }
  return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)
}
// Fixed-fractional sizing: risk riskPerTradeBps of equity; with a stopLossPct stop the size that
// loses ~that much is riskUsd / stopLossPct. Collateral targets `leverage`, bounded by free funds.
function sizePosition(freeWeth: number, price: number): { sizeUsd: number; collateralWeth: number } | null {
  const equityUsd = freeWeth * price
  if (equityUsd <= 0) return null
  const riskUsd = equityUsd * (PARAMS.riskPerTradeBps / 10_000)
  const sizeUsd = Math.min(riskUsd / (PARAMS.stopLossPct / 100), PARAMS.maxPositionUsd)
  if (sizeUsd < PARAMS.minPositionUsd) return null
  const collateralWeth = sizeUsd / PARAMS.leverage / price
  return collateralWeth > freeWeth ? null : { sizeUsd, collateralWeth }
}
