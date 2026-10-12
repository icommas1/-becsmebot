# Run BecsAutoForward

This is a Python/FastAPI application with a static Telegram Mini App. Start one
application process and keep its own persistent `data/` directory. The new
repository does not inherit any deployment, credentials, sessions or database
from BecsBot.

## Local setup

Use Python 3.11 or 3.12. Create a virtual environment, install dependencies and
copy the empty example configuration:

```sh
python -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8080
```

Set `BECS_ALLOWED_TELEGRAM_ID` to the owner ID before startup. Telegram sign-in
requires the personal API ID/hash and a stable random `BECS_SESSION_SECRET`.
Telegram Mini App authentication requires the control bot token. Configure
`BECS_TELEGRAM_BOT_USERNAME` for invitations and `BECS_MINI_APP_URL` for the bot's
Open Mini App button. Enter credentials privately in the runtime configuration.

The default frontend and API use the same origin, with `/api` as the API prefix.
Health is `GET /api/health`; account and forwarding endpoints require access.
Use `BECS_DEV_MODE=1` only for loopback development. The owner ID is still required
by the workspace registry. Development mode does not authenticate administration
requests that require a verified Telegram owner launch.

For a container, the supplied Dockerfile starts Uvicorn on `PORT` (8080 by default).
Persist `/app/data`, or explicitly set `BECS_DB_PATH` and `BECS_SESSION_DIR` to the
project's own persistent storage. Do not point this new process at another live
process's stores or run multiple replicas against the same sessions.

## Separately hosted frontend

Set `BECS_FRONTEND_ORIGINS` to the exact HTTPS frontend origin(s), separated by
commas. The default is empty, so cross-origin browser access is not enabled.
Build the optional hosted frontend with explicit new-project destinations:

```sh
python scripts/build_appdeploy_bundle.py \
  --output /tmp/becs-forward-bundle \
  --api-url https://your-api.example/api \
  --app-url https://your-mini-app.example \
  --bot-username your_bot
npm install --prefix /tmp/becs-forward-bundle/project
npm run build --prefix /tmp/becs-forward-bundle/project
```

The builder generates local files; it does not publish or deploy them. Imported
deployment notes refer to the previous service and are historical context.
Sensitive recovery remains disabled, including for cached clients.

## Verify changes

```sh
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
.venv/bin/python -m compileall -q app scripts tests
node --check static/app.js
node --check static/sw.js
```

The forwarding-branch/PR workflow also builds the optional frontend and exercises the source
and built UI at mobile and desktop sizes using intercepted requests and synthetic
identities. These checks do not prove real Telegram delivery or deploy a service.
