import { createOperatorCore, pairOverBrowser, runOperator } from '@puppet.fund/operator'
import {
  acceptablePrice,
  dominantPosition,
  gmxOperator,
  gmxPrice,
  positionMetrics,
  usd,
  weth
} from '@puppet.fund/operator/gmx'
import { type Address, isAddressEqual } from 'viem'

// GUARDED — the reference risk-managed operator. The guards are the product; the signal is
// a placeholder. decide() proposes, the guards dispose: every tick produces one Intent and
// each guard appends a reason, so the log explains every action AND every non-action.
//
// The honest claim of this file is structural, not financial: the default signal (weekly-SMA
// momentum) has NO demonstrated edge after costs — every round trip pays 2x GMX position fee,
// 2x price impact, a keeper executionFee and a relay fee per order, plus borrow/funding while
// held. The guards survive ANY decide() you swap in; that is the deliverable. Start tiny.
//
// Layers, mirroring the protocol's own: your guards (this file) → the matchmaker's screened
// perimeter (only GMX order calls are co-signed) → on-chain signed-balance accounting.
// Risk memory that the chain cannot reconstruct (high-water mark, halt latch, day ledger)
// persists to state.json — a kill switch that resets on restart is decorative.
//
// DRY-RUN IS THE DEFAULT: the full verify/screen pipeline runs and logs every order it
// would place, but nothing dispatches and no risk state persists. Set DRY_RUN=0 to go live.

const DRY = Bun.env.DRY_RUN !== '0'
const ETH = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' as Address
const PARAMS = {
  smaHours: 168, // weekly SMA on 1h closes — slow on purpose; frequency is the master cost variable
  hysteresisBps: 50, // enter above SMA*(1+h), exit below SMA*(1-h); the band itself is a cost control
  riskPerTradeBps: 100, // risk 1% of equity per trade — the stop and the size are one number
  stopLossPct: 4, // on-chain stop distance from entry; also converts risk into size
  leverage: 2, // target leverage plan() sizes at
  maxLeverage: 3, // hard clamp — inert for the default plan(), exists for a swapped reckless decide()
  maxPositionUsd: 250,
  minPositionUsd: 25, // dust floor — an order this small can't beat its own costs
  softDrawdownPct: 6, // vs the persisted high-water mark (WETH terms): blocks opens, closes still run
  hardDrawdownPct: 10, // force-close + halt, latched in state.json until you review and edit it
  liqGuardLeverage: 8, // effective leverage (incl. PnL) that triggers a safety close
  dailyCostBudgetBps: 30, // measured spend (fees, not collateral) per UTC day, as bps of day-start equity
  maxOrdersPerDay: 6, // signal orders
  maxOrdersPerDayHard: 12, // absolute ceiling incl. safety orders — a runaway safety loop burns fees too
  cooldownMs: 600_000,
  orderTtlMs: 300_000, // cancel a market order the keeper hasn't executed after this long
  slippageBps: 30,
  feeHeadroomWeth: 0.0005, // keeper executionFee headroom the funds veto reserves on top of collateral
  maxOrderCostWeth: 0.001, // per-order ceiling on the measured cost sample (bounds ledger poisoning by unrelated transfers)
  tickMs: 60_000
}
// A dispatch that fails after signing (e.g. relay ack timeout) is in LIMBO: the relay can
// still land it until the intent's deadline. Acting during limbo is how positions double.
const INTENT_DEADLINE_MS = 5 * 60_000

const session = await pairOverBrowser(Bun.env.PAIR_URL)
const core = await createOperatorCore(session, { rpcUrl: Bun.env.ARBITRUM_RPC_URL, dryRun: DRY })
const gmx = gmxOperator(core)
const market = gmx.getMarket(ETH)
const marketInfo = gmx.markets.find(m => isAddressEqual(m.marketToken as Address, market))
if (!marketInfo) throw new Error(`market ${market} not in the GMX market list`)
const longToken = marketInfo.longToken as Address

// ── persisted risk memory (everything else re-derives from chain every tick) ───────────────
interface IRiskState {
  hwmWeth: number
  halted: boolean
  dayKey: string
  dayStartEquityWeth: number
  dayCostWeth: number
  dayOrders: number
  daySafetyOrders: number
  lastOrderAt: number
  limboUntil: number
}
const STATE_FILE = new URL('../state.json', import.meta.url).pathname
const state: IRiskState = (await Bun.file(STATE_FILE).exists())
  ? await Bun.file(STATE_FILE).json()
  : {
      hwmWeth: 0,
      halted: false,
      dayKey: '',
      dayStartEquityWeth: 0,
      dayCostWeth: 0,
      dayOrders: 0,
      daySafetyOrders: 0,
      lastOrderAt: 0,
      limboUntil: 0
    }
const persist = async () => {
  if (!DRY) await Bun.write(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`)
}

type Order = Awaited<ReturnType<typeof gmx.getOrders>>[number]
type Stance = 'long' | 'flat'
interface ISnapshot {
  price: number
  sma: number
  freeWeth: number
  equityWeth: number
  drawdownPct: number
  raw: ReturnType<typeof dominantPosition<Awaited<ReturnType<typeof gmx.getPositions>>[number]>>
  pos: ReturnType<typeof positionMetrics> | null
  now: number
}
interface IIntent {
  kind: 'hold' | 'open' | 'close'
  isLong?: boolean
  sizeUsd?: number
  collateralWeth?: number
  reasons: string[]
}
type Guard = (intent: IIntent, snap: ISnapshot) => IIntent
const hold = (intent: IIntent, reason: string): IIntent => ({ kind: 'hold', reasons: [...intent.reasons, reason] })
const underHardCap = (): boolean => state.dayOrders + state.daySafetyOrders < PARAMS.maxOrdersPerDayHard

// ── THE SWAP POINT — replace this function and keep the rest ────────────────────────────────
function decide(snap: ISnapshot): Stance {
  const band = PARAMS.hysteresisBps / 10_000
  if (snap.price > snap.sma * (1 + band)) return 'long'
  if (snap.price < snap.sma * (1 - band)) return 'flat'
  return snap.pos ? 'long' : 'flat' // inside the band: keep the current stance (hysteresis)
}

// Stance × position → Intent. Sizing: the stop and the size are one number — risking
// riskPerTradeBps of equity against a stopLossPct stop fixes the size; leverage fixes collateral.
function plan(snap: ISnapshot, stance: Stance): IIntent {
  if (stance === 'long' && !snap.pos) {
    const equityUsd = snap.equityWeth * snap.price
    const sizeUsd = (equityUsd * (PARAMS.riskPerTradeBps / 10_000)) / (PARAMS.stopLossPct / 100)
    return {
      kind: 'open',
      isLong: true,
      sizeUsd,
      collateralWeth: sizeUsd / PARAMS.leverage / snap.price,
      reasons: ['signal']
    }
  }
  if (stance === 'flat' && snap.pos) return { kind: 'close', reasons: ['signal'] }
  return { kind: 'hold', reasons: ['no-change'] }
}

// ── guards: clamps → vetoes → escalations (a forced de-risk is never attenuated) ───────────
const clampMaxPosition: Guard = (intent, snap) => {
  if (intent.kind !== 'open' || intent.sizeUsd === undefined) return intent
  const sizeUsd = Math.min(intent.sizeUsd, PARAMS.maxPositionUsd)
  if (sizeUsd < PARAMS.minPositionUsd) return hold(intent, 'dust')
  const scale = sizeUsd / intent.sizeUsd
  return {
    ...intent,
    sizeUsd,
    collateralWeth: intent.collateralWeth! * scale,
    reasons: scale < 1 ? [...intent.reasons, 'clamped-size'] : intent.reasons
  }
}
const clampMaxLeverage: Guard = (intent, snap) => {
  if (intent.kind !== 'open' || intent.sizeUsd === undefined) return intent
  const collateralUsd = intent.collateralWeth! * snap.price
  if (intent.sizeUsd <= collateralUsd * PARAMS.maxLeverage) return intent
  return { ...intent, sizeUsd: collateralUsd * PARAMS.maxLeverage, reasons: [...intent.reasons, 'clamped-leverage'] }
}
const vetoFunds: Guard = (intent, snap) =>
  intent.kind === 'open' && intent.collateralWeth! + PARAMS.feeHeadroomWeth > snap.freeWeth
    ? hold(intent, 'insufficient-funds')
    : intent
const vetoCooldown: Guard = (intent, snap) =>
  intent.kind !== 'hold' && snap.now - state.lastOrderAt < PARAMS.cooldownMs ? hold(intent, 'cooldown') : intent
const vetoDayBudget: Guard = (intent, _snap) =>
  intent.kind === 'open' && state.dayCostWeth >= state.dayStartEquityWeth * (PARAMS.dailyCostBudgetBps / 10_000)
    ? hold(intent, 'day-cost-budget')
    : intent
const vetoOrdersPerDay: Guard = intent =>
  intent.kind === 'open' && state.dayOrders >= PARAMS.maxOrdersPerDay ? hold(intent, 'day-order-cap') : intent
const vetoSoftDrawdown: Guard = (intent, snap) =>
  intent.kind === 'open' && snap.drawdownPct >= PARAMS.softDrawdownPct ? hold(intent, 'soft-drawdown') : intent
const escalateHardDrawdown: Guard = (intent, snap) => {
  if (snap.drawdownPct < PARAMS.hardDrawdownPct) return intent
  return snap.pos
    ? { kind: 'close', reasons: [...intent.reasons, 'HARD-DRAWDOWN-HALT'] }
    : hold(intent, 'HARD-DRAWDOWN-HALT')
}
const GUARDS: Guard[] = [
  clampMaxPosition,
  clampMaxLeverage,
  vetoFunds,
  vetoCooldown,
  vetoDayBudget,
  vetoOrdersPerDay,
  vetoSoftDrawdown,
  escalateHardDrawdown
]

await runOperator(core, async signal => {
  console.log(
    `guarded live on ${market} · ${DRY ? 'DRY-RUN (no dispatch; set DRY_RUN=0 to go live) · ' : ''}risk ${PARAMS.riskPerTradeBps / 100}%/trade · stop ${PARAMS.stopLossPct}% on-chain · halt at -${PARAMS.hardDrawdownPct}% · Ctrl-C to stop`
  )
  while (!signal.aborted) {
    try {
      await tick()
    } catch (err) {
      console.error('tick error:', err instanceof Error ? err.message : err)
    }
    await Bun.sleep(PARAMS.tickMs)
  }
})

async function tick(): Promise<void> {
  if (!core.isOpen()) return
  if (Date.now() < state.limboUntil) {
    console.log('[guarded] holding: a failed dispatch may still land until its intent deadline')
    return
  }

  // At rest or do nothing: never measure equity or act while a MARKET order awaits the keeper
  // (balances and positions are distorted mid-flight). Resting stop orders are exempt — they
  // are managed by reconcile(), not paused on. Stuck orders get cancelled after orderTtlMs.
  const orders = (await gmx.getOrders()).filter(o => isAddressEqual(o.order.addresses.market, market))
  const pendingMarket = orders.filter(
    o =>
      Number(o.order.numbers.orderType) === gmx.GMX_ORDER_TYPE.MarketIncrease ||
      Number(o.order.numbers.orderType) === gmx.GMX_ORDER_TYPE.MarketDecrease
  )
  if (pendingMarket.length > 0) {
    for (const o of pendingMarket) {
      if (Date.now() / 1000 - Number(o.order.numbers.updatedAtTime) > PARAMS.orderTtlMs / 1000 && underHardCap()) {
        console.log(`[guarded] cancelling stale market order ${o.orderKey}`)
        await recordCancel(() => gmx.cancelOrder(o.orderKey))
      }
    }
    return
  }

  const snap = await perceive()
  await rollDay(snap)
  // Safety management (stop repair, orphan cleanup, liq-guard) keeps running even when
  // halted — a halt stops TRADING, never the protection of what is already open.
  if (await reconcile(snap, orders)) return
  if (state.halted) {
    console.log('[guarded] HALTED (hard drawdown) — review, then edit state.json (halted:false) to resume')
    return
  }

  const stance = decide(snap)
  const raw = plan(snap, stance)
  const final = GUARDS.reduce((intent, guard) => guard(intent, snap), raw)
  if (final.reasons.includes('HARD-DRAWDOWN-HALT')) {
    state.halted = true
    await persist()
  }
  console.log(
    `$${snap.price.toFixed(2)} sma=${snap.sma.toFixed(0)} → ${stance.toUpperCase()} | ${snap.pos ? `pos ${snap.pos.isLong ? 'long' : 'short'} $${(Number(snap.pos.sizeUsd) / 1e30).toFixed(0)}` : 'flat'} | eq ${snap.equityWeth.toFixed(5)} WETH dd ${snap.drawdownPct.toFixed(1)}% | cost ${state.dayCostWeth.toFixed(6)}/${(state.dayStartEquityWeth * (PARAMS.dailyCostBudgetBps / 10_000)).toFixed(6)} ${state.dayOrders}/${PARAMS.maxOrdersPerDay} orders | ${raw.kind} → ${final.kind} (${final.reasons.join(', ')})`
  )
  await execute(final, snap, false)
}

async function perceive(): Promise<ISnapshot> {
  const closes = (await fetchCandles('ETHUSDT', '1h', PARAMS.smaHours + 8)).map(c => c.close)
  const price = closes[closes.length - 1]
  const sma = closes.slice(-PARAMS.smaHours).reduce((a, b) => a + b, 0) / PARAMS.smaHours
  const freeWeth = Number(await core.getFundBalance()) / 1e18
  const raw = dominantPosition(await gmx.getPositions(), market)
  const pos = raw ? positionMetrics(raw, gmxPrice(price, 18), longToken) : null
  // Equity in WETH vs a persisted high-water mark: a WETH fund holding WETH is the benchmark,
  // so drawdown measures bot-attributable loss, never ETH/USD moves while flat.
  const equityWeth = freeWeth + (pos ? Number(pos.marginUsd) / 1e30 / price : 0)
  const drawdownPct = state.hwmWeth > 0 ? Math.max(0, (1 - equityWeth / state.hwmWeth) * 100) : 0
  return { price, sma, freeWeth, equityWeth, drawdownPct, raw, pos, now: Date.now() }
}

async function rollDay(snap: ISnapshot): Promise<void> {
  const dayKey = new Date().toISOString().slice(0, 10)
  if (dayKey !== state.dayKey) {
    state.dayKey = dayKey
    state.dayStartEquityWeth = snap.equityWeth
    state.dayCostWeth = 0
    state.dayOrders = 0
    state.daySafetyOrders = 0
  }
  if (snap.equityWeth > state.hwmWeth) state.hwmWeth = snap.equityWeth
  await persist()
}

// Safety reconciliation — signal-independent, at most one safety action per tick. The on-chain
// stop is the only exit that works when the matchmaker (or this process) is down: placement and
// crash-repair are the same mechanism, re-checked every tick. Software stops are fiction here.
async function reconcile(snap: ISnapshot, orders: Order[]): Promise<boolean> {
  const stops = orders.filter(o => Number(o.order.numbers.orderType) === gmx.GMX_ORDER_TYPE.StopLossDecrease)
  // A frozen stop (failed execution) is dead weight, not protection — cancel and re-place.
  const frozen = stops.filter(o => o.order.flags.isFrozen)
  if (frozen.length > 0 && underHardCap()) {
    console.log(`[guarded] cancelling frozen stop ${frozen[0].orderKey}`)
    await recordCancel(() => gmx.cancelOrder(frozen[0].orderKey))
    return !DRY
  }
  const liveStops = stops.filter(o => !o.order.flags.isFrozen)
  if (snap.raw && snap.pos && liveStops.length === 0) {
    const entry = snap.raw.numbers.sizeInUsd / snap.raw.numbers.sizeInTokens
    const stopBps = BigInt(Math.round(PARAMS.stopLossPct * 100))
    const trigger = snap.pos.isLong ? (entry * (10_000n - stopBps)) / 10_000n : (entry * (10_000n + stopBps)) / 10_000n
    const pad = BigInt(2 * PARAMS.slippageBps)
    console.log('[guarded] placing on-chain stop (full size, autoCancel)')
    await execute({ kind: 'hold', reasons: [] }, snap, true, async () =>
      gmx.createOrder({
        orderType: gmx.GMX_ORDER_TYPE.StopLossDecrease,
        market,
        isLong: snap.pos!.isLong,
        sizeDeltaUsd: snap.raw!.numbers.sizeInUsd,
        collateralDelta: 0n,
        triggerPrice: trigger,
        acceptablePrice: snap.pos!.isLong
          ? (trigger * (10_000n - pad)) / 10_000n
          : (trigger * (10_000n + pad)) / 10_000n,
        autoCancel: true
      })
    )
    return !DRY
  }
  if (!snap.pos && liveStops.length > 0) {
    for (const o of liveStops) {
      if (!underHardCap()) break
      console.log(`[guarded] cancelling orphan stop ${o.orderKey}`)
      await recordCancel(() => gmx.cancelOrder(o.orderKey))
    }
    return !DRY
  }
  if (snap.pos && snap.pos.effLeverage >= PARAMS.liqGuardLeverage) {
    console.log(`[guarded] LIQ-GUARD: effective leverage ${snap.pos.effLeverage.toFixed(1)}x — closing`)
    await execute({ kind: 'close', reasons: ['liq-guard'] }, snap, true)
    return !DRY
  }
  return false
}

async function recordCancel(cancel: () => Promise<{ actualRelayFee: bigint }>): Promise<void> {
  if (!DRY) {
    state.daySafetyOrders++
    await persist()
  }
  const result = await intoLimboOnFailure(cancel)
  if (!DRY) {
    state.dayCostWeth += Number(result.actualRelayFee) / 1e18
    await persist()
  }
}

// A failed dispatch may still land: latch limbo (persisted — a restart must not forget it)
// and book the worst-case cost now; refunds are never credited, errors lean conservative.
async function intoLimboOnFailure<T>(dispatch: () => Promise<T>): Promise<T> {
  try {
    return await dispatch()
  } catch (err) {
    if (!DRY) {
      state.limboUntil = Date.now() + INTENT_DEADLINE_MS
      state.dayCostWeth += PARAMS.maxOrderCostWeth
      await persist()
    }
    throw err
  }
}

// The one chokepoint every order passes through — no code path trades around the risk engine.
// Costs are MEASURED, not modeled: actualRelayFee from the dispatch ack plus whatever left the
// fund beyond the intended collateral (keeper executionFee), counted on attempt, refunds never
// credited — all accounting errors lean conservative.
async function execute(
  intent: IIntent,
  snap: ISnapshot,
  safety: boolean,
  place?: () => Promise<{ actualRelayFee: bigint }>
): Promise<void> {
  if (intent.kind === 'hold' && !place) return
  if (!underHardCap()) {
    console.log('[guarded] hard order ceiling reached for the day — skipping')
    return
  }
  if (!DRY) {
    if (safety) state.daySafetyOrders++
    else {
      state.dayOrders++
      state.lastOrderAt = snap.now
    }
    await persist()
  }
  const before = await core.getFundBalance()
  const intendedOutWeth = intent.kind === 'open' ? intent.collateralWeth! : 0
  const result = await intoLimboOnFailure(() =>
    place
      ? place()
      : intent.kind === 'open'
        ? gmx.createOrder({
            orderType: gmx.GMX_ORDER_TYPE.MarketIncrease,
            market,
            isLong: intent.isLong!,
            sizeDeltaUsd: usd(intent.sizeUsd!.toFixed(2)),
            collateralDelta: weth(intent.collateralWeth!.toFixed(8)),
            acceptablePrice: acceptablePrice(snap.price, intent.isLong!, true, PARAMS.slippageBps)
          })
        : gmx.createOrder({
            orderType: gmx.GMX_ORDER_TYPE.MarketDecrease,
            market,
            isLong: snap.pos!.isLong,
            sizeDeltaUsd: snap.raw!.numbers.sizeInUsd,
            collateralDelta: 0n,
            acceptablePrice: acceptablePrice(snap.price, snap.pos!.isLong, false, PARAMS.slippageBps)
          })
  )
  if (DRY) return
  const after = await core.getFundBalance()
  const spent = Number(before - after) / 1e18 - intendedOutWeth
  state.dayCostWeth += Number(result.actualRelayFee) / 1e18 + Math.min(Math.max(0, spent), PARAMS.maxOrderCostWeth)
  await persist()
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────
async function fetchCandles(symbol: string, interval: string, limit: number): Promise<{ close: number }[]> {
  const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`)
  if (!res.ok) throw new Error(`price feed ${res.status}`)
  return ((await res.json()) as (string | number)[][]).map(r => ({ close: +r[4] }))
}
