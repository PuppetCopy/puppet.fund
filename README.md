# Puppet

**Fund a trader, human or agent, without trusting them.**

Puppet is a self-custody shared wallet operated by humans and agents. Back a
trader without handing over your money: they trade their own capital on GMX, your
capital follows under rules you sign, and every action is co-signed and enforced
on-chain. Custody never moves into the protocol. Copy-trading, finally without
the custodian.

🔗 Live on Arbitrum mainnet at **[puppet.fund](https://puppet.fund)**.

## Demo

[![Puppet demo](https://img.youtube.com/vi/5kJtlNgPiNs/maxresdefault.jpg)](https://youtu.be/5kJtlNgPiNs)

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
  theirs. Assets stay in accounts their owners control, never in the protocol.
- **Co-signed intents.** Nothing executes on one signature. Every action is an
  EIP-712 intent signed by the actor _and_ an attestor relay that first screens
  it (GMX venue rules, swap slippage against a median oracle, bridge safety, NAV
  bounds), then co-signs. A trader can only ever act inside what each backer
  signed for, by signature, not by policy.
- **Lazy capital pull, not upfront lockup.** Backers never escrow. Their balance
  stays liquid in their own account and only moves to a fund when the trader
  actually trades. One deposit can back many traders at once, each pull bounded
  by the rule you signed; unfunded or throttled matches simply skip.
- **Shares at an attested NAV.** A capital pull mints non-transferable shares at
  a net asset value attested from a median of six price sources (Binance,
  Coinbase, Kraken, OKX, Chainlink, GMX), verified on-chain. Backers redeem at
  that same NAV.
- **Skin in the game.** A trader can never exit ahead of the people who backed
  them; their queued shares redeem pro-rata with the backers'.

## Fund an AI agent

A trader doesn't have to be human. The open [operator kit](operator/) scaffolds a
running agent in one command and pairs it to a fund in minutes through an
encrypted, local-only (`127.0.0.1`) handshake. Guardrails are built in: dry-run
by default, an on-chain stop, a drawdown halt, a cost budget. In the LLM
template, Claude proposes long / flat / close through structured tool use and
deterministic code enforces every cap, the model can never size, route, or
withdraw. The operator key can never withdraw at all: withdrawals return to your
wallet and require a separate signature.

> **Fund the agent. Don't trust it.**

## Live today

- **Venue:** GMX V2 perpetuals, the live, attestor-screened trading venue. Every
  new venue is one screen, not a newly trusted contract.
- **Hub chain:** Arbitrum. Subscribe / allocate / redeem / claim settle here;
  deposits can bridge and swap in from Base, Optimism, Polygon, and Ethereum.
- **End-to-end flows:** create wallet + fund, deposit (cross-chain bridge + swap
  into the fund's base token), subscribe with signed copy rules, allocate (lazy
  capital pull at NAV), trade GMX by hand via a WalletConnect tunnel (your fund
  appears as the wallet) or via an agent, then redeem / sell / claim.
- Contracts verified on Arbiscan; the operator kit ships open-source.

## Packages

- **`contracts/`** — the on-chain protocol: account-abstraction accounts, gates,
  the share economy, and the co-sign model (Solidity / Foundry).
- **`sdk/`** — `@puppet/sdk`: intent builders, attestation, state, and evaluation.
- **`website/`** — the puppet.fund web app (aelea), installable as a PWA.
- **`operator/`** — the open agent operator kit and GMX trading templates.

## Tech

Arbitrum + account-abstraction smart accounts; an attestor relay over a compact
WebSocket protocol; a median price oracle for NAV; Across bridging and LI.FI
swaps screened in-domain; an Envio/Hasura indexer; a TypeScript/Bun operator kit
with Claude (Anthropic) in the loop.

## License

Business Source License 1.1; see [LICENSE.md](LICENSE.md).

Security disclosures: [SECURITY.md](SECURITY.md).
