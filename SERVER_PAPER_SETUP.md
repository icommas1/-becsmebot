# Activate the private server paper account

The database integration is optional. Local paper trading continues with
`PAPER_ACCOUNTS_ENABLED=false`. Enabling it does not enable real trading.

## Railway preparation

Provision one PostgreSQL service named `Postgres` with persistent storage and
private networking. Keep the existing BecsBot `/app/data` chart volume mounted.
On the BecsBot service, set:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `PUBLIC_ORIGIN` | `https://becsbot-production.up.railway.app` |
| `PAPER_GITHUB_USER_ID` | Your numeric GitHub user ID |
| `PAPER_ACCOUNTS_ENABLED` | `false` until sign-in is configured |

Do not expose a public database proxy or copy the resolved database password.
PostgreSQL adds metered Railway usage. Billing/payment changes must be made by
the account owner in Railway's workspace billing settings.

## GitHub setup (account owner)

1. Open https://github.com/settings/applications/new.
2. Application name: **BecsBot Paper**.
3. Homepage URL: **https://becsbot-production.up.railway.app/terminal**.
4. Authorization callback URL:
   **https://becsbot-production.up.railway.app/api/auth/github/callback**.
5. Register the application and generate a client secret.
6. In Railway → BecsBot → Variables, enter the app's **Client ID** as
   `GITHUB_CLIENT_ID`, and its **Client secret** as `GITHUB_CLIENT_SECRET`.
   Do not paste the secret in chat or source control.
7. Change `PAPER_ACCOUNTS_ENABLED` to `true` and deploy the staged changes.
8. Open `/terminal` → **Paper wallet** → **Sign in with GitHub**.

The first authorized sign-in creates a separate server paper wallet with the
existing 0.4 simulated SOL default. The original browser wallet is preserved,
not imported or overwritten. **Sign out to local wallet** returns to it.
Only the configured GitHub numeric user ID may sign in. No repository scope is
requested. There is no wallet connection, signer or LiveExecutor.

## Behavior and recovery

- Server balance, holds, settings, activity and request receipts commit together.
- A lost response leaves a pending command in that tab's session storage.
  Use **Retry pending action** to send exactly the same ID; do not recreate it.
  Keep that tab open until the result is resolved. Other tabs see the latest
  committed account on their next refresh (normally within 15 seconds).
- The database retains the latest 500 successful command receipts per account.
  Exact retries return the original result plus the current account snapshot.
  Conflicting payloads reject. Pruning advances a timestamp watermark; requests
  older than it fail closed, including after a wallet reset. Equal-timestamp
  requests may also expire conservatively. New requests expire after 24 hours;
  retained successful receipts remain replayable. This is not a live order queue.
- Cash, reset and settings commands include an account revision; stale edits
  cannot overwrite changes made on another tab. Auto is page-local and off after
  reload. The backend rechecks existing auto eligibility and uses server marks.
- A database/sign-in failure never switches an active server wallet into local
  execution. Markets remain public. Retry after service recovery.
- A 401 shows **Sign in with GitHub** and blocks new paper actions while keeping
  the selected server wallet and any unresolved command. After signing in,
  **Retry pending action** confirms that same command ID. Auto remains off;
  neither wallet's balances or history are reset by reauthentication.
- Disabling the feature hides sign-in and returns browsers to their separate
  local wallet on reload; PostgreSQL data remains intact. Back up the database
  before replacing or deleting its volume. Automated backup/restore validation
  is a separate operational task; a volume alone is not a backup.

## Verification

Run `npm ci`, `npm run check`, `npm test`, and `npm run test:mobile`.
Set `TEST_DATABASE_URL` to a disposable PostgreSQL database to run the real SQL
integration test; CI provisions PostgreSQL 18 automatically on Node 22/24.
Without that variable only the database integration test is skipped. Never
point tests at the production database. Production smoke checks are read-only.

The health route describes the market process, not authenticated database health.
After activation check sign-in, account retrieval and sign-out manually. No
production buy/sell is needed to confirm deployment.
