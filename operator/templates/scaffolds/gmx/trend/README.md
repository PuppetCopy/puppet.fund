# Puppet GMX operator: trend

A deterministic long/flat trend-following agent on ETH (no LLM): EMA(12/26) trend + an RSI filter →
fixed-fractional sizing → market orders, one position at a time with a cooldown. Everything is one
file: `src/index.ts` (price feed, indicators, sizing, and the strategy all inline).

## Setup

```bash
bun install
bun run dev   # pair on the site (create your account + allocate a WETH fund first)
```

**Dry-run is the default** (`DRY_RUN=1` in `.env.example`): the full signal + sizing + order
pipeline runs and logs, but nothing dispatches. Set `DRY_RUN=0` to trade live.

Edit the `wantLong` rule (the signal) and `PARAMS` (risk %/trade, leverage, position caps). Each
tick it reads price + fund balance + position, decides, and opens/closes within the caps. Note
that `stopLossPct` only converts risk into a position size: no stop order is placed on-chain and
there is no liquidation guard here (the `guarded` variant is the one with real stops).

**Not a profit guarantee.** Slow trend strategies lose in chop; the value here is the structure +
risk discipline, not the signal. Start tiny.
