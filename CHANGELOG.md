# Changelog

All notable repository-level changes are recorded here. Product strategy and proposed behavior do not belong in this file.

## Unreleased

- Continue operational, security and reliability review of the public paper terminal.

## 2026-09-30

- Reorganized the service into API, market and web boundaries while preserving `src/basket.js` as the Railway entry point.
- Added strict local and upstream data contracts, bounded provider requests and deterministic fixtures.
- Added unit, integration and Playwright coverage for Radar, Signals, paper accounting, contracts and mobile layout.
- Added GitHub CI, Dependabot, repository templates and read-only Railway smoke checks.
- Removed the unused wallet-capable Solana SDK and retained canonical mint validation with a non-signing base58 dependency.
