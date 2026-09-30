# BecsBot Jupiter terminal

Public full-page markets and paper trading dashboard. No login. Real transaction routes return 410; the runtime does not load a wallet signer or private key.

## Terminal interface

Desktop has a left signal rail, central SVG radar and compact token contacts, right paper wallet/execution module, an observed activity tape and persistent dollar execution dock. iPhone uses bottom navigation, horizontally swipeable cards, 44px trading buttons and native modal slide-up details. $1/$5/$10/custom sizing affects manual dock orders only; automatic buys retain their configured amount. Contact buttons always buy/sell $1.

Radar positions encode age with a small deterministic spacing jitter; blip sizes encode a heuristic activity score from organic score, 5m volume and momentum. Labels appear on hover/focus, and every blip is keyboard selectable. States NEW/HEATING/TRENDING/COOLING use observed age/change/feed membership; EXIT means an auto target sale occurred on that hold. These are display labels, not predictions. No wallet score or external wallet-trade stream is invented. The tape combines newly observed eligible contacts and local paper executions. The sweep is visual instrumentation; scan status remains tied to the actual REST scan. Reduced-motion preferences disable animation.

## Markets and signals

The terminal opens to New launches sorted newest first. Default shared launch filters are age ≤24 hours, market cap ≤$1 million and liquidity ≥$2,000. Missing age/cap, suspicious tokens and stale/unavailable prices are excluded. Launch filters live directly above the radar with a restore button; minimum/maximum age and cap, liquidity, holders, organic score and 5m volume remain adjustable. Age uses token creation time with first pool time as fallback. Older saved unrestricted filters migrate once without clearing paper holds or cash.

Jupiter Tokens V2 provides trending, top traded and organic categories for 5m, 1h, 6h and 24h, plus recent pools and token search. Server scans run every minute. This is REST polling, not a streaming feed. Feed errors and timestamps appear under Feeds.

Server chart observations persist for up to 24 hours in `DATA_DIR/market-history.json`. Signals ranks current multiples against the first retained observation and shows peak multiples and the starting time. It does not claim launch returns or trading profits. Each signal and hold has a token address, Copy CA and Dex Screener link.

## Paper trading

Default buys spend $1.00 before the configurable simulated network fee. Manual and auto buys use the same fill logic and filters. Sell $1 sells up to $1 of the position before the fee; Sell all closes it. Price impact and fees are simulation settings, not executable quotes. SOL input amounts depend on the observed USD price; real exactly-$1 execution is not guaranteed.

Auto source follows the selected launch tab and interval. Radar, Signals and auto buys use the same launch filters; token search respects those filters but does not change the auto source. An optional multiple target above 1 triggers one $1 paper sale per hold, using the same sale logic; 0 disables it. Auto is off after reload and runs only while the page is open. Paper balances, holds and settings save in this browser. Server market scanning and charts continue when it closes.

Buys need recent Tokens V2 and SOL marks. Sells need a recent Jupiter Price V3 mark; omitted prices remain unavailable and cannot produce fills. Price refreshes cover all holds in batches. Last known marks can still appear in estimated portfolio values and are labeled stale.

## Run

Node 20+, `npm ci`, `npm test`, `npm start`. Set `JUPITER_API_KEY`; optionally set `PORT` and persistent `DATA_DIR`. API keys remain server-side. No paid plan is purchased by this project.

Jupiter calls are serialized, spaced 2.2 seconds apart, cached and bounded. One 429 retry uses the reset header. Public search and price endpoints validate inputs and rate limit requests.

Tests cover normalization, incoming feeds and failures, missing prices, history persistence, observed signal multiples, retry/queue behavior, public endpoint validation, blocked signing routes, and paper dollar accounting. Fixtures verify behavior; they do not predict returns or guarantee live liquidity.

## Contributor guide and repository checks

Read [AGENTS.md](AGENTS.md), [ARCHITECTURE.md](ARCHITECTURE.md), [RADAR_SPEC.md](RADAR_SPEC.md) and [SIGNALS_SPEC.md](SIGNALS_SPEC.md). The stable Railway entry point remains `src/basket.js`; market modules, API contracts and browser assets are separated under `src/market`, `src/api` and `src/web`.

Copy `.env.example` to `.env` for local configuration and keep your API key server-side. Use Node 22/24 for CI parity.

```sh
npm ci
npm run check
npm test
npx playwright install --with-deps chromium webkit
npm run test:mobile
npm run test:smoke
```

`npm test` is offline and credential-free. Playwright starts a deterministic local Express fixture on port 4173 and tests iPhone WebKit, mobile Chromium and desktop Chromium. `npm run verify` combines syntax/schema, unit/integration and browser checks. Browser reports and traces are generated locally and ignored by git.

Smoke defaults to the public Railway origin; override `SMOKE_BASE_URL` for a fixture or staging service. It only uses GET requests and checks API contracts, thirteen healthy feeds, a recent scan/SOL mark, terminal controls and logo. `SMOKE_ATTEMPTS` allows bounded deployment warm-up retries. GitHub CI runs on PRs/main; Railway smoke runs on main, manually and every six hours. Dependabot checks npm and Actions weekly. API schemas are in `src/api/schemas.json` and validate successful responses and upstream payloads without coercion.
