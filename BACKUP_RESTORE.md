# Backup and restore boundary

The PostgreSQL volume is the only established durable production copy. Research collection is currently paused by owner request. An independent production backup destination and its access/encryption configuration have not been supplied. Do not claim that CI fixtures or this verifier are a production backup, create a new paid service, or resume research to exercise restoration.

## Read-only verification

Set `STORAGE_VERIFY_DATABASE_URL` privately in the execution environment and run `npm run verify:storage`. The command does not fall back to `DATABASE_URL`, initialize schemas, store verification checkpoints, or print database errors, identities, credentials or payloads. It uses a repeatable-read, read-only transaction and bounded keyset pages. Compressed research payloads are read one at a time and decompression uses the runtime's 32 MiB bound. SQL calls have timeouts.

The report contains table-family availability, counts and a deterministic SHA-256 fingerprint of retained evidence and complete paper-account/receipt rows. Missing optional families are explicit; partially missing families and a database with no BecsBot storage fail. It checks all research payloads and record chains, all paper-event chains from sequence one, and local proof metadata/ranges/roots without the web endpoint's 5,000-event or 1,000-proof windows. Unsealed events are counted separately and may be valid. A mismatch fails with a fixed error code.

Paper ledger/receipt hashes allow exact source-versus-restored comparison. They are not historical signatures on mutable balances. This tool cannot prove the original truth of provider data or defeat an administrator who rewrites every hash consistently. Sessions and pending OAuth flows are not included in the report; production recovery should invalidate sessions and require fresh login. Bounded chart history and pending delivery files live on the separate `/app/data` volume and need their own backup.

## Rehearsal in CI

The Node 22 and 24 jobs use disposable PostgreSQL 18 containers. After tests, CI creates a fixture with an actual simulated holding, committed receipt, BecsEvents/proof and research data. It verifies the source, exports it using the container's matching `pg_dump` in custom format, restores with `pg_restore --exit-on-error` into a new empty `becs_restore` database, verifies again, and compares the complete reports. No production URL or secret is available to this job. Fixture dumps are temporary and are not uploaded as workflow artifacts.

The dedicated integration test also verifies 5,001 historical events beyond the interactive verifier's window, different page boundaries, and a corrupted stream head. Unit tests reject corrupt payloads, incorrect byte counts, unsupported encodings and incomplete schemas.

## Production recovery procedure once a destination exists

1. Confirm the encrypted, owner-only off-provider destination, credentials, retention and storage budget. Use a PostgreSQL client compatible with the server version; supply credentials through the environment, never commands, logs or Git.
2. Export a consistent custom-format database dump. Do not overwrite a previous verified backup. Store a checksum and test decryption/retrieval from the independent destination.
3. Restore into a separate empty, disposable database using `pg_restore --exit-on-error --no-owner --no-privileges`. Never run a destructive restore against the production URL.
4. Run the read-only verifier against the restored database. Compare counts/fingerprints captured from the same snapshot, or during a coordinated write pause; an active source can legitimately change after a dump starts.
5. Separately restore `/app/data`, inspect any pending delivery spool, and rehearse idempotent delivery only in the isolated environment with external provider/trading access disabled.
6. Keep production in place until the restore is accepted. Cutover, session invalidation, DNS/database URL changes and removal of old copies are separate operations requiring a concrete recovery decision.

Do not delete permanent history or loosen append-only triggers to recover disk space. Any later compression migration needs a proven backup, measured working space, lossless verification and its own rollback plan.
