# BecsBot contributor instructions

BecsBot is a public Jupiter market-observation and paper-trading terminal with browser-local wallets and an optional private server paper account. Its purpose is to display provider data faithfully and make simulated trading behavior inspectable; it is not a wallet, custody service, signal oracle or live execution engine.

Read `ARCHITECTURE.md`, `RADAR_SPEC.md` and `SIGNALS_SPEC.md` before changing behavior. Keep these documents and `src/api/schemas.json` consistent with the implementation.

## Product rules

- This deployment is a public paper terminal. Keep `tradingEnabled: false`, blocked real transaction routes and server-side Jupiter credentials. Do not introduce a signer, wallet secret or real order path as part of routine maintenance.
- Preserve the stable `src/basket.js` Railway entry point and `DATA_DIR` chart history. Never reset persistent history or browser paper holdings to fix a UI issue.
- Radar, Signals and automatic paper buys must share launch filters and the selected source. Never fabricate marks, wallet scores, stream events or executable quotes.
- Missing, suspicious, stale or future-dated prices must not produce simulated fills. A $1 order means $1 gross token value; simulated fees are additional.
- Make iPhone controls usable at their native viewport. Keep sticky execution, bottom navigation, swipeable cards and 44px execution/detail controls.

## Repository map and boundaries

- `src/basket.js` is the stable Railway process entry point. `src/api` owns HTTP boundaries, `src/market` owns provider access and normalization, and `src/web` owns the browser terminal.
- `src/api/schemas.json` is the machine-readable API/provider contract. Update it with implementation and contract-test changes.
- The server owns provider credentials, scans, cached market snapshots and bounded chart history. The browser owns local paper balances, holdings, settings and the buy-once list. When server accounts are enabled, authenticated PostgreSQL transactions own those fields for that separate account; preserve the original local wallet.
- There is no Solana RPC client, wallet feed, WebSocket/SSE feed, signer or live position store in this repository. Do not document or program as if one exists.
- Do not introduce new thresholds, classifications, routing, slippage, sizing, scoring or strategy rules without an explicit product decision. Record ambiguity instead of guessing.

## Development

Read `SERVER_PAPER_SETUP.md` before changing authentication or server account persistence. Keep the default feature gate off without complete credentials; never accept client ownership or marks for server fills.

Use Node 22 or 24 and `npm ci`. `npm run check` validates syntax and compiles strict schemas. `npm test` runs unit and integration tests without credentials or external market calls. Run `npm run test:mobile` for UI changes; first install browsers with `npx playwright install --with-deps chromium webkit`.

Add regression coverage for behavior changes and errors, not tests that just restate markup. Keep fixtures in `test/fixtures`, unit tests in `test/unit`, HTTP/persistence integration tests in `test/integration`, and browser tests in `test/e2e`. Browser fixtures must remain local and paper-only.

Run `npm run test:smoke` to check Railway using read-only GET requests. Do not use production buys/sells to test deployment. Report checks that could not run instead of marking them passed.

Do not commit `.env`, keys, personal wallet data, runtime history, `node_modules`, or Playwright reports. Update the lockfile when changing dependencies. Keep changes focused; preserve API route compatibility during reorganization.

Treat every provider response and browser request as untrusted. Validate before normalization, preserve unavailable values as unavailable, bound caches/queues/body sizes, use timeouts, and avoid returning raw provider bodies or stack traces. Never log request headers or environment values.

Before deployment-related changes, verify `npm ci`, `npm run check`, `npm test`, production startup, health behavior and the persistent `DATA_DIR` assumption. Keep Railway listening on `0.0.0.0` and the supplied `PORT`. Shutdown must stop new scans and close the HTTP server without deleting persisted history.

