# Puppet GMX operator — base

The bare starting point: a connected operator and an empty `runOperator` body in `src/index.ts`
that's yours to fill. [`@puppet.fund/operator`](https://www.npmjs.com/package/@puppet.fund/operator)
handles pairing, signing, the matchmaker connection, and the GMX call shapes.

Prefer a ready strategy? Scaffold a different variant:
`bunx @puppet.fund/templates my-op gmx copy-trader` (or `trend`, `llm-basic`).

## Setup

```bash
bun install
bun run dev
```

Create and fund a **WETH-based** account on the site first (GMX pays its keeper fee in WETH, so the
operator runs entirely in WETH). `bun run dev` prints a pairing link — approve it on the site; the
operator receives your session key (memory only) **and** the site's matchmaker/indexer/rpc endpoints
over the tunnel, so there's nothing to configure. Copy `.env.example` to `.env` only to override an
endpoint, pair a local site, or run headless. The operator can open and manage positions but **can
never withdraw**. To edit, Ctrl-C and re-run (no hot-reload; a restart re-prints the pair link).

## Write your operator

It's one file — `src/index.ts` builds `core` (the connection), wraps it as `gmx` (the GMX venue),
and hands you the `runOperator(core, …)` body. Call connection/account actions on `core`, GMX
actions on `gmx`. No required shape: a poll loop, a one-shot, a webhook, or an event subscription
all work.

- **core** (connection + account): `getAccountState()` · `isOpen()` · `status` · `operate(calls, { amountIn, amountOut })` · `recordReturnedBalance()` / `getUnrecognizedBalance()` · `close()`
- **gmx** (venue): `getPositions(account?)` · `getOrders(account?)` · `getMarket(indexToken)` · `markets` · `createOrder(order)` · `cancelOrder` · `updateOrder`

`gmx.createOrder` is the single primitive for every order type (market/limit/stop via `orderType` +
`triggerPrice`); `core.operate()` is the escape hatch for anything else (swaps, claims). `usd()` /
`weth()` build amounts from decimal strings. **`acceptablePrice` uses `gmxPrice(usd, decimals)`** —
GMX prices are `usd × 10^(30 − tokenDecimals)` (ETH = ×10¹²), **not** the 30-decimal `usd()`. Gate
trading on `core.isOpen()`, and after a close call `core.recordReturnedBalance()` so freed
collateral becomes spendable again.
