# Contributing

Read `AGENTS.md`, `ARCHITECTURE.md`, `RADAR_SPEC.md` and `SIGNALS_SPEC.md` before changing behavior. Keep changes narrow and preserve the public paper-only boundary.

## Local verification

Use Node 22 or 24:

```sh
npm ci
npm run check
npm test
```

For browser changes, install Chromium and WebKit with their system dependencies and run `npm run test:mobile`. The Playwright server is deterministic and must not be replaced with the production service. Use `npm run test:smoke` only for the documented read-only deployment check.

## Change expectations

- Add behavioral regression coverage for bug fixes and contract changes.
- Update API schemas and architecture/specification documents when behavior changes.
- Keep paper operations in browser-local simulation code; do not add a signer or live-order call to make a test pass.
- Preserve unavailable, missing or stale provider values as unavailable.
- Do not include generated reports, runtime history, credentials or personal wallet data.
- Explain checks that could not run and distinguish environmental failures from code failures.

Pull requests should state user-visible behavior, safety impact, tests run and deployment considerations. Dependency updates are reviewed like code changes and are not automatically merged.
