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

- Smart contracts in `contracts/src/` deployed at the addresses listed in `@puppet/contracts/PUPPET_CONTRACT_MAP`.
- The `@puppet/sdk` runtime as published.
- Cryptographic, economic, or correctness flaws in the protocol design itself.

Out of scope:

- Issues in third-party dependencies whose disclosure should go to the upstream maintainer.
- Frontend issues that do not affect funds (UI bugs, broken links).
- Spam, social engineering, or denial-of-service against operational infrastructure.
- Issues only reproducible against forks, redeployments, or local devnets that are not the canonical Puppet deployment.

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
