# Operations

## Runtime

BecsBot runs as one Node/Express process with `npm start`. It requires Node 22 or 24 and listens on `0.0.0.0` using `PORT` (default `3000`). Startup fails with a concise error when `JUPITER_API_KEY` is absent or `PORT` is invalid. `SIGTERM` and `SIGINT` stop the scan interval and close HTTP connections gracefully; provider requests already have a ten-second timeout.

Required and optional variable names are documented in `.env.example`. Values belong in Railway or a local untracked `.env`, never in source control or command output.

## Railway

The repository assumes Railway runs `npm start`. Configure the service health check to `GET /health`. Mount the persistent volume at the same directory supplied as `DATA_DIR`—the existing deployment uses `/app/data`—so observed chart history survives restarts. Do not point `DATA_DIR` at source files or a shared credential directory.

Railway service access, variables, volume attachment, restart policy and deployment health-check settings are external configuration and cannot be proven from this repository. No wallet or private key is required or expected.

## Health and smoke checks

`GET /health` proves process liveness and reports scan/feed state; it is not a promise that Jupiter is healthy. `npm run test:smoke` performs nine read-only GET requests against `SMOKE_BASE_URL`, validates contracts and confirms that live trading remains disabled. It reports provider degradation separately. Set `SMOKE_REQUIRE_MARKET_DATA=1` only for a strict provider-readiness check.

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

Keep both the PostgreSQL volume and `/app/data` mounted. Never delete `research-pending` to clear an alarm: it contains undelivered evidence. Check `GET /health/archive` and run `SMOKE_REQUIRE_ARCHIVE=1 npm run test:smoke` after deploy warmup. Healthy means current market evidence, an empty delivery queue and successful chain/payload verification through the committed head. Initial verification can take multiple passes on a large archive. Failures expose fixed codes only; inspect capacity/connectivity without printing credentials.

Monitor both volume usage and queue growth. There is no permanent archive TTL or pruning command. Expand/migrate storage before it fills; do not reduce historical coverage automatically. A capacity/disk failure pauses new capture scans and returns an archive-health alarm instead of deleting pending records. SIGTERM drains a running scan before database close, subject to the host's termination grace period. Forced termination before a completed scan is durably queued is outside this guarantee.

Independent, encrypted off-provider backups plus a tested restore remain required. The current repository does not configure an external backup destination, payment, or retention policy. A healthy archive endpoint verifies the primary copy only and must not be presented as proof of an independent backup.
