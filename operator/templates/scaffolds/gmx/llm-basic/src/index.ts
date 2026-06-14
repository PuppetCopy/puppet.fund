import Anthropic from '@anthropic-ai/sdk'
import { createOperatorCore, pairOverBrowser, runOperator } from '@puppet.fund/operator'
import { acceptablePrice, formatWeth, gmxOperator, usd, weth } from '@puppet.fund/operator/gmx'
import { type Address, isAddressEqual } from 'viem'

// A basic LLM (Claude) agent: same perceive / size / execute as a deterministic bot, but the
// DECISION (long / flat) is delegated to a model via structured tool use. This is the "agentic"
// pattern — the model proposes, your code enforces the risk caps, and the protocol's signed rules
// are the final backstop. An LLM decision is non-deterministic and not financial advice; keep the
// hard caps around it. Requires ANTHROPIC_API_KEY in .env.

const ETH = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' as Address
const PARAMS = { riskPerTradeBps: 100, stopLossPct: 3, leverage: 2, maxPositionUsd: 250, minPositionUsd: 25 }
const SLIPPAGE_BPS = 30
const TICK_MS = 5 * 60_000
// Keep >= the intent deadline (5min) and arm it on ATTEMPT: a dispatch that times out can
// still land until its deadline, so a re-fire inside that window risks a doubled position.
const COOLDOWN_MS = 10 * 60_000

// Fail fast and clearly, before pairing: the SDK reads the key lazily and would otherwise
// crash mid-run with a raw credentials error (or silently pick up an ambient dev key).
if (!Bun.env.ANTHROPIC_API_KEY) {
  throw new Error('set ANTHROPIC_API_KEY in .env (cp .env.example .env) — get a key at https://console.anthropic.com')
}
const anthropic = new Anthropic() // reads ANTHROPIC_API_KEY
const session = await pairOverBrowser(Bun.env.PAIR_URL)
const core = await createOperatorCore(session, { rpcUrl: Bun.env.ARBITRUM_RPC_URL })
const gmx = gmxOperator(core)
const market = gmx.getMarket(ETH)
let lastTradeAt = 0

const SYSTEM = `You are a disciplined crypto trading agent managing ONE ETH perpetual position on GMX.
You may only go long or be flat — no shorts. Bias toward capital preservation: when trend and
momentum do not clearly agree, choose "hold". You do not size positions (the host enforces risk
limits); you only choose the action and explain it in one sentence.`

type IAction = 'open_long' | 'close' | 'hold'

async function decide(ctx: {
  price: number
  ema12: number
  ema26: number
  rsi: number
  inLong: boolean
}): Promise<{ action: IAction; reason: string }> {
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }], // cache the static prompt
    tools: [
      {
        name: 'decide',
        description: 'Choose the next action for the ETH position.',
        input_schema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['open_long', 'close', 'hold'] },
            reason: { type: 'string', description: 'one short sentence' }
          },
          required: ['action', 'reason']
        }
      }
    ],
    tool_choice: { type: 'tool', name: 'decide' },
    messages: [
      {
        role: 'user',
        content: `ETH $${ctx.price.toFixed(2)} · EMA12 ${ctx.ema12.toFixed(0)} · EMA26 ${ctx.ema26.toFixed(0)} · RSI ${ctx.rsi.toFixed(0)}. Position: ${ctx.inLong ? 'LONG open' : 'flat'}. Choose open_long, close, or hold.`
      }
    ]
  })
  const block = res.content.find(b => b.type === 'tool_use')
  if (block?.type !== 'tool_use') return { action: 'hold', reason: 'no decision returned' }
  return block.input as { action: IAction; reason: string }
}

await runOperator(core, async signal => {
  console.log(`LLM agent live on ${market} (claude-sonnet-4-6) · Ctrl-C to stop`)
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

  const closes = (await fetchCandles('ETHUSDT', '5m', 200)).map(c => c.close)
  const price = closes[closes.length - 1]
  const freeWeth = Number(formatWeth(await core.getFundBalance()))
  const longPos = (await gmx.getPositions()).find(p => isAddressEqual(p.addresses.market, market) && p.flags.isLong)
  const inLong = !!longPos && longPos.numbers.sizeInUsd > 0n

  const { action, reason } = await decide({
    price,
    ema12: ema(closes, 12),
    ema26: ema(closes, 26),
    rsi: rsi(closes, 14),
    inLong
  })
  console.log(`$${price.toFixed(2)} inLong=${inLong} -> ${action}: ${reason}`)

  if (Date.now() - lastTradeAt < COOLDOWN_MS) return
  if (action === 'open_long' && !inLong) {
    const s = sizePosition(freeWeth, price)
    if (!s) {
      console.log('skip open: free balance below the minimum position size')
      return
    }
    lastTradeAt = Date.now()
    await gmx.createOrder({
      orderType: gmx.GMX_ORDER_TYPE.MarketIncrease,
      market,
      isLong: true,
      sizeDeltaUsd: usd(s.sizeUsd.toFixed(2)),
      collateralDelta: weth(s.collateralWeth.toFixed(8)),
      acceptablePrice: acceptablePrice(price, true, true, SLIPPAGE_BPS)
    })
  } else if (action === 'close' && inLong && longPos) {
    lastTradeAt = Date.now()
    await gmx.createOrder({
      orderType: gmx.GMX_ORDER_TYPE.MarketDecrease,
      market,
      isLong: true,
      sizeDeltaUsd: longPos.numbers.sizeInUsd,
      collateralDelta: 0n,
      acceptablePrice: acceptablePrice(price, true, false, SLIPPAGE_BPS)
    })
  }
}

// ── helpers (price feed, indicators, sizing — all inline) ───────────────────────────────────
async function fetchCandles(symbol = 'ETHUSDT', interval = '5m', limit = 200): Promise<{ close: number }[]> {
  const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`)
  if (!res.ok) throw new Error(`price feed ${res.status}`)
  return ((await res.json()) as (string | number)[][]).map(r => ({ close: +r[4] }))
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
function sizePosition(freeWeth: number, price: number): { sizeUsd: number; collateralWeth: number } | null {
  const equityUsd = freeWeth * price
  if (equityUsd <= 0) return null
  const sizeUsd = Math.min(
    (equityUsd * (PARAMS.riskPerTradeBps / 10_000)) / (PARAMS.stopLossPct / 100),
    PARAMS.maxPositionUsd
  )
  if (sizeUsd < PARAMS.minPositionUsd) return null
  const collateralWeth = sizeUsd / PARAMS.leverage / price
  return collateralWeth > freeWeth ? null : { sizeUsd, collateralWeth }
}
