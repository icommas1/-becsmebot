# Becs · Crypto Telegram Forwarding Terminal

A standalone, personal-use Telegram crypto forwarding bot + Telegram Mini App web frontend. Terminal Pro dark design. This is a **real local application**, not a screenshot or static mockup. **No public server has been deployed and no Telegram account is connected by default.**

## What works now

- Professional mobile-responsive dark dashboard with **real SQLite-backed metrics**, actual stored activity, four routing modes and a global pause control.
- Create, edit, enable, pause and delete routes with **multiple sources and destinations** (for your one personal account).
- `Express`: essential checks (hard blacklist and destination dedupe) then queue; `Smart`: regex, contract address candidates, allow/block keywords, network checks, destination dedupe; `Hybrid AI`: local decisions + optional non-blocking cloud analysis; `AI-Gated`: optional cloud classification before queue; if unavailable/uncertain, hold for review.
- Solana-format Base58 address candidates (decoded to **32 bytes**) and EVM `0x` address candidates. This is **not on-chain token mint or smart-contract verification**.
- Custom Python `regex` with a **25 ms evaluation timeout**, limit of 250 characters, keyword ANY/ALL and blacklist priority.
- Persistent SQLite routing state, queued jobs, review decisions, contracts seen, and event logs.
- Exact/contract-first duplicate fingerprints per destination, configurable cooldown, one outbound job at a time, Telegram `FloodWait` aware retries, failed job retries, pause/resume.
- Optional **Telethon personal-account connector** with official phone-code and 2FA login; session strings **encrypted at rest** using a server-side secret.
- Optional **Telegram control bot** for `/start`, `/status`, `/routes`, `/pause`, `/resume`, and an **Open Mini App** button once an HTTPS Mini App URL is configured.
- Backend **Telegram Mini App initData validation** with expiry and a single approved Telegram user ID; optional server access key for standalone secure web access.
- Optional Google Gemini API gateway, invoked only for a route selecting Hybrid/AI-Gated mode. It may have quota, privacy and cost conditions. No API key means deterministic rules still work and AI-Gated messages wait for review.

## Run locally (no deployment)

Use a computer with Python 3.11+ (not directly runnable as a background Python server on a standard iPhone):

```bash
cd becs
python -m venv .venv
source .venv/bin/activate           # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
cp .env.example .env                # Windows: copy .env.example .env
python start_local.py
```

Then open **http://127.0.0.1:8765** on that same computer. The dashboard, route editor and Regex Lab are available even without Telegram credentials. The server listens **only on 127.0.0.1**, not on the public Internet.

To run tests:

```bash
pip install pytest pytest-asyncio
python -m pytest -q
```

## Connect your *own* Telegram account (optional until ready)

In your private `.env` file:

1. `TELEGRAM_API_ID` and `TELEGRAM_API_HASH`: obtain your own API credentials at <https://my.telegram.org>.
2. `BECS_SESSION_SECRET`: set a unique, randomly generated 48+ character value. **Back this up privately**; changing it prevents decrypting the saved Telegram session. Example generation using Python: `python -c "import secrets; print(secrets.token_urlsafe(48))"`.
3. Restart the server. In Becs **More → Personal Telegram connection**, enter your phone, then the Telegram login code, and two-step password if requested. Do **not** paste codes into a bot chat.
4. Click **Load chats**, then add the source/destination IDs to a route. Ensure you have legal access to the source and permission to post to the destination.
5. Enable the route. New messages matching those sources enter the sequential send queue. **No historical/backfill scan** is performed.

You can also optionally configure a separate control bot:

- `TELEGRAM_BOT_TOKEN`: your own @BotFather token.
- `BECS_ALLOWED_TELEGRAM_ID`: **the administrator’s numeric Telegram user ID**. Additional users need a private single-use invitation and explicit approval. See [Private Workspaces](PRIVATE_WORKSPACES.md).
- `BECS_MINI_APP_URL`: an **HTTPS** URL once you explicitly choose to host the app. Until then, Telegram cannot open an externally hosted Mini App. The local browser UI remains available.
- `BECS_ADMIN_TOKEN`: long random server-side access key for browser/API access when not launched from an authorized Telegram Mini App.

**Do not put secrets in the Mini App frontend**. API credentials, encrypted sessions and AI keys remain on your backend. Never expose the development server directly to the Internet. In future hosting, put it behind HTTPS, authentication and properly configured reverse proxy access controls. Secure the private `.env` and `data/` directory; the encrypted session secret must remain secret too.

## AI (optional)

Set `GEMINI_API_KEY` and optionally `GEMINI_MODEL` for external AI analysis. The configured provider receives the text of messages flowing through Hybrid AI and AI-Gated routes; only enable this for material you have permission to share. Free API quotas/terms may change or be unavailable. Fast Express and Smart processing require no external AI service.

## Project structure

```text
becs/
  app/
    main.py            FastAPI API + authentication + route CRUD
    db.py              SQLite schema / state
    engine.py          Crypto regex/keyword/address filters
    service.py         Ingest, dedupe, sequential delivery, reviews
    telegram_client.py Telethon account and Telegram control bot
    ai.py              Optional Gemini interface
    models.py          Validated route configuration
  static/
    index.html         Telegram Mini App HTML
    styles.css         Terminal Pro design system
    app.js             API-backed interactive dashboard
    icon.svg           Custom Becs icon
    manifest.webmanifest
    sw.js
  tests/test_core.py   Automated backend behavior tests
  .env.example         Credential template (no real secrets)
  start_local.py       Local-only development entry point
  requirements.txt
```

## Design decisions and limits

- **Private workspaces**: one administrator and up to two explicitly approved members, each with an independent database, Telegram session, routes, filters, logs, and delivery worker. See [access flow, migration, verification, and rollback](PRIVATE_WORKSPACES.md).
- Each account’s outgoing messages share its own sequential worker. Telegram's per-account/per-destination rate limits are dynamic, so no millisecond-level speed guarantees are made.
- Telegram Bot API access and personal Telegram account access are **separate**; a bot cannot see arbitrary groups/channels without permission.
- Native forwards preserve original content/media attribution; text mode sends text only, omitting media. Exact / contract-first dedupe can hide repeat alerts about the same token; configure route cooldown carefully.
- The Mini App is not yet reachable *inside Telegram* because this version has not been deployed to an HTTPS host. Hosted operation, free-tier server accounts and real Telegram connection require your credentials and later setup approval.
- No on-chain RPC verification, semantic embedding vector store, native iOS binary or guaranteed uptime is claimed.
- Local account logout / disconnect in V1 **retains** the encrypted session. Stop server access and manage the encrypted session file privately to revoke local storage; Telegram active sessions can be revoked through official Telegram account settings.
- When paused, incoming messages are not added to the queue; queued sends wait until resumed. No backfill or replay is implemented.

## Next stage (only when you approve)

Configure free-tier HTTPS hosting and authorized Telegram connections, then test real forwarding with your own sources/destinations. There is **no automatic deployment** in this project package.
