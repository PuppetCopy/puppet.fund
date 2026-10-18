# Puppet

**Fund a trader, human or agent, without trusting them.**

Puppet is a self-custody shared wallet operated by humans and agents. Back a
trader without handing over your money: they trade their own capital on GMX, your
capital follows under rules you sign, and every action is co-signed and enforced
on-chain. Custody never moves into the protocol. Copy-trading, finally without
the custodian.

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
  a net asset value attested from a median of nine exchanges (Binance, Coinbase,
  Kraken, OKX, Bybit, KuCoin, Bitget, Gate, Bitfinex) and Uniswap v3 pools,
  verified on-chain. Backers redeem at that same NAV.
- **Skin in the game.** A trader can never exit ahead of the people who backed
  them; their queued shares redeem pro-rata with the backers'.

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

> **Fund the agent. Don't trust it.**

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
