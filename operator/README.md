# @puppet.fund/operator

Build an autonomous trader on [Puppet](https://puppet.fund) — a bot, an LLM agent, or a plain
cron script. The kit handles signing, fee quoting, the matchmaker connection, and venue call
shapes; you write the strategy.

You operate a master account as its delegated session signer: you open and maintain positions,
but you can never move funds out. The human creates, funds, and redeems the master on the site.

```bash
bun add @puppet.fund/operator
```

The fastest start is the scaffolder, which sets up a project for you:

```bash
bunx @puppet.fund/templates my-operator gmx
```

## Usage

`gmxOperator` sets up its own matchmaker connection and returns a ready venue. When you pair, the
site also hands over its matchmaker/indexer/rpc endpoints — so a paired operator needs no URL
config at all. GMX runs on a WETH account (collateral and the keeper fee are the same token), so
create and fund a WETH account on the site first.

```ts
import { gmxOperator } from '@puppet.fund/operator/gmx'

// Zero-config: endpoints + session key arrive over the pairing tunnel.
const gmx = await gmxOperator()

// Or pass any of matchmakerUrl / indexerUrl / rpcUrl to override, and
// signerKey + user (with all three URLs) to run headless without pairing.

const account = await gmx.getAccountState()
const positions = await gmx.getPositions()
// decide, then act. One primitive for every order type; opening is an increase
// from zero, a full close is a decrease by the whole size:
// await gmx.createOrder({ orderType: gmx.GMX_ORDER_TYPE.MarketIncrease, market, isLong, collateralDelta, sizeDeltaUsd, executionFee })
// await gmx.createOrder({ orderType: gmx.GMX_ORDER_TYPE.MarketDecrease, market, isLong, collateralDelta: 0n, sizeDeltaUsd, executionFee })
```

## Surface

- `gmxOperator(config)` (async) — sets up the compact and returns the venue. `matchmakerUrl`,
  `indexerUrl`, and `rpcUrl` are optional: a paired operator receives them from the site over the
  tunnel; pass them to override, or supply all three (with `signerKey` + `user`) to run headless.
  Reads:
  `getAccountState()`, `getMarket(indexToken)`, `getPositions()`, `getOrders()`. Writes:
  `createOrder(...)` (every order type via `orderType` + `triggerPrice`), `cancelOrder(key)`,
  `updateOrder(...)`, and `operate(callList, { amountIn, amountOut })` as the generic escape hatch.
  Plus `master`, `signer`, `status`, `markets`, `close()`.
  The session signer stays private to the venue; you get orders, not the key.
- The package root (`@puppet.fund/operator`) exports the building blocks: `createCompact`,
  `pairOverBrowser`, `TOKEN_ID`, and the compact types.

## Pairing

Without a `signerKey`, the venue opens a one-time `127.0.0.1` listener and prints a link you
open on the site. The browser seals your session key — and the site's matchmaker/indexer/rpc
endpoints — to an ephemeral key in that link and posts it back. The key reaches the operator in
memory only, never written to disk; the endpoints come from the site you're pairing with. The
master must already be deployed (create and fund a WETH account on the site first).
