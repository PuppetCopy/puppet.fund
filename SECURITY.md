# Security Policy

## Reporting a vulnerability

Email **dao@puppet.fund** with subject line `[SECURITY] Puppet Protocol - <short summary>`.

Include:

- Affected component (contract, SDK, frontend) and commit hash or deployed address.
- Reproduction steps or proof-of-concept.
- Your assessment of impact (funds at risk, scope of affected accounts, ease of exploitation).
- Whether you intend to publish, and a proposed coordinated disclosure window.

Encrypt sensitive details with the PGP key published at `puppet.fund/.well-known/pgp.asc` if available; otherwise plain email is acceptable for the initial contact and a secure channel will be set up before details are exchanged.

## Scope

In scope:

- Smart contracts in `contracts/src/` deployed at the addresses listed in `contracts-manifest/src/deployments/index.ts`.
- The `@puppet/sdk` runtime as published.
- Cryptographic, economic, or correctness flaws in the protocol design itself.

Out of scope:

- Issues in third-party dependencies whose disclosure should go to the upstream maintainer.
- Frontend issues that do not affect funds (UI bugs, broken links).
- Spam, social engineering, or denial-of-service against operational infrastructure.
- Issues only reproducible against forks, redeployments, or local devnets that are not the canonical Puppet deployment.

## Trust model

Three roles take part in every action:

- **User.** Chooses what to do in the UI and signs it: an intent for one action, or a standing mandate that backs a master's fund. A signature comes from the wallet or from a session key the wallet granted. A wallet that is a contract (a multisig, a passkey wallet) may also sign in its own form, marked with a fixed tag: the account then asks the wallet's own ERC-1271 check, so the wallet must exist on the chain where the signature is used.
- **Attestor.** Appointed by governance to execute intents. Before co-signing, it simulates the call against the state it will land on, then relays it and is paid the relay fee the user signed.
- **Governance.** Deploys and upgrades the protocol contracts and keeps the token registry. It holds no signature over any account.

### Fundamentals

1. **Consent is a signature.** Value moves only when the owner of that value signed for it. No role, governance included, holds a key or a switch over any account.
2. **Every intent is spent once and expires.** An account builds the digest it verifies from its own address, chain, current nonce and the intent's deadline (both packed into the EIP-712 domain salt), so a signature is used the moment it lands, can never be replayed or moved to another account or chain, and is refused by the account itself once its deadline passes.
3. **The account checks consent itself.** Accounts accept two kinds of consent and verify both in their own code: a fresh intent signed by the owner and co-signed by the attestor, and a standing mandate. Under a mandate the account allows exactly one thing: a transfer of the backer's tokens to the master the mandate names, while the mandate is unexpired and the backer's signature still verifies. A mandate signature is bound to the hub chain, so it can only be granted and used there. Accounts cannot call the account module, so a master can never trigger a mandate from its own trades; the fund logic does, after checking the mandate's rules. Upgradeable code decides how much a round takes, never where the money goes.
4. **Incentives, not freezes.** Governance may swap logic at any time, behind its delay. The question for every path is not whether governance can change code, but whether it can move value to itself with nobody's consent. Every path must need the signature of the party whose value moves. A path that needs a master's signature can only benefit that master, whom the backer chose to trust.
5. **Mandates bound speed, not outcome.** A mandate protects a backer from instant theft: each round takes at most the mandate's share of the backer's balance, with a cooldown between rounds. Slow loss through poor or hostile trading shows on chain round by round and leaves the backer time to react. A backer revokes by signing the mandate again with an expiry of zero, and a mandate signed with a session key also stops when that session ends, or once its revocation takes effect.
6. **The attestor vetoes, it never acts.** It signs the same digest the user signs, so it can refuse an action but cannot author one, and its signature alone moves nothing.
7. **No shutdown or migration machinery.** Stopping the protocol is an upgrade that stops new operations, and users leave with their own signatures.
8. **Immutable code stays small.** Accounts and the account module only check what an owner signed. Every other rule lives in the upgradeable gates, where it can be fixed without touching anyone's account.

### Current limits

Known, tracked and not yet closed, measured against the fundamentals above:

- `Dictate` applies upgrades and access grants at once; the delay belongs to its owner. While versions are drafted the owner is a single key, so upgrades take effect immediately. A settled version is owned by a governance contract with its own timelock.
- An intent signature covers the intent, not the calls built from it. Accounts refuse an intent after its signed deadline, so a signature only ever runs under the code that was live when it was signed, provided the governance timelock outlasts the longest intent (the chain accepts deadlines up to 10 minutes; the site signs 5 minutes, and 30 seconds for intents that carry a price, which the attestor refuses past 60 seconds). That holds only once the owner is the timelocked governance contract (first limit).
- How much a mandate pull takes is set by upgradeable code, so a changed rule could over-allocate a backer into the fund they chose, but never send their funds anywhere else.
- Escrow sits in a store on each chain until its round releases it. The store books nothing it did not receive, returns escrow only to the wallet of the account that committed it, releases it only to a fund that account opened, and routes at most a tenth of a release as fee to a receiver fixed at deployment. Upgradeable gate code therefore decides when escrow moves and how much, never where it goes. A sell queues shares in its fund's exit queue, and a redemption the master signs pays the whole queue at one price, in the one canonical hub token it names, together with the same fraction of every stake when the master redeems everyone. The opening transaction moves the redemption's pot into the shared fund store, ring-fenced for that fund, and pays the first cohort. Anyone can pay the rest in later cohorts, and the attestor does, the master last; the order of the cohorts changes when a holder is paid, never what it gets. The master's own exit is symmetric: it joins a queue-only redemption with at most its pro-rata share of it, and otherwise exits only by redeeming the same fraction of every stake, its own included, so no holder's ownership relative to the master changes by the master's exit. The cohort lists are supplied by the attestor, not proven complete on chain: a holder left out stays owed, and the redemption stays open until it is paid. Each holder is paid its claim less its performance fee and one relay fee. The performance fee is the fund's rate on the holder's own gain: the redemption's price per share above the holder's average entry price, on the shares that exit, so a holder at or below its entry price pays none and holders who joined at different prices never pay each other's fees. The master's part of those fees is paid with its own payout when the redemption closes, and the protocol's cut goes to the protocol fee receiver, the governance address, fixed in the redemption logic. A claim worth at most one relay fee settles for nothing. Once the unpaid pot is worth at most one fee, the remaining holders are cut instead: that pot returns to the fund, and they keep their shares and their place in the queue. Payouts are transfers of that token. A WETH payout cannot be refused, but a payee frozen by the token's issuer reverts its cohort, so the redemption stays open and the fund can neither allocate nor redeem until the freeze lifts. This risk is accepted: a fund holding that token already carries its issuer.
- Only a fund's own account can mint its shares and allow their burn, and holders can only move their shares into the fund's exit queue. On chain, a master's swap must spend its signed input exactly and, on the same chain, return at least its signed output. Which contract the swap calls is the attestor's screen, not the chain's: it co-signs only declared swap routers, the wrapped-native contract and Across. So it is the attestor that keeps a swap from calling the fund's own share token or handing fund money to an arbitrary contract.
- A wallet approval given to the deposit module can be spent by it while it stands. The site approves the exact amount right before each deposit.
- Every balance, user accounts included, leaves only through gate code and the attestor, so governance or the attestor can freeze it. There is no self-serve exit yet.
- Revoking a session applies only on the chain where it is revoked, and takes effect after a 10-minute grace window, so intents the attestor already sent can still land. A leaked session key stays usable for that window. A wallet grant that names a fund stays that fund's approval for good: revoking ends the session, never the fund's binding to its owner.
- A session acts for the whole account. Besides operating the fund it can sign the account's own mandates and sells, so a leaked session key can back another master's fund with the account's balance, within that mandate's rate and cooldown. Withdrawals still pay only the account's own wallet.
- An agent never holds a key or a session. A linked agent asks the open app to act, and the app runs each request with its own session, one at a time and without a prompt, but only within the scopes the owner approved when the agent connected: trade, run rounds, redeem. An approved agent can therefore trade within the venue screens, credit rounds from the owner's capital or pay redemptions while the app is open, so link only agents you run yourself. The link is local: the app dials 127.0.0.1, both sides prove the link's secret by HMAC, and the owner can disconnect or revoke it in the app.

## Disclosure

We aim to acknowledge reports within 72 hours and to provide an initial triage decision within 7 days. We coordinate disclosure timing with the reporter and ask that public disclosure wait until a fix is deployed or 90 days have passed, whichever is sooner.

## Bounty

There is no formal bounty program at this time. The Licensor may, at its discretion, offer a discretionary reward for high-impact reports that follow this policy.

## Safe harbor

The Licensor (puppetdao.eth) will not pursue civil or criminal action against good-faith security research that:

- Targets only systems owned or operated by the Licensor (the canonical Puppet Protocol deployment and `puppet.fund` infrastructure).
- Does not exfiltrate, modify, or destroy user data beyond what is strictly necessary to demonstrate the issue.
- Does not exploit the vulnerability for financial gain beyond a returned proof-of-concept transaction.
- Reports the issue through this policy and provides a reasonable disclosure window.

This safe harbor does not apply to research targeting third parties, forks, or unaffiliated deployments.
