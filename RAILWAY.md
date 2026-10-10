# Becs forwarding-only Railway service

This branch replaces the old Solana signal/trading runtime with the *standalone* Becs crypto Telegram forwarder. The historic main branch and data were deliberately preserved.

- Runtime: Python 3.11, FastAPI, Telethon, SQLite on mounted Railway volume.
- Server: Dockerfile, uvicorn bound to 0.0.0.0:$PORT, public health path `/api/health`.
- Dashboard: served from the same Railway HTTPS origin (`/`).
- Private data: set `BECS_DB_PATH=/app/data/becs-v1/becs.sqlite`, `BECS_SESSION_DIR=/app/data/becs-v1/sessions`, and a long random `BECS_SESSION_SECRET` in private Railway variables.
- Single-account authorization: set `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_BOT_TOKEN`, and `BECS_ALLOWED_TELEGRAM_ID` via Railway variables, **never** into GitHub, chat, or the dashboard's public URL.
- Mini App: once the backend is healthy and authorized, change BotFather's configured Mini App URL to the Railway HTTPS URL. Do not change it until authentication has been tested.
- The existing Postgres database, trading data, legacy secrets, old domain, and historical volumes are intentionally not deleted by the migration. Remove those only following a verified backup and an explicit separate decision.
- Optional `GEMINI_API_KEY` supports Hybrid AI and AI-Gated modes; AI-Gated must hold for review when AI is unavailable.
- Test route using authorized source and destination, without a trading wallet or on-chain execution.
