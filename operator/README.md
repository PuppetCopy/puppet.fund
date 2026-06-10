# @puppet.fund/operator

Build an autonomous trader on [Puppet](https://puppet.fund) — a bot, an LLM agent, or a plain
cron script. The kit handles signing, fee quoting, the matchmaker connection, and venue call
shapes; you write the strategy.

You operate a **fund** — the pooled on-chain vehicle that holds the trading capital and carries
the positions — as the delegated session signer of the **account** that controls it. You open and
maintain positions. The human creates the account, allocates the fund, and redeems on the site.

```bash
bun add @puppet.fund/operator
```

The fastest start is the scaffolder, which sets up a project for you:

```bash
bunx @puppet.fund/templates my-operator gmx
```

## Entrypoints

The package is split by operator, so you choose yours:

- **`@puppet.fund/operator/gmx`** — the ready-made GMX V2 venue (`gmxOperator(core)`), wrapping a
  core you build. What the scaffolder sets up, and what most users want.
- **`@puppet.fund/operator`** — the generic, venue-agnostic core. `createOperatorCore(config)`
  gives you pairing + endpoint resolution, the RPC/indexer clients, account + fund prediction and
  deploy checks, the matchmaker compact, the generic `operate(callList)` dispatch,
  `getFundBalance()`, and connection lifecycle (`status` / `isOpen()` / `close()`). Compose it
  with your own venue call shapes to build an extended operator — a different venue, base token,
  or surface. The GMX venue is built on exactly this. Also here: `runOperator`,
  `pairOverBrowser`, `createCompact`, `TOKEN_ID`, and the compact error helpers. Type your
  operator against `IOperatorCore`.

## Usage

Build the **core** (the connection — pairing/endpoint resolution, signing, the matchmaker compact,
your account + fund, lifecycle), then wrap it in the GMX venue. The core does the async setup and
owns the connection; `gmxOperator(core)` is synchronous and adds only GMX execution + reads — so
you call connection/account actions on `core`, GMX actions on `gmx`. When you pair, the site hands
over its matchmaker/indexer endpoints, so a paired operator needs no URL config; RPC defaults to
the public Arbitrum endpoint (set `rpcUrl` for anything beyond a first run). GMX runs on a WETH
fund (collateral and the keeper fee are the same token), so create your account and allocate a
WETH fund on the site first.

```ts
import { createOperatorCore, runOperator } from '@puppet.fund/operator'
import { GMX_BASE_TOKEN_ID, gmxOperator } from '@puppet.fund/operator/gmx'

// Zero-config: endpoints + session key arrive over the pairing tunnel.
const core = await createOperatorCore({ baseTokenId: GMX_BASE_TOKEN_ID })
const gmx = gmxOperator(core)

// Override endpoints by passing matchmakerUrl / indexerUrl / rpcUrl to createOperatorCore,
// or add signerKey + user (with matchmakerUrl + indexerUrl) to run headless without pairing.

const deployable = await core.getFundBalance() // core: account + connection
const positions = await gmx.getPositions() //      gmx:  venue reads
// decide, then act. One primitive for every order type; opening is an increase from zero,
// a full close is a decrease by the whole size (executionFee auto-quoted when omitted):
// await gmx.createOrder({ orderType: gmx.GMX_ORDER_TYPE.MarketIncrease, market, isLong, collateralDelta, sizeDeltaUsd })
// await gmx.createOrder({ orderType: gmx.GMX_ORDER_TYPE.MarketDecrease, market, isLong, collateralDelta: 0n, sizeDeltaUsd })
// collateral freed by a close returns to the fund on its own — it shows up in getFundBalance().
```

## The account model

Two addresses matter, both deterministic and printed at startup:

- **`core.account`** — your account, the identity that signs. The session key delegated to the
  operator signs through it.
- **`core.fund`** — the fund your account controls: it holds the pooled base capital (yours plus
  any subscribers'), it is the GMX account positions live under, and every `operate` executes from
  it. Its idle base is `getFundBalance()` — deployable as collateral right away, no bookkeeping
  steps. The protocol co-signs every action against the rules the backers signed.

## Surface

- `createOperatorCore(config)` (async, package root) — pairs / resolves endpoints, sets up the
  matchmaker compact, predicts + checks the account and the fund, and returns the connection +
  account surface you call directly: `getFundBalance()`, `isOpen()` (is the matchmaker connected —
  gate a tick on it), `status`, `operate(callList)` (the generic signed-call escape hatch for
  anything a venue doesn't wrap — swaps, claims), and `close()`; plus `account`, `fund`, `signer`,
  `user`, `token`, `baseTokenId`, `publicClient`, `sql`, `compact`. Type it as `IOperatorCore`.
  `matchmakerUrl` / `indexerUrl` are optional (a paired operator receives them from the site; pass
  them to override, or supply both with `signerKey` + `user` to run headless). `rpcUrl` defaults
  to the public Arbitrum endpoint. The session signer stays private to the core — you get signed
  intents, not the key.
- `gmxOperator(core, opts?)` (sync, `@puppet.fund/operator/gmx`) — the GMX venue over a core. Build
  the core with `baseTokenId: GMX_BASE_TOKEN_ID` (WETH) and pass it in; this validates the base token
  and adds GMX-only surface. Reads: `getMarket(indexToken)` (the canonical perp for the base token;
  throws only if still ambiguous), `getPositions(account?)` (defaults to your fund; pass any GMX
  account to read someone else's), `getOrders(account?)`, `markets`. Writes: `createOrder(...)` —
  the one primitive for every increase/decrease order type (market/limit/stop/take-profit) via
  `orderType` + `triggerPrice`, `executionFee` auto-quoted when omitted, fund balance pre-checked —
  `cancelOrder(key)`, `updateOrder(...)`. Plus `GMX_ORDER_TYPE`, `GMX_DECREASE_SWAP_TYPE`, and the
  helpers `usd`, `weth`, `formatUsd`, `formatWeth`, `gmxPrice` for GMX's 30dp-USD / 18dp-WETH
  amounts and price units. `opts.executionFeeBufferBps` (default 2000 = 20%) pads the auto-quote.
  It does NOT re-expose core methods — call those on `core`.
- Lifecycle + building blocks (`runOperator`, `pairOverBrowser`, `createCompact`, `TOKEN_ID`, compact
  types + error helpers) live at the package root — see **Entrypoints** above. A GMX operator is
  `createOperatorCore({ baseTokenId: GMX_BASE_TOKEN_ID })` + `gmxOperator(core)`, run under
  `runOperator(core, body)`.

## Pairing

Without a `signerKey`, the core opens a one-time `127.0.0.1` listener and prints a link you
open on the site. The browser seals your session key — and the site's matchmaker/indexer
endpoints — to an ephemeral key in that link and posts it back. The key reaches the operator in
memory only, never written to disk; the endpoints come from the site you're pairing with. Your
account and fund must already exist (create the account and allocate a WETH fund on the site
first).

The browser seals the *derived* session key, never your wallet's bind signature, so a
paired operator can sign operate intents but cannot deploy accounts under you.

## Trust and limits

The session key delegated to an operator can open and manage positions within the
rules you signed, but can never withdraw — withdrawals always return to your own
wallet, and every action is co-signed by the protocol. That key is derived
deterministically from a single wallet signature: it is the same on every machine,
and there is no on-chain revocation yet. So protecting your pairing link and the host
that runs the operator is protecting full operating authority. A leaked key cannot
move funds out, but it can churn positions and burn execution fees until you withdraw
and abandon the account. Only ever pair on the real https://puppet.fund.

## Scope

Today this kit ships one venue — GMX V2 on Arbitrum, on a WETH fund (GMX pays its
keeper fee in WETH, so collateral and fee are the same token and nothing else needs
funding). `createOrder` stays a single primitive for every order type;
`operate(callList)` is the generic escape hatch for anything it doesn't cover (other
GMX calls, swaps, claims) and is also where you set custom per-call gas (each
`callList` entry carries its own `gasLimit`). The venue-agnostic plumbing lives in
`createOperatorCore` (the package root), so more venues, base tokens, and chains can
be added as sibling `@puppet.fund/operator/<venue>` entrypoints built on the same
core — or you can build your own.
