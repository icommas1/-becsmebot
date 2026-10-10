# Becs dashboard access — fixed five-minute sessions

Unlock once using the existing `BECS_ADMIN_TOKEN`, or explicitly choose Telegram authentication.
The server issues an opaque Secure, HttpOnly, SameSite=Strict cookie lasting at most 300 seconds.
The database stores only its hash, a fixed server expiry, a credential-bound tag and a CSRF value.
No admin key is written to browser storage. Old `becs_key` entries are removed on load.

The Mini App restores the same unexpired session after refresh or reopening in the same cookie
storage context; it never extends the expiry. Clearing cookies or using another browser/device
requires another unlock. The countdown is a UI aid; the server denies access at the exact
300-second boundary. Suspended iPhone views hide private content and revalidate on return.

Manual Log out revokes that session immediately. Expiry or logout never pauses the worker,
logs out the personal Telegram account, changes routes, or deletes an encrypted Telegram session.
Unsaved dashboard form contents are cleared on lock. The existing admin key remains unchanged.
Protected API endpoints no longer accept raw admin keys or Telegram initData as an indefinite
bypass: use `/api/auth/login`, then the cookie and the returned CSRF token for mutations.

`GET /api/auth/session` and ordinary API traffic never refresh the lifetime. The login endpoint
also returns the existing expiry rather than extending an active session. There is no background
or automatic reauthentication after expiry. Admin-key or bot-token rotation invalidates affected
sessions. The session table is additive and uses the current SQLite volume; no extra service,
credentials, paid dependency, or migration of route data is required.

Tests use fake credentials and isolated databases. Browser checks mock the API and Telegram SDK;
no production credentials are read and no Telegram messages are sent by tests.
