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
| `src/web/dashboard.html` | Semantic terminal shell and self-hosted module entry point |
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
Jupiter Price V3 / Tokens V2
  -> strict upstream schemas
  -> canonical-mint normalization and feed deduplication
  -> bounded market cache and persisted observations
  -> Radar rows and observed Signals
  -> validated Express responses
  -> browser presentation and browser-local paper accounting
```

The process scans SOL Price V3 and thirteen Tokens V2 feeds once a minute. Jupiter requests are serialized with a 2.2-second gap, a ten-second timeout, a 24-request pending bound and at most one 429 retry. The scan cannot overlap itself. Successful feed data replaces its prior cache; failed feeds retain their prior timestamps and an error. Schema failures follow the same failure path. Fresh metadata cannot refresh a cached price timestamp.

Normalization merges canonical mints and feeds. Positive finite prices and numeric metrics are retained; absence stays unavailable. The server retains full observed history for signal ranking. `GET /api/basket` sends feed timestamps, Radar rows and compact Signals references; the browser joins each signal to its Radar row by mint. `GET /api/history` sends chart trails separately, downsampled to at most 120 points per mint while retaining endpoints and bucket extrema. The browser revalidates the basket every 15 seconds and requests chart history only after `lastScanAt` changes. ETags return 304 for unchanged basket/history revisions. Market scans remain once per minute; REST polling does not make scans faster or turn them into a stream.

`DATA_DIR/market-history.json` is atomically replaced with restricted file permissions. History keeps up to 1,000 mints, 1,440 points per mint and 24 hours. Invalid, old and future observations are discarded. Pruning is shared and limited to once per scan interval so repeated browser snapshot reads do not repeatedly sort the complete history. Failure to read history rebuilds it from later scans; persistence errors do not stop market discovery. Railway's `/app/data` volume must remain mounted.

## HTTP contract

| Route | Behavior |
| --- | --- |
| `GET /` | Full terminal |
| `GET /assets/becs-logo.jpg` | Fixed supplied artwork |
| `GET /health` | Liveness, feed/scan state, real trading disabled |
| `GET /api/basket` | Validated cached market snapshot |
| `GET /api/history` | Validated, bounded chart trails, independent from signal history |
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

Browser API requests have a 60-second deadline covering both the response and its JSON body. A timeout releases refresh/marking locks through their existing `finally` paths; later refreshes can recover, and successful conditional-response caches are retained. If browser storage is blocked, the terminal still opens with session-only paper state and reports failed saves without replacing that warning with a success message. Search failures appear in the empty Radar state and recover on later queries.

Manual contact actions, dock actions and auto use the same paper accounting functions. Sells require current Price V3 marks; estimated portfolio values may show labeled stale marks. See the radar and signals specs for eligibility and state rules.

### Strategy and execution boundary

The production paper path is:

`Radar / Signals -> DecisionEngine -> OrderIntent -> PaperExecutor -> browser-local paper ledger`.

The modules under `trading/` do not require the DOM, browser storage, provider clients or network access. They can also be imported by Node. The decision engine evaluates the existing launch filters, selected auto source, buy-once history and optional multiple target against input snapshots. It returns no action or intent(s), without modifying cash, positions, activity or exit flags. The strategy identifier is `launch-v1`, version `1`; the strategy and its thresholds are unchanged.

An OrderIntent contains a UUID `intentId`, independent `userId` and `accountId`, strategy ID/version, creation time, asset identifier, side, quantity with mode/unit, market/reduce-only/cap constraints, and decision reason/source. Dollar requests use `quote`/`USD`; percentage exits use `position_fraction`/`fraction`. Intents carry no provider routes, transaction objects, keys, RPC details, fees or fill prices. A retry should retain the original intent ID. Durable duplicate protection and pending-order persistence are deferred; this synchronous paper phase must not be reused as a live execution queue.

An Executor implements `execute(intent, marketContext) -> ExecutionResult`. PaperExecutor validates ownership and paper mode before touching its supplied ledger, checks fill data, and owns impact, extra fees, reserve checks, proportional cost basis, position changes, realized P/L and one-time target-exit flags. It returns requested quantity separately from filled token/quote quantities, fill price, USD fees, status/rejection reason and creation/completion timestamps. The existing price cache and UI messages use a thin compatibility adapter. Execution results are currently returned internally, not persisted as a separate journal or exposed over HTTP.

Each local ledger now carries an `account` with independent random local user and paper account IDs and an explicit execution mode. Existing `becsPaperV1` data migrates without changing cash, holds, settings, activity or buy-once records; save/reload preserves IDs, reload still disables auto, and resetting balances retains account identity. Executor instances receive their account and ledger explicitly; no singleton balance or position map is used. The current browser still exposes only one local ledger. These IDs express ownership within that ledger; they are not authenticated identities or cross-device isolation. Authentication and account-scoped server persistence must precede any real multi-user product.

Trading mode belongs to account routing, not strategy identity or the intent payload. A strategy may describe a request for a future live account, but the only executor implementation is PaperExecutor, which rejects live mode both at construction and execution. There is no LiveExecutor, signing dependency, submission route or mode switch that enables real trading. A future live guard and executor require a separate phase.

The execution boundary is intentionally one-way: the browser can request public market/search/price data, but the server exposes no signing route. Compatibility paths under `/api/sell` and `/api/pause` always return 410. Tests replace provider access with fixtures and assert that paper actions do not call those paths.

## Verification and delivery

CI runs syntax/schema checks and unit/integration tests on Node 22/24, plus iPhone WebKit, mobile Chromium and desktop Chromium using a local fixture server. Failures retain traces/screenshots for seven days. No test needs a production API key.

The Railway workflow runs after pushes to main, manually, and every six hours. It makes only five GET requests per attempt, allows deployment warm-up retries, validates contracts including bounded chart history, confirms all thirteen configured feeds, a recent scan, disabled live trading and terminal/asset availability. Provider freshness is reported separately so a Jupiter outage is not misclassified as a BecsBot process outage; strict market-data readiness is available through `SMOKE_REQUIRE_MARKET_DATA=1`. It does not send orders, change settings or buy a developer plan. Dependabot opens weekly npm and Actions update PRs; updates are not automatically merged.

Railway service variables, volume attachment and health-check configuration live outside this repository. The repository defines the startup command and expected variable names but cannot prove those external settings. No `railway.toml`, Dockerfile or Procfile is currently required.
