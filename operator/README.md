# @puppet.fund/operator

Build an autonomous trader on [Puppet](https://puppet.fund): a bot, an LLM agent, or a plain
cron script. The kit handles signing, fee quoting, the matchmaker relay, and venue call
shapes; you write the strategy.

You trade as a **master**: one account per wallet, the same address on every chain. It holds
what you deposit on the site, executes every action, and pays and collects at settlement.
Backers, called **puppets**, bond funds into a pool on the hub and sign **mandates** naming you,
each carrying the rules their bond may be matched under: how much skin they want behind them,
what share of their pool you may take, a cooldown, an expiry, and which tokens they will back.
The protocol co-signs every action against those mandates. What you set per operate is `skin`,
the share of your own collateral you let backers match against, and `token`, the base token the
cycle trades and pays out in.

```bash
bun add @puppet.fund/operator
```

The fastest start is the scaffolder, which sets up a project for you:

```bash
bunx @puppet.fund/templates my-operator gmx
```

## Entrypoints

The package is split by operator, so you choose yours:

- **`@puppet.fund/operator/gmx`**: the ready-made GMX V2 venue
  (`gmxOperator(connector, { rpcUrl, token, skin })`), which establishes its
  chain-bound operator internally and exposes it as `gmx.operator`. What the scaffolder sets up,
  and what most users want. Also here: `GMX_V2_CHAIN_ID` and the GMX helpers.
- **`@puppet.fund/operator`**: the generic, venue-agnostic layers. `createConnector()` (async)
  acquires the session (browser pairing, or a `session` you built headlessly) and establishes
  the chain-agnostic connection: your identity (wallet address + the trading account you paired),
  the matchmaker compact, the token registry, the oracle rate source, and `close()`.
  `createOperator(connector, config)` then binds it to one chain: the RPC client, balance reads, and
  the generic `credit` / `convert` / `operate` / `settle` dispatch. Compose that with your own
  venue call shapes to build an extended operator: a different venue, collateral, or surface. The
  GMX venue is built on exactly this. Also here: `runOperator`, `pairOverBrowser`, and the compact
  errors (`CompactError`, `CompactContractError`). Type against `IConnector`, `IOperator`, and
  `IGetRate`.

## Usage

`createConnector()` (async) acquires the **session**, the sealed identity seed (your wallet
address, the matchmaker and oracle endpoints, the session grant, the token registry): with no
config it pairs over the browser (set `pairUrl` for a local site); for unattended runs pass a
`session` (an `IPairedSession` literal you build yourself). It validates the sealed endpoints,
derives your puppet account, and establishes the **connector** (signing, the matchmaker compact,
the oracle rate source, lifecycle). Hand the connector to the venue:
`gmxOperator(connector, { rpcUrl, token, skin })` (async) internally establishes a
chain-bound operator on `GMX_V2_CHAIN_ID` (the RPC client, the trading body, balance reads,
dispatch), exposes it as `gmx.operator`, and adds the GMX execution + reads, so you call
identity/lifecycle actions on `connector`, chain actions on `gmx.operator`, GMX actions on
`gmx`. For a venue of your own, `createOperator(connector, config)` names any chain
and establishes the same chain-bound **operator**; one connector can establish operators on
several chains, sharing the same identity, relay, and registry.
`rpcUrl` is required: the relay fee you sign is priced on the gas price your node reports and on
the fee token's rate from the protocol oracle the session names, and the relay re-derives the
same fee and drops an intent whose fee disagrees without answering. Every attested value is in
the hub USDC unit, and relay fees are paid in the chain's USDC by the account that acts (the
trading body for `operate`, your puppet account for `credit`, your hub puppet account for
`settle`), so keep a little USDC where you act. `convert` is the exception: its fee comes out of
the token it converts.

```ts
import { createConnector, runOperator } from '@puppet.fund/operator'
import { gmxOperator } from '@puppet.fund/operator/gmx'

// Pairing carries everything: identity, matchmaker + oracle endpoints, session grant, registry.
const connector = await createConnector() // pairUrl for a local site, else https://puppet.fund

const rpcUrl = Bun.env.ARBITRUM_RPC_URL
if (!rpcUrl) throw new Error('set ARBITRUM_RPC_URL')
const WETH = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'
const gmx = await gmxOperator(connector, { rpcUrl, token: WETH, skin: 10_000n })

// Headless (no browser): build the session yourself as an IPairedSession literal, then
// createConnector({ session }).

await gmx.operator.credit(WETH) // sweep WETH that a bridge delivered to the account's deposit route
const deployable = await gmx.operator.readBalance(WETH) // gmx.operator: chain reads + dispatch
const positions = await gmx.getPositions() //               gmx:          venue reads
// decide, then act. One primitive for every order type; opening is an increase from zero,
// a full close is a decrease by the whole size (executionFee auto-quoted when omitted):
// await gmx.createOrder({ orderType: GMX_ORDER_TYPE.MarketIncrease, market, isLong, collateralDelta, sizeDeltaUsd })
// await gmx.createOrder({ orderType: GMX_ORDER_TYPE.MarketDecrease, market, isLong, collateralDelta: 0n, sizeDeltaUsd })
// collateral freed by a close returns to the trading body on its own: it shows up in readBalance(WETH)
// and your next order re-signs it automatically.
```

## The account model

Three addresses matter, all deterministic:

- **`connector.user`**: your wallet. The session key delegated to the operator signs on its
  behalf.
- **`connector.account`** (also `gmx.operator.account`): the trading account you paired, the same
  address on every chain. It holds what you deposit on the site, is the GMX account positions live
  under, executes every `operate` and pays the relay fees, and receives what settlement pays out.
  One wallet has exactly one account; the performance fee is a protocol constant and it is yours.

## Surface

- `pairOverBrowser(pairUrl?)` (async, package root): opens a one-time `127.0.0.1` listener and
  prints a link to open on the site; returns the sealed `IPairedSession` seed: `signerKey`, `user`,
  `matchmakerUrl`, `oracleUrl`, the session grant, and the token registry. `createConnector` calls
  it for you when no `session` is supplied; reach for it directly only in a custom flow. For
  unattended runs build the same seed yourself as an `IPairedSession` literal.
- `createConnector(config?)` (async, package root): acquires the session (`config.session` when
  supplied, else browser pairing at `config.pairUrl`) and establishes the connection: it
  validates that the sealed endpoints are absolute http(s) URLs, sets up the matchmaker compact
  and the oracle rate source, and predicts the puppet account. Returns the chain-agnostic
  **connector** (`IConnector`): `user`, `account`, the `compact` relay client, `tokenRegistry`,
  `getRate`, `dryRun`, `sign(typedData)` (EIP-712 intent signing; the session key itself never
  leaves the connector), and `close()`. One connector per process: it is what you hand to
  `runOperator(connector, body)`. `config.dryRun: true` means never dispatch: every operator
  established on the connector builds and screens each intent exactly as it would for a
  dispatch, logs what would be sent, and skips the dispatch: the way to watch a strategy decide
  without risking funds.
- `createOperator(connector, config)` (async): takes a config naming the `chainId` and the `rpcUrl`
  that reaches it (`hubRpcUrl` is optional and only the hub draw inside `settle` needs it, when a cycle closes with losses; `routeEndpoint` is optional
  and only `convert` needs it) and builds the RPC client. Returns the chain-bound **operator**
  (`IOperator`) you call directly: `account` (the trading account), `readBalance(token)` (its live
  balance of any token), `credit(token)` (sweep a token that a bridge delivered to the account's
  deposit route into the account), `convert(inputToken, outputToken, inputAmount)`
  (convert a token your puppet account holds on this chain into another via an allowlisted DEX:
  the operator quotes the route through `config.routeEndpoint`, the origin that proxies the
  aggregator, for the amount left after the relay fee and signs the quoted output as the floor;
  the matchmaker re-prices in-domain and the contract bounds the output. Conversions are
  chain-local; cross-chain moves are a site flow), `operate(callList, open)` (the generic
  signed-call dispatch from the master account; `open: true` opens the next cycle with
  this operate, `false` trades inside the open one; the protocol attestor co-signs only calls
  inside the venue perimeter it can screen, so arbitrary targets are rejected), `settle()` (close
  the open cycle: the attestor values the account, gains pay each backer on the traded chain in
  the cycle's token less your performance fee, and losses draw from their bond on the hub), plus
  `publicClient`. Multiple operators on different chains can share one connector. The operator
  needs no indexer: nonces, balances, and settlement are read from your own RPC, and the cohort
  terms come from the matchmaker. The relay itself is stateless HTTP: the compact POSTs each intent to the matchmaker,
  fire-and-ACK. `credit`, `convert`, `operate`, and `settle` (and everything built on them) return
  `Promise<IDispatchedFrame | null>`: a real dispatch settles on-chain before resolving, and
  `null` means dry-run, nothing was dispatched.
- `gmxOperator(connector, opts)` (async, `@puppet.fund/operator/gmx`): the GMX venue over a
  connector. `opts` is the operator config without `chainId`; its `token` is what every order
  posts as collateral and what `getMarket` resolves markets against (WETH keeps collateral and
  keeper fee in one token): it internally calls
  `createOperator(connector, { ...opts, chainId: GMX_V2_CHAIN_ID })` and exposes the chain-bound
  operator it established as `gmx.operator`. Adds GMX-only surface. Reads: `getMarket(indexToken)`
  (the canonical perp for the collateral token; throws only if still ambiguous),
  `getPositions(account?)` (defaults to your trading body; pass any GMX account to read someone
  else's), `getOrders(account?)`, `markets`. Writes: `createOrder(...)`, the one primitive for
  every increase/decrease order type (market/limit/stop/take-profit) via `orderType` +
  `triggerPrice`, trading-body balance pre-checked, `executionFee` auto-quoted when omitted (the
  quote accounts for `swapPath` hops and the default decrease PnL swap; set `executionFee` on the
  order to override it, with `calculateExecutionFee` and `getGasLimitsConfig` re-exported for
  exactly that), `cancelOrder(key)`, `updateOrder(...)` (every field stated explicitly, because
  GMX overwrites the whole order on update). Plus `GMX_ORDER_TYPE`, `GMX_DECREASE_SWAP_TYPE`, and
  the pure helpers `usd`, `formatUsd`, `gmxPrice` (30dp-USD amounts and price units; 18dp WETH
  amounts are viem's `parseEther`/`formatEther`), `acceptablePrice` (slippage-bounded price,
  correct direction per side and order kind), `dominantPosition` (largest position on a market),
  `positionMetrics` (size/collateral/margin incl. unrealized PnL, valuing WETH or USDC collateral
  correctly), and `getPositionPnlUsd`. The auto-quote is padded 20%; every other `opts` field
  passes straight through to the internal operator. Call chain actions on `gmx.operator`,
  identity/lifecycle on `connector`.
- Lifecycle + building blocks (`runOperator`, `pairOverBrowser`, the compact types and errors)
  live at the package root; see **Entrypoints** above. A GMX operator is `createConnector()` →
  `gmxOperator(connector, { rpcUrl, token, skin })`, run under
  `runOperator(connector, body)`.

## Pairing

Pairing (what `createConnector` runs when no session is supplied) opens a one-time `127.0.0.1`
listener and prints a link you open on the site. The browser seals the session (your session
key, your wallet address, the matchmaker and oracle endpoints, the session grant, and the token
registry) to an ephemeral key in that link and posts it back. The key reaches the operator in
memory only, never written to disk. Your account must already exist (deposit on the site first).

The browser seals the *derived* session key, never your wallet's bind signature, so a
paired operator can sign intents but cannot deploy accounts under you.

## Trust and limits

The session key delegated to an operator can open and manage positions within the
rules you signed, but can never withdraw: withdrawals always return to your own
wallet, and every action is co-signed by the protocol. That key is derived
deterministically from a single wallet signature: it is the same on every machine,
and there is no on-chain revocation yet. So protecting your pairing link and the host
that runs the operator is protecting full operating authority. A leaked key cannot
move funds out, but it can churn positions and burn execution fees until you withdraw
and abandon the account. Only ever pair on the real https://puppet.fund.

## Scope

Today this kit ships one venue: GMX V2 on Arbitrum. Any registered collateral works (WETH
keeps collateral and keeper fee in one token; any other token funds the keeper fee
from a little native ETH in the trading body). `createOrder` stays a single primitive for
every order type; `operate(callList, open)` is the generic dispatch underneath it, but every
call is screened by the protocol attestor, which today co-signs only the GMX order perimeter
(create, cancel, update, and their token legs). Claims and foreign targets are rejected until
the screen widens. `operate` is also where you set custom per-call gas (each `callList` entry
carries its own `gasLimit`). The venue-agnostic plumbing lives in `createConnector` and
`createOperator` (the package root), so more venues, collateral tokens, and chains can be added
as sibling `@puppet.fund/operator/<venue>` entrypoints built on the same connector, or you can
build your own.
