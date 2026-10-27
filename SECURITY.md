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
- The website's release check: its service worker and the `release.json` it verifies. A flaw that lets an unapproved bundle run affects funds, because that bundle asks users to sign.
- Cryptographic, economic, or correctness flaws in the protocol design itself.

Out of scope:

- Issues in third-party dependencies whose disclosure should go to the upstream maintainer.
- Frontend issues that do not affect funds (UI bugs, broken links).
- Spam, social engineering, or denial-of-service against operational infrastructure.
- Issues only reproducible against forks, redeployments, or local devnets that are not the canonical Puppet deployment.

## Trust model

Three roles take part in every action:

- **User.** Chooses what to do in the UI and signs it: an intent for one action, or a standing mandate for a master's fund. A signature comes from the wallet's own key or from a session key that key granted, and the attestor co-signs nothing else: wallets must sign with their own key, so contract wallets such as multisigs and passkey wallets are not supported, while an EIP-7702 wallet that keeps its key is. The account contract still has a path for a contract wallet's own signature form (an ERC-1271 check, marked with a fixed tag), but the attestor co-signs nothing that uses it.
- **Attestor.** Appointed by a governance vote to execute intents. Before co-signing, it simulates the call against the state it will land on, then relays it and is paid the relay fee the user signed.
- **Governance.** Deploys and upgrades the protocol contracts and keeps the token registry. It holds no signature over any account.

### Fundamentals

1. **Consent is a signature.** Gate code moves value only when the owner of that value signed for it. No role, governance included, holds an account key. The attestor alone moves no value: escrow is released against a total the owner signed and returns to the owner's wallet on the owner's own call; the other paths that move value without the owner's signature are listed under Current limits.
2. **Every intent is spent once and expires.** An account builds the digest it verifies from its own address, chain, current nonce and the intent's deadline (both packed into the EIP-712 domain salt), so a signature is used the moment it lands, can never be replayed or moved to another account or chain, and is refused by the account itself once its deadline passes.
3. **The account checks consent itself.** Accounts accept two kinds of consent and verify both in their own code: a fresh intent signed by the owner and co-signed by the attestor, and a standing mandate. Under a mandate the account allows exactly one thing: a transfer of the puppet's tokens to the master the mandate names, while the mandate is unexpired and the puppet's signature still verifies. A mandate signature is bound to the hub chain, so it can only be granted and used there. Accounts cannot call the account module, so a master can never trigger a mandate from its own trades; the fund logic does, after checking the mandate's rules. Upgradeable code decides how much a round takes, never where the money goes.
4. **Incentives, not freezes.** Governance may swap logic by a public vote at any time, and a vote settles as soon as votes for reach the quorum of 1 PUPPET with two thirds of the votes cast, which the deployer's one PUPPET does alone. The question for every path is not whether governance can change code, but whether it can move value to itself with nobody's consent. Every path must need the signature of the party whose value moves. A path that needs a master's signature can only benefit that master, whom the puppet chose to trust.
5. **Mandates bound speed, not outcome.** A mandate protects a puppet from instant theft: each round takes at most the mandate's share of the puppet's balance, with a cooldown between rounds. Slow loss through poor or hostile trading shows on chain round by round and leaves the puppet time to react. Upgradeable fund logic enforces the mandate's share, cooldown and expiry and pays only into the fund the mandate names; expiry or a revoke from the puppet's wallet ends a mandate.
6. **The attestor vetoes and cannot author.** It signs the same digest the user signs, so it can refuse any action an owner starts and cannot author one, and on its own signature it moves no value. A fund's body is an EIP-7702 account whose key is 2-of-2: the owner's device holds one half, derived from a signature of the owner's wallet, and the attestor's key service holds the other, so neither signs for the fund alone. Before it co-signs a fund's opening or a round, the attestor proves that the fund's address is formed by those two halves, so no master can open or fill a fund on a key it holds alone. A round credits escrow against a running total the owner signs, with any signature the owner's account approves, less a relay fee of at most a tenth: hub escrow is released in the same transaction, and escrow on another chain only once it has been released into the fund's body there, which the attestor checks before it co-signs. The owner's wallet takes open escrow back a day after asking, and later redemption cohorts need no signature at all.
7. **No shutdown or migration machinery.** Stopping the protocol is an upgrade that stops new operations, and users leave with their own signatures.
8. **Immutable code stays small.** Accounts and the account module only check what an owner signed. Every other rule lives in the upgradeable gates, where it can be fixed without touching anyone's account.

### Current limits

Known, tracked and not yet closed, measured against the fundamentals above:

- A GovernorAccount on each chain, at one address everywhere, is the protocol's authority: it upgrades every gate and module, grants access and receives the protocol's fee share, and it runs only what a passed PUPPET vote on Ethereum bridges to it. Website releases are approved on Ethereum itself (Website releases, below). While power is unshared, the founder's deployer key holds the one liquid PUPPET, which alone meets the quorum of 1 PUPPET, and the other 99,999,999 sit idle in the Governor until a passed proposal moves them. A vote opens a second after its proposal and settles as soon as votes for reach the quorum with two thirds of the votes cast; votes against count only when cast before it settles, and a proposal short of the quorum fails after two weeks. Any proposal that sends PUPPET out of the Governor must first raise the quorum in the same vote, or its recipient could settle votes alone; that is a rule for how proposals are built, not a check the Governor makes. So every change is a public vote on Ethereum, and one key decides it as soon as it votes, plus the bridge's time.
- An intent signature covers the intent, not the calls built from it. Accounts refuse an intent after its signed deadline, so a signature only ever runs under the code that was live when it was signed, provided upgrades wait longer than the longest intent (the chain accepts deadlines up to 10 minutes; the site signs 5 minutes, and 30 seconds for intents that carry a price, which the attestor refuses past 60 seconds). A vote can settle a second after its proposal, so with the bridge an upgrade can land while an intent signed under the old code is still valid (first limit).
- The puppet's own account bounds only a pull's shape: one token transfer with no ETH attached. Its destination, amount and timing are the fund logic's, which is upgradeable, so a changed rule could send a puppet's balance anywhere through mandate pulls. This is an accepted risk: such a change is a public vote, and while one holder holds the quorum it settles as soon as that holder votes.
- Escrow sits in a store on each chain. A round credits it against a running total the owner signed, with any signature the owner's account approves (the wallet, or a live session), so a replayed or lower total is refused: hub escrow is released in the same transaction, and escrow on another chain is credited only after a relayed release has moved it into the fund's body on that chain. The attestor co-signs such a round only when that chain's release into the body equals the credit's total and fee total, so the hub never mints shares against escrow that could still go elsewhere; until a round credits it, released value counts as the owner's, never the fund's. A body the owner holds alone can receive only the owner's own escrow, and the one-day return cannot reach anything credited, since nothing is credited before its release. A hub credit bills exactly the master's slice of the round's fee; a credit from another chain bills at least that slice, and whatever its release paid beyond it comes out of the master's mint, so puppets never pay for the release. The store books nothing it did not receive, returns open escrow only to the wallet of the account that committed it, a day after that wallet asks, releases it only into a fund bound to that account, and routes at most a tenth of a release as fee to a receiver fixed at deployment. New escrow cancels a pending reclaim, and escrow released during that day is not returned. Upgradeable gate code therefore decides when escrow moves and how much, never where it goes. A sell queues shares in its fund's exit queue, and a redemption the master signs pays the whole queue at one price, in the one canonical hub token it names, together with the same fraction of every stake when the master redeems everyone. Queued holders leave only through a redemption the master signs, so the master can delay their exits. The opening transaction moves the redemption's pot into the shared fund store, booked for that fund, and pays the first cohort. Anyone can pay the rest in later cohorts, and the attestor does, the master last; the order of the cohorts changes when a holder is paid, never what it gets. The master's own exit is symmetric: it joins a queue-only redemption with at most its pro-rata share of it, and otherwise exits only by redeeming the same fraction of every stake, its own included, so no holder's ownership relative to the master changes by the master's exit. A partial exit is refused while the queue beside it is worth at most one relay fee, so the master never exits beside a queue that would be cut; this never refuses a full exit. The cohort lists are supplied by the attestor, not proven complete on chain: a holder left out stays owed, and the redemption stays open until it is paid. Each holder is paid its claim less its performance fee and one relay fee. The performance fee is the fund's rate on the holder's own gain: the redemption's price per share above the holder's average entry price, on the shares that exit, so a holder at or below its entry price pays none and holders who joined at different prices never pay each other's fees. The master's part of those fees is paid with its own payout into the master's Puppet account when the redemption closes, and the protocol's cut goes to the protocol fee receiver, the chain's GovernorAccount, fixed in the redemption logic. A claim worth at most one relay fee is cut whenever a cohort reaches it: it pays nothing, burns none of its shares, keeps its place in the queue, and its part of the pot returns to the fund. Once the unpaid pot is worth at most one fee, the remaining holders are cut the same way: that pot returns to the fund, and they keep their shares and their place in the queue. Payouts are transfers of that token. A payout the token refuses while the fund store holds it, such as one to a payee the token's issuer froze, is cut the same way: the holder is paid nothing, keeps its shares and its place in the queue, and its part of the pot returns to the fund, so the redemption goes on. The master's close-out, the cut back to the fund and the fees still have to transfer, so a token freeze of the master's Puppet account, of the fund itself or of a fee receiver would still hold the redemption open.
- Only a fund's own account can mint its shares and allow their burn, and holders can only move their shares into the fund's exit queue. On chain, a master's swap must spend its signed input exactly and, on the same chain, return at least its signed output. Which contract the swap calls is the attestor's screen, not the chain's: it co-signs only declared swap routers, the wrapped-native contract and Across. So it is the attestor that keeps a swap from calling the fund's own share token or handing fund money to an arbitrary contract.
- A wallet approval given to the deposit module can be spent by it while it stands. The site approves the exact amount right before each deposit.
- Gate code and the attestor carry every routine move, so governance, which upgrades gate code by vote, or the attestor can hold a balance. A user's own account balance has a way out: the user's wallet can revoke on any chain at any time (`revokeSessions`). A revoke ends every session of that chain's account ten minutes later, and on the hub every mandate at once; for the next ten minutes the wallet can withdraw the account's balance to itself directly (`UserAccount.withdraw`), with no other signature; a later revoke opens a new window. The attestor co-signs nothing for that account until the window closes, which is the attestor's rule, not the chain's. The revoke and the withdrawal sit in the account itself, so no upgrade can take them away. Fund holdings still leave only through gate code and the attestor; open escrow returns through gate code on the wallet's own call, a day after it asks. While one holder holds the quorum, an access grant that holder votes through can also let a contract pay out what the fund store holds, such as open redemption pots, to any address (`FundStore.pay`).
- Revoking a session applies only on the chain where it is revoked, and takes effect after a 10-minute grace window, so intents the attestor already sent can still land. A leaked session key stays usable for that window. A wallet grant that names a fund stays that fund's approval for good: revoking ends the session, never the fund's binding to its owner.
- A session acts for the whole account. Besides operating the fund it can sign the account's own mandates, sells and credit totals, so a leaked session key can allocate the account's balance to another master's fund, within that mandate's rate and cooldown, or credit the owner's own escrow into the owner's fund. A same-chain withdrawal pays only the account's own wallet; a cross-chain withdrawal's recipient sits in the provider calldata the attestor builds, so the attestor's screen keeps it to the owner's wallet.
- An agent never holds a key or a session. A linked agent asks the open app to act, and the app runs each request with the owner's session in that fund, one at a time and without a prompt, after screening and simulating it like the owner's own. A linked agent can therefore do in that fund whatever the owner's session can while the app is open, so owners should link only agents they run themselves. The link is local: the app dials 127.0.0.1, both sides prove the link's secret by HMAC, and the owner can disconnect or revoke it in the app.

### How to audit a proposal

Every change to the protocol is a proposal on the Ethereum Governor, so what a vote installs can be checked.

1. **What a proposal carries.** Each action either calls one chain's native bridge (OP's portal deposit, Arbitrum's and Robinhood's retryable tickets, Polygon's FxRoot), carrying one batch of calls for that chain's GovernorAccount, which refuses the batch after its deadline; or it calls a contract on Ethereum itself, such as the Governor's own settings or a Token transfer.
2. **Its source.** The description's second paragraph reads `Source: https://github.com/PuppetCopy/puppet.fund/tree/<commit>/contracts`. The deploy script proposes only from a committed contracts tree, names that commit, and proposes only once everything the proposal installs is verified on its chain's explorer (Etherscan; Sourcify for Robinhood Chain). The commit is public once pushed: the v39 wiring vote's commit is pushed after the draft is checked, so its Source link resolves from then on.
3. **Decode it** on puppet.fund/governance, or with the audit command. Set `RPC_<chainId>` to an archive RPC for chains 1, 10, 137, 4663 and 42161, and `ETHERSCAN_API_KEY`, then run `bun puppet.fund/sdk/src/governance/audit.ts <proposal id> --artifacts <your prod build output dir>`; it also takes the forge broadcast JSON of a propose run. It lists every call on every chain: the contract, the function and its arguments, the function each access grant allows, and the state each call changes now. Without `--artifacts` it skips the source match and the constructor arguments.
4. **Check each implementation it installs.**
   - Its verified source and compiler settings: solc 0.8.36, via-IR, Prague, 1000 optimizer runs, no metadata hash.
   - Its creation transaction, from the chain's own history: the CREATE2 factory `0x0000000000FFe8B47B3e2130213B802212439497`, the salt (the universe version) and the init code, whose CREATE2 address is the implementation's.
   - A rebuild. At the Source commit, run `cd contracts && forge build --optimizer-runs 1000`. The init code must begin with your build's creation code. The constructor arguments follow it, and the audit command decodes them: HubGate's carry the attestor, the fee receiver, the gas limit, the intent lifetime, the fee caps, the attestor endpoints, the canonical tokens, the cohort size and the performance fee, plus a website release that no app reads since the `Release` registry, which v40 removes. Explorers show no constructor arguments for contracts a factory creates, so this rebuild is the only way to see them.
5. **Timing.** A vote opens a second after its proposal and can run two weeks, but it settles as soon as votes for reach the quorum: today 1 PUPPET, held by the deployer. So today an audit reviews what already passed. Once PUPPET is shared and the quorum raised, the vote is the window to vote against it.

### Website releases

The site runs only a release that a governance vote approved, and a service worker checks it on every device.

1. **What a vote approves.** A release is a vote on Ethereum calling `Release.approve(hash)` on the `Release` registry (`0xFbbA28689B6C1bF7828451250B003831D3Ba09D4`), which only the Governor can call; `current()` reads the approved hash, and no bridge or gate is involved. The hash is the sha256 of `release.json`, which lists the release's version and the sha256 of every file the site serves (videos excepted), the service worker included. The approval the app reads (the registry, its `current()` call and two public Ethereum RPCs) is built into that worker, which each release ships under a new content-hashed URL. The vote's description links the website source commit (`.../tree/<commit>/website`).
2. **What the app checks.**
   - The worker asks two public Ethereum RPCs, run by different operators, for the block number and then for `current()` at that block, and refuses an answer from a block older than the one its last accepted check settled on (the lower of that check's answers; a release naming a different first RPC starts over).
   - When both answer, they must agree; when one fails, the other decides.
   - It answers same-origin GET requests for documents, scripts, styles, images, fonts, the manifest and workers, serving only bytes whose sha256 is in the approved list and an error otherwise. `/api`, `/health`, `release.json` and videos pass through unverified, as does any data the app fetches. It never takes trust from the browser's cache, which page scripts can write.
   - A navigation the worker does not serve from the release (a non-GET one, or one to `/api`, `/health` or `release.json`) never runs as a page: a non-GET navigation gets 405, and the others show as plain text in a sandbox.
   - Its responses add `frame-ancestors 'none'`, `X-Frame-Options: DENY`, a cross-origin opener policy and `nosniff`.
   - If a worker replaces it at the same URL, the page deletes its stored keys (fund key shares, approvals, the session key, agent links and WalletConnect storage) and leaves.
3. **Accepted limits.**
   - A first visit, or a hard reload that bypasses the worker, trusts the server.
   - Online, when the approval cannot be read, the site is served from the server unverified, never from the cache.
   - Offline, a self-consistent fake release planted in the cache can boot, marked unverified, until the next successful check reloads the windows.
   - A `Clear-Site-Data` header on a same-origin response can drop the stored release.
   - The same-URL takeover guard protects pages that are open when a replacement worker arrives. A replacement that installs and takes control before a page's first script runs goes undetected, since a page cannot read a worker's bytes and the URL is the same.
   - Either public RPC can fail or refuse; the worker then takes the other's answer alone, trusting its operator. A forged approval still needs the server to serve the forged files.
   - While the deployer's one PUPPET meets the quorum, a release passes the moment the deployer votes.
4. **How to audit a release.**
   - Decode the vote: `Release.approve(hash)` on Ethereum.
   - Check that the sha256 of `https://puppet.fund/release.json` equals `Release.current()`.
   - Check that each served file's sha256 is the one `release.json` lists.

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
