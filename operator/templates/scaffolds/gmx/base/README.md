# Puppet GMX operator: base

The bare starting point: a connected operator and an empty `runOperator` body in `src/index.ts`
that's yours to fill. [`@puppet.fund/operator`](https://www.npmjs.com/package/@puppet.fund/operator)
handles pairing, signing, the matchmaker relay, and the GMX call shapes.

Prefer a ready strategy? Scaffold a different variant:
`bunx @puppet.fund/templates my-op gmx copy-trader` (or `trend`, `llm-basic`).

## Setup

```bash
bun install
bun run dev
```

Create a trading account on the site first and deposit the WETH it trades with into it on
Arbitrum. **WETH** collateral is simplest (GMX's keeper fee and the collateral are one token); any
other registered token works too, it just needs a little native ETH in the account for keeper fees. Order relay fees are paid in USDC by
the trading body (each order's fee also prepays its distribution on the hub), so keep a little USDC in it.
`bun run dev` prints a pairing link: approve it
on the site; the operator receives your session key (memory only) **and** the site's
matchmaker endpoint over the tunnel. `cp .env.example .env` first: it names the chronicle
(`CHRONICLE_URL`, where backing rows are composed from) and the Arbitrum and Optimism (hub) RPC
endpoints (`ARBITRUM_RPC_URL`, `OPTIMISM_RPC_URL`; set your own for anything beyond a first run).
Edit it to override an endpoint, pair a local site, or run headless. The operator can open and manage positions but **can never withdraw**. To edit, Ctrl-C
and re-run (no hot-reload; a restart re-prints the pair link).

## Write your operator

It's one file: `src/index.ts` establishes `connector` (the connection + identity), wraps it as
`gmx` (the GMX venue, which binds Arbitrum internally and exposes the chain-bound RPC + dispatch
as `gmx.operator`), and hands you the `runOperator(connector, …)` body. Call identity/lifecycle
actions on `connector`, chain actions on `gmx.operator`, GMX actions on `gmx`. No required shape: a poll loop, a one-shot, a
webhook, or an event subscription all work.

- **connector** (connection + identity): `account` (your trading account: it signs, holds what you deposit, and trades) · `close()` (runOperator handles it)
- **gmx.operator** (chain-bound): `account` · `readBalance(token)` · `credit(token)` (sweep a bridged arrival in from the deposit route) · `convert(inputToken, outputToken, inputAmount)` · `operate(callList)` · `poolSwap(inputToken, outputToken, inputAmount, destinationChainId)` (swap or bridge fund balances to any supported chain, landing on your own account) · `redeem(retire, drain)` (on the hub: drain the sell queue and pay puppets who sold)
- **gmx** (venue): `getPositions(account?)` · `getOrders(account?)` · `getMarket(indexToken)` · `markets` · `createOrder(order)` · `cancelOrder` · `updateOrder`

`gmx.createOrder` is the single primitive for every order type (market/limit/stop via `orderType` +
`triggerPrice`); `gmx.operator.operate()` is the raw dispatch underneath it (the attestor co-signs only
GMX-perimeter calls today, so swaps/claims/foreign targets are rejected). Both return
`IDispatchedFrame | null` (`null` = dry-run; a real dispatch settles on-chain before resolving).
`usd()` builds 30dp amounts from decimal strings; 18dp WETH amounts are viem's `parseEther()`. **`acceptablePrice` uses
`gmxPrice(usd, decimals)`**: GMX prices are `usd × 10^(30 − tokenDecimals)` (ETH = ×10¹²),
**not** the 30-decimal `usd()`. The relay is stateless HTTP, fire-and-ACK (no connection state):
attempt the operate and handle a thrown `DISPATCH_TIMEOUT`.
Collateral GMX frees on a close returns to the trading body on its own, shows
up in `readBalance(WETH)`, and your next `createOrder` re-signs it automatically, no extra step.
