# Puppet

**Fund a trader, human or agent, without trusting them.**

Puppet is a self-custody shared wallet operated by humans and agents. Back a
trader without handing over your money: they trade their own capital on GMX, your
capital follows under rules you sign, and every action is screened and co-signed
within limits the chain enforces. Copy-trading, finally without the custodian.

🔗 Live at **[puppet.fund](https://puppet.fund)**, with its hub on OP Mainnet.

## Demo

[![Puppet demo](https://img.youtube.com/vi/5kJtlNgPiNs/sddefault.jpg)](https://youtu.be/5kJtlNgPiNs)

_Create a wallet, deposit, connect to GMX, and open a perp position, all self-custodial._

## The problem

Copy-trading is one of the most-used products on every major exchange, but
on-chain it is still custodial: following a trader means handing your money to an
exchange, a vault contract, or a Telegram wallet. GMX is the flagship perpetuals
venue on Arbitrum and has no native copy layer. Puppet is that layer, with
self-custody.

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

## Fund an AI agent

A trader doesn't have to be human. On the app's Agent link page you create a
link and copy its instruction; paste it into Claude Code or any LLM with your
strategy in plain words, and the agent it builds connects to your fund through the
Puppet app you have open. The agent holds no key: the app runs each request on its
own session, only within the scopes you approved when the agent connected (trade,
run rounds, redeem), on any venue the attestor screens and on any chain Puppet runs
on. It can never withdraw, and every action it takes is co-signed by the attestor
inside its screens. The starter strategies carry the guardrails as instructions:
on-chain stops, a drawdown halt, a daily cost budget.

> **Allocate to the agent. Trust the screens.**

## Live today

- **Venue:** GMX V2 perpetuals, the live, attestor-screened trading venue. Every
  new venue is one screen, not a newly trusted contract.
- **Hub chain:** OP Mainnet. Subscribe / allocate / redeem / claim settle here;
  deposits can bridge and swap in from other chains.
- **End-to-end flows:** create wallet + fund, deposit (cross-chain bridge + swap
  into the fund's base token), subscribe with signed copy rules, allocate (lazy
  capital pull at NAV), trade GMX by hand via a WalletConnect tunnel (your fund
  appears as the wallet) or via an agent, then redeem / sell / claim.
- Contracts verified on Arbiscan.

## Packages

- **`contracts/`** — the on-chain protocol: account-abstraction accounts, gates,
  the share economy, and the co-sign model (Solidity / Foundry).
- **`sdk/`** — `@puppet/sdk`: intent builders, attestation, state, and evaluation.
- **`website/`** — the puppet.fund web app (aelea), installable as a PWA.

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
