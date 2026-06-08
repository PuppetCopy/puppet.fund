# Puppet GMX operator — trend

A deterministic long/flat trend-following agent on ETH (no LLM): EMA(12/26) trend + an RSI filter →
fixed-fractional sizing → market orders, one position at a time with a cooldown. Everything is one
file: `src/index.ts` (price feed, indicators, sizing, and the strategy all inline).

## Setup

```bash
bun install
bun run dev   # pair on the site — create + fund a WETH account first
```

Edit the `wantLong` rule (the signal) and `PARAMS` (risk %/trade, leverage, position caps). Each
tick it reconciles returned base, reads price + position, decides, and opens/closes within the caps.

**Not a profit guarantee.** Slow trend strategies lose in chop; the value here is the structure +
risk discipline, not the signal. Start tiny.
