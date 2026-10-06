# BECS Home — review-only implementation

## Scope

Add `/home` to the existing BecsBot Express service and a **BECS Home** link at the beginning of the terminal navigation. Keep `/` and `/terminal` serving the original terminal. Do not replace the production landing page in this change.

This is an assistant-style, mobile-friendly read-only screen. It is **not a general AI chatbot**. Questions are classified locally into status, attention, activity, usage or help. Unrecognized requests get an explicit capability explanation. No question is sent to a model or a provider, and no conversation is persisted.

The existing original artwork remains unchanged and supplies the favicon and Apple touch icon. No new mascot, third-party UI framework, dependency, application, backend service, or hosting account is introduced.

## Existing contracts reused

| Read | Purpose | When |
| --- | --- | --- |
| `GET /health` | Service reachability, reported execution-disabled flag, original scan time and source revision | Initial page load and explicit status checks |
| `GET /api/paper/capabilities` | Server-paper availability | Alongside a status check |
| `GET /api/superagent/capabilities` | Separately gated outcome-report availability | Alongside a status check |
| `GET /api/auth/status` | Existing BecsBot owner session | Only on an explicit activity request |
| `GET /api/paper/events?limit=5` | Up to five recorded owner-scoped paper events | Only after authenticated status |

The page never sends a client-selected owner, account, stream, cursor or provider. The server remains responsible for authorization. The existing sign-in link is `/api/auth/github`; its unchanged callback returns to `/terminal`, where the new BECS Home link provides a way back.

The paper event feed is not the separately provisioned observer/outcome store. Showing existing paper events neither enables that report nor proves ingestion, learning, profitability, or backup readiness. A completed-execution event is labeled “recorded,” not automatically described as a successful fill.

The page does not read or combine browser-local paper wallets, AppDeploy journals, Commas experiments or private records from another application. No wallet, strategy, account, authentication, API response schema, archive, storage, or provider configuration changes are included.

## Usage and failure boundaries

`src/web/assets/js/home-model.mjs` holds the presentation limits and exact read allowlist:

- Ten-second whole-request deadline, including streamed response bodies; one MiB maximum response size.
- One public status check and one private activity check per ten seconds per page. Only one check is in flight at a time; public status uses three bounded reads.
- Five events maximum; original source event IDs, sequences and times are retained. Payloads and account IDs are discarded before rendering.
- Two-hundred-character question limit; matching occurs on-device and questions are cleared after submission.
- No retries, background polling, remote AI, provider requests, automatic purchases, or new scan commands from this page.
- A local clock updates age labels; it does not perform network requests. The existing five-minute display-freshness cutoff does not alter trading eligibility.
- Private event details live only in DOM/memory and clear after sixty seconds, on page hiding/pagehide, offline events, or failed authentication. Request cancellation and generation checks reject late responses. Returning to a page does not silently reload private data.

These are **page-level limits, not an account-wide budget system**. Existing server scans, hosting costs, other clients and provider balances remain outside this screen. It does not claim those costs are free, that their quotas have been checked, or that a global spending ceiling is enforced.

Malformed data, unknown booleans, excessive/duplicate/out-of-order/cross-account event pages, authentication failures and unavailable reads fail closed. Unknown is not converted to disabled, zero, empty history or a successful check. Retained public status is labeled last-known after an unsuccessful check. Future scan timestamps are labeled clock mismatch. All untrusted display values use text nodes, never HTML.

## Files

Runtime: `src/web/home.html`, `src/web/assets/home.css`, `src/web/assets/js/home-model.mjs`, `home-api.mjs`, and `home.mjs`.

Existing integration points: one additive GET route in `src/api/app.js`; one navigation link in `src/web/assets/js/launch.mjs`. Existing security headers remain unchanged.

Tests: `test/unit/home.test.js`, `test/unit/home-route.test.js`, `test/e2e/home.spec.js`. The route unit test checks registration without initializing a store; it is not a substitute for real Express HTTP integration. `test/fixtures/home-preview.js` is an explicitly synthetic localhost-only review fixture, never imported by production.

## Review and validation

Prepared against `icommas1/BecsBot` main at `e6ba725b4b4a4e5990d6d35389047a39931b963c`.

The two modified existing files were retrieved through the authorized GitHub connection and reconstructed locally only after their Git blob hashes matched the retrieved originals. No full repository clone was available in this preparation environment; direct clone failed at DNS resolution.

Focused Node tests and offline DOM fixture checks are recorded in the accompanying review receipt. They do not certify the complete repository, real backend authentication, deployment, full browser HTTP/CSP behavior, WebKit, or a physical iPhone.

Before release, apply the patch to a clean checkout of the reviewed base, inspect the complete diff and any newer changes, install the locked dependencies, and run `npm run check`, `npm test`, and `npm run test:mobile`. The new Playwright spec runs through the existing fixture server and project configurations. Do not reduce assertions or alter permissions to obtain a green result.

The existing CI workflow triggers on pull requests, including drafts. CI usage and the previously failed main runs require separate verification before starting hosted jobs. This preparation does not request a workflow rerun, open a pull request, merge, deploy, activate a report, or change billing.

## Rollback

Before release, discard the unmerged patch. After a separately approved release, revert this feature's route, navigation link and newly added home assets/tests/documentation. Do not reset account data, delete retained history, change feature gates, or roll back storage to remove a screen.
