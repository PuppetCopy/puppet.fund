import { createConnector, runOperator } from '@puppet.fund/operator'
import { acceptablePrice, dominantPosition, GMX_ORDER_TYPE, gmxOperator, gmxPrice, positionMetrics, usd } from '@puppet.fund/operator/gmx'
import { type Address, formatEther, isAddressEqual, parseEther } from 'viem'

// COPY-TRADER bot. Mirror a chosen GMX trader's position on one market — same direction and
// (capped) leverage, sized to OUR funds — with risk caps, anti-churn rebalancing, and an active
// liquidation guard. GMX charges a punitive fee at liquidation, so the guard de-risks well before
// the position can get there. A STARTING POINT, not a profit guarantee: you inherit the trader's
// edge (or lack of one) minus your own costs, plus a tick of lag.
//
// Decision tree each tick (liquidation safety FIRST, independent of the trader):
//   1. our effective leverage near the guard?  -> add collateral (or reduce size) to restore
//   2. trader flat,  we hold  -> close      3. trader holds, we flat -> open the copy
//   4. trader flipped side    -> close (re-opens opposite next tick)
//   5. same side, size drifted past the band -> increase / decrease toward target
//
// Set TRADER_ACCOUNT in .env to the GMX account to copy.

const ETH = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' as Address
const TRADER = Bun.env.TRADER_ACCOUNT as Address | undefined
if (!TRADER) throw new Error('set TRADER_ACCOUNT=0x... (the GMX account to copy) in .env')
// DRY-RUN IS THE DEFAULT (set DRY_RUN=0 in .env to trade live): the full mirror + guard
// pipeline runs and logs every order it would place, but nothing dispatches.
const DRY = Bun.env.DRY_RUN !== '0'

const RISK = {
  copyCollateralFraction: 0.2, // commit at most 20% of our free WETH as the copy's collateral
  maxLeverage: 5, // cap the trader's leverage no matter how reckless they are
  maxPositionUsd: 250,
  minPositionUsd: 25,
  rebalanceBand: 0.15, // resize only when our size drifts >15% from target (anti-churn / fee saving)
  liqGuardLeverage: 10, // restore to maxLeverage if effective leverage (incl. PnL) reaches this —
  // keep it well below the market's true liquidation leverage (~1/minCollateralFactor, often >50x).
  minActionUsd: 10,
  slippageBps: 30
}
const TICK_MS = 30_000
const COOLDOWN_MS = 60_000
// A dispatch that fails (e.g. ack timeout) can still land until its intent deadline (5min),
// and the cooldown above is shorter than that window — so any dispatch failure holds ALL
// action until the deadline has passed, otherwise a re-fire can double the position.
const INTENT_DEADLINE_MS = 5 * 60_000

if (!Bun.env.CHRONICLE_URL || !Bun.env.ARBITRUM_RPC_URL || !Bun.env.OPTIMISM_RPC_URL) {
  throw new Error('set CHRONICLE_URL, ARBITRUM_RPC_URL and OPTIMISM_RPC_URL in .env (cp .env.example .env)')
}
const connector = await createConnector({ pairUrl: Bun.env.PAIR_URL, chronicleUrl: Bun.env.CHRONICLE_URL, dryRun: DRY })
const gmx = await gmxOperator(connector, {
  rpcUrl: Bun.env.ARBITRUM_RPC_URL,
  hubRpcUrl: Bun.env.OPTIMISM_RPC_URL,
  token: ETH,
})
const market = gmx.getMarket(ETH)
const marketInfo = gmx.markets.find(m => isAddressEqual(m.marketToken as Address, market))
if (!marketInfo) throw new Error(`market ${market} not in the GMX market list`)
const longToken = marketInfo.longToken as Address // WETH on the ETH/USDC perp; the other collateral is USDC
type Position = Awaited<ReturnType<typeof gmx.getPositions>>[number]
let lastActionAt = 0
let holdUntil = 0

await runOperator(connector, async signal => {
  console.log(
    `copy-trader live on ${market} · ${DRY ? 'DRY-RUN (no dispatch; set DRY_RUN=0 to go live) · ' : ''}following ${TRADER} · ${RISK.maxLeverage}x max · Ctrl-C to stop`
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

  const price = await ethSpot()
  const markPrice = gmxPrice(price, 18)
  // Account balance = deployable network token; collateral freed by closes/reduces returns
  // to the account on its own and shows up here next tick.
  const freeWeth = Number(formatEther(await gmx.operator.readBalance(ETH)))
  const ourPos = dominantPosition(await gmx.getPositions(), market)
  const traderPos = dominantPosition(await gmx.getPositions(TRADER), market)

  const throttled = Date.now() - lastActionAt < COOLDOWN_MS || Date.now() < holdUntil

  // 1) LIQUIDATION GUARD — our position only, before anything trader-driven, and checked even
  // during cooldown/limbo. While throttled, only the collateral-add branch may fire: adding
  // collateral cannot double exposure the way a re-fired resize can, and skipping the guard
  // for the whole limbo window is how positions get liquidated.
  if (ourPos) {
    const m = metrics(ourPos, markPrice)
    if (m.marginUsd <= 0 || m.effLeverage >= RISK.liqGuardLeverage) {
      const addUsd = m.sizeUsd / RISK.maxLeverage - m.marginUsd
      if (m.marginUsd > 0 && addUsd > RISK.minActionUsd && freeWeth * price >= addUsd) {
        console.log(`LIQ-GUARD: effLev ${m.effLeverage.toFixed(1)}x, adding $${addUsd.toFixed(0)} collateral`)
        await order(m.isLong, 'increase', { collateralWeth: addUsd / price }, price)
      } else if (!throttled) {
        const reduceUsd = m.marginUsd > 0 ? m.sizeUsd - m.marginUsd * RISK.maxLeverage : m.sizeUsd
        console.log(`LIQ-GUARD: effLev ${m.effLeverage.toFixed(1)}x, reducing $${reduceUsd.toFixed(0)} size`)
        await order(m.isLong, 'decrease', { sizeUsd: Math.min(reduceUsd, m.sizeUsd) }, price)
      } else {
        console.log(`LIQ-GUARD: effLev ${m.effLeverage.toFixed(1)}x but throttled and cannot add collateral, waiting`)
      }
      return
    }
  }

  if (throttled) return

  // 2-5) MIRROR the trader.
  if (!traderPos && !ourPos) return
  if (!traderPos && ourPos) {
    console.log('trader closed: closing our copy')
    await closePosition(ourPos, price)
    return
  }
  if (traderPos && !ourPos) {
    const t = target(traderPos, freeWeth, price, markPrice)
    if (!t) return
    console.log(`OPEN ${t.isLong ? 'long' : 'short'} $${t.sizeUsd.toFixed(0)} @ ${t.collateralWeth.toFixed(5)} WETH`)
    await order(t.isLong, 'increase', { sizeUsd: t.sizeUsd, collateralWeth: t.collateralWeth }, price)
    return
  }
  if (traderPos && ourPos) {
    if (traderPos.flags.isLong !== ourPos.flags.isLong) {
      console.log('trader flipped side: closing our copy (re-opens opposite next tick)')
      await closePosition(ourPos, price)
      return
    }
    const t = target(traderPos, freeWeth, price, markPrice)
    if (!t) return
    const ourSizeUsd = Number(ourPos.numbers.sizeInUsd) / 1e30
    if (Math.abs(ourSizeUsd - t.sizeUsd) / t.sizeUsd > RISK.rebalanceBand) {
      const deltaUsd = Math.abs(t.sizeUsd - ourSizeUsd)
      if (deltaUsd < RISK.minActionUsd) return
      if (t.sizeUsd > ourSizeUsd) {
        console.log(`REBALANCE up +$${deltaUsd.toFixed(0)} (trader grew)`)
        await order(t.isLong, 'increase', { sizeUsd: deltaUsd, collateralWeth: deltaUsd / t.leverage / price }, price)
      } else {
        console.log(`REBALANCE down -$${deltaUsd.toFixed(0)} (trader shrank)`)
        await order(t.isLong, 'decrease', { sizeUsd: deltaUsd }, price)
      }
    }
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────────────────
async function ethSpot(): Promise<number> {
  const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT')
  if (!res.ok) throw new Error(`price feed ${res.status}`)
  return Number(((await res.json()) as { price: string }).price)
}

// USD figures (plain numbers) for a position at the current mark, including unrealized PnL.
// positionMetrics (kit) values collateral correctly whether the trader posted WETH or USDC —
// getting that wrong mis-reads their leverage.
function metrics(p: Position, markPrice: bigint) {
  const m = positionMetrics(p, markPrice, longToken)
  return {
    isLong: m.isLong,
    sizeUsd: Number(m.sizeUsd) / 1e30,
    marginUsd: Number(m.marginUsd) / 1e30,
    leverage: m.leverage,
    effLeverage: m.effLeverage
  }
}

// Our target copy of the trader: same direction + leverage (capped), sized to our risk budget.
function target(traderPos: Position, freeWeth: number, price: number, markPrice: bigint) {
  const lev = Math.min(Math.max(metrics(traderPos, markPrice).leverage, 1), RISK.maxLeverage)
  const collateralUsd = Math.min(RISK.copyCollateralFraction * freeWeth * price, RISK.maxPositionUsd / lev)
  const sizeUsd = Math.min(collateralUsd * lev, RISK.maxPositionUsd)
  if (sizeUsd < RISK.minPositionUsd || collateralUsd / price > freeWeth) return null
  return { isLong: traderPos.flags.isLong, sizeUsd, collateralWeth: collateralUsd / price, leverage: lev }
}

function closePosition(p: Position, price: number) {
  return dispatch({
    orderType: GMX_ORDER_TYPE.MarketDecrease,
    market,
    isLong: p.flags.isLong,
    sizeDeltaUsd: p.numbers.sizeInUsd, // whole size
    collateralDelta: 0n, // collateral returns to the account async on keeper execution
    acceptablePrice: acceptablePrice(price, p.flags.isLong, false, RISK.slippageBps)
  })
}

function order(
  isLong: boolean,
  kind: 'increase' | 'decrease',
  amounts: { sizeUsd?: number; collateralWeth?: number },
  price: number
) {
  return dispatch({
    orderType: kind === 'increase' ? GMX_ORDER_TYPE.MarketIncrease : GMX_ORDER_TYPE.MarketDecrease,
    market,
    isLong,
    sizeDeltaUsd: amounts.sizeUsd === undefined ? 0n : usd(amounts.sizeUsd.toFixed(2)),
    collateralDelta: amounts.collateralWeth === undefined ? 0n : parseEther(amounts.collateralWeth.toFixed(8)),
    acceptablePrice: acceptablePrice(price, isLong, kind === 'increase', RISK.slippageBps)
  })
}

// The cooldown is armed on ATTEMPT (before the await), and a failed dispatch holds all action
// for the full intent deadline: the intent may still land, and acting on a stale view of it
// is how positions get doubled.
async function dispatch(params: Parameters<typeof gmx.createOrder>[0]) {
  lastActionAt = Date.now()
  try {
    return await gmx.createOrder(params)
  } catch (err) {
    holdUntil = Date.now() + INTENT_DEADLINE_MS
    throw err
  }
}
