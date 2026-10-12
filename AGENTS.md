# BecsAutoForward contributor instructions

This repository is the standalone Python/FastAPI Telegram forwarding project.
Use code, tests and `migration/branch-manifest.json` as implementation evidence.
The imported README and release notes are historical material.

Preserve contract-address-only delivery and deduplication, signed Telegram
authentication, owner approval and per-user workspace isolation. Keep sensitive
recovery disabled. Do not restore the reverted five-minute dashboard lock or
native full-message forwarding from historical branches.

Keep deployment origins and the Telegram bot username explicitly configured.
Do not introduce defaults that connect this project to BecsBot's existing service.
Never commit credentials, Telegram sessions, runtime databases or generated UI
previews. Do not delete or reset existing user data to fix application behavior.

Use Python 3.11 or 3.12 and Node 22 or 24. Install `requirements-dev.txt`, then run
`python -m pytest -q`, `python -m compileall -q app scripts tests`,
`node --check static/app.js` and `node --check static/sw.js`.
For UI changes, install Playwright Chromium and run the mocked browser checks
listed in `.github/workflows/ci.yml` for `becs-forwarding-v1`. Tests must use synthetic identities and
temporary stores; never contact Telegram or send real messages as a test.

Run one application process: the SQLite stores and worker registry assume one
active process. Listen on the host's supplied `PORT` and persist the project's
own `data/` directory. Preserve encryption secrets and retained sessions during
restarts and migration. Repository extraction does not authorize a production
deployment or moving an existing production database.
