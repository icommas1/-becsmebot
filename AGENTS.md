# BecsBot contributor instructions

Read `ARCHITECTURE.md`, `RADAR_SPEC.md` and `SIGNALS_SPEC.md` before changing behavior. Keep these documents and `src/api/schemas.json` consistent with the implementation.

## Product rules

- This deployment is a public paper terminal. Keep `tradingEnabled: false`, blocked real transaction routes and server-side Jupiter credentials. Do not introduce a signer, wallet secret or real order path as part of routine maintenance.
- Preserve the stable `src/basket.js` Railway entry point and `DATA_DIR` chart history. Never reset persistent history or browser paper holdings to fix a UI issue.
- Radar, Signals and automatic paper buys must share launch filters and the selected source. Never fabricate marks, wallet scores, stream events or executable quotes.
- Missing, suspicious, stale or future-dated prices must not produce simulated fills. A $1 order means $1 gross token value; simulated fees are additional.
- Make iPhone controls usable at their native viewport. Keep sticky execution, bottom navigation, swipeable cards and 44px execution/detail controls.

## Development

Use Node 22 or 24 and `npm ci`. `npm run check` validates syntax and compiles strict schemas. `npm test` runs unit and integration tests without credentials or external market calls. Run `npm run test:mobile` for UI changes; first install browsers with `npx playwright install --with-deps chromium webkit`.

Add regression coverage for behavior changes and errors, not tests that just restate markup. Keep fixtures in `test/fixtures`, unit tests in `test/unit`, HTTP/persistence integration tests in `test/integration`, and browser tests in `test/e2e`. Browser fixtures must remain local and paper-only.

Run `npm run test:smoke` to check Railway using read-only GET requests. Do not use production buys/sells to test deployment. Report checks that could not run instead of marking them passed.

Do not commit `.env`, keys, personal wallet data, runtime history, `node_modules`, or Playwright reports. Update the lockfile when changing dependencies. Keep changes focused; preserve API route compatibility during reorganization.
