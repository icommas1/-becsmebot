# BecsBot phase reconciliation — 2026-10-02

## Fundamentals integration — 2026-10-04

This integration starts from verified main `7889535672eba1c0b191a870010f5fdb03884835` and reconciles the pinned implementation heads of PRs #57, #58, #59, #61 and #63. Previous source copies and unfinished working trees are preserved. The older sections below are dated evidence, not claims about the latest release.

Final reconciliation includes observer head `5cc991446e2acb73311c1896f5379b704e3bcfae`
and report head `1d49fc693abae39a15798b4507a4f2c69649180b`, which advanced during
validation. Their retained-witness monitoring and per-context browser fixture
isolation are preserved; existing event/archive contracts remain unchanged.

| Fundamental | Implemented behavior |
| --- | --- |
| Strategy, Radar and Signals | Existing launch-v1 decision rules, shared filters and observed multiples retained; no new trading thresholds. |
| Paper accounting and wallets | Existing local/server separation, fresh-mark checks, fee/cost-basis accounting and duplicate protection retained. |
| Sources & tools | Nineteen-feed status and selected-tool catalog, with truthful reader/support roles. |
| Research workspace | Authenticated on-demand Exa/Parallel reads; bounded queries, original URLs and RAM-only results; browser-local recipes are separate from holdings. |
| Memory evidence | Owner-only event coverage/export plus a usable view; partial and invalid checks are explicit. Semantic memory is not implemented. |
| Tool review | Separate isolated evaluation, signed receipts, persistent budgets and one-use review approvals. Registry remains gated off; reviewed tools have no execution rights. |
| SuperAgent observation | Durable, scoped ingestion and restart/duplicate protections plus a same-origin report. Production observer/report remain off pending a separate database and exact bindings. |
| Production reliability | Existing retained-record pin, archive crash recovery, disabled collection and release verification are preserved. |

Storage expansion, archive resumption, independent production backups and evaluator/observer provisioning are deferred by the owner's current instruction. No credential or production feature gate is changed by this implementation. Validation and deployment outcomes belong in the release PR checkpoint; local checks, CI fixtures and production evidence must remain distinct.

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
| Permanent research archive | Delivered in #48–#53, including durable queue, optional-field handling, provenance and verification. New collection remains disabled pending storage capacity and backups; the owner requested completion on 2026-10-04. Existing history remains. |
| Paused-mode operations | This change makes release checks independent of archive capture, asserts the expected disabled state, and skips research-only scan copies while paused. |
| Full verification and restore readiness | This change adds a read-only full-history verifier and a disposable PostgreSQL dump/restore comparison in CI. Independent production backups remain unconfigured. |

## Actual remaining dependencies

- **Independent production backups:** need an owner-only encrypted external destination and its access configuration. The restore procedure and fixture rehearsal do not establish a production backup.
- **Storage expansion:** Railway still limits each existing volume to 500 MB. Collection is off; capacity/billing changes belong to the owner. Do not purge history or resume collection as a substitute.
- **Smart Wallet activation:** requires a provider credential and any required subscription. Existing normalization and tests are complete; enabling it is not possible without that input.
- **Memory evidence and tool review:** owner-only read-only evidence reporting, a disabled tool-review registry, signed isolated evaluation and approval replay controls are implemented in this change. Semantic memory materialization, long-horizon outcomes and rejection collection still require an approved collection scope; paused research is not resumed. See `AGENT_MEMORY_TOOLS.md`.
- **Real signing/live execution:** explicitly excluded, including live executors, wallet routing and tiny-value live tests. Completing safe phases does not authorize activation.
- **Feed freshness:** production scans updated all nineteen feeds. A confirmed browser issue left the last Reporting labels frozen after failed or stalled requests; the follow-up freshness change makes those labels age, shows cached/disconnected status, and revalidates on tab/network recovery. The original specific stale screen has not been identified, so no provider-side outage is claimed.

## Branch reconciliation

Fifty-two retained branch heads match merged PRs. Their presence does not represent unfinished implementation. The three unmerged branches are preserved: `fix/research-archive-json-normalization` and its `-v2` variant are superseded by #49; `maintenance/phase1-docs-repo-guidance` is superseded by the guidance delivered in #30. No old branch should be merged wholesale into current main, especially branches for the retired signing/Pump paths. No branches, credentials, wallets, volumes or historical rows were deleted during this reconciliation.


## Archive continuation — 2026-10-04

The starting main was verified as `cdf1222af54303fb78baaf6b98badd45bd870b5c`, with successful main CI and Railway deployment `dd224a72-9ba8-4e44-afa4-5495befcbd3c`. The deployed service had live execution disabled and collection paused. Open feature PRs #57–#59 and earlier uncommitted checkouts were preserved; none were merged as part of the archive scope.

This scoped archive change adds owner-only metadata/payload retrieval while paused, hash/byte validation, an aggregate historical retrieval witness, fsynced temporary-spool recovery, and database tests for lost responses, replacement collectors, duplicate IDs and stream/account isolation. Retention rules and delivery limits are explicit. CI fixtures remain separate from production evidence.

Continuous capture and production backup/restore are still blocked: Railway reported PostgreSQL disk usage of 0.422 GB on a 500 MB volume, and no independent backup destination is configured. Local checks, PR CI and post-deployment restart evidence must be reported separately; this document does not assert an unperformed production restore or new capture.
