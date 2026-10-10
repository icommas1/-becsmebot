# Three independent Becs accounts

The existing `primary` account remains at `/`. Additional login URLs are
`/?account=account-2` and `/?account=account-3`. API calls use
`/api/accounts/{account_id}/...`; existing `/api/...` endpoints remain primary-only.
The server authorizes the selected account before routing a request. An account
selector, numeric route ID, request header, or another account's access token does
not grant access across accounts.

## Storage and sessions

- Primary keeps the existing `BECS_DB_PATH` and
  `BECS_SESSION_DIR/personal.session.enc`, including existing routes and history.
- Each additional account uses `accounts/<account_id>/<original database filename>`
  beneath the original database directory and
  `BECS_SESSION_DIR/<account_id>/personal.session.enc`.
- Every store has independent routes, jobs, reviews, filters, contract history,
  events, duplicate suppression, pause state and flood cooldowns.
- Each account has a separate Telegram client, login challenge, encryption key
  derivation, incoming-message handler and sequential delivery worker.
- The first successful login binds a slot to its Telegram user. Signing a different
  user into that slot or reusing the same user in another slot is rejected.
- Browser access has no automatic timeout; its account-specific token is stored
  persistently in local storage. Telegram sessions remain encrypted on the server.
  Lock browser removes only that browser's selected account token. Access keys
  and tokens should be used only on trusted devices over HTTPS.
- Changing an account's access key or configured Telegram ID revokes its prior
  browser token. Changing the session secret invalidates encrypted Telegram
  sessions and generated invitation keys; preserve it across deployments.

## Additional account setup

From Account 1, open Settings → Get additional account access keys. Share the
appropriate login URL and access key privately with each account owner. This
owner provisioning endpoint is forbidden to Accounts 2 and 3. Each owner enters
that key and completes Telegram's phone/code/2FA flow in their own account screen.
Existing authorized sessions reconnect after server restarts; reconnect is also
available in Settings. No other account's Telegram session is copied or reused.

Optional environment overrides:

| Account | Access key | Telegram Mini App/control bot sender ID |
| --- | --- | --- |
| Primary | `BECS_ADMIN_TOKEN` | `BECS_ALLOWED_TELEGRAM_ID` |
| Account 2 | `BECS_ACCOUNT_2_ADMIN_TOKEN` | `BECS_ACCOUNT_2_ALLOWED_TELEGRAM_ID` |
| Account 3 | `BECS_ACCOUNT_3_ADMIN_TOKEN` | `BECS_ACCOUNT_3_ALLOWED_TELEGRAM_ID` |

If an additional access key is omitted, Becs derives a separate high-entropy key
from `BECS_SESSION_SECRET`. Telegram sender IDs have no fallback to the primary
owner; configure them explicitly to enable Mini App HMAC access and control-bot
commands for additional accounts. Duplicate configured IDs or keys prevent
startup. Telegram API ID/hash and optional AI credentials remain server settings.
`BECS_DEV_AUTH_BYPASS=true` is an explicit local testing option; leave it unset in
production. The default never trusts a localhost or testserver Host header.

## Delivery and rollout checks

The worker marks a job sent only after the owning Telegram client returns a
positive message ID, saved as `telegram_message_id`. A missing receipt or a send
interrupted by restart is held as failed for destination review, never replayed
automatically. Existing historical sent rows retain their old data and may have no
receipt ID. These protections do not provide exactly-once network delivery.

Automated checks:

```sh
python -m unittest discover -s tests -p 'test_*.py' -v
node --check static/app.js
node --check static/sw.js
python tests/browser_bot_destination.py
python tests/browser_multi_account.py
```

The multi-account integration suite exercises the application ingress, filters,
deduplication, queues, real Telegram adapter methods, error handling and receipt
persistence using a fake Telegram transport. Browser tests use a mocked API.
These checks do not establish real Telegram delivery.

Before production promotion, authorize all three distinct accounts in the
verification environment and send a unique harmless marker through each account's
explicitly chosen test source and destination. Confirm the destination message and
its recorded Telegram message ID, confirm the other accounts have no matching job
or event, repeat the marker to verify duplicate suppression, and verify pause and
reconnect affect only the selected account. Do not use a trading bot for smoke
messages. Keep the production branch unchanged until these required live checks
and the exact candidate commit's automated workflow both pass.

## Runtime limit

Use one application process and one Railway replica with the existing persistent
volume. The SQLite queues and identity registry are not a distributed worker
coordination system. An account owner controls only their account; the primary
server owner can provision additional access and the server administrator can
access the mounted storage.
