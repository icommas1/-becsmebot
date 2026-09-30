# Changelog

All notable repository-level changes are recorded here. Product strategy and proposed behavior do not belong in this file.

## Unreleased

- Split the dashboard into shared rules/state helpers, API access, Radar/Signals views and paper-wallet views without changing routes or trading behavior.

- Added security, contribution and operations guidance plus explicit data-source-of-truth documentation.
- Added safe handling for explicit unavailable Price V3 marks and deterministic duplicate-feed normalization.
- Expanded Playwright coverage to six desktop/mobile/tablet projects and all terminal navigation panels.
- Added browser security headers, generic provider-facing failures and a production dependency audit in CI.
- Separated process-health smoke checks from optional strict provider-readiness checks.
- Limited full history pruning to the scan interval instead of every browser snapshot read.
- Added validated runtime configuration, graceful shutdown and production-runtime integration coverage.

## 2026-09-30

- Reorganized the service into API, market and web boundaries while preserving `src/basket.js` as the Railway entry point.
- Added strict local and upstream data contracts, bounded provider requests and deterministic fixtures.
- Added unit, integration and Playwright coverage for Radar, Signals, paper accounting, contracts and mobile layout.
- Added GitHub CI, Dependabot, repository templates and read-only Railway smoke checks.
- Removed the unused wallet-capable Solana SDK and retained canonical mint validation with a non-signing base58 dependency.
