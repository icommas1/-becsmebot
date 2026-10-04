# BecsSuperAgent owner report

The first recorded-evidence view lives at BecsBot's `/superagent`, using its
existing GitHub owner session. It shows the durable observer report from
[SUPERAGENT_OBSERVER.md](SUPERAGENT_OBSERVER.md). The public HTML shell contains
no observation data. Authenticated GET requests load private pages with
`Cache-Control: no-store`; the browser retains them only in memory and clears them
when hidden or when authentication fails. Returning to a visible tab revalidates.
The report has no trade, wallet, strategy, recommendation or ingestion controls.

## Integration baseline and identity boundary

The report implementation from PR #63 at
`1d49fc693abae39a15798b4507a4f2c69649180b` and its observer dependency from
PR #61 at `5cc991446e2acb73311c1896f5379b704e3bcfae` were reconciled with
BecsBot main `7889535672eba1c0b191a870010f5fdb03884835` during fundamentals
integration. Original branch files were compared against their pinned GitHub
blobs before merging. Final CI, deployed source and runtime evidence belong in
the integration PR's release checkpoint; older branch results are prior evidence.
The source event/archive contract remains at the inspected
`9fb32fe01ef7b7b714c6a49ba84831adaf5ba9c0` revision.

The report uses the BecsBot GitHub session and persisted account directly.
The independent AppDeploy dashboard and its browser-local journal are outside
this integration. Cross-platform identity linking and an embedded AppDeploy
report are future work; email or wallet-address similarity does not establish
ownership.

## Configuration and ownership

All settings and operational limits are in `src/superagent/config.js`. Default
startup leaves the report disabled. Enabling the report requires the existing
complete server-paper authentication configuration plus:

| Variable | Purpose |
| --- | --- |
| `SUPERAGENT_REPORT_ENABLED=true` | Enable the owner report reader only |
| `SUPERAGENT_REPORT_DATABASE_URL` | SELECT-only login to the initialized, separate observer DB |
| `SUPERAGENT_SOURCE_ID` | Same source identity used by ingestion |
| `SUPERAGENT_OWNER_ID` | Exact persisted `github:<numeric-id>` matching `PAPER_GITHUB_USER_ID` |
| `SUPERAGENT_ACCOUNT_ID` | Exact existing paper account ID used by ingestion |
| `SUPERAGENT_ARCHIVE_STREAM` | Same retained archive stream used by ingestion |

The runtime reader requires no event/archive ingestion credentials and does not
load the observer CLI. Report configuration rejects the paper source database as
its target. The database binding must match source, owner, account, paper mode,
archive stream and inspected contract revision. Changing any binding fails closed.
Every request resolves the existing, unexpired HttpOnly session against the
persisted paper account and verifies owner ID, account ID and paper mode before
reading the observer store. Clients cannot choose owners/accounts/streams.

Provision the observer store and initialize/backfill it with the separately
reviewed owner-operated CLI before activating this view. The web reader performs
no DDL, account creation, checkpoint updates or ingestion. Missing schema/scope,
wrong identity, unavailable databases and malformed evidence fail closed with
fixed sanitized errors. Its PostgreSQL sessions and transactions are read-only.
Grant the report role CONNECT, schema USAGE, and SELECT on exactly
`superagent_observer_scopes`, `superagent_observer_purchases`, and
`superagent_observer_outcomes`. Do not grant ingestion or schema-owner rights.
The observer initializer adds an outcome pagination index without deleting data;
the report role cannot create that index.

The source's documented capacity block and production backup gap are unresolved.
This integration does not provision resources on that volume, resume archive
capture, change secrets or enable the observer/report gates. The deployed
report shell explains when the report is disabled.

## Report behavior

`GET /api/superagent/capabilities` returns only the availability flag.
`GET /api/superagent/report` returns the strict `superagentReport` schema, scoped
on the server. Optional `purchaseAfter` and JSON `outcomeAfter` query values are
bounded, validated delivery cursors. Purchases and outcomes have independent
100-row pages in a repeatable-read snapshot per request. More-purchases and
more-outcomes controls advance their own lists. No provider is contacted by the
report; old retained observations stay old and are shown with original UTC times.

The view shows recorded purchase/sale decisions, fill quantities, gross values,
fees, strategy versions and original event/hash references. Archived market marks
show their source/time and price divided by recorded entry price, with the
explicit limitation that this is not a realized return or executable quote.
Sale outcomes link to their originating purchase reference; they do not calculate
P/L. Missing observations do not become losses. Paper labels remain explicit,
live evidence is unsupported, hypotheses remain empty, and learning/predictive
improvement remain not evaluated. Provider/client text is rendered as text.

Coverage shows committed ingestion checkpoints, not current source heads or
continuous freshness. Pagination requests are separate snapshots; refresh restarts
both lists and includes any newly backfilled outcomes that precede a previous
cursor. A failed page leaves only previously loaded cards with an unavailable
status. Refresh, hidden-tab return and failed authentication clear the view.
One report read runs at a time, with bounded request rate and DB/client timeouts.
Shutdown closes the report pool along with the existing stores.

## Validation and smallest remaining step

HTTP tests cover feature gating, absent/other-owner sessions, wrong account/mode,
cross-site requests, rejected client scope selection, invalid cursors, concurrent
reads, rate limits, strict response validation and sanitized failures. Disposable
PostgreSQL tests exercise a real SELECT-only login, no initialization on a missing
schema, equality with the ingested report after reader restart, denied mutations,
and persisted session/account mapping with sign-out revocation. Existing ingestion
recovery, duplicate protection and source immutability regressions remain in place.
Browser tests cover independent pages, source references, text escaping, empty and
unavailable states, authentication expiry, native mobile controls and overflow.
Each browser context receives its own fixture scan, preserving its ETags and
original observation timestamps. A regression verifies that later contexts get
fresh fixture observations while old observations remain stale. Production
freshness rules and market behavior are unchanged.

Local Node validation can run without production credentials. PostgreSQL and
mobile/desktop browser results must be verified in CI for the final PR head.
Production report availability, owner sign-in on the deployed origin, capacity,
observer provisioning, backfill and backup restore remain operational prerequisites.
The observer/report implementations are now reconciled with current BecsBot main
in the fundamentals integration. Production activation still needs an independent
observer provisioning/backfill plan with backup verification. An
AppDeploy identity bridge is unnecessary for this first same-origin owner view.
