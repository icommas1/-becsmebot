# BecsBot phase reconciliation — 2026-10-02

Verified baseline: merged main `a63296f09ad1840c2f4888ba868a0fd92fd7c692` (PR #53), green main CI, successful Railway deployment, no open PRs or issues. This file describes implemented capabilities and explicit dependencies; it does not turn product mockups into approved trading rules.

| Phase | Status and evidence |
| --- | --- |
| Original engineering phases 0–13 | Delivered in merged #30: repository guidance, source boundaries, contracts, validation, failure handling, CI, browser tests and deployment smoke. |
| Dashboard modules and transport | Delivered in #31–#33; compact basket, separate bounded charts, ETags and 15-second browser polling. |
| Decision and execution separation | Delivered in #34 and hardened in #42/#52; shared DecisionEngine → normalized OrderIntent → PaperExecutor. Live execution remains unreachable. |
| Mobile resilience, Dex feeds and diagnostics | Delivered in #35–#40/#52; nineteen sources, scroll/recovery fixes and reporting/delayed/pending labels. |
| Paper performance | Delivered in #41 using recorded cost basis; legacy entries with missing basis stay explicitly excluded from returns. |
| Duplicate protection and private accounts | Delivered in #43–#45; GitHub sign-in and PostgreSQL are configured in production. Browser and server accounts remain separate. |
| Wallet intelligence | Provider boundary and normalization delivered in #46. Ingestion is disabled pending a valid provider key; no invented scores or trade observations. |
| Evidence and proof ledger | Delivered in #47/#52; append-only BecsEvents and local proofs, transactional with paper mutations. |
| Permanent research archive | Delivered in #48–#53, including durable queue, optional-field handling, provenance and verification. New collection is intentionally disabled by the owner; existing history remains. |
| Paused-mode operations | This change makes release checks independent of archive capture, asserts the expected disabled state, and skips research-only scan copies while paused. |
| Full verification and restore readiness | This change adds a read-only full-history verifier and a disposable PostgreSQL dump/restore comparison in CI. Independent production backups remain unconfigured. |

## Actual remaining dependencies

- **Independent production backups:** need an owner-only encrypted external destination and its access configuration. The restore procedure and fixture rehearsal do not establish a production backup.
- **Storage expansion:** Railway still limits each existing volume to 500 MB. Collection is off; capacity/billing changes belong to the owner. Do not purge history or resume collection as a substitute.
- **Smart Wallet activation:** requires a provider credential and any required subscription. Existing normalization and tests are complete; enabling it is not possible without that input.
- **Long-horizon outcomes, rejection research, Memory/Lab recommendations:** require an approved collection scope and evidence. These remain deferred under the stop-storage instruction; no new strategy thresholds or research claims have been invented.
- **Real signing/live execution:** explicitly excluded, including live executors, wallet routing and tiny-value live tests. Completing safe phases does not authorize activation.
- **Feed freshness:** production scans updated all nineteen feeds. A confirmed browser issue left the last Reporting labels frozen after failed or stalled requests; the follow-up freshness change makes those labels age, shows cached/disconnected status, and revalidates on tab/network recovery. The original specific stale screen has not been identified, so no provider-side outage is claimed.

## Branch reconciliation

Fifty-two retained branch heads match merged PRs. Their presence does not represent unfinished implementation. The three unmerged branches are preserved: `fix/research-archive-json-normalization` and its `-v2` variant are superseded by #49; `maintenance/phase1-docs-repo-guidance` is superseded by the guidance delivered in #30. No old branch should be merged wholesale into current main, especially branches for the retired signing/Pump paths. No branches, credentials, wallets, volumes or historical rows were deleted during this reconciliation.
