# Portable configuration backups

In the owner’s Telegram Mini App, open **More → Backups → Export Backup**. This prepares a dated ZIP in app memory. Then tap **Save / Share ZIP** to open the platform share sheet where supported or request a browser download. On iPhone choose **Save to Files** if offered. Check the saved file yourself; Becs cannot verify device storage. If Telegram blocks the download, use Telegram Desktop. External browsers do not inherit Telegram Mini App authentication; never put signed login data or tokens in a URL.

Only an authenticated Telegram owner can export. Browser/server-key fallback does not grant export access. The ZIP contains separate configurations for the currently approved workspaces (owner plus up to two members). Members see an admin-backup disclosure both before approval and in More. Pending/revoked workspaces and their retained data are excluded.

## Contents and privacy

- `manifest.json`: schema version, UTC preparation time, inert approved Telegram IDs/status, configuration fingerprint and SHA-256 checksums/file sizes.
- `workspaces/<telegram-id>/configuration.json`: whitelisted route names, modes, enabled intent, source/destination chat identifiers, keyword/regex/network/contract/dedup/delivery filters, and the pause setting.
- `README.txt`: recovery instructions and exclusions.

No Telegram sessions, credentials, API keys, environment variables, invitations/tokens, access grants, message history, reviews, logs, queued jobs or deduplication history are included. SHA-256 detects accidental corruption; it is not a signature or authenticity proof. The ZIP is not encrypted and contains private configuration: keep it private.

Nothing is automatically uploaded or saved outside the server. The prepared file is only outside Railway after you save your own copy. You may keep a private cloud copy plus an offline copy on another device or microSD; no storage destination is integrated or automatically selected. Preparation history/file contents remain in app memory and clear on access loss or reload. “Last prepared” never means “Last saved.”

The app compares the current configuration fingerprint with this session’s last preparation when Backups is opened/refreshed. It recommends export if changed, if more than seven days old, or if schema version changes, and reminds you before data-affecting upgrades, migrations or server moves. Reloading clears this local history, so it recommends preparation again. There is no unattended export, scheduler, or automatic migration detection.

## Offline validation and dry run

From a trusted Becs checkout with its dependencies:

    python scripts/validate_backup.py saved-backup.zip
    python scripts/validate_backup.py saved-backup.zip --plan recovery-plan.json

The optional plan is a new private local JSON file (0600, no overwrite), with all routes **disabled**, forwarding **paused**, and membership marked **requires-owner-reapproval**. Validation does not connect to Telegram, change any database, grant access, or restore/import anything. It checks ZIP inventory, bounded sizes, version, checksums and structural route schemas. Chat permissions, identities, regex behavior, loop protection and simulation still require manual review.

## Recover manually

1. Install a trusted compatible Becs release and configure new server credentials separately.
2. Sign in as the owner and pause forwarding before reconnecting Telegram. Keep routes disabled.
3. Review the archived IDs. Invite and approve members again. Each signs into their own workspace and reconnects their own Telegram account; the archive grants no access.
4. Recreate owner routes in the owner workspace; each member recreates their own routes using the route editor and their workspace configuration. Share individual private config files only with permission.
5. Recheck sources/destinations, filters, modes, AI setup and delivery style. Simulate/test before enabling.
6. Enable desired routes and resume only after review. Never replay old queues/messages.

No live restore or importer is included. Each workspace is read using a read-only SQLite transaction; the three snapshots are not one global transaction. Missing storage fails closed rather than silently exporting an empty workspace. Configuration changes during preparation may require exporting again. Archive limit: 6 MiB, up to 3 approved workspaces, 1,000 routes/workspace and 2 MiB/workspace. This is a portable configuration recovery aid, not a complete Railway/server image or a substitute for authorized platform volume backups.

## Verification

`python -m unittest discover -s tests -p 'test_*.py'` includes synthetic signed-owner/auth denial, cross-workspace content, secret exclusion, corrupt/oversize ZIP and offline dry-run tests. `python tests/browser_backup.py` and `python tests/browser_backup.py --dist PATH_TO_DIST` use network-isolated mock APIs to check source/hosted UI, exact ZIP download/share bytes, member disclosure, expired authorization cleanup and mobile layout. Real iOS Telegram save-sheet behavior still requires device validation; no real production export is generated by tests.
