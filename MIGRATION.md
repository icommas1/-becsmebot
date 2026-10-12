# BecsAutoForward migration provenance

Inspected on 2026-10-12 using repository inventory, Git refs and ancestry, and implementation code. No GitHub README was read or used as a source.

The intended new repository is **`icommas1/BecsAutoForward` (PRIVATE)** with default branch `main`. GitHub repository creation is blocked by the connected integration; publication remains pending. Source repository branches are untouched. Local extraction does not establish that the new GitHub repository exists or that migration has been published.

## Account repositories inspected

| Repository | Visibility | Observation |
|---|---|---|
| `icommas1/dot-widget` | PRIVATE | Inspected inventory |
| `icommas1/BecsBot` | PRIVATE | Forwarding source |
| `icommas1/-becsmebot` | PUBLIC | Empty |
| `icommas1/bexs` | PRIVATE | Inspected inventory |
| `icommas1/BecsSuperAgent` | PUBLIC | Separate project |

## Selected implementation and branch history

Reviewed **87 concrete BecsBot branch refs**, excluding the symbolic `origin/HEAD` alias. **13 forwarding branches** contain the Python forwarding implementation. Their exact source commits are recorded below and in [the machine-readable manifest](migration/branch-manifest.json).

The baseline is `becs-forwarding-v1` at **`34acedd607e5648153a47cfa591e0e979191c164`**. Its current tree is a standalone Python/FastAPI Telegram forwarding project; the unrelated market-terminal branch heads are excluded. New `main` starts from this baseline; its extraction commit is pending and must be recorded after the separation changes are committed. Historical refs retain their original commits and names.

| Source branch | Exact source commit | Transfer status |
|---|---|---|
| `becs-forwarding-v1` | `34acedd607e5648153a47cfa591e0e979191c164` | Baseline |
| `becs-multi-account-isolation` | `2cc7c0ba623028b54cc61fab471d91742dfac74b` | Divergent history; preserve only |
| `feature/becs-chat-picker` | `9783e24120788b335334e1145296d8037173e07e` | Integrated history |
| `feature/becs-chat-search-fix` | `ba3dbf76ad9397a5e454229244b76c0014c0bec7` | Integrated history |
| `feature/becs-dashboard-session-5m` | `465f5be49fc0250c09aef6a2aa6ba8d96d4025ca` | Integrated history |
| `feature/becs-owner-status` | `a8a73e16a4e2a946d4a56ca1c80ff0a5f61abe4e` | Integrated history |
| `feature/becs-smart-filters-v2` | `409952756a0f06c56da85defef36960b8e31e57b` | Integrated history |
| `feature/disable-sensitive-recovery` | `29382e7aea025f2b21c4724628313e153ae6ab75` | Integrated history |
| `feature/private-invites-workspaces` | `d5ce9b49b535529f401f736ff674bae8cf4c6c76` | Integrated history |
| `feature/recovery-consent-encrypted-v1` | `a991dbcf0362a10ec7f4fde93049a7c41cf22fdd` | Integrated history |
| `fix/becs-bot-destinations` | `582ece0209949728284e19316602a9f5158c2e97` | Integrated history |
| `simplify/becs-forward-only-v1` | `834cee7f9938570e4089d894e792e85b872b6318` | Integrated history |
| `test/becs-isolated-filters-20261010` | `eafadd38618712a38b0ed5bba9d75e778fa235b3` | Integrated history |

Twelve refs, including the baseline, are ancestors of the baseline. The sole divergent branch, `becs-multi-account-isolation`, adds one unused `app/accounts.py` scaffolding commit. Preserve its ref without merging it: the current implementation already isolates approved users through access controls, runtime managers, and per-user SQLite workspaces.

The five-minute dashboard lock was intentionally reverted at the owner's request in `37c69e2576747b735fd2ade10ebf0395a4fb8f02`. The native full-message forwarding branch was later superseded by contract-address-only delivery, including `dd5478e27c974e6f2add385b34c0641f8e4c3852`. Preserving these historical refs does not reactivate either behavior. The baseline retains contract-address-only forwarding and deduplication, signed Telegram authentication, private approved workspaces, and disabled sensitive recovery.

## Publication and verification

Publication is pending because the GitHub integration could not create the intended repository. Keep the BecsBot refs intact until the new repository is available and its transferred refs are verified. Record the final `main` extraction commit and actual verification results after completion; this document makes no test-pass or deployment claim.
