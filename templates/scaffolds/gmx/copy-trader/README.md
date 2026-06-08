# Puppet GMX operator — copy-trader

A deterministic COPY-TRADER (no LLM). Mirrors a chosen GMX **trader's** position on ETH — same
direction and capped leverage, sized to YOUR funds — with risk caps, anti-churn rebalancing, and an
active **liquidation guard** (GMX's liquidation fee is punitive, so it de-risks well before the
position can get there). Everything is one file: `src/index.ts`.

## Setup

1. `bun install`
2. Set `TRADER_ACCOUNT=0x...` in `.env` — the GMX account to copy.
3. Create + fund a **WETH** account on the site, then `bun run dev` to pair.

## How it works — each tick

1. **Liquidation guard first:** if our effective leverage (incl. unrealized PnL) reaches
   `liqGuardLeverage`, add collateral to restore `maxLeverage` (or reduce size if we can't fund it).
2. trader flat → close · trader holds → open the copy · trader flipped side → close (re-opens
   opposite next tick) · same side, size drifted past `rebalanceBand` → resize toward target.

Tune the `RISK` block: `copyCollateralFraction` (share of equity committed), `maxLeverage`,
`maxPositionUsd` / `minPositionUsd`, `rebalanceBand`, `liqGuardLeverage`, `slippageBps`.

**Not a profit guarantee** — you inherit the trader's edge (or lack of one) minus your own costs
(keeper + relay + impact + funding per round trip), plus a tick of lag. The guard and caps keep it
*survivable*, not profitable.
