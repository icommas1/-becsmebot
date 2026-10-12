# Railway deployment review

Inspected 2026-10-12 through the connected Railway account and GitHub APIs.
No README was used as evidence. No Railway service, source, runtime variable,
volume or deployment was changed during this inspection.

## Current service

The screenshot's top project is [becs.](https://railway.com/project/a1c0549d-d1c0-4b97-b923-f1be372c2e32).
Its production environment is `50c90b83-8bf0-41e7-a181-e8b83aedfe55`.
The BecsBot service is `581f8f77-d61b-44e1-b02a-1f82672282ce`.

- Online: one running replica, zero crashed replicas, no reported service issues.
- Latest successful deployment: `443c8527-8526-4b3e-b7bd-e8e2280d2158` from
  `icommas1/BecsBot@becs-forwarding-v1`, commit `34acedd607e5`.
- Dockerfile build, Uvicorn startup, `/api/health` deployment healthcheck.
- Persistent 500 MB volume mounted at `/app/data`.
- No pending configuration changes or staged resource deletion.
- The new `icommas1/-becsmebot` repository is not this service's source.

The independently configured forwarding project requires explicit frontend
origins and its Telegram bot username. `BECS_FRONTEND_ORIGINS` and
`BECS_TELEGRAM_BOT_USERNAME` are absent from the existing service's variable-name
inventory. Configure these for the intended frontend and bot before any future
source cutover. Credential values were not read.

## Why releases show REMOVED

The 50 most recent Railway deployment records contain one `SUCCESS` and 49
`REMOVED`. Removed releases remain in the history; this is a deployment state.
[Railway's lifecycle documentation](https://docs.railway.com/deployments/reference#removed)
explains that new deployments replace older active releases. Its singleton model
keeps one running deployment per service; aborted builds also become `REMOVED`.

A concrete sequence on 2026-10-11, all times UTC:

| Commit | New deployment created | Subsequent evidence |
|---|---|---|
| `6b8b4ee` | 14:55:23 | Removed; no allocated runtime region |
| `7daa240` | 14:55:29 | Removed; no allocated runtime region |
| `0573ea2` | 14:55:38 | Railway success status at 14:55:59; removed at 14:56:26 |
| `34acedd` | 14:55:57 | Railway success status at 14:56:23; still active |

The preceding active deployment was retired three seconds after the new release
passed health checks. Closely spaced commits also produced intermediate releases
that never received runtime regions. This supports normal Railway replacement
and supersession for the observed removals. There is no observed service deletion.
The source configuration has `checkSuites: false`, so GitHub CI completion is not
a prerequisite for this service's automatic deployment.

GitHub's forwarding workflows contain no Railway deletion command. Access to
BecsBot's GitHub deployment-record endpoint was denied with HTTP 403, so an
exhaustive GitHub deletion audit is unavailable; commit statuses and Railway's
deployment history were accessible.

## Red or cancelled GitHub checks

- [BecsBot smoke run 38188958004](https://github.com/icommas1/BecsBot/actions/runs/38188958004)
  requested `/health` and received 404. That workflow tests the signal application
  on BecsBot main, while the Railway hostname serves the Python forwarder.
- [Forwarding regression run 38149185249](https://github.com/icommas1/BecsBot/actions/runs/38149185249)
  omitted pytest from installation and failed importing `test_recovery_crypto`.
  The migrated project's development requirements include pytest.
- The earlier new-repository CI run was cancelled by `cancel-in-progress: true`
  when the next commit arrived. This setting affects CI runs.
- [New-repository CI run 38202730955](https://github.com/icommas1/-becsmebot/actions/runs/38202730955)
  passed on Python 3.11 and 3.12, including hosted frontend and browser checks.

## Removing main from the new repository

The standalone project and CI have been moved onto `becs-forwarding-v1`, retaining
all commits previously held by main. GitHub rejected the administration operation
to change the repository's default branch with HTTP 403. GitHub does not permit
deleting the default branch. Set `becs-forwarding-v1` as the default in
[repository settings](https://github.com/icommas1/-becsmebot/settings), then main
can be deleted without losing these standalone changes.
