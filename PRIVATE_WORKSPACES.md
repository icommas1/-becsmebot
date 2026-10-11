# Private invites and independent workspaces

Review build based on production commit `9defa2c32ec1d0622bb326a122f087e50d10c9df`. Building or testing this source does not approve a production deployment, send invitations, approve people, log in to Telegram, or send live messages.

## Access flow

1. The existing `BECS_ALLOWED_TELEGRAM_ID` remains the administrator. The maximum is three approved accounts including this owner.
2. In the signed Telegram Mini App, the owner opens **More → Users → Invite User**. Creation returns a private `@becsmebot` deep link once, expiring after 24 hours. Tokens are 256-bit random values, stored only as SHA-256 hashes. Invitations do not grant access.
3. A recipient opens the link and presses Start in a direct private bot conversation. The bot trusts only the numeric sender ID provided by the authenticated Telegram Bot API; forwarded messages, groups, bot senders, and conflicting sender/chat IDs are ignored.
4. Redemption consumes the link transactionally and registers a pending request. The owner sees it in Users and explicitly approves it. Concurrent approvals cannot exceed the three-account limit.
5. The approved person opens Becs and connects the same personal Telegram account as the verified workspace identity. Each person configures independent routes and filters.
6. Only the signed owner can reject, revoke access, or revoke an unused invitation. Revocation denies further API calls, cancels/drains active Telegram work, disconnects the local client, and retains stored data. The retained workspace is paused, so a later reapproved member must explicitly Resume before old queued work runs. Normal server shutdown does not change pause settings. A send already accepted by Telegram cannot be recalled. Interrupted deliveries are marked failed with a manual verification warning and are never automatically replayed.

A rejected/revoked identity cannot use another generic invitation or be directly reapproved. The owner can explicitly create a user-bound re-invitation through `POST /api/admin/users/{id}/reinvite`; it must be redeemed by that same identity and approved again. The Users screen offers a scoped Reinvite action on revoked accounts.

The Users screen is the approval-request inbox. It refreshes when opened or manually refreshed; there is no background push notification or auto-approval. Invitation creation is rate-limited, redemption attempts have per-ID and global persistent limits, and Telegram sign-in attempts are bounded per approved account.

## Isolation and session lifetime

- `BECS_DB_PATH` is still the owner's original database. No owner route, setting, job, log, review, or contract table is copied, rewritten, or deleted by this migration.
- A separate `access.sqlite` beside that database contains membership, hashed invitations, throttles, and access audit events. It binds to the original numeric owner; changing the configured owner thereafter fails closed.
- Additional accounts use `workspaces/<numeric-id>.sqlite` beside the owner database. All API requests, bot commands, incoming listeners, and delivery tasks use an authenticated context. Request-supplied workspace IDs never select a database.
- The owner keeps `personal.session.enc` and the exact existing encryption derivation. Members use `user-<numeric-id>.session.enc`, encrypted with independently derived per-user keys under the existing `BECS_SESSION_SECRET`. Copying one member's encrypted file to another identity does not decrypt.
- Authorization verifies the Telegram account's numeric ID before trusting or persisting a personal session. A mismatched session is disconnected and preserved on disk for recovery; it is never overwritten or automatically logged out.
- There is no scheduled logout. Telegram sessions persist across server restarts until the user revokes them in Telegram, explicitly disconnects locally, or the administrator revokes Becs access. Local disconnect retains encrypted storage.
- Existing contract-address-only forwarding remains in effect. No full incoming message body or media is newly stored.
- Operate exactly one application process/replica with the persistent volume attached. Membership transactions are SQLite-safe across concurrent requests, but multiple Telegram pollers or session owners are unsupported. The application starts one shared bot poller and one sequential delivery worker per approved workspace.

Signed Mini App initData is still validated by bot-token HMAC including Telegram's `signature` field when present. A payload must be fresh (24 hours) and duplicate query keys are rejected. Persistent personal Telegram sessions do not make Mini App signatures permanent. The existing server admin key remains owner-workspace-only; it cannot manage users or invitations. Local unauthenticated browser use now additionally requires `BECS_DEV_MODE=1`, a loopback client, and a loopback Host; never enable it on production.

## Deployment and rollback, only after approval

1. Keep production unchanged until the preview and offline checks are reviewed. A feature branch is not a production deployment. Do not open a PR until Railway PR-environment behavior is verified, because it may create a live preview automatically.
2. Stop the old process before taking a consistent snapshot of the entire persistent data volume (owner SQLite files plus any WAL/SHM, encrypted sessions, and other data). Back up existing environment configuration privately, especially the session secret. Do not put secrets or live data into Git or this review bundle.
3. Deploy the reviewed commit with the same owner ID, database path, session directory, existing secret, bot, volume, and one replica. No new external integration or credential is needed. Verify `BECS_MINI_APP_URL` points to the verified existing entry point `https://becs-crypto-forwarding-terminal-59lgyp.v2.appdeploy.ai` so bot replies include an Open Mini App button; if absent, recipients must use the existing Telegram menu entry. Do not change live configuration before deployment approval. The initial migration creates the access registry and registers only the owner; it generates no invitation and grants no other person access.
4. Serve the matching static UI bundle. If the separate AppDeploy frontend is still the Mini App entry point, update its UI only as an explicitly approved deployment step; changing Railway's static files alone does not update a separately hosted frontend. The existing allowed origin is preserved.
5. Verify owner access, original route counts/settings, existing saved-session identity, private Users control, health, and worker status. Do not approve other accounts or send live test messages unless separately authorized.
6. For rollback, stop the new process and restore the old source commit using the same volume/configuration. The old app reads the unchanged owner database and owner session filename and ignores the added registry/member files. Keep those new files for recovery, with permissions intact; do not delete, merge, or copy member data into the owner database. Stop all new workers before restarting the old app.
7. If the source rollback does not recover owner operation, use the consistent predeployment snapshot, preserving the failed state separately. Restoring a snapshot loses subsequent state and therefore needs explicit review/approval. Do not reset the owner ID or regenerate the session secret as a troubleshooting shortcut.

## Offline verification

Run in an isolated test environment without real credentials:

```sh
python -m unittest discover -s tests -p 'test_*.py' -v
python -m compileall -q app tests
node --check static/app.js
node --check static/sw.js
python tests/browser_bot_destination.py
python tests/browser_compact_filters.py
python tests/browser_users.py
```

Python requirements are in `requirements.txt`; browser checks additionally require Playwright and Chromium. Every Telegram call in these tests is mocked. Browser fixtures block external network requests and include synthetic access states. Generated screenshots are UI previews, not a live account or invitation.
