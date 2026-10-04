# Architecture

BecsBot is a single Node/Express service serving a vanilla HTML/CSS/JavaScript terminal. It reads Jupiter market data and DexScreener discovery membership and simulates trades in browser storage, with an optional private GitHub-authenticated PostgreSQL paper account. It has no wallet signer or real execution engine.

## Repository layout

| Location | Responsibility |
| --- | --- |
| `src/basket.js` | Stable Railway entry point, environment and scan timer |
| `src/paper/` | Optional GitHub authentication, bounded sessions, PostgreSQL paper transactions and BecsEvent persistence |
| `src/events/` | Canonical BecsEvent hashing, materialization and chain verification |
| `src/proof/` | Provider-neutral proof contract and local Merkle-hash provider; XYO adapter point |
| `src/api/app.js` | HTTP routes, limits, fixed static assets and errors |
| `src/api/schemas.json` | Draft-07 request, response and upstream contracts |
| `src/api/validation.js` | Strict Ajv validators and canonical Solana mint checks |
| `src/market/client.js` | Serialized Jupiter queue, timeout and bounded 429 retry |
| `src/market/dexscreener.js` | Bounded public DexScreener discovery transport and Solana membership |
| `src/market/mint.js` | Canonical base58 mint validation without a wallet SDK |
| `src/market/tokens.js` | Feed definitions and token normalization |
| `src/market/market.js` | Scans, caches, single-flight requests and snapshots |
| `src/market/history.js` | Bounded 24-hour chart persistence |
| `src/market/signals.js` | Multiples against the first retained observation |
| `src/web/dashboard.html` | Small launch shell and self-hosted module entry point |
| `src/web/assets/terminal-fragment.html` | Terminal controls loaded after launch |
| `src/web/assets/js/launch.mjs` | Loads the terminal controls before starting the dashboard |
| `src/web/assets/dashboard.css` | Terminal layout and responsive presentation |
| `src/web/assets/js/dashboard.mjs` | Browser startup, shared state coordination, refresh and event wiring |
| `src/web/assets/js/core.mjs` | Shared formatting, time and signal-presentation helpers |
| `src/web/assets/js/filters.mjs` | Radar topic selection, launch eligibility and sort values |
| `src/web/assets/js/paper-wallet.mjs` | Browser-local persistence, ownership migration and portfolio reads |
| `src/web/assets/js/trading/decision-engine.mjs` | Shared, DOM-free strategy decisions and automatic candidate selection |
| `src/web/assets/js/trading/contracts.mjs` | Account, strategy, provider-neutral OrderIntent and ExecutionResult contracts |
| `src/web/assets/js/trading/paper-executor.mjs` | Executor implementation, simulated fills, ledger mutations and activity |
| `src/web/assets/js/trading/paper-pipeline.mjs` | Thin adapter from the existing browser ledger to decision/execution inputs |
| `src/web/assets/js/api-client.mjs` | Same-origin read and paper-price requests |
| `src/web/assets/js/dom.mjs` | Safe text nodes, sparklines and activity bars |
| `src/web/assets/js/radar-view.mjs` | Radar cards/instrument and filtered Signals presentation |
| `src/web/assets/js/paper-view.mjs` | Wallet, positions, activity, tape, dock and detail sheet |
| `src/web/assets/becs-logo.jpg` | Supplied terminal artwork |
| `test/unit`, `test/integration`, `test/e2e` | Logic, HTTP and real browser regression tests |
| `test/fixtures` | Deterministic market/server fixtures, no live credentials |
| `scripts/` | Syntax/schema check and read-only Railway smoke runner |

## Data path

```text
DexScreener discovery -> Jupiter mint enrichment
Jupiter Price V3 / Tokens V2
  -> strict upstream schemas
  -> canonical-mint normalization and feed deduplication
  -> bounded market cache and persisted observations
  -> Radar rows and observed Signals
  -> validated Express responses
  -> browser presentation and browser-local paper accounting
```

The process scans SOL Price V3, thirteen Tokens V2 feeds and six DexScreener discovery feeds once a minute. Dex discovery runs independently while Jupiter category reads proceed. Each Dex request has a ten-second timeout, a 1 MiB body bound and no retry; at most six are in flight. Valid Solana mints deduplicate, with at most 50 per Dex feed and 300 per scan. They are enriched using Jupiter Tokens V2 mint search in batches of at most 100. Only exact requested mints can supply metadata. Dex fields never supply prices, cap, liquidity, age, verification or organic scores. Missing Jupiter data stays unavailable; failed discovery or enrichment retains the affected feed’s prior data and timestamp. Paid ads/boosts are labeled and do not represent the proprietary DexScreener Trending Score. Jupiter requests are serialized with a 2.2-second gap, a ten-second timeout, a 24-request pending bound and at most one 429 retry. The scan cannot overlap itself. Successful feed data replaces its prior cache; failed feeds retain their prior timestamps and an error. Schema failures follow the same failure path. Fresh metadata cannot refresh a cached price timestamp.

Normalization merges canonical mints and feeds. Positive finite prices and numeric metrics are retained; absence stays unavailable. The server retains full observed history for signal ranking. `GET /api/basket` sends feed timestamps, Radar rows and compact Signals references; the browser joins each signal to its Radar row by mint. `GET /api/history` sends chart trails separately, downsampled to at most 120 points per mint while retaining endpoints and bucket extrema. The browser revalidates the basket every 15 seconds and requests chart history only after `lastScanAt` changes. ETags return 304 for unchanged basket/history revisions. Market scans remain once per minute; REST polling does not make scans faster or turn them into a stream.

`DATA_DIR/market-history.json` is atomically replaced with restricted file permissions. History keeps up to 1,000 mints, 1,440 points per mint and 24 hours. Invalid, old and future observations are discarded. Pruning is shared and limited to once per scan interval so repeated browser snapshot reads do not repeatedly sort the complete history. Failure to read history rebuilds it from later scans; persistence errors do not stop market discovery. Railway's `/app/data` volume must remain mounted.

## HTTP contract

| Route | Behavior |
| --- | --- |
| `GET /`, `GET /terminal` | Lean launch shell; same-origin fragment hydrates the full terminal |
| `GET /assets/becs-logo.jpg` | Fixed supplied artwork |
| `GET /health` | Liveness, feed/scan state, validated release commit, real trading disabled |
| `GET /api/basket` | Validated cached market snapshot |
| `GET /api/history` | Validated, bounded chart trails, independent from signal history |
| `GET /api/search?q=...` | Trimmed 2–80-character query; one-minute cache |
| `POST /api/paper/prices` | Strict `{mints:[...]}` body, max 100 canonical mints, upstream chunks of 50 |
| `GET /api/wallet-intel` | Read-only aggregate Smart Money flow; never returns provider wallet addresses or transaction hashes |
| `GET /api/paper/events` | Authenticated append-only server-paper BecsEvents, newest first |
| `GET /api/paper/proofs` | Authenticated local proof batches for the server-paper event stream |
| `GET /api/paper/verify` | Authenticated hash-chain and local-proof verification summary |
| `/api/sell/*`, `/api/pause/*` | 410 compatibility blocks |

Price cache TTL is 20 seconds; search cache TTL is one minute. Concurrent identical lookups share a job. Search and price requests share limits of 30/minute per IP and 40/minute globally; busy responses include `Retry-After: 60`. Input errors return 400, malformed JSON 400, oversized bodies 413, provider/contract failures 503 and unexpected failures 500. No private upstream body or credentials are logged. Unknown response data never becomes a fill.

Ajv compiles schemas in strict mode without coercion or mutation. Upstream token schemas allow additional provider fields for forward compatibility. Local successful response contracts validate numeric values, mints, timestamps and disabled trading flags. The local schema file is the machine-readable source of truth.

## Data sources of truth

| Value | Implemented source of truth |
| --- | --- |
| Token identity | Canonical 32-byte base58 `id` returned by Jupiter; rows deduplicate by this mint |
| Symbol and name | Most recently merged non-empty Jupiter token metadata, length-limited for display |
| Token price | Positive finite Tokens V2 `usdPrice` for discovery; Price V3 is separately required for paper sells |
| Market cap | Positive finite Jupiter `mcap`; missing/zero remains unavailable |
| Liquidity | Positive finite Jupiter `liquidity`; missing/zero remains unavailable |
| Volume | Sum of nonnegative buy and sell volume for the corresponding Jupiter interval |
| Token age | Jupiter `createdAt`, falling back to `firstPool.createdAt`; interpreted by the browser |
| Holders | Positive finite Jupiter `holderCount`; no separate holder service is queried |
| Launch source | Membership in configured Tokens V2 category feeds or DexScreener discovery feeds plus optional Jupiter `launchpad` metadata |
| Wallet signals | Optional Nansen Smart Money DEX trades normalized into aggregate token flow; disabled unless `NANSEN_API_KEY` is configured |
| Positions | Browser-local `becsPaperV1`, or the signed-in paper account in PostgreSQL; no live positions |

When multiple feeds describe one mint, feeds and ranks accumulate. Later merged non-empty fields can update metadata, while the row's price timestamp remains tied to the feed that actually supplied its retained price. This ordering is an implementation detail, not a promise that any category is globally authoritative.

## Smart wallet intelligence

The first wallet-intelligence phase is read-only and provider-neutral. When `NANSEN_API_KEY` is configured, BecsBot polls Nansen's documented Solana Smart Money DEX Trades endpoint and normalizes up to 100 recent trades per scan. Provider wallet addresses and transaction hashes remain server-internal; the public `/api/wallet-intel` contract exposes only token-level buy/sell counts, USD flow, unique-wallet counts and explicit provider labels.

Classification separates three concepts: the intelligence provider (currently Nansen), the provider's Smart Money category (for example fund or smart trader), and an execution/client platform label (for example Trojan, BullX, Photon, GMGN, Maestro, Bloom, Blood Solutions, Jupiter or Phantom). Platform attribution is recorded only when a provider label explicitly contains that platform; BecsBot does not infer that a normal Solana address is a Phantom, Trojan or other client wallet. This avoids fabricating provenance.

Jupiter's SmartMoney UI is not scraped because no stable documented SmartMoney feed API has been established for this integration. Phantom's documented developer products provide wallet connection/embedded-wallet capabilities rather than a public Smart Money leaderboard. Trojan is treated as an execution-platform label when an upstream intelligence provider identifies it. Additional providers such as Birdeye can be added behind the same normalization boundary without changing strategy or execution.

Wallet intelligence does not change Radar eligibility, Signals, sizing, DecisionEngine behavior or paper fills in this phase. It is observational data to be measured before it is allowed to become strategy input.

## BecsEvent ledger and proof boundary

Committed authenticated server-paper actions emit versioned `BecsEvent` records in the same PostgreSQL transaction as the account mutation and request receipt. A successful buy or sell records the bounded decision evidence, normalized `OrderIntent`, and `ExecutionResult`; settings, cash adjustments and resets record their committed before/after state. Replayed request IDs return their original result and do not append duplicate audit events. Rejected or rolled-back commands do not produce committed BecsEvents.

Each paper account has a pseudonymous stream ID derived from its authenticated user ID. Events have monotonically increasing sequence numbers, canonical SHA-256 payload hashes, the previous event hash, and an envelope hash covering event identity, type, source, timestamp, account/strategy references and payload hash. PostgreSQL triggers reject UPDATE, DELETE and TRUNCATE on event and proof rows. The mutable stream-head row is only an index; verification recomputes event hashes and checks the stored head.

`ProofProvider` is deliberately separate from trading and persistence. The first provider, `local-hash-v1`, creates Merkle roots over contiguous event ranges. Batches are created after at least 32 unproved events, up to 128 at a time; an internal force-seal operation exists for tests/administration. Proof rows are append-only. A future XYO provider can attest the same event ranges without changing DecisionEngine, OrderIntent, PaperExecutor or the BecsEvent contract.

This layer is non-blocking with respect to future external proof networks: PostgreSQL remains the operational ledger and local hashes remain independently verifiable. No XYO SDK, wallet, gas token, live signing path or network dependency is introduced in this phase.

## Execution and UI

Browser `becsPaperV1` storage owns cash, holdings, settings, activity and buy-once records. Auto resets to off on reload. Charts and market scans continue on the server when a phone closes; paper auto requires the page to remain active. iOS background suspension can pause it. Settings migration preserves cash and holds. The optional server account synchronizes committed state on refresh; the separate local wallet does not synchronize.

The Performance panel reads recorded sale activity from the active local or authenticated server paper ledger. New sale entries record proportional USD cost basis (including entry fees), net proceeds (after the exit fee), realized USD P/L and the position's entry market cap. Each partial exit is one sale; sale returns divide its realized P/L by that sale's basis. The panel can filter manual and automatic sales, shows net P/L, winning-sale percentage and median return, and plots sales with a known positive entry cap. Existing older activity entries do not contain a cost basis and are excluded from those statistics, while the separately labeled ledger realized total still includes them. Activity remains bounded to the newest 500 entries and resetting the local paper wallet clears it. No backtest, market-wide edge ranking, predictive recommendation or automatic setting change is inferred from these observations.

Browser API requests have a 60-second deadline covering both the response and its JSON body. A timeout releases refresh/marking locks through their existing `finally` paths; later refreshes can recover, and successful conditional-response caches are retained. If browser storage is blocked, the terminal still opens with session-only paper state and reports failed saves without replacing that warning with a success message. Search failures appear in the empty Radar state and recover on later queries.

Manual contact actions, dock actions and auto use the same paper accounting functions. Sells require current Price V3 marks; estimated portfolio values may show labeled stale marks. See the radar and signals specs for eligibility and state rules.

The Feeds panel labels each configured source as Reporting, Delayed or Pending and shows the last successful update relative to the browser clock. The five-minute freshness cutoff matches the read-only production smoke check. A delayed source may retain its previous token count and timestamp; the UI labels that count as cached. Feed ages refresh every polling tick even while a prior request is waiting. Failed basket requests or a browser offline event label retained feeds as cached/Delayed, show the connection failure, and stop the scanning indicator. A visible returning tab or online event immediately revalidates through the existing single-request guard; only a successful response (including HTTP 304) clears the connection warning, and old provider timestamps can still remain Delayed. Cached cards, charts, paper holdings and conditional-response data are preserved. These are observation labels, not new launch eligibility thresholds.

### Strategy and execution boundary

The default local paper path is:

`Radar / Signals -> DecisionEngine -> OrderIntent -> PaperExecutor -> browser-local paper ledger`.

The modules under `trading/` do not require the DOM, browser storage, provider clients or network access. They can also be imported by Node. The decision engine evaluates the existing launch filters, selected auto source, buy-once history and optional multiple target against input snapshots. It returns no action or intent(s), without modifying cash, positions, activity or exit flags. The strategy identifier is `launch-v1`, version `1`; the strategy and its thresholds are unchanged.

An OrderIntent contains a UUID `intentId`, independent `userId` and `accountId`, strategy ID/version, creation time, asset identifier, side, quantity with mode/unit, market/reduce-only/cap constraints, and decision reason/source. Dollar requests use `quote`/`USD`; percentage exits use `position_fraction`/`fraction`. Intents carry no provider routes, transaction objects, keys, RPC details, fees or fill prices. A retry retains the original intent ID. A browser-local receipt journal protects recent local fills. The optional server path adds transactional duplicate protection and tab-local pending command persistence. This synchronous paper phase must not be reused as a live execution queue.

An Executor implements `execute(intent, marketContext) -> ExecutionResult`. PaperExecutor validates ownership and paper mode before touching its supplied ledger, checks fill data, and owns impact, extra fees, reserve checks, proportional cost basis, position changes, realized P/L and one-time target-exit flags. It returns requested quantity separately from filled token/quote quantities, fill price, USD fees, status/rejection reason and creation/completion timestamps. The existing price cache and UI messages use a thin compatibility adapter. Filled execution results are retained with intent signatures in the browser-local paper ledger; the optional authenticated server account returns its own results over HTTP.

The journal keeps the most recent 500 filled intents, in the same `becsPaperV1` JSON save as cash and holdings. An exact retry returns a copy of its original result without needing a fresh mark or mutating the ledger. Reusing its ID with changed intent fields is rejected. Rejected attempts are not recorded, so a transient failure can retry with the same ID. Existing paper ledgers migrate with an empty journal and retain their cash, holds, activity and account identity. Wallet reset clears the journal. Evicted receipts cannot protect older sale intents; this bounded browser feature is not a durable, cross-device or live-order idempotency guarantee.

The executor also rejects malformed or absent market contexts and invalid browser-ledger structures before mutation. Invalid sale holdings cannot turn cost basis or realized P/L into non-finite numbers. This is a fail-closed check on the existing paper path; it does not add an order route or change eligibility for valid ledgers.

Each local ledger now carries an `account` with independent random local user and paper account IDs and an explicit execution mode. Existing `becsPaperV1` data migrates without changing cash, holds, settings, activity or buy-once records; save/reload preserves IDs, reload still disables auto, and resetting balances retains account identity. Executor instances receive their account and ledger explicitly; no singleton balance or position map is used. The current browser still exposes only one local ledger. These IDs express ownership within that ledger; they are not authenticated identities or cross-device isolation. The optional server account uses authenticated ownership instead. Full multi-user onboarding remains deferred.

Trading mode belongs to account routing, not strategy identity or the intent payload. A strategy may describe a request for a future live account, but the only executor implementation is PaperExecutor, which rejects live mode both at construction and execution. There is no LiveExecutor, signing dependency, submission route or mode switch that enables real trading. A future live guard and executor require a separate phase.

The execution boundary is intentionally one-way: the browser can request public market/search/price data, but the server exposes no signing route. Compatibility paths under `/api/sell` and `/api/pause` always return 410. Tests replace provider access with fixtures and assert that paper actions do not call those paths.

### Optional authenticated server paper account

`Authenticated command -> server market snapshot + shared DecisionEngine -> normalized OrderIntent -> PaperExecutor -> PostgreSQL transaction`.

Configuration lives in `src/paper/config.js` and `.env.example`; trading defaults remain in `paper-wallet.mjs`. `PAPER_ACCOUNTS_ENABLED` defaults off and requires a database URL, HTTPS public origin, GitHub OAuth client credentials and one allowed numeric GitHub user ID when enabled. See [SERVER_PAPER_SETUP.md](SERVER_PAPER_SETUP.md).

GitHub login uses state, a browser-bound HttpOnly Secure SameSite=Lax cookie, one-use database-backed PKCE and an owner allowlist. No GitHub repository scope is requested. OAuth tokens are not retained. Random session tokens are stored only as hashes in PostgreSQL, expire after seven days and are bounded to ten per user. Auth flows expire after ten minutes and are bounded to 100. Mutating routes require the authenticated owner and the exact configured Origin. Client account IDs, marks, ledger objects and execution modes are rejected by strict request schemas.

The first sign-in creates a separate 0.4 simulated SOL paper account. No client ledger is imported and `becsPaperV1` is never overwritten while signed in. The browser retains presentation and page-local auto scheduling; the backend reevaluates the existing strategy with server-owned settings and market data. Sell all remains a full-position fraction intent; dollar sales retain their cap and fee behavior. Account settings, cash adjustment and reset use optimistic revision checks to avoid stale edits overwriting newer state.

Each command locks its account row. Its balance/hold changes and successful request receipt commit together; rollback removes both. Exact retries return the original execution result and latest account state before market access. A changed payload with the same ID rejects. The latest 500 successful command receipts are retained, including cash/settings/reset commands. Pruning advances an account timestamp watermark so expired receipts cannot execute again after eviction or reset; equal-timestamp requests can conservatively expire. New requests are bounded to 24 hours with 30 seconds of future-clock tolerance. Rejected attempts are not retained. Ledger JSON is bounded to 5 MiB; pool/HTTP concurrency, waits and external reads are bounded. This remains paper-only, not an asynchronous live order queue.

Public market startup and polling run independently of the private account check. Account failures stop auto, block new paper actions and retry every 15 seconds without switching to the local ledger; stalled account requests cannot hold up Radar refreshes.

The browser persists one unresolved command per tab in session storage before sending it. An uncertain response keeps its original ID across reload; the user retries explicitly. A server failure never routes a signed-in trade through local execution. Closing the tab can discard its pending command; committed server state remains. State refreshes every 15 seconds, and auto remains off after reload. No server-side scheduled trading or automatic local-ledger migration is implemented.

| Route | Behavior |
| --- | --- |
| `GET /api/paper/capabilities` | Feature availability, no private account data |
| `GET /api/auth/status` | Session status, only when enabled |
| `GET /api/auth/github`, `GET /api/auth/github/callback` | GitHub sign-in and one-use callback |
| `POST /api/auth/logout` | Same-origin session revocation |
| `GET /api/paper/account` | Authenticated owner's current paper account/revision |
| `POST /api/paper/commands` | Strict paper buy/sell/settings/cash/reset command, no live mode |
| `GET /api/paper/events` | Private append-only committed-event history |
| `GET /api/paper/proofs` | Private local proof-batch history |
| `GET /api/paper/verify` | Private chain/proof integrity summary |

The existing market health route does not certify database health. When disabled, account and auth routes are absent. Enabling with missing credentials fails startup rather than weakening authentication. Database schema creation is lazy and additive; persistent storage and backup operations belong to Railway administration. The PostgreSQL volume is separate from `/app/data` chart history.

## Verification and delivery

CI runs syntax/schema checks and unit/integration tests with a disposable PostgreSQL 18 service on Node 22/24, plus iPhone WebKit, mobile Chromium and desktop Chromium using a local fixture server. Failures retain traces/screenshots for seven days. No test needs a production API key.

The Railway workflow runs after pushes to main, manually, and every six hours. It makes eleven GET requests per attempt, including archive status, allows deployment warm-up retries, validates contracts including bounded chart history, confirms all nineteen configured feeds, a recent scan, disabled live trading and terminal/asset availability. Provider freshness is reported separately so a provider outage is not misclassified as a BecsBot process outage; strict market-data readiness is available through `SMOKE_REQUIRE_MARKET_DATA=1`. It does not send orders, change settings or buy a developer plan. Dependabot opens weekly npm and Actions update PRs; updates are not automatically merged.

Railway service variables, volume attachment and health-check configuration live outside this repository. The repository defines the startup command and expected variable names but cannot prove those external settings. No `railway.toml`, Dockerfile or Procfile is currently required.

Market re-renders retain the currently visible mobile card by mint and preserve panel/sheet scroll. Source, sort, search, filter and page changes reset horizontal contacts. Token details use a labeled 48px close control and backdrop dismissal; closing restores focus to the stable dock token without scrolling the market.

The entry response contains only a loading status, CSS and a self-hosted launch module. That module loads the static terminal fragment before starting the dashboard. A same-origin `/terminal` route and standalone web app manifest support a home-screen launch. Safari Reader eligibility and automatic Reader preferences remain browser decisions; the initial response no longer presents Radar as an article-like HTML document.


## Permanent research archive

BecsBot has a separate append-only research archive for long-horizon replay and future BecsSuperAgent analysis. It is intentionally distinct from the operational 24-hour chart-history file and from the private BecsEvent execution audit ledger.

When `RESEARCH_ARCHIVE_ENABLED=true`, each completed market scan is persisted to PostgreSQL with the complete normalized Radar snapshot, ranked Signals, accepted provider rows, feed status/errors, SOL reference price and scan timestamp. Smart-wallet scans are persisted with their private normalized wallet/transaction observations plus public aggregates when wallet intelligence is enabled.

The archive uses two tables layers: content-addressed gzip-compressed JSON payloads keyed by deterministic SHA-256 and an immutable chronological record stream. Repeated identical payloads reuse the same blob while every observation still receives its own sequence, timestamp and hash-chain record. PostgreSQL triggers reject UPDATE and DELETE on archive records and payloads. Application code contains no retention or pruning path.

`RESEARCH_ARCHIVE_DATABASE_URL` can point to a dedicated PostgreSQL database later; when omitted, the archive reuses `DATABASE_URL`. This keeps the capture contract stable if research storage is split from paper-account storage as volume grows.

The archive is not a substitute for independent backups. PostgreSQL + its persistent Railway volume is the primary durable copy; an off-provider/object-storage backup is still required before the word “forever” can be treated as an operational retention guarantee. BecsEvent remains the tamper-evident decision/execution ledger, while the research archive retains market/intelligence evidence used for replay, backtests and outcome analysis.

### Archive delivery and verification

Completed evidence is fsynced as a private gzip record under `DATA_DIR/research-pending/<stream>` before delivery. Records have stable UUIDs; database replay after an uncertain commit returns the original receipt and rejects conflicting content. Pending files are removed only after that receipt. The spool retries every ten seconds and survives application restart on the existing persistent volume. It is delivery state, not an independent backup.

The queue has a 128 MiB capacity. If persistence or capacity fails, the already collected observation remains in bounded memory and new market/intelligence scans pause until the queue can accept it; pending disk records are never evicted. `/health/archive` reports 503 for failure, stale capture, backlog, or incomplete integrity verification. Disk failure followed by forced process termination can still lose evidence that never reached durable storage; operators must act on the unhealthy status. Shutdown waits for in-flight scan capture before closing the database.

The public archive health route exposes only counters, timestamps and fixed error codes, never payloads, paths, wallet identities or database errors. A cursor verifies ten records per pass against a fixed head; later passes continue beyond 5,000 records and check newer committed records. While healthy verification is catching up, the next pass is scheduled one second after the previous job completes. Current archives and failures keep the ten-second cadence. Pages never overlap or grow in memory size, and shutdown cancels scheduling. Existing `/health` remains market liveness. `SMOKE_REQUIRE_ARCHIVE=1 npm run test:smoke` additionally requires a current, fully verified archive. Database triggers also reject TRUNCATE of archive records/payloads. These guards prevent application accidents; a privileged database administrator can still bypass database controls.

Coverage is prospective. Old chart samples already pruned before archive activation cannot be reconstructed. Accepted market provider evidence and provider failures are retained; this is not a complete blockchain index. Smart Wallet capture occurs only with a configured provider; a disabled provider produces no invented observations. Browser-local paper history remains local/bounded; only authenticated server-paper committed actions enter BecsEvent. Rejections and future horizon outcomes remain separate research gaps.

### Reproducible runtime/configuration history

When research capture is enabled, each new process archives a version-2 `runtime.started` payload before starting its scan timers. It records a random runtime ID, the validated Railway commit SHA (null when unavailable), Node/package versions, hashes of the relevant strategy/execution/market/archive sources and dependency lockfile, API schema hash, and an explicit non-secret configuration snapshot. The snapshot contains actual shared strategy/default settings, feed definitions, feature enabled flags, polling intervals and archive format/stream. It never enumerates environment variables, stores credentials, OAuth owner identity or connection strings.

Each subsequent market or intelligence record includes the runtime ID, configuration hash, code hash and full runtime-evidence payload hash in its hash-protected metadata. This links observations to the exact deployed configuration for later replay and outcome comparison, without changing the strategy or default values. Per-account settings changes remain in private BecsEvent; these runtime defaults do not pretend to replace account-specific history. Older records lacking provenance remain intact and explicitly lack this new linkage.

`/health/archive` exposes current provenance plus an optional historical market witness containing only hashes, timestamps and row/feed counts. The witness verifies one retrieved payload/envelope; it is not a full-history verification or backup. `/health` independently exposes the running release commit, including while capture is paused. Production smoke checks that commit against the workflow commit on deploy and on the existing six-hour schedule. The current owner-requested pause is enforced with `SMOKE_ARCHIVE_MODE=disabled`; `required` instead requires a healthy archive and matching provenance when collection is authorized again. Neither route exposes archived payloads, and smoke never makes paper commands. With research capture disabled, scans continue without retaining or cloning provider evidence for the archive; saved history remains intact.


### Retained research reads and crash recovery

Owner-authenticated `GET /api/research/records?limit=20&before=<sequence>` pages record metadata in descending sequence order; `GET /api/research/records/<sequence>` retrieves one hash-checked payload/envelope. Both routes reuse the configured owner session, ignore client-supplied account/stream selectors, and always read the configured research stream. A missing record returns 404; unavailable/corrupt storage returns a sanitized 503. Listing verifies record envelopes, while individual retrieval also checks compressed/uncompressed byte counts and payload hashes. Neither operation claims to verify every neighboring record in the chain.

These reads remain available while collection is paused when server paper accounts and the archive database are configured. They do not initialize schemas, modify archive rows, resume collection or delay public market scans. One research read runs at a time; metadata pages are capped at 100 records, individual decompression at 32 MiB, and SQL calls have timeouts. Public historical-witness loading is independent from market startup. Private metadata, source payloads and wallet observations never enter public health responses.

A crash after spool fsync but before rename may leave `.json.gz.tmp` evidence. Complete temporary records are promoted and delivered using their original UUID. An identical final copy is kept while its redundant temporary copy is removed. Incomplete or conflicting files remain untouched, count toward the backlog, make health fail and block new capture scans until resolved. No recovery path deletes permanent history. Delivery/read/freshness limits are centralized in `src/archive/config.js` and included in new runtime provenance.
