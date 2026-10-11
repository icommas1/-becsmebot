# Encrypted private recovery format v1

This format is separate from the existing unencrypted, configuration-only backup. It includes highly sensitive Telegram session strings and optional Telegram bot/API credentials. No real credentials or sessions are used by the test suite.

## Security and limitations

Use a unique, password-manager-generated strong passphrase. The format requires at least 12 characters and at most 1,024 UTF-8 bytes; it does not estimate entropy, trim, or normalize passwords. Store the password separately from the archive. A lost password cannot be recovered. Anyone possessing the archive and password can access its contents. Offline password guessing remains possible.

Encryption authenticates the encrypted payload and cryptographic metadata, not the identity, authorization, or consent of whoever created it. The exporting application must freshly verify owner authorization, active access, per-person consent and relevant runtime state. Validation alone is not proof that a Telegram session is valid or belongs to its claimed user.

No import or live restore is implemented. Archived identities, historical consent versions, or credentials never grant access on another server or root. Shared-root storage is never a recovery workspace. All membership requires fresh approval and all restored configuration would require disabled-first manual review. No queues, invitations, access grants, owner authentication sessions, root paths, environment dumps, AI credentials, logs, or message histories are supported.

Encryption and default validation use in-memory Python objects only and create no plaintext temporary files. The explicit offline recovery option below writes private plaintext intentionally after a terminal confirmation. Python and the operating system can retain copies in memory, swap, process dumps, or debugging tools; guaranteed zeroization is not claimed. Run the offline tool on a trusted machine.

## Outer archive

ZIP_STORED, precisely two entries in this order:

1. `README.txt`: fixed public instructions, no secrets or account inventory
2. `payload.enc`: the encrypted envelope below

ZIP metadata uses a fixed timestamp. There are no directory entries, symlinks, encrypted ZIP members, compressed members, extras, comments, data descriptors, ZIP64, multipart ZIPs, duplicate names, arbitrary paths, prepended or trailing data. The reader checks central/local file consistency, CRC, offsets and exact contents of the public README. The README is informational; trusted recovery instructions come from the installed checkout. It is never executed. Account identifiers and application configuration are inside the encrypted payload.

Maximum plaintext is 6 MiB; maximum archive size is 6 MiB + 16 KiB. Every size is checked before expensive derivation. The public envelope is capped at 2 KiB. A well-formed hostile archive can still require one bounded Argon2id computation per attempt; deployments must separately limit concurrent exports and requests.

## Encrypted envelope

Concatenate:

- Nine magic bytes: `BECSREC1` followed by NUL
- Four-byte unsigned big-endian canonical-header byte length
- Canonical UTF-8 JSON header
- AES-256-GCM ciphertext with its appended 16-byte authentication tag

All bytes before ciphertext are AES-GCM additional authenticated data. Canonical JSON uses sorted keys, compact comma/colon separators, UTF-8 without ASCII escaping, and no NaN or infinities. Duplicate object keys are rejected. Header JSON must already be canonical. Unknown versions, parameters, fields and algorithm names are rejected, with no fallback.

Header fields are exactly:

- `format`: `becs-private-recovery`
- `version`: integer `1`
- `cipher`: `AES-256-GCM`
- `kdf`: exactly `{"name":"Argon2id","memory_kib":65536,"iterations":3,"parallelism":4,"key_bytes":32}`
- `salt`: canonical padded standard base64 of 16 fresh cryptographically random bytes
- `nonce`: canonical padded standard base64 of 12 fresh cryptographically random bytes

Argon2id derives 32 bytes from the unchanged UTF-8 password with memory cost 65,536 KiB, three iterations and four lanes. The salt and nonce are independently generated with the OS CSPRNG for every export. The dependency is pinned to `cryptography==49.0.0`; no custom cryptographic primitive is used.

## Plaintext schema

The decrypted UTF-8 JSON has exactly these fields:

- `format`: `becs-private-recovery`
- `version`: integer `1`
- `application`: exactly `{"name":"Becs","version":"1.1.0","workspace_schema":1,"access_schema":1}`
- `owner_telegram_id`: positive canonical decimal Telegram user ID less than 2^63
- `created_at`: timezone-aware ISO 8601 timestamp with UTC offset zero
- `sessions`: zero to three unique entries, each exactly `{user_id, consent_version, telegram_session}`. IDs use the same numeric convention; `consent_version` is string `1`; session strings are nonempty and at most 65,536 characters. Every session must have a corresponding configuration workspace. Only currently approved users who explicitly consented may be collected by the application.
- `credentials`: exactly `{telegram_api_id, telegram_api_hash, telegram_bot_token}`. Every key is present. ID/hash are both null or both populated: ID is a positive integer less than 2^31 and hash is 32 hexadecimal characters. Bot token is null or a nonempty string up to 256 characters. Credentials are data only, never executed or used by the offline reader.
- `configuration`: exactly `{workspaces}`. Workspaces is one to three unique entries, each exactly `{user_id, routes, paused}`. The owner must be present. `paused` must be true, and every route `enabled` must be false. Configuration may cover approved users who did not consent to session recovery; consent controls session inclusion separately. Each workspace is at most 2 MiB canonical JSON and contains no more than 1,000 routes.

Route fields are pinned to `name`, `mode`, `enabled`, `sources`, `destinations`, `allowed`, `blocked`, `pattern`, `match_mode`, `network`, `require_contract`, `dedup_minutes`, and `delivery_style`. Existing supported enumerations, field lengths, list sizes and numeric bounds are enforced independently of application startup. Unknown fields are rejected. Route chat IDs are inert strings and must be reviewed before any future use; they are never treated as paths or destinations for offline writes.

No root ID or source filesystem location is carried. Numeric user IDs do not convey root authorization. Decryption has no destination root parameter, access-grant writer or runtime dependency.

## Offline operation

From a trusted compatible checkout with the pinned dependencies installed:

`python scripts/recover_archive.py PATH_TO_ARCHIVE.zip`

The password is requested through a hidden interactive terminal prompt. It is not accepted through command-line options, environment variables, files or piped stdin. If echo suppression is unavailable, the tool fails closed. Unknown command-line arguments are not echoed in errors, so an accidentally supplied password is not printed.

By default the CLI performs a dry-run in memory. It prints only validation status and workspace/session/route counts, never identities, credential values, decrypted data or traceback detail. By default it does not write an output file. Neither mode uploads, contacts Telegram, refreshes credentials, starts forwarding, replays queues, changes membership or grants permissions. Live restore features require a separate reviewed design and explicit authorization.

For an intentional sensitive plaintext recovery, use `python scripts/recover_archive.py PATH_TO_ARCHIVE.zip --recover-to NEW_DIRECTORY`. After decryption and validation, the tool displays a warning and destination, and requires typing exactly `WRITE SENSITIVE RECOVERY FILES`. Cancellation leaves no output. The destination must not exist (including symlinks); its parent must already exist in a trusted operator-controlled location. It creates a mode-0700 directory and one mode-0600 `recovery-sensitive.json` file using exclusive creation. Nothing is overwritten. This file contains the validated inert payload, including plaintext secrets; protect it accordingly. It is not a server environment file, database, runnable script, or automatic restore instruction. A failed write removes its partial file where possible; an empty destination directory may remain. Sensitive-file extraction requires a supported POSIX platform such as macOS or Linux; unsupported platforms fail before directory creation. Windows can use the default in-memory dry-run. These Unix permission and no-symlink safeguards require a platform supporting the underlying flags.

The module exposes `encrypt_recovery_archive(payload, password) -> bytes`, `decrypt_recovery_archive(archive, password) -> dict`, `validate_recovery_payload(payload) -> dict`, and `RecoveryError`. Callers must not log returned plaintext or passwords. The offline tool imports only this standalone module, never application runtime or database initialization.
