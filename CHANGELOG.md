# Changelog

All notable repository-level changes are recorded here. Product strategy and proposed behavior do not belong in this file.

## Unreleased

- Reject missing market contexts, invalid paper ledgers and corrupt sale cost basis at the PaperExecutor boundary before any simulated fill.

- Add a paper Performance view for recorded simulated sales with per-sale basis, net return, source filtering and entry-cap chart. Older sales remain visible in ledger P/L but are excluded from return statistics.

- Show a readable 19-feed readiness count and per-source last-success status in the Feeds panel, including retained data for delayed sources.

- Route the terminal through a lean launch shell and `/terminal` home-screen web app entry; remove the long Radar note from initial presentation.

- Preserve mobile card/panel/detail scroll during refresh and improve token-sheet close targets, backdrop dismissal and focus restoration.


- Add six bounded, independently failing DexScreener discovery feeds with Jupiter mint enrichment, explicit paid labels and shared Radar/Signals/auto filters. Expand contracts and read-only readiness checks to nineteen feeds.

- Add browser request deadlines and recovery, resilient startup with blocked storage, persistent failed-save warnings, and visible search failures.
- Separate shared decisions and OrderIntents from account-scoped paper execution while preserving existing paper accounting and stored holdings.
- Scope revision ETags to each server instance so restarts cannot reuse a validator for changed data.
- Split chart history from the frequent basket response, cap browser chart trails at 120 extrema-preserving points, compact Signals transport, and add conditional ETag requests. The browser now polls every 15 seconds and reloads chart history only after a completed scan; server-side signal history and paper behavior remain unchanged.

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
