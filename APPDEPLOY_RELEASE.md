# Becs hosted frontend release package

## Scope and authorization

This is a **local, offline release package**, not a deployment. Nothing in the
build script calls AppDeploy, Railway, Telegram, GitHub, or any other network
service. Publishing or rolling back the AppDeploy app requires separate explicit
authorization. This package does not deploy the backend, merge a branch, alter
CORS, create an invitation, change a user's access, or connect a Telegram account.

The live Mini App is a separate AppDeploy frontend. Updating this repository's
FastAPI `static/` files alone does not update the live Mini App.

- App ID: `becs-crypto-forwarding-terminal-59lgyp`
- Frontend: <https://becs-crypto-forwarding-terminal-59lgyp.v2.appdeploy.ai/>
- Existing external API: <https://becsbot-production.up.railway.app/api>
- Architecture: existing `frontend-only` / `html-static` Vite app
- Verified source baseline and rollback target: **v3, version `1791693928637`**
- Snapshot inspected on 2026-10-11. Recheck it immediately before any future publication.
- The three connected AppDeploy links expose this same app. The payload pins the
  inspected account link and existing app ID; it does not create a new app.

## Implementation checklist

- Reuse the approved Terminal Pro `static/index.html`, `static/app.js`,
  `static/styles.css`, icon and manifest as input without changing those originals.
- Adapt only the hosted copy: fixed Railway API, signed Telegram launch header,
  Telegram-only missing/expired-launch guidance, no server-key fallback, no browser
  key storage, and no service-worker registration.
- Preserve owner Users/invite/approve/revoke flows, member-private workspaces, and
  approved-user phone/code/two-step account controls. Enforce authorization on the
  backend; the UI is not an authorization boundary.
- Replace stale demo production QA with anonymous, non-mutating access checks.
  Exercise real role transitions only through the wholly intercepted offline suite.
- Generate content-hashed asset paths, a changed-files-only deployment payload,
  a buildable local project, checksums, and a deterministic archive.
- Preserve the existing package/Vite/PostCSS/Tailwind/TypeScript scaffold exactly.
  Add no AppDeploy SDK imports, dependencies, or AppDeploy-owned backend.

## Reproduce the package

From the repository root, choose a new output directory outside the repository:

```sh
python scripts/build_appdeploy_bundle.py --output /tmp/becs-appdeploy-update
npm install --prefix /tmp/becs-appdeploy-update/project
npm run build --prefix /tmp/becs-appdeploy-update/project
python -m unittest discover -s tests -p 'test_appdeploy_bundle.py' -v
python tests/browser_appdeploy.py \
  --dist /tmp/becs-appdeploy-update/project/dist \
  --screenshots preview/appdeploy
```

The exact unchanged v3 build inputs are tracked in `scripts/appdeploy_base/`.
Their SHA-256 values are pinned in the generator, so CI needs no external snapshot
or credentials. This build-only baseline is not submitted in the deployment
payload. `npm install` resolves the existing version ranges; package content and
asset generation are deterministic, but this package makes no claim of a locked
future npm dependency graph. Do not submit the locally generated lockfile.

To preserve the complete inspected v3 source tree, including dormant old assets,
provide the read-only snapshot directory obtained from AppDeploy's source tools:

```sh
python scripts/build_appdeploy_bundle.py \
  --snapshot /path/to/verified-v3-snapshot \
  --output /tmp/becs-appdeploy-full-update
```

The generator checks every snapshot file against the pinned v3 hashes. An altered
or incomplete snapshot is rejected. The full-snapshot and portable build produce
identical `deployment_payload.json` files. Only the full-snapshot local project
also carries the unchanged old `becs-v2.js`, `becs-v2.css` and dormant `sw.js` files.
The portable project contains all files needed for the actual Vite build.

Snapshot text normalization: the saved snapshot adds one final LF to three remote
files that originally had none: `index.html`, `public/assets/becs-v2.css`, and
`public/assets/becs-v2.js`. The manifest's `base_sha256` values describe that saved
snapshot. When comparing a fresh raw AppDeploy read, add that one LF to these
three files first. All seven build scaffold files, `public/assets/sw.js`, and
`tests/tests.json` were re-read and verified byte-for-byte against remote v3.
The new payload and asset hashes need no normalization. Raw remote SHA-256 values
for the three normalized baseline files are:

- `index.html`: `485da7161af90fd955f102518b41adbf6531be7e7a5e297be79b07a68e1f5341`
- `public/assets/becs-v2.css`: `c9e4abad662df7a028e5eab65ab75ae0e7fd71d70eeb893463b3b85472cd8b54`
- `public/assets/becs-v2.js`: `715d9d03726f2e76c9fdc53ada87aef23a78e8c6cc74f6ce5d873f50e76565c3`

Output:

- `deployment_payload.json`: complete tool arguments for a future authorized update;
  **not automatically submitted**
- `changed/`: precisely the six changed/new remote source files
- `project/`: local merged Vite project; production build is `project/dist/`
- `release_manifest.json`: source and output SHA-256 values, asset mapping, base
  version, app/API targets, and an explicit `publication_performed: false`
- `APPDEPLOY_RELEASE.md`: this release guide
- Adjacent `.zip`: stable file order, fixed timestamps and file permissions

The archive is created before local npm/build output, keeping `node_modules`, build
artifacts and generated dependency lockfiles out of the source release archive.
The script refuses to overwrite a non-empty output directory or the repository.
It never removes an existing directory.

## Hosted adaptation

The generated JavaScript sends requests only to the existing Railway `/api` base.
It forwards `Telegram.WebApp.initData` verbatim in `X-Telegram-Init-Data`, sets
`credentials: 'omit'`, and refuses to fetch anything when signed launch data is
missing. The Railway server remains responsible for validating signature,
auth-date freshness, user status, ownership and workspace authorization.

There is no `X-Becs-Key`, server/admin-token form, unlock action, browser key
storage, or localhost bypass in the generated hosted script. A rejected/expired
launch clears rendered private state and dialogs and instructs the user to close
and reopen the Mini App through `@becsmebot`. A network failure gives retry
guidance rather than asking the user to start a local FastAPI service.

The approved phone, Telegram code and two-step-verification controls remain
available only after approved private workspace access. They use the same
existing API methods. No real account connection is performed by these tests.

New JS, CSS, icon and manifest filenames include their own content hashes.
The index references only those new paths, avoiding stale v2 UI assets. The
manifest's icon path also points to its new hash-named asset. The old worker is
not re-registered. No worker migration or deletion is included; if future
read-only inspection finds an active worker controlling the root app, investigate
its scope/cache behavior before publication instead of silently adding one.

The existing CORS configuration already permits the AppDeploy origin and needed
headers/methods; this package does not change it. The explicit external API
architecture needs no AppDeploy client/server SDK.

## Test coverage and safety

The packaging unit tests cover changed-file-only payload shape, pinned build
inputs, deterministic ZIP output, fixed external API and Telegram header, missing
launch fetch guard, absence of key/storage/SDK/worker code, source/asset hashes,
valid path mappings, JSON production QA schema, approved account controls,
source-drift failure, CSS token preservation and JavaScript syntax.

`tests/browser_appdeploy.py` serves the **Vite-built dist** through Playwright
request interception at the actual hosted origin. Every request is either served
locally or aborted. The Telegram SDK is explicitly blocked; a synthetic WebApp
object supplies fake test-only launch data. Every Railway API response is mocked,
and any unexpected host or same-origin `/api` request fails the test. No real
credentials, signed launches, accounts, invites or writes are used.

Offline browser coverage:

- Mobile and desktop owner Users list, protected owner row, capacity display,
  invite creation/copy, duplicate clicks, refresh-preserved dialog, dismissed
  one-time link removal, canceled and confirmed revoke, approval, invite revoke,
  and mutation results retained on subsequent list reads
- Member-only account controls, mocked phone/code/two-step flow, and no owner API
  requests or owner controls
- Pending, revoked and non-invited access denial before workspace API reads
- Missing Telegram launch and unverified URL identity denial with **zero API calls**
- Exact synthetic signed header on every API request; ignored legacy browser key
- Expired launch after approved access clears private UI and an open invite
- Failed and expired invitations expose errors without a usable expired link
- Mobile width, no hosted service-worker registration, no server-key fallback

Generated `tests/tests.json` is intentionally restricted to safe anonymous
production smoke tests. Each case explicitly forbids credentials, live writes,
real invites, access changes and Telegram connection actions, and stops if an
authenticated session is encountered. It is not evidence that production owner or
member flows passed. Signed roles and account transitions are tested only offline.
Do not replace these safety restrictions to make a production QA run pass.

Local Python/JavaScript syntax checks can run in the preparation environment.
The environment's Chromium launch is blocked by a socket sandbox restriction;
therefore a local browser pass must not be claimed. The feature-branch CI runs the
actual Vite build and browser suite and records synthetic screenshots. Require
that exact candidate's successful CI result before release.

## Preflight for a future authorized publication

1. Obtain explicit permission to publish this existing AppDeploy frontend. Confirm
   backend release readiness separately; do not imply the bundle deploys Railway.
2. Re-read current AppDeploy deployment instructions and the existing app's status,
   versions and source snapshot. Confirm the exact app/account/name. The release
   is prepared against v3 `1791693928637`; if the applied source version changed,
   stop and reconcile the new snapshot. Do not apply this partial update blindly.
3. Compare the live source file hashes to `base_sha256` in the release manifest,
   accounting for the three explicitly documented terminal-LF normalizations.
   Verify package/build config remains unchanged and review any new live changes.
4. Require all backend regressions, packaging tests, the actual Vite production
   build, generated JS syntax, and built-dist offline browser tests to pass for
   the exact candidate. Review synthetic mobile and desktop screenshots.
5. Parse the exact payload and production QA JSON. Confirm `app_id`, existing
   frontend-only architecture, model/intent/initiator/type, fixed API origin,
   changed-file hashes and six complete changed-file content entries. No unchanged
   package/scaffold files, credentials, SDKs, service worker or `deletePaths`.
6. Submit only the reviewed `deployment_payload.json` fields through AppDeploy
   after authorization. Its contents are full replacements/new files, not a ZIP
   upload and not an instruction to upload the entire `project/` directory.
7. If authorized deployment starts, poll status through its terminal state and
   review build/e2e/runtime errors. Verify the served index points at the exact new
   asset hashes. Run only the safe anonymous production checks. Real owner/member
   tests require their own appropriate approved context and scope.

## Rollback

Before an authorized update, verify that **v3, version `1791693928637`** is still
listed as deployable in AppDeploy. This is the source snapshot inspected for this
package. Record any newer version that should instead become the rollback target
after reconciling live changes.

If an authorized release needs rollback, use AppDeploy's version-application tool
with the recorded numeric version, not the display label `v3`. A rollback is a
production write requiring appropriate authorization. Poll it to completion and
verify the previous hosted index/assets. This restores the frontend snapshot only;
it does not undo Railway deployments, database changes, invitations or user access.
