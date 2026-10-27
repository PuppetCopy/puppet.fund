# Puppet

**Fund a trader, human or agent, without trusting them.**

Puppet is a self-custody shared wallet operated by humans and agents. Top traders
seamlessly earn more, trading on any DeFi dApp. Investors allocate capital and
share the gains, within rules they sign once and the EVM enforces, and every
action is screened and co-signed. Allocate to the best. Or become one.

🔗 Live at **[puppet.fund](https://puppet.fund)**, with its hub on OP Mainnet.

## Demo

[![Puppet demo](https://img.youtube.com/vi/5kJtlNgPiNs/sddefault.jpg)](https://youtu.be/5kJtlNgPiNs)

_Create a wallet, deposit, connect to GMX, and open a perp position, all self-custodial._

## The problem

Allocating to a trader still means handing over your money: an exchange's copy
product, a vault contract or a Telegram wallet holds it, and its rules are
whatever the custodian enforces. Puppet removes the custodian: a master trades
the fund on screened venues, your capital joins each round within a mandate you
sign, and nobody can move your funds anywhere but back to you, exceed your
mandate, or trade outside screened venues.

## How it works

- **Smart-contract accounts, not a vault.** Each user controls a deterministic
  account-abstraction account; a trader's fund is a fund account derived from
  theirs. Balances stay in accounts their owners control, except escrow waiting
  on a round and an open redemption's pot, which sit in protocol stores until
  they are released or paid. An owner's wallet can revoke at any time: its
  mandates end at once and its sessions 10 minutes later, and for the next 10
  minutes the wallet withdraws its balance directly.
- **Co-signed intents.** Every action an owner starts is an EIP-712 intent signed
  by the owner _and_ an attestor relay that first screens it (venue rules, swap
  slippage against the oracle's median, bridge safety, valuation bounds), then
  co-signs. On its own signature the attestor moves no value: a round credits
  escrow against a running total the owner signs, on another chain only once
  it has been released into the fund there, and open escrow returns to the
  owner's wallet a day after it asks; later redemption cohorts need no
  signature.
  Which venues a trade reaches is the attestor's screen.
- **One balance, rounds on demand.** An investor's balance stays in its own
  account and funds every trader it mandates. When the trader allocates, each
  eligible mandate joins the round, bounded by the share and cooldown of the
  mandate the investor set, and only into the fund it names; a revoke ends it.
- **Shares at an attested value.** A round mints non-transferable shares at a net
  asset value the trader signs line by line and the attestor checks against its
  own read; the chain sums the attested lines and checks three cash bounds. A
  redemption pays every queued holder at one price.
- **Skin in the game.** Holders exit through a redemption the trader signs, so the
  trader can delay their exits but never get ahead of them: the trader's own
  exit joins the same queue pro rata or redeems the same fraction of every
  stake.

## Run your own agent

A trader doesn't have to be human. In your wallet, open Sessions, press New agent
and save it, then paste its one link line into the .env beside your agent.
Templates for the agent and its instructions are in the Quickstart, from one
AGENTS.md in your own words to a Bun program that runs your strategy every hour
and journals each step. The agent runs on your computer and links to your wallet
while it is open. It holds none of the fund's keys: the app signs each request
with your session after screening and simulating it like your own, so the money
it moves goes only to screened venues, back to your fund or to exits. You see
every request and can pause or remove the agent at any time.

> **Allocate to the agent. Trust the screens.**

## Live today

- **Venues:** GMX V2 on Arbitrum, Hyperliquid, Uniswap on Arbitrum and Robinhood
  Chain, and Polymarket on Polygon, each screened by the attestor. Every new
  venue is one screen, not a newly trusted contract.
- **Chains:** OP Mainnet is the hub, where funds, rounds and exits settle.
  Arbitrum, Robinhood Chain and Polygon are spokes, and deposits bridge and swap
  in from any of them. The PUPPET token and its Governor are on Ethereum.
- **Flows:** create a wallet and a fund, deposit from any supported chain, sign a
  mandate for each fund you allocate to, join rounds at one verified price, trade
  from the fund in the venue apps you know (over WalletConnect) or through your
  own agent, then sell into the exit queue and redeem.
- Contracts verified on every chain's explorer.

## Packages

- **`contracts/`**: the on-chain protocol, with account-abstraction accounts,
  gates, the share economy, and the co-sign model (Solidity / Foundry).
- **`sdk/`**: `@puppet/sdk`, with intent builders, attestation, state, and
  evaluation.
- **`website/`**: the puppet.fund web app (aelea), installable as a PWA.

## Tech

A hub gate on OP Mainnet with spoke gates on the other chains; EIP-7702
accounts whose key is a two-party ECDSA (DKLs18) split between the owner's app
and the attestor; an attestor that simulates every intent before it co-signs; a
median price oracle for NAV; Across bridging and LI.FI, KyberSwap and Relay swaps
screened in-domain; an event-sourced indexer; agents linked locally to the app,
built by Claude (Anthropic) or any LLM from the app's instruction.

## License

Business Source License 1.1; see [LICENSE.md](LICENSE.md).

## Trademarks

Puppet, puppet.fund and the Puppet logo are trademarks of puppetdao.eth. The Business Source License grants no trademark rights: forks and derivative works must use their own name, logo and domain.

Security disclosures: [SECURITY.md](SECURITY.md).
