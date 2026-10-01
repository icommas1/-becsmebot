# Security policy

## Scope

BecsBot is currently a public market-data and paper-trading application with local wallets and an optional private GitHub-authenticated server paper account. The repository contains no wallet signer or live execution engine. A change that introduces custody, signing or live-order capability is a security-sensitive product change and must not be treated as routine maintenance.

## Reporting

Do not open a public issue containing credentials, exploit details that expose users, or personal wallet data. Use the repository owner's GitHub Security Advisory reporting channel when available. Otherwise, open a minimal issue requesting a private security contact without including the sensitive details.

If a credential is found in repository history, redact it from discussion, revoke or rotate it at the provider, and then address repository history separately. Removing a value from the latest commit does not make the credential safe again.

## Supported version

The `main` branch is the only supported code line. Security fixes should include a regression test when one can be written without reproducing a real secret or invoking live execution.

## Security invariants

- Provider credentials stay server-side and are read only from environment variables.
- Seed phrases, private keys, keypairs, wallet exports, session secrets and authentication tokens must never enter source, fixtures, logs or browser storage.
- Successful API and provider payloads are schema-validated without coercion. Invalid data remains unavailable rather than receiving a fabricated fallback.
- Real order and pause compatibility paths remain disabled with HTTP 410.
- CI, browser tests and smoke checks require no wallet and cannot make live trades.
- Production smoke checks are read-only and accept only a plain HTTP(S) origin without embedded credentials.

## Deployment responsibility

Railway variables, access controls, volume attachment and GitHub branch/ruleset configuration are external to this repository. Operators should restrict access, rotate provider keys when exposure is suspected, keep the persistent data volume mounted at the configured `DATA_DIR`, and review dependency alerts before merging updates.


Server account routes require the configured GitHub numeric owner ID, opaque expiring sessions, and same-origin writes. OAuth client secrets stay in Railway; no GitHub repository scope is requested. Session tokens are HttpOnly cookies, stored only as hashes in PostgreSQL. Browser wallet data is never trusted as authenticated ownership or imported into the server ledger. Auth remains gated off until configuration is complete.
