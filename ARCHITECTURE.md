# Architecture

BecsBot is a single Node/Express service serving a vanilla HTML/CSS/JavaScript terminal. It reads Jupiter market data and simulates trades in browser storage. It has no login, wallet signer or real execution engine.

## Repository layout

| Location | Responsibility |
| --- | --- |
| `src/basket.js` | Stable Railway entry point, environment and scan timer |
| `src/api/app.js` | HTTP routes, limits, fixed static assets and errors |
| `src/api/schemas.json` | Draft-07 request, response and upstream contracts |
| `src/api/validation.js` | Strict Ajv validators and canonical Solana mint checks |
| `src/market/client.js` | Serialized Jupiter queue, timeout and bounded 429 retry |
| `src/market/mint.js` | Canonical base58 mint validation without a wallet SDK |
| `src/market/tokens.js` | Feed definitions and token normalization |
| `src/market/market.js` | Scans, caches, single-flight requests and snapshots |
| `src/market/history.js` | Bounded 24-hour chart persistence |
| `src/market/signals.js` | Multiples against the first retained observation |
| `src/web/` | Terminal and supplied logo |
| `test/unit`, `test/integration`, `test/e2e` | Logic, HTTP and real browser regression tests |
| `test/fixtures` | Deterministic market/server fixtures, no live credentials |
| `scripts/` | Syntax/schema check and read-only Railway smoke runner |

## Data path

```text
Jupiter Price V3 / Tokens V2
  -> strict upstream schemas
  -> canonical-mint normalization and feed deduplication
  -> bounded market cache and persisted observations
  -> Radar rows and observed Signals
  -> validated Express responses
  -> browser presentation and browser-local paper accounting
```

The process scans SOL Price V3 and thirteen Tokens V2 feeds once a minute. Jupiter requests are serialized with a 2.2-second gap, a ten-second timeout, a 24-request pending bound and at most one 429 retry. The scan cannot overlap itself. Successful feed data replaces its prior cache; failed feeds retain their prior timestamps and an error. Schema failures follow the same failure path. Fresh metadata cannot refresh a cached price timestamp.

Normalization merges canonical mints and feeds. Positive finite prices and numeric metrics are retained; absence stays unavailable. The snapshot contains feed timestamps, radar rows, observed trails and ranked signals. The browser polls this cached snapshot every ten seconds; this does not make market scans faster or turn REST into a stream.

`DATA_DIR/market-history.json` is atomically replaced with restricted file permissions. History keeps up to 1,000 mints, 1,440 points per mint and 24 hours. Invalid, old and future observations are discarded. Failure to read history rebuilds it from later scans; persistence errors do not stop market discovery. Railway's `/app/data` volume must remain mounted.

## HTTP contract

| Route | Behavior |
| --- | --- |
| `GET /` | Full terminal |
| `GET /assets/becs-logo.jpg` | Fixed supplied artwork |
| `GET /health` | Liveness, feed/scan state, real trading disabled |
| `GET /api/basket` | Validated cached market snapshot |
| `GET /api/search?q=...` | Trimmed 2–80-character query; one-minute cache |
| `POST /api/paper/prices` | Strict `{mints:[...]}` body, max 100 canonical mints, upstream chunks of 50 |
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
| Launch source | Membership in configured Tokens V2 category feeds plus optional Jupiter `launchpad` metadata |
| Wallet signals | Not implemented; no wallet history is fetched or scored |
| Positions | Browser-local simulated holds in `becsPaperV1`; there is no server or live position store |

When multiple feeds describe one mint, feeds and ranks accumulate. Later merged non-empty fields can update metadata, while the row's price timestamp remains tied to the feed that actually supplied its retained price. This ordering is an implementation detail, not a promise that any category is globally authoritative.

## Execution and UI

Browser `becsPaperV1` storage owns cash, holdings, settings, activity and buy-once records. Auto resets to off on reload. Charts and market scans continue on the server when a phone closes; paper auto requires the page to remain active. iOS background suspension can pause it. Settings migration preserves cash and holds. There is no cross-device wallet synchronization.

Manual contact actions, dock actions and auto use the same paper accounting functions. Sells require current Price V3 marks; estimated portfolio values may show labeled stale marks. See the radar and signals specs for eligibility and state rules.

The execution boundary is intentionally one-way: the browser can request public market/search/price data, but the server exposes no signing route. Compatibility paths under `/api/sell` and `/api/pause` always return 410. Tests replace provider access with fixtures and assert that paper actions do not call those paths.

## Verification and delivery

CI runs syntax/schema checks and unit/integration tests on Node 22/24, plus iPhone WebKit, mobile Chromium and desktop Chromium using a local fixture server. Failures retain traces/screenshots for seven days. No test needs a production API key.

The Railway workflow runs after pushes to main, manually, and every six hours. It makes only four GET requests per attempt, allows deployment warm-up retries, validates contracts, confirms all thirteen configured feeds, a recent scan, disabled live trading and terminal/asset availability. Provider freshness is reported separately so a Jupiter outage is not misclassified as a BecsBot process outage; strict market-data readiness is available through `SMOKE_REQUIRE_MARKET_DATA=1`. It does not send orders, change settings or buy a developer plan. Dependabot opens weekly npm and Actions update PRs; updates are not automatically merged.

Railway service variables, volume attachment and health-check configuration live outside this repository. The repository defines the startup command and expected variable names but cannot prove those external settings. No `railway.toml`, Dockerfile or Procfile is currently required.
