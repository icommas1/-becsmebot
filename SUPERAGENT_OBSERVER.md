# BecsSuperAgent recorded-evidence observer

This phase supplies a separate, owner-operated backend observer and paginated
report contract. It reads BecsBot's retained server-paper BecsEvents and research
archive, and writes observation state only to a separate PostgreSQL database.
It is installed in this repository so its source contracts and tests are reviewed
together. It is not imported by `src/basket.js`, and does not deploy or change the
BecsSuperAgent dashboard. There is no HTTP ingestion endpoint or automated job.

## Verified prerequisites and boundaries

- Baseline: BecsBot main `9fb32fe01ef7b7b714c6a49ba84831adaf5ba9c0`, incorporating
  merged archive-retrieval/recovery PR #60. The starting main `cdf1222` was checked
  byte-for-byte; #60 merged during this phase and its updated source was fetched,
  inspected and incorporated before final validation. BecsEvent and archive
  envelope/payload contracts remain compatible. Existing unfinished local work
  and open PRs #57, #58 and #59 were preserved; this phase does not depend on them.
- BecsSuperAgent's applied AppDeploy source snapshot `1791128821011` contains a
  React preview, market readers and optional AI analysis, with browser-local paper
  journals. It has no durable BecsBot ingestion, repository instructions or linked
  GitHub-owner identity. Existing illustrative "BecsBot Buy" cards are demo data.
- BecsEvent schema version 1 records only committed authenticated server-paper
  commands. Decision, intent and execution records commit with the ledger. Failed
  attempts and browser-local trades are absent. Never infer purchases from Radar,
  Signals, Smart Wallet flow, demo cards or the current balance.
- Market archive payload version 1 supplies sampled Radar marks, not candles or
  executable quotes. The archive can be paused without deleting history; this
  observer neither resumes capture nor reconstructs missing observations. Current
  operations documentation reports a storage-capacity block and no independent
  production backup. A separate observer store must not be provisioned on that
  constrained source volume as part of this review-only delivery.
- `contractRevision` identifies the inspected source contract. It does **not**
  prove the deployed commit that produced an individual historical purchase.
  BecsEvents lack that per-event build linkage. Source references retain IDs,
  sequences, payload/envelope hashes, and strategy versions for retrieval.

## Configuration and operation

All new configuration and limits live in `src/superagent/config.js`; BecsBot's
existing configuration, strategy and execution path are untouched. Disabled is
the default. Provide the following variables privately to the observer process:

| Variable | Purpose |
| --- | --- |
| `SUPERAGENT_OBSERVER_ENABLED=true` | Enable only the separate CLI |
| `SUPERAGENT_SOURCE_ID` | Stable, operator-controlled source deployment identity |
| `SUPERAGENT_OWNER_ID` | Exact persisted BecsBot user ID, normally `github:<numeric-id>` |
| `SUPERAGENT_ACCOUNT_ID` | Exact existing server-paper account ID |
| `SUPERAGENT_ARCHIVE_STREAM` | Exact retained archive stream |
| `SUPERAGENT_EVENT_DATABASE_URL` | SELECT-only connection to the BecsEvent database |
| `SUPERAGENT_ARCHIVE_DATABASE_URL` | SELECT-only archive connection; may share the event database |
| `SUPERAGENT_DATABASE_URL` | Separate observer database, writable only by its owner-operated process |

Source roles need SELECT on `paper_accounts`, `becs_event_streams`, `becs_events`,
`research_archive_streams`, `research_archive_records`, and
`research_archive_payloads` as appropriate. They need no source DML, DDL, account
commands, provider credentials, OAuth tokens, wallet keys or network market APIs.
Source pools force read-only transactions and session defaults. The target
connection initializes the additive observer schema; provision it separately in
a later authorized operational phase. Do not supply production credentials to
tests. Host/database identities must differ from the target even if credentials
or URL options differ; operators must also avoid aliases pointing to the same DB.

Run `node scripts/observe-becsbot.js ingest` to commit at most four pages. Each
invocation resumes persisted cursors; `complete` means caught up to the source
heads read during that invocation, not continuous or future coverage. There are
no automatic external retries. Repeat explicitly when more retained pages remain.
CLI errors are fixed codes and never include database URLs or raw DB exceptions.

Run `node scripts/observe-becsbot.js report` for the first owner-scoped report
page. For additional pages use `createObserver(config).report({purchaseAfter,
outcomeAfter})` with its returned independent cursors. Reports use a repeatable-read
snapshot, include source references and separately paginated purchases/outcomes,
and disclose that current source heads are not queried by the report. JSON output
is private owner data; a future authenticated UI must verify the ownership mapping
before exposing it. No public ingestion/report endpoint exists in this phase.

## Ingestion, recovery and retention

The configured owner must resolve to the exact source account. Scope keys bind
source, owner, account and explicit paper mode; changed archive/contract bindings
fail instead of reusing another scope. Every event in the owner stream is checked
for hash continuity, including unprojected events and other account records.
Purchase observations require the matching adjacent decision, intent and filled
paper execution with matching request, account, side and strategy. Durable context
survives pagination and restart. A source reset separates later sale attribution
from earlier purchases; it never deletes history or fabricates an exit.

Event backfill precedes archive ingestion. A newly discovered purchase resets the
archive cursor to genesis, retaining existing observations, to handle source
transaction delay and previously ingested market outcomes. Duplicate source IDs
use permanent unique keys; changed evidence fails closed. Copied evidence and its
cursor commit in one target transaction under the scope lock. A crash before
commit rolls both back; a crash after commit before acknowledgment resumes without
duplicating evidence. Separate workers serialize schema initialization and then
work on that same persisted scope. Purchase and outcome report cursors are
independent, so either history can be paged without dropping the other.

Archive verification checks ordered envelopes, compressed payload hashes/sizes
and stream head continuity. Missing streams/payloads, gaps, changed anchors,
unknown market payload versions and ambiguous marks stop the page without
advancing its cursor. Hash consistency is tamper evidence, not authentication of
provider truth or an independent external attestation. Already checked source
prefixes are not fully re-read on every restart; operators still need independent
backups and integrity audits against privileged database modification.

Only canonical, positive, nonsuspicious marks observed strictly after a purchase
and within the source's 180-second freshness rule are outcomes. Their original
observed time remains unchanged. Missing/stale/future-dated marks are skipped;
they do not become losses, zeros or fresh prices. Outcomes for unpurchased assets
are not retained. Private provider bodies, wallet intelligence and arbitrary
payload fields are not copied.

The observer has **no pruning or expiry path**. PostgreSQL guards observations
against UPDATE, DELETE and TRUNCATE. Processing/reporting limits never remove
permanent history: pages resume, and excessive Radar/matched-purchase cardinality
fails explicitly. Scope cursors are mutable delivery state, not history. The
database and independently tested backups must persist across restarts; a volume
alone is not a backup. Any destructive retention policy needs a separate decision.

## What the evidence means

`recorded-paper-purchase` and `recorded-paper-sale` describe BecsBot's recorded
simulated fills and fees. A sale observation is linked to the preceding purchase
within the same account/reset period; it is not a newly calculated realized P/L.
`observed-market-mark` reports a sampled price and its ratio to the recorded entry
fill price. This excludes fee/slippage accounting and does not assert portfolio
value, executable returns, lifetime peaks or future performance. Marks can remain
interesting after an exit/reset; their scope is the original research purchase.

All observations retain explicit paper provenance. A live result in the existing
paper contract fails closed; no verified live source contract exists yet. Reports
contain no hypotheses or recommendations and label learning and predictive
improvement as "not evaluated". Nothing can write strategy/configuration, create
OrderIntents, invoke an executor, sign or submit transactions.

## Validation and remaining work

Unit tests cover disabled/scoped configuration, whitelist copying, correlated
purchase provenance, tampering, rejected live labels, and invalid archive marks.
The disposable PostgreSQL integration test exercises actual BecsBot decisions
and paper fills, split-page context, a failed target transaction, process exit
after commit without acknowledgment, restart/replay, append-only guards, source
immutability, owner/account isolation, truncated source heads, and archive replay
for a purchase whose transaction commits after its market outcome was ingested.
Tests never call production providers or trade funds.

Local syntax/unit tests are distinct from real PostgreSQL CI evidence. This phase
does not establish production ingestion, deployment, restore-from-backup behavior,
future unattended scheduling, a linked AppDeploy/GitHub identity, live ingestion,
research recommendations, causal learning or predictive improvement. The authenticated
read-only BecsSuperAgent view is now implemented in `SUPERAGENT_REPORT.md` and
integrated with the terminal. Its production gate remains off until the separate
observer database, exact owner/account binding and operational prerequisites are configured.
