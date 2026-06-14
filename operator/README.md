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
- **`@puppet.fund/operator`** — the generic, venue-agnostic core. `pairOverBrowser()` →
  `createOperatorCore(session)` gives you the RPC client, account + fund prediction and
  deploy checks, the matchmaker compact, the generic `operate(callList)` dispatch,
  `getFundBalance()`, and connection lifecycle (`onStatus()` / `isOpen()` / `close()`). Compose it
  with your own venue call shapes to build an extended operator — a different venue, base token,
  or surface. The GMX venue is built on exactly this. Also here: `runOperator`,
  `pairOverBrowser`, `buildSession`, `createCompact`, `TOKEN_ID`, and the compact error helpers. Type your
  operator against `IOperatorCore`.

## Usage

`pairOverBrowser()` returns the **session** — the whole sealed identity (account params, the fund
and its base token, the matchmaker endpoint, the token registry). Pass it to `createOperatorCore`
to build the **core** (signing, the matchmaker compact, your account + fund, lifecycle), then wrap
it in the GMX venue. The core does the async setup and owns the connection; `gmxOperator(core)` is
synchronous and adds only GMX execution + reads — so you call connection/account actions on `core`,
GMX actions on `gmx`. RPC defaults to the public Arbitrum endpoint (set `rpcUrl` beyond a first
run). The agent trades whatever base the paired fund settles in (the session names it) — WETH is
the simplest (GMX's keeper fee is the same token, carved straight from the collateral, so the fund
needs no native ETH); USDC or native ETH work too, but a non-WETH base also needs a little ETH in
the fund for the GMX execution fee.

```ts
import { createOperatorCore, pairOverBrowser, runOperator } from '@puppet.fund/operator'
import { gmxOperator } from '@puppet.fund/operator/gmx'

// Pairing carries everything: identity, fund + base token, matchmaker endpoint, registry.
const session = await pairOverBrowser() // a PAIR_URL for a local site, else https://puppet.fund
const core = await createOperatorCore(session, { rpcUrl: Bun.env.ARBITRUM_RPC_URL })
const gmx = gmxOperator(core)

// Headless (no browser): build the session yourself —
// buildSession({ signerKey, user, baseTokenId, name }) — then createOperatorCore(session).

const deployable = await core.getFundBalance() // core: account + connection
const positions = await gmx.getPositions() //      gmx:  venue reads
// decide, then act. One primitive for every order type; opening is an increase from zero,
// a full close is a decrease by the whole size (executionFee auto-quoted when omitted):
// await gmx.createOrder({ orderType: gmx.GMX_ORDER_TYPE.MarketIncrease, market, isLong, collateralDelta, sizeDeltaUsd })
// await gmx.createOrder({ orderType: gmx.GMX_ORDER_TYPE.MarketDecrease, market, isLong, collateralDelta: 0n, sizeDeltaUsd })
// collateral freed by a close returns to the fund on its own — it shows up in getFundBalance()
// and your next order re-signs it automatically (the surplus rides along as the leg's amountIn).
```

## The account model

Two addresses matter, both deterministic and printed at startup:

- **`core.account`** — your account, the identity that signs. The session key delegated to the
  operator signs through it.
- **`core.fund`** — the fund your account controls: it holds the pooled base capital (yours plus
  any subscribers'), it is the GMX account positions live under, and every `operate` executes from
  it. Its idle base is `getFundBalance()` — deployable as collateral with no manual bookkeeping:
  fund value moves settle as signed transfer legs, and `createOrder` declares the outflow and
  re-signs anything GMX returned since the last order in the same leg. The protocol co-signs
  every action against the rules the backers signed.

## Surface

- `pairOverBrowser(pairUrl?)` (async, package root) — opens a one-time `127.0.0.1` listener and
  prints a link to open on the site; returns the sealed `IPairedSession`: `params` ({user,
  signer}), `share` ({master, baseTokenId, name}), `matchmakerUrl`, and the token registry. For
  unattended runs build the same shape with `buildSession({ signerKey, user, baseTokenId, name })`.
- `createOperatorCore(session, config?)` (async, package root) — takes a session, sets up the
  matchmaker compact, predicts + checks the account and the fund (asserting the session's
  identity is internally consistent), and returns the connection + account surface you call
  directly: `getFundBalance()` (live base in the fund), `getFundSignedBalance()` (the signed
  portion, on-chain), `isOpen()` (is the matchmaker connected — gate a tick on it), `onStatus()`,
  `operate(callList, transferList?)` (the generic signed-call dispatch under the venue surface —
  declare value the calls move as transfer legs; the default 0/0 leg fits value-neutral
  dispatches, and the protocol attestor co-signs only calls inside the venue perimeter it can
  screen, so arbitrary targets are rejected), and `close()`; plus `params`, `share`, `account`,
  `fund`, `signer`, `user`, `token`, `baseTokenId`, `publicClient`, `compact`. Type it as
  `IOperatorCore`. The base token is the paired fund's (`share.baseTokenId`); the matchmaker
  endpoint and registry come from the session too. The operator needs no indexer: intent block
  anchors arrive as head frames on the relay socket, balances and settlement are read from the
  chain. `config.rpcUrl` defaults to the public Arbitrum endpoint. `config.dryRun: true` runs
  every dispatch through the identical local verification + venue screen the matchmaker applies,
  logs what would be sent, and skips the dispatch — the way to watch a strategy decide without
  risking funds. The session signer stays private to the core — you get signed intents, not the key.
- `gmxOperator(core, opts?)` (sync, `@puppet.fund/operator/gmx`) — the GMX venue over a core whose
  fund settles in a GMX-tradable base (WETH is simplest; `GMX_BASE_TOKEN_ID` is its id). Adds
  GMX-only surface. Reads: `getMarket(indexToken)` (the canonical perp for the base token;
  throws only if still ambiguous), `getPositions(account?)` (defaults to your fund; pass any GMX
  account to read someone else's), `getOrders(account?)`, `markets`. Writes: `createOrder(...)` —
  the one primitive for every increase/decrease order type (market/limit/stop/take-profit) via
  `orderType` + `triggerPrice`, `executionFee` auto-quoted when omitted, fund balance pre-checked —
  `cancelOrder(key)`, `updateOrder(...)`. Plus `GMX_ORDER_TYPE`, `GMX_DECREASE_SWAP_TYPE`, and the
  pure helpers `usd`, `weth`, `formatUsd`, `formatWeth`, `gmxPrice` (30dp-USD / 18dp-WETH amounts
  and price units), `acceptablePrice` (slippage-bounded price, correct direction per side and
  order kind), `dominantPosition` (largest position on a market), and `positionMetrics`
  (size/collateral/margin incl. unrealized PnL, valuing WETH or USDC collateral correctly).
  `opts.executionFeeBufferBps` (default 2000 = 20%) pads the auto-quote. It does NOT re-expose
  core methods — call those on `core`.
- Lifecycle + building blocks (`runOperator`, `pairOverBrowser`, `buildSession`, `createCompact`,
  `TOKEN_ID`, compact types + error helpers) live at the package root — see **Entrypoints** above.
  A GMX operator is `pairOverBrowser()` → `createOperatorCore(session)` → `gmxOperator(core)`, run
  under `runOperator(core, body)`.

## Pairing

`pairOverBrowser()` opens a one-time `127.0.0.1` listener and prints a link you open on the site.
The browser seals the session — your session key, the fund identity (`params` + `share`), the
matchmaker endpoint, and the token registry — to an ephemeral key in that link and posts it back.
The key reaches the operator in memory only, never written to disk. Your account and fund must
already exist (create the account and allocate the fund on the site first).

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
`operate(callList)` is the generic dispatch underneath it, but every call is screened
by the protocol attestor, which today co-signs only the GMX order perimeter (create,
cancel, update, and their token legs). Swaps, claims, and foreign targets are rejected
until the screen widens. `operate` is also where you set custom per-call gas (each
`callList` entry carries its own `gasLimit`). The venue-agnostic plumbing lives in
`createOperatorCore` (the package root), so more venues, base tokens, and chains can
be added as sibling `@puppet.fund/operator/<venue>` entrypoints built on the same
core — or you can build your own.
