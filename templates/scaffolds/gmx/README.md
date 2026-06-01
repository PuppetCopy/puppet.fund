# Puppet trading operator (GMX)

An autonomous operator that trades a Puppet master account on GMX V2. You write the
strategy in `src/index.ts`; [`@puppet.fund/operator`](https://www.npmjs.com/package/@puppet.fund/operator)
handles signing, fee quoting, the matchmaker connection, and the GMX call shapes.

## Setup

```bash
bun install
bun run dev
```

Create and fund a **WETH-based** account on the site first. GMX pays its keeper
fee in WETH, so this operator runs entirely in WETH — collateral and fees are the
same token, nothing else to fund.

`bun run dev` prints a pairing link. Open it on the site and approve — the operator
receives your session key **and the site's matchmaker/indexer/rpc endpoints** over
the tunnel, so there's nothing to configure. The session key reaches the operator
in memory only (never written to disk). Copy `.env.example` to `.env` only to
override an endpoint or run headless. The operator
signs as your delegated session signer; it can open and manage positions but
cannot withdraw. You create, fund, and redeem the master on the site yourself.

## Strategy

Edit the loop in `src/index.ts`. Each tick you read `gmx.getAccountState()` and
`gmx.getPositions()`; act with:

- `gmx.createOrder({ orderType, market, isLong, collateralDelta, sizeDeltaUsd, executionFee, triggerPrice?, acceptablePrice? })`
  — one primitive for every order type (market/limit/stop/take-profit). Opening is an increase from zero; a full close is a decrease by the position's whole size.
- `gmx.cancelOrder(key)`, `gmx.updateOrder({ key, sizeDeltaUsd, ... })`, `gmx.getPositions()`, `gmx.getOrders()`

`collateral` and `executionFee` are both WETH (18 dp), drawn from the account's
WETH balance.
