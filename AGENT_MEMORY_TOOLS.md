# Memory evidence and constrained tool review

These modules implement owner-only evidence reporting and a bounded, signed tool-review workflow. They do not implement an autonomous agent, a semantic memory materializer, arbitrary tool invocation, or live execution.

## Memory report

The terminal's `/memory` screen renders these owner-only reads and links the JSON export. It clears private evidence on page hide or authentication failure and never saves the report to browser storage. Display limits are centralized in `src/memory/config.js`. The public HTML shell has no owner evidence; report access still requires the configured GitHub session.

One report runs at a time, using a separate concurrency counter from paper
commands. Slow or failed reads cannot consume paper command slots. Agent registry
connection and validation limits live in `src/agent/config.js`, alongside the
centralized evaluator policy.

With server accounts enabled, `GET /api/memory/coverage` and `GET /api/memory/coverage/export` require the existing GitHub owner session. The latter downloads the same JSON report. Neither accepts caller-selected users, streams or filters. Unauthenticated, other-owner and revoked sessions fail; no-store headers apply.

The adapter opens a repeatable-read, read-only transaction, never initializes schemas, and reads only that owner's retained BecsEvents. Counts are grouped by event category and observed strategy/source provenance. Sequential hashes are checked against the retained stream head. The report distinguishes unavailable, empty, verified, invalid and partial evidence. It verifies up to 5,000 events in pages of 50 with a five-second loop budget and 1.5-second SQL deadlines; a running statement may finish after the loop budget. Categories and provenance groups are bounded to 64. Larger histories are explicitly partial; use the full-storage verifier for complete offline checks.

`memory.status` is `not_implemented`, with null record counts and coverage percentage. Retained event completeness is not semantic memory completeness. Human sessions, browser-local history, rejected commands and the separate research store are outside this report. Strategy versions do not establish source-code freshness. No collection is resumed and no memory rows or checkpoints are written.

## Configuration and trust

Tool routes are absent unless `AGENT_TOOLS_ENABLED=true`. Enabling requires configured server-account authentication, `AGENT_EVALUATOR_IMAGE` in the exact form `node:24-alpine@sha256:<64 lowercase hex digits>`, and an Ed25519 PEM public key in `AGENT_EVALUATOR_PUBLIC_KEY`. The private signing key belongs only on the evaluator host.

`src/agent/policy.json` centrally defines the initial capability (`event.coverage`), input-read permission, fixed verifier cases and budgets: 256 candidates, three reservations per candidate, 24 per UTC day. Reservations consume budget even if a worker crashes or its response is lost. Candidate creation and budget accounting use PostgreSQL transactions. These are resource limits, not trading thresholds.

The initial tool checks missing, orphan and duplicate event IDs in supplied JSON. It cannot query a database or export private evidence. Positive, negative and held-out combinations are public fixed regressions, not secret evaluation data or proof of generalization. Candidate code cannot choose its verifier.

## Owner-authenticated workflow

All writes require the existing owner session, exact configured Origin and strict request schemas. The common request throttle applies. Registration does not accept caller-supplied ownership, capabilities, policy, permissions or execution mode.

1. `POST /api/agent/tools` with `{name, code}` stores the immutable source and hashes of source, policy and verifier, plus the pinned image. Identical registrations return the existing bundle hash.
2. `POST /api/agent/tools/:hash/evaluations/reserve` with `{}` atomically consumes budgets and returns a private manifest with a nonce and 15-minute deadline. Save it as `manifest.json`. Lost responses do not refund budgets.
3. On a dedicated disposable evaluator host with Docker and the exact image already pulled, run `AGENT_EVALUATOR_PRIVATE_KEY_FILE=/private/evaluator-key.pem node scripts/agent-evaluate.js manifest.json`. Deny group/other access to the private-key file. The supervisor verifies hashes, probes isolation, independently runs fixtures and signs its report. Do not put production credentials or data on this host.
4. `POST /api/agent/tools/:hash/evaluations` with the resulting `{report, signature}`. The backend verifies the pinned public key, nonce, reservation, times, bundle, policy, verifier, image and test totals. Browser assertions cannot substitute for signed evidence.
5. Inspect `GET /api/agent/tools/:hash`. After review, `POST .../:hash/approvals` with `{evaluationId}` creates a five-minute approval token bound to that successful evaluation. One token may be issued per evaluation; lost or expired tokens require a new evaluation within the remaining budget.
6. `POST .../:hash/promote` with `{evaluationId, approvalToken}` consumes the token and marks the candidate `reviewed` in one transaction. Concurrent retries, expiration and replay after restart fail. The result always says `executionEnabled:false`. No invocation endpoint or executor is attached to the registry.

Creation, reservation, evaluation, approval and review decisions enter an append-only audit table. Budget and consumed approval rows are retained and included in the full-storage restore fingerprint. Database administrator privileges can bypass application controls; internal hashes are not protection against a privileged rewrite.

## Isolation and tests

Each Docker fixture uses a nonroot UID, immutable image, no network, read-only root and source mount, all capabilities dropped, no-new-privileges, 128 MiB memory with no extra swap, one CPU, and 32 PIDs. Wall time is five seconds and output is limited to 64 KiB. No host credentials, key, repository directory or Docker socket is mounted. The host compares results with fixed expected values. Containers are force-removed on completion or failure; unverified isolation or cleanup cannot produce successful evidence.

CI checks working and false-all-clear candidates, read-only/network/UID/capability probes, timeout, excess output and cleanup. Docker shares its host kernel; use a dedicated disposable, patched host. Database tests cover real hashed sessions and revocation, ownership, read-only reporting, partial and corrupt evidence, forged signatures, concurrent promotion, persistent budgets and replay, expiry, and append-only audit guards. A real disposable dump is encrypted, decrypted, restored and compared, including registry state.

## Production dependencies

Activation needs an independent encrypted backup destination with retention/access configuration, an owner-held backup key, and a dedicated evaluator with privately provisioned signing keys and a pinned image. These are not silently provisioned or enabled. Research collection stays paused; real trading stays disabled.
