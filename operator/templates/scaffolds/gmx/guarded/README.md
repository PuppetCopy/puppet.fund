# Puppet GMX operator — guarded

The reference risk-managed operator. **The guards are the product; the signal is a placeholder.**
A pure `decide()` proposes, a pipeline of pure guards disposes, and one `execute()` chokepoint is
the only path to an order. Swap `decide()` for your own signal and every cap, stop, and ledger
keeps holding — they are written assuming your strategy is reckless.

One file: `src/index.ts` (~250 lines). Risk memory the chain can't reconstruct (high-water mark,
halt latch, day ledger) persists to `state.json`; everything else re-derives from chain each tick.

## Setup

1. `bun install`
2. Create your account + allocate a **WETH** fund on the site, then `bun run dev` to pair.
3. **Dry-run is the default** (with or without a `.env`): the bot runs the full verify/screen
   pipeline and logs every order it would place, dispatching nothing and persisting no risk
   state. When you're ready: `cp .env.example .env` and set `DRY_RUN=0` to trade live.

## What the guards do — each tick

1. **At rest or do nothing**: while one of our market orders awaits the GMX keeper, never measure
   equity or act (mid-flight reads are distorted); stuck orders cancel after `orderTtlMs`. A
   dispatch that fails after signing enters **limbo** (the relay acks or stays silent, and a
   silent intent can still land until its deadline): all action holds until that window passes,
   with the worst-case cost booked to the day ledger up front.
2. **Safety reconciliation** (signal-independent): a position without a resting on-chain
   **StopLossDecrease** gets one placed (placement and crash-repair are the same mechanism — the
   on-chain stop is the only exit that works if the matchmaker or this process is down); orphan
   stops get cancelled; effective leverage ≥ `liqGuardLeverage` force-closes.
3. `decide()` → `plan()` → **guards**, in a fixed order — clamps (`maxPositionUsd`,
   `maxLeverage`), then vetoes (`funds`, `cooldown`, `day cost budget`, `orders/day`,
   `soft drawdown`), then escalations (`hard drawdown` → force-close + **halt**, latched in
   `state.json` until you review and edit it). Escalations run last so a forced de-risk is never
   attenuated by an earlier veto.
4. One log line explains the action **and every non-action**: price, stance, position, WETH
   equity + drawdown vs the high-water mark, measured day cost vs budget, and the
   `raw → final (reasons)` chain. This is how you debug a bot that "does nothing".

Drawdown is **WETH-denominated**: a WETH fund holding WETH is the benchmark, so it measures
bot-attributable loss, never ETH/USD moves while flat. Costs are **measured, not modeled**: each
order records the relay fee from the dispatch ack plus whatever left the fund beyond intended
collateral (the keeper execution fee), and opens stop when the day's spend hits
`dailyCostBudgetBps` of day-start equity.

## The honest part

The default signal (price vs weekly SMA with a hysteresis band, long/flat) has **no demonstrated
edge after costs**. Every round trip pays: 2× GMX position fee, 2× price impact, a keeper
execution fee and a relay fee per order, plus borrow/funding while held. Slow frequency and the
hysteresis band exist to keep those costs survivable, not to make money. Start tiny.

## Hardening exercises (in rough order of value)

- Persist nothing you can re-derive; persist everything you can't — `state.json` already does
  this, read it after a few days and check the cost ledger against your expectations.
- Reconcile estimated vs realized cost per round trip (two `getFundBalance()` reads +
  `getPositionPnlUsd`) and alarm when realized exceeds estimate by 1.5×.
- Replace the fixed `stopLossPct` with a volatility-scaled stop (ATR) so size adapts to regime.
- A time stop: close any position older than N hours (read `increasedAtTime` on the position).
