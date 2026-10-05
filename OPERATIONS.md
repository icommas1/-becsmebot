# Operations

## Runtime

BecsBot runs as one Node/Express process with `npm start`. It requires Node 22 or 24 and listens on `0.0.0.0` using `PORT` (default `3000`). Startup fails with a concise error when `JUPITER_API_KEY` is absent or `PORT` is invalid. `SIGTERM` and `SIGINT` stop the scan interval and close HTTP connections gracefully; provider requests already have a ten-second timeout.

Required and optional variable names are documented in `.env.example`. Values belong in Railway or a local untracked `.env`, never in source control or command output.

## Nansen credit budget

For the free allowance, set `WALLET_INTEL_SCAN_MS=86400000` and `NANSEN_MIN_CREDITS_RESERVE=5`. Each refresh first checks the live balance using the free account endpoint and makes one five-credit Smart Money request only if at least ten credits remain. An unknown balance or a balance below that boundary pauses requests; `/api/wallet-intel` retains the current process's last successful data with its original timestamp and a fixed pause/error reason. A restart can perform an additional guarded refresh, so the interval is not a durable daily request counter. Other Nansen clients use the same account credit balance and are outside this service's reserve guard. No credits are purchased automatically. The startup default is once daily; existing explicitly configured shorter intervals remain honored.

Nansen's free plan grants 100 trial credits and later tops a below-ten balance up to ten daily. With one normal five-credit refresh daily, five credits remain for headroom after that top-up. Check [Nansen usage](https://app.nansen.ai/api?tab=usage-analytics) for the account's complete usage. Returning cached aggregates from BecsBot does not make another Nansen request. Changing these non-secret settings requires an application deployment, preserving the `/app/data` mount and existing records.

## Railway

The repository assumes Railway runs `npm start`. Configure the service health check to `GET /health`. Mount the persistent volume at the same directory supplied as `DATA_DIR`—the existing deployment uses `/app/data`—so observed chart history survives restarts. Do not point `DATA_DIR` at source files or a shared credential directory.

Railway service access, variables, volume attachment, restart policy and deployment health-check settings are external configuration and cannot be proven from this repository. No wallet or private key is required or expected.

## Health and smoke checks

`GET /health` proves process liveness and reports scan/feed state and `release.commit`; it is not a promise that Jupiter is healthy. The commit is a validated Railway commit SHA or null, available even when research capture is disabled. `npm run test:smoke` performs eleven read-only GET requests against `SMOKE_BASE_URL`, validates contracts and confirms that live trading remains disabled. It reports provider degradation separately. Set `SMOKE_REQUIRE_MARKET_DATA=1` only for a strict provider-readiness check.

`SMOKE_ARCHIVE_MODE=required` requires enabled, current, verified research capture; `disabled` requires capture to remain off; the default `auto` verifies it if enabled. The legacy `SMOKE_REQUIRE_ARCHIVE=1` still requires capture and conflicts with an explicit disabled mode. `SMOKE_EXPECT_COMMIT` always checks `/health` independently of archive mode. The production workflow currently expects `disabled`, reflecting the storage-capacity block; an unexpected reactivation fails the check.

`SMOKE_EXPECT_RETAINED_RECORD_HASH` optionally requires the public retained-record witness to match a previously verified lowercase SHA-256. The production workflow pins record #4's hash, retrieved on 2026-10-04, so disabled-mode checks fail if a new process cannot retrieve it or returns a different record. Keep this expectation when capture resumes. Investigate a missing/changed witness rather than replacing the pin to clear an alarm. Loading may briefly lag market startup, so the existing bounded smoke retries allow warmup. The witness is loaded once per application start; this check proves retrieval of that record, not ongoing database connectivity, a full-history integrity sweep or an independent backup. A paused archive remains `healthy: false` and `verificationComplete: false`.

The smoke script rejects URLs containing embedded credentials, query strings or fragments. It never calls search, price POST, wallet, order, sell or pause operations.

## Failure behavior

- A failed feed retains its last successful data and timestamp and exposes a delayed status.
- Missing Price V3 entries remain unavailable; they cannot produce a paper sale.
- Invalid provider contracts fail that operation with 503 and do not expose the provider body.
- Missing history can be rebuilt by later scans; a persistence failure does not stop market discovery.
- A missing API key or invalid port prevents startup rather than creating a partially configured process.


## Optional server paper account

See [SERVER_PAPER_SETUP.md](SERVER_PAPER_SETUP.md) for private PostgreSQL provisioning, OAuth setup, activation and rollback. The market health route remains independent of database availability. Server-account failures return sanitized errors and must not fall back to local fills. Keep the database volume and chart-history volume separate; backup/restore validation remains an operational follow-up.

## Research archive operations

Keep both the PostgreSQL volume and `/app/data` mounted. Never delete `research-pending` to clear an alarm: it contains undelivered evidence. Check `GET /health/archive` and run `SMOKE_REQUIRE_ARCHIVE=1 npm run test:smoke` after deploy warmup. Healthy means current market evidence, an empty delivery queue and successful chain/payload verification through the committed head. Initial verification uses bounded ten-record pages, with one second between successful catch-up jobs and ten seconds between normal or failed jobs. Large archives can still take multiple passes; do not weaken health checks or silently skip older evidence. Failures expose fixed codes only; inspect capacity/connectivity without printing credentials.

Monitor both volume usage and queue growth. There is no permanent archive TTL or pruning command. Expand/migrate storage before it fills; do not reduce historical coverage automatically. A capacity/disk failure pauses new capture scans and returns an archive-health alarm instead of deleting pending records. SIGTERM drains a running scan before database close, subject to the host's termination grace period. Forced termination before a completed scan is durably queued is outside this guarantee.

Independent, encrypted off-provider backups plus a tested restore remain required. The current repository does not configure an external backup destination, payment, or retention policy. A healthy archive endpoint verifies the primary copy only and must not be presented as proof of an independent backup.

When collecting, runtime evidence is available as hashes and commit in `/health/archive`. `SMOKE_ARCHIVE_MODE=required SMOKE_EXPECT_COMMIT=<merged-sha> npm run test:smoke` verifies both capture/integrity and release identity. While intentionally paused, use `SMOKE_ARCHIVE_MODE=disabled`; `/health` still verifies the release. The code revision comes only from Railway's built-in `RAILWAY_GIT_COMMIT_SHA`; it is never substituted with an invented value. Runtime/configuration payloads stay private in PostgreSQL.

## Storage pause and renewed archive request — 2026-10-04

Production `RESEARCH_ARCHIVE_ENABLED=false`. The owner has now requested archive completion; continuous collection remains blocked on capacity and backup configuration. On 2026-10-04 the Railway PostgreSQL disk metric was 0.422 GB against a 500 MB mounted volume. Do not resume unlimited collection or spend on expansion without resolving that capacity decision. No history was deleted. Market/Radar/Signals scanning, the bounded chart cache and operational paper-account persistence continue. Paused market scans skip retaining/cloning research-only provider evidence; existing research delivery files remain untouched. Compression experiments were stopped without deploying a new archive encoding.

PostgreSQL settings were adjusted without a database restart: `min_wal_size=32MB`, `max_wal_size=64MB`, and `wal_compression=on` (pglz). `fsync`, `full_page_writes` and `synchronous_commit` remain on. WAL limits are soft limits, not a storage guarantee; no measured disk reduction was established. Earlier values were 80MB, 1GB and off respectively. No table was vacuum-full rewritten, truncated or removed. Temporary maintenance deployment hooks were cleared.

`STORAGE_VERIFY_DATABASE_URL` and `npm run verify:storage` run an independent read-only check of existing history even while capture is off. It verifies every research payload/envelope/chain, every BecsEvent from sequence one, local proof ranges, paper ownership/basic balance shape, and retained request receipts. The deterministic fingerprint includes complete paper ledger/receipt contents for restore comparison. It is a consistency check, not an independent external attestation of the original data. See [BACKUP_RESTORE.md](BACKUP_RESTORE.md) for the tested restore boundary and remaining destination requirement.


## Audit checkpoint — 2026-10-02

Main through PR #51 was deployed with green CI, all nineteen feeds current, server paper accounts enabled, and a healthy verified research archive. Wallet intelligence remains disabled without `NANSEN_API_KEY`. The production startup health check is now configured as `/health`; it applies to the next deployment. Live execution remains disabled.

Remaining operational work, in priority order:

1. **Increase storage capacity.** The workspace's effective Railway limit is 0.5 GB per volume, with zero native backups allowed. PostgreSQL disk usage was approximately 0.389 GB during this audit and rising. This is a workspace limit, not a safe long-term archive capacity. Update the Railway workspace/billing limits, then expand the existing PostgreSQL volume without replacing it. Do not prune records, reset the database or discard the delivery spool.
2. **Establish independent backups and prove restoration.** Provision an encrypted off-provider destination, define retention, schedule database exports and restore into a separate disposable database. Verify research hashes, BecsEvent/proof integrity and paper balances there before relying on the backup. No backup is presently configured.
3. **Remove retired deployment credentials after owner review.** The service still lists `SOLANA_PRIVATE_KEY`, `HELIUS_RPC_URL`, `MANUAL_SELL_ENABLED` and legacy `DASHBOARD_*` names. Current runtime code does not read them. Confirm any wallet key has an independently secured backup before deleting its deployment copy. Never print these values or bring a signer back into this service.
4. **Keep archive verification practical as history grows.** Research verification resumes within a running process but restarts its scan from the beginning on deploy. The post-#52 smoke check exposed a warm-up timeout; successful catch-up now advances every second while failures retain their ten-second backoff. Paper-event verification explicitly reports incomplete coverage above its bounded window. A durable verification checkpoint/independent full verifier is a follow-up; never label partial coverage as complete.

Branch reconciliation found 50 branch heads belonging to merged PRs and three unmerged branches (`fix/research-archive-json-normalization`, its `-v2` variant, and `maintenance/phase1-docs-repo-guidance`). The normalization attempts are superseded by merged #49. All three were preserved; no old branch should be blindly merged into current main, particularly branches from the retired live/Pump implementation.


## Retrieval and explicit retention rules

Sign in as the configured owner, then use the same-origin research GET routes documented in ARCHITECTURE.md. Existing saved records can be read even with collection disabled. `/health/archive.retainedEvidence` is an aggregate witness of the oldest retained market scan, reloaded from PostgreSQL on each application start. Compare its sequence, timestamps and hashes before/after an application restart. This proves retrieval of that historical record, not a complete production restore or continuous capture while paused.

| Data | Retention and deletion rule |
| --- | --- |
| Research records and compressed payloads | Permanent; no TTL/pruning; UPDATE, DELETE and TRUNCATE guarded. |
| BecsEvents and proofs | Permanent committed server-paper audit; append-only guards. |
| Pending research files, including crash temporary files | Keep until a matching DB receipt or a proven identical durable copy; never evict for capacity. Incomplete/conflicting evidence requires recovery. |
| Chart history | Operational 24 hours, up to 1,440 points/mint and 1,000 mints; distinct from permanent history. |
| Paper command receipts | Latest 500/account with replay watermark; committed BecsEvents remain permanent. |
| Browser paper state/activity | Local operational state; not a permanent server research archive. |

Do not mistake disabled-mode health for a current, fully verified archive. After capacity and independent backups are established, set `RESEARCH_ARCHIVE_ENABLED=true`, change smoke expectation to `required`, wait for bounded full-chain catch-up, and verify new scan delivery plus a controlled application restart. Keep database restarts and destructive restore/cutover out of smoke tests.
