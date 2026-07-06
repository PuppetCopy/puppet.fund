# @puppet.fund/operator

Build an autonomous trader on [Puppet](https://puppet.fund): a bot, an LLM agent, or a plain
cron script. The kit handles signing, fee quoting, the matchmaker relay, and venue call
shapes; you write the strategy.

You operate a **fund** (the pooled on-chain vehicle that holds the trading capital and carries
the positions) as the delegated session signer of the **account** that controls it. You open and
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

- **`@puppet.fund/operator/gmx`**: the ready-made GMX V2 venue (`gmxOperator(connector)`),
  which establishes its chain-bound operator internally and exposes it as `gmx.operator`. What
  the scaffolder sets up, and what most users want. Also here: `GMX_V2_CHAIN_ID`,
  `GMX_BASE_TOKEN`, `gmxTokenPerNativeToken` (for building a custom operator via
  `createOperator(connector, ...)`), and the GMX helpers.
- **`@puppet.fund/operator`**: the generic, venue-agnostic layers. `createConnector()` (async)
  acquires the session (browser pairing, or a `session` you built headlessly) and establishes
  the chain-agnostic connection: your identity (account +
  fund), the matchmaker compact, the token registry, and `close()`. `createOperator(connector, config)`
  then binds it to one chain: the RPC client, the on-chain deploy checks, balance reads, and the
  generic `operate(callList)` / `swap(input)` dispatch. Compose that
  with your own venue call shapes to build an extended operator: a different venue, base token,
  or surface. The GMX venue is built on exactly this. Also here: `runOperator`,
  `pairOverBrowser`, `buildSession`, `createCompact`, and the compact errors (`CompactError`,
  `CompactContractError`). Type against `IConnector` and `IOperator`.

## Usage

`createConnector()` (async) acquires the **session**, the sealed identity seed (your wallet
address, the fund's base token and name, the matchmaker endpoint, the token registry): with no
config it pairs over the browser (set `pairUrl` for a local site); for unattended runs pass a
`session` built with `buildSession(...)`. It then validates and probes the sealed matchmaker
endpoint, derives your account and fund from the session, and establishes the **connector**
(signing, the matchmaker compact, your account + fund, lifecycle). Hand the connector to the venue:
`gmxOperator(connector)` (async) internally establishes a chain-bound operator on
`GMX_V2_CHAIN_ID` (the RPC client, the on-chain deploy checks, balance reads, dispatch),
exposes it as `gmx.operator`, and adds the GMX execution + reads, so you call
identity/lifecycle actions on `connector`, chain actions on `gmx.operator`, GMX actions on
`gmx`. For a venue of your own, `createOperator(connector, config)` names any chain and establishes
the same chain-bound **operator**; one connector can establish operators on several chains,
sharing the same identity, relay, and registry.
RPC defaults to the chain's public endpoint (set `rpcUrl` beyond a first run). The agent trades whatever base the
paired fund settles in (the session names it). WETH is the simplest: GMX's keeper fee and the
collateral are the same token, priced by the shipped `gmxTokenPerNativeToken`. Any other
registered ERC-20 base needs no extra fee provider, because the execution-fee leg is native ETH
and native is auto-priced; the fund just needs a little native ETH for keeper fees. A native-ETH
base works too (a single native leg funds collateral and fee).

```ts
import { createConnector, runOperator } from '@puppet.fund/operator'
import { gmxOperator } from '@puppet.fund/operator/gmx'

// Pairing carries everything: identity, fund + base token, matchmaker endpoint, registry.
const connector = await createConnector() // pairUrl for a local site, else https://puppet.fund
const gmx = await gmxOperator(connector, { rpcUrl: Bun.env.ARBITRUM_RPC_URL })

// Headless (no browser): build the session yourself with
// buildSession({ signerKey, user, baseToken, name }), then createConnector({ session }).

const deployable = await gmx.operator.getFundBalance() // gmx.operator: chain reads + dispatch
const positions = await gmx.getPositions() //              gmx:          venue reads
// decide, then act. One primitive for every order type; opening is an increase from zero,
// a full close is a decrease by the whole size (executionFee auto-quoted when omitted):
// await gmx.createOrder({ orderType: gmx.GMX_ORDER_TYPE.MarketIncrease, market, isLong, collateralDelta, sizeDeltaUsd })
// await gmx.createOrder({ orderType: gmx.GMX_ORDER_TYPE.MarketDecrease, market, isLong, collateralDelta: 0n, sizeDeltaUsd })
// collateral freed by a close returns to the fund on its own: it shows up in getFundBalance()
// and your next order re-signs it automatically (the surplus rides along as the leg's amountIn).
```

## The account model

Two addresses matter, both deterministic and printed at startup:

- **`connector.account`**: your account, the identity that signs. The session key delegated to
  the operator signs through it.
- **`connector.fund`**: the fund your account controls: it holds the pooled base capital (yours plus
  any puppets'), it is the GMX account positions live under, and every `operate` executes from
  it. Its idle base is `getFundBalance()`, deployable as collateral with no manual bookkeeping:
  fund value moves settle as signed transfer legs, and `createOrder` declares the outflow and
  re-signs anything GMX returned since the last order in the same leg. The protocol co-signs
  every action against the rules the puppets signed.

## Surface

- `pairOverBrowser(pairUrl?)` (async, package root): opens a one-time `127.0.0.1` listener and
  prints a link to open on the site; returns the sealed `IPairedSession` seed: `signerKey`, `user`,
  `baseToken`, `name`, `matchmakerUrl`, and the token registry (the operator derives `params`,
  `fundParams`, `account`, and `fund` from these). `createConnector` calls it for you when no
  `session` is supplied; reach for it directly only in a custom flow. For unattended runs build
  the same seed with `buildSession({ signerKey, user, baseToken, name })`.
- `createConnector(config?)` (async, package root): acquires the session (`config.session` when
  supplied, else browser pairing at `config.pairUrl`) and establishes the connection: it
  validates that the sealed matchmaker endpoint is an absolute http(s) URL, probes it (throwing
  a clear error when it is unreachable), sets up the matchmaker compact, and predicts the
  account and the fund. Returns the chain-agnostic
  **connector** (`IConnector`): the identity (`params`, `fundParams`, `user`, `signer`,
  `account`, `fund`, `baseToken`), the `compact`
  relay client, `tokenRegistry`, `dryRun`, `sign(typedData)` (EIP-712 intent signing; the
  session key itself never leaves the connector), and `close()`. One connector per process: it
  is the `IClosable` you hand to
  `runOperator(connector, body)`. The base token is the paired fund's (`fundParams.baseToken`);
  the matchmaker endpoint and registry come from the session too. `config.dryRun: true` means
  never dispatch: every operator established on the connector runs each dispatch through the
  identical local verification + venue screen the matchmaker applies, logs what would be sent,
  and skips the dispatch: the way to watch a strategy decide without risking funds. The session
  signer stays private to the connector: you get signed intents, not the key.
- `createOperator(connector, config)` (async): takes a config naming the `chainId` (required; `rpcUrl`
  and `getTokenPerNativeToken` are optional), builds the RPC client, and checks on-chain that
  the account and the fund are deployed, the base token is registered on that chain, and warns
  if the fund holds a different registered token than the base this operator trades. Returns the
  chain-bound **operator** (`IOperator`) you call directly: `getFundBalance()` (live base in the
  fund), `getFundSignedBalance()` (the signed
  portion, on-chain), `readSignedBalance(token)` and `readRouteBalance(token)` (the same reads
  for any token),
  `operate(callList, transferList?)` (the generic signed-call dispatch under the venue surface;
  declare value the calls move as transfer legs; the default 0/0 base leg fits value-neutral
  dispatches, and the protocol attestor co-signs only calls inside the venue perimeter it can
  screen, so arbitrary targets are rejected), `swap(input)` (convert one registered token the fund
  holds to another via an allowlisted DEX: pass the input/output token, amounts including the output
  floor, and the `provider` + `providerCallData` from a LI.FI quote you fetch with the fund as the
  output recipient. Defaults to an internal rebalance of the fund's signed balance; set `fromRoute`
  to source the deposit route. The matchmaker re-prices in-domain, and the contract bounds the output
  and enforces the provider allowlist. Swaps are hub-local; cross-chain consolidation is a site flow);
  plus `connector` (the back-reference), `chainId`, and `publicClient`. Multiple operators on
  different chains can share one connector: same identity, relay, and registry. The operator
  needs no indexer: intent block
  anchors are read from the operator's own RPC (`getBlockNumber()`), balances and settlement from
  the chain. The relay itself is stateless HTTP: the compact POSTs each intent to
  `${matchmakerUrl}/attest`, fire-and-ACK (the default endpoint is
  `https://puppet.fund/api/matchmaker`). `operate` and `swap` (and everything built on them)
  return `Promise<IDispatchedFrame | null>`: a real dispatch settles on-chain before resolving,
  and `null` means dry-run, nothing was dispatched.
  `config.rpcUrl` defaults to the chain's public endpoint.
  `config.getTokenPerNativeToken` prices a non-native fee token (native is
  auto-priced; the GMX entry ships `gmxTokenPerNativeToken` for WETH).
- `gmxOperator(connector, opts?)` (async, `@puppet.fund/operator/gmx`): the GMX venue over a
  connector whose fund settles in a GMX-tradable base (WETH is simplest; `GMX_BASE_TOKEN` is its
  address). It internally calls `createOperator(connector, { chainId: GMX_V2_CHAIN_ID,
  getTokenPerNativeToken: gmxTokenPerNativeToken, rpcUrl: opts.rpcUrl })` and exposes the
  chain-bound operator it established as `gmx.operator` (chain reads, `operate`, the `swap`
  escape hatch). Adds GMX-only surface. Reads: `getMarket(indexToken)` (the canonical perp for the base token;
  throws only if still ambiguous), `getPositions(account?)` (defaults to your fund; pass any GMX
  account to read someone else's), `getOrders(account?)`, `markets`. Writes: `createOrder(...)`,
  the one primitive for every increase/decrease order type (market/limit/stop/take-profit) via
  `orderType` + `triggerPrice`, fund balance pre-checked, `executionFee` auto-quoted when omitted
  (the quote accounts for `swapPath` hops and the default decrease PnL swap; set `executionFee`
  on the order to override it, with `calculateExecutionFee` and `getGasLimitsConfig` re-exported
  for exactly that),
  `cancelOrder(key)`, `updateOrder(...)` (including optional `validFromTime`). Plus
  `GMX_ORDER_TYPE`, `GMX_DECREASE_SWAP_TYPE`, and the
  pure helpers `usd`, `weth`, `formatUsd`, `formatWeth`, `gmxPrice` (30dp-USD / 18dp-WETH amounts
  and price units), `acceptablePrice` (slippage-bounded price, correct direction per side and
  order kind), `dominantPosition` (largest position on a market), `positionMetrics`
  (size/collateral/margin incl. unrealized PnL, valuing WETH or USDC collateral correctly), and
  `getPositionPnlUsd`.
  `opts.executionFeeBufferBps` (default 2000 = 20%) pads the auto-quote; `opts.rpcUrl` passes
  through to the internal operator. Call chain actions on `gmx.operator`, identity/lifecycle on
  `connector`.
- Lifecycle + building blocks (`runOperator`, `pairOverBrowser`, `buildSession`, `createCompact`,
  the compact types and errors) live at the package root; see **Entrypoints** above.
  A GMX operator is `createConnector()` →
  `gmxOperator(connector)`, run under `runOperator(connector, body)`.

## Pairing

Pairing (what `createConnector` runs when no session is supplied) opens a one-time `127.0.0.1` listener and prints a link you open on the site.
The browser seals the session (your session key, your wallet address, the fund's base token and
name, the matchmaker endpoint, and the token registry) to an ephemeral key in that link and posts
it back.
The key reaches the operator in memory only, never written to disk. Your account and fund must
already exist (create the account and allocate the fund on the site first).

The browser seals the *derived* session key, never your wallet's bind signature, so a
paired operator can sign operate intents but cannot deploy accounts under you.

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

Today this kit ships one venue: GMX V2 on Arbitrum. Any registered base works (WETH
keeps collateral and keeper fee in one token; any other base funds the keeper fee
from a little native ETH in the fund, auto-priced; a native-ETH base uses a single
native leg for both). `createOrder` stays a single primitive for every order type;
`operate(callList)` is the generic dispatch underneath it, but every call is screened
by the protocol attestor, which today co-signs only the GMX order perimeter (create,
cancel, update, and their token legs). Swaps, claims, and foreign targets are rejected
until the screen widens. `operate` is also where you set custom per-call gas (each
`callList` entry carries its own `gasLimit`). The venue-agnostic plumbing lives in
`createConnector` and `createOperator` (the package root), so more venues, base
tokens, and chains can be added as sibling `@puppet.fund/operator/<venue>` entrypoints
built on the same connector, or you can build your own.
