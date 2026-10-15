# Ordered forwarding upgrades

Targets: Railway becs. / production / BecsBot, repository
icommas1/BecsBot branch becs-forwarding-v1. Preserve the existing database,
sessions, secrets, domain, one replica, and control-bot identity.
Frontend: existing becs-crypto-forwarding-terminal-59lgyp AppDeploy application;
baseline applied snapshot 1791766571341. Preserve the Express propagation fix.
Standalone source: icommas1/-becsmebot main; retain explicit deployment configuration.

Implementation order (capability level gates both API and interface):
1. Shadow Mode, shared address-only rules, case-correct address keys, interrupted-send recovery.
2. Private decision explanations with bounded address-only records.
3. Route health and queue age.
4. Workspace-local reusable filter presets.
5. Source comparison, observed from upgrade installation onward.
6. Existing configuration ZIP preview and additive disabled/shadow route import into the owner's own workspace.
7. Mobile form/focus preservation, request timeouts, reduced-motion layout polish.

Preflight: verify exact live source and rollback snapshot; inspect current files;
preserve signed authentication and disabled sensitive recovery; use additive,
idempotent migrations; run the full backend and mocked browser checks in CI;
confirm frontend API origin and absence of credentials; reconcile unsigned-launch
QA plus synthetic feature tests; deploy backend before enabling frontend controls;
observe each Railway release SUCCESS and final AppDeploy ready.

Coverage: tests/test_upgrades.py covers migration, shadow/no-send, live dedupe,
case-sensitive Solana identity, simulator parity, interrupted sending, trace
retention, workspace isolation, feature gates, presets, health/source aggregation,
backup validation and disabled-only import. tests/browser_upgrades.py covers
desktop/mobile route shadow controls, explanations, presets, source comparison,
restore preview, mobile state and denied API behavior with intercepted requests.
Existing CI remains mandatory. No real Telegram sends as tests.
