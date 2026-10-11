#!/usr/bin/env python3
"""Build Becs's local-only, deterministic AppDeploy partial update.

This script has no network calls or deployment integration. It creates reviewable
files and a payload only. Production publication requires separate authorization.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_ID = 'becs-crypto-forwarding-terminal-59lgyp'
APP_NAME = 'Becs Crypto Forwarding Terminal'
APP_URL = f'https://{APP_ID}.v2.appdeploy.ai'
API_URL = 'https://becsbot-production.up.railway.app/api'
BASE_VERSION = '1791693928637'
LINK_ID = 'link_6acb693aa0e4819184217c94d7f0bde2'
BASE_HASHES = {
    'index.html': '71b0155345c40256f64e067e378706050eb6eb1862fc9e13a07e8130e3e4894d',
    'package.json': '62f8f64749796b56b1e1d9bbf24e7933239437dc62e2ef9996f9170a7449d002',
    'postcss.config.js': 'e32657baf631d7c5f4dc67b4b2ee0ec8e7d5b3c41860e09cddce7c0377cd80bc',
    'public/assets/becs-v2.css': '6916da5df7cddf4915f588a6f6fff2827d15bf142271393c81c16a2ad1054aab',
    'public/assets/becs-v2.js': 'a995a88599790d4172e6a10b4475187804e1cb9f0bd537774321511171053075',
    'public/assets/sw.js': '4f7323acb96cd6a35f88f291324914ec455323a03a82177e85e766d6c07f6bc6',
    'src/main.ts': '217646dc79ea1a48ee40940f8366d787165446238bae9dd51e2163500288c53c',
    'src/styles.css': 'fb9e2b0698c210817ae27c89b0638e47fb265ab8dfd05cfd82a143df9b937dc3',
    'tailwind.config.js': '0dbb175063f49e76762cafb4b72a3be22ec69e2e0909af2d6d370ffe67cf02ee',
    'tests/tests.json': '3f4f87b9dea1af605eb7c3fc431129d47243931bfb717263cf55f0299cc816a6',
    'tsconfig.json': 'c3df7d9e7ce2ec1fbfb3884f3b091ec1f3d57a814a29c354e03700e31a3834ff',
    'vite.config.ts': '3c262a3268477dada7bb158e592a8e14f28acf74ae1471915def8230d57fa079',
}
BUILD_BASE_PATHS = (
    'package.json', 'vite.config.ts', 'postcss.config.js', 'tailwind.config.js',
    'tsconfig.json', 'src/main.ts', 'src/styles.css',
)
FORBIDDEN_HOSTED = (
    'X-Becs-Key', 'BECS_ADMIN_TOKEN', 'becs_key', 'adminKey',
    "'unlock'", 'data-action="unlock"', 'sessionStorage', 'localStorage',
    '@appdeploy/client', '@appdeploy/sdk', 'serviceWorker.register',
)


def digest(content: str | bytes) -> str:
    return hashlib.sha256(content.encode() if isinstance(content, str) else content).hexdigest()


def serialized(value) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False) + '\n'


def replace_once(source: str, old: str, new: str) -> str:
    if source.count(old) != 1:
        raise ValueError(f'Approved source anchor changed or is ambiguous: {old[:85]!r}')
    return source.replace(old, new, 1)


def replace_function(source: str, start: str, end: str, replacement: str) -> str:
    """Replace a known adjacent function region; fail closed on source drift."""
    if source.count(start) != 1 or source.count(end) != 1:
        raise ValueError(f'Approved function anchors changed: {start!r}, {end!r}')
    before, rest = source.split(start, 1)
    _, after = rest.split(end, 1)
    return before + replacement.rstrip() + '\n' + end + after


def hosted_script(source: str) -> str:
    source = replace_once(
        source,
        "if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/assets/sw.js').catch(()=>{});",
        '// Hosted release deliberately registers no service worker.',
    )
    source = replace_function(source, 'async function request(path,options={}) {',
                              'function toast(', """async function request(path, options = {}) {
  const signed = tg?.initData || '';
  if (!signed) {
    const error = new Error('Open Becs from @becsmebot in Telegram, then launch the Mini App again.');
    error.status = 401;
    error.reason = 'missing_telegram_launch';
    state.me = null;
    state.access = 'unknown';
    state.accessVersion++;
    clearWorkspace();
    state.apiError = error.message;
    render();
    throw error;
  }
  const requestAccessVersion = state.accessVersion;
  const headers = {
    Accept: 'application/json',
    ...(options.body ? {'Content-Type': 'application/json'} : {}),
    ...(options.headers || {}),
    'X-Telegram-Init-Data': signed,
  };
  let response;
  try {
    response = await fetch('""" + API_URL + """' + path, {
      ...options,
      headers,
      cache: 'no-store',
      credentials: 'omit',
    });
  } catch {
    throw new Error('Becs is temporarily unreachable. Try again in a moment.');
  }
  const payload = await response.json().catch(() => ({detail: response.statusText}));
  if (!response.ok) {
    const detail = payload.detail;
    const error = new Error(typeof detail === 'string' ? detail : detail?.message || 'Request failed');
    error.status = response.status;
    error.reason = payload.reason || detail?.reason || '';
    if (error.status === 401) {
      error.message = 'Your Telegram launch is missing, invalid or expired. Close Becs and reopen it from @becsmebot in Telegram.';
      state.me = null;
      state.access = 'unknown';
      state.accessVersion++;
      clearWorkspace();
      state.apiError = error.message;
      render();
    } else if (error.status === 403 && [
      'access_pending', 'access_revoked', 'access_rejected',
      'not_invited', 'access_not_invited',
    ].includes(error.reason)) {
      denyAccess(error.reason.replace(/^access_/, ''));
    }
    throw error;
  }
  if (requestAccessVersion !== state.accessVersion) {
    throw new Error('Your access changed. Check access again.');
  }
  return payload;
}
""")
    source = replace_function(source, 'function gatePage(){', 'function accessPage(){', """function gatePage() {
  return `<section class="access-card">
    <span class="access-symbol">${icon('lock')}</span>
    <p class="eyebrow">BECS / SECURE TELEGRAM ACCESS</p>
    <h1>Open Becs in Telegram</h1>
    <p>Open @becsmebot in Telegram and launch Becs using the Mini App button.</p>
    <div class="notice warn" role="alert">${safe(state.apiError || 'A verified Telegram launch is required.')}</div>
    <p>If this launch has expired, close the Mini App and open it again from the bot.</p>
    <button class="button button-primary" data-action="retry-access">${icon('refresh')} Check access</button>
    <div class="access-footer">Invite-only access. Each approved person gets a private workspace.</div>
  </section>`;
}
""")
    source = replace_once(
        source,
        " 'unlock':async()=>{sessionStorage.setItem('becs_key',dom('adminKey').value);await reload();if(state.apiError)toast('Invalid access key or server configuration',true);}\n",
        '',
    )
    source = replace_once(source, "!['retry-access','unlock'].includes(target.dataset.action)",
                          "target.dataset.action!=='retry-access'")
    source = replace_once(source, 'Local or self-hosted; no deployment requested',
                          'Private workspace API hosted on Railway')
    for forbidden in FORBIDDEN_HOSTED:
        if forbidden.lower() in source.lower():
            raise ValueError(f'Forbidden hosted behavior remains: {forbidden}')
    return source


def readable_css(source: str) -> str:
    """Expand compact CSS without rewriting quoted text, comments or values."""
    result, current = [], []
    depth, parens = 0, 0
    quote = None
    escaped = False
    comment = False
    i = 0

    def flush():
        value = ''.join(current).strip()
        if value:
            result.append('  ' * depth + value)
        current.clear()

    while i < len(source):
        char = source[i]
        if comment:
            current.append(char)
            if char == '*' and source[i:i + 2] == '*/':
                current.append('/')
                i += 1
                comment = False
                flush()
        elif quote:
            current.append(char)
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == quote:
                quote = None
        elif source[i:i + 2] == '/*':
            flush()
            current.extend(['/', '*'])
            i += 1
            comment = True
        elif char in ('"', "'"):
            quote = char
            current.append(char)
        elif char == '(':
            parens += 1
            current.append(char)
        elif char == ')':
            parens -= 1
            current.append(char)
        elif char == '{' and parens == 0:
            current.append(' {')
            flush()
            depth += 1
        elif char == '}' and parens == 0:
            flush()
            depth -= 1
            current.append(char)
            flush()
        elif char == ';' and parens == 0:
            current.append(char)
            flush()
        elif char == '\n':
            current.append(' ')
        else:
            current.append(char)
        i += 1
    flush()
    if quote or comment or depth or parens:
        raise ValueError('Unbalanced approved CSS')
    return '\n'.join(result) + '\n'


def production_tests() -> list[dict]:
    guardrail = (
        'Use a fresh unsigned normal-browser session only. Do not enter credentials, '
        'phone numbers, login codes, passwords, invite tokens or real signed Telegram data. '
        'Do not create/revoke invites, approve/revoke users, connect/disconnect accounts, '
        'save routes, toggle forwarding, or make any live write. If already authenticated, stop this test.'
    )
    return [
        {
            'name': 'Unsigned launch blocks workspace and access management',
            'sanity': True,
            'viewport': 'desktop',
            'covers': ['anonymous denial', 'workspace privacy', 'admin access boundary', 'safe retry'],
            'description': 'Unauthenticated visitors remain outside private workspaces, including after a deliberate access retry.',
            'steps': [guardrail, 'Open the app without a Telegram launch payload.',
                      'Choose Check access once.',
                      'Verify the guidance to reopen the Mini App from @becsmebot and inspect the unavailable workspace navigation.'],
            'expected': 'The Telegram-only access screen remains visible; no routes, user list, invitation controls or sign-in fields are exposed, and no API call is made without signed launch data.',
        },
        {
            'name': 'Mobile access gate keeps account controls unavailable',
            'viewport': 'mobile',
            'covers': ['mobile access guidance', 'account control guardrail', 'no server-key fallback'],
            'description': 'A mobile unsigned visitor cannot reach Telegram account connection or an alternate server-key sign-in.',
            'steps': [guardrail, 'Open the app at the mobile viewport without a Telegram launch.',
                      'Verify the Account button is disabled and the workspace navigation is hidden.',
                      'Read the missing/expired launch guidance and check that it fits the viewport.'],
            'expected': 'The user can read how to reopen Becs in Telegram without horizontal scrolling. Phone/code/password, server-key, unlock and invitation inputs are absent; no account or workspace change occurs.',
        },
        {
            'name': 'Unverified URL identity does not grant private access',
            'viewport': 'desktop',
            'covers': ['untrusted URL identity denial', 'protected navigation', 'signed identity required'],
            'description': 'A plain URL parameter and a users fragment cannot substitute for verified Telegram launch data.',
            'steps': [guardrail, 'Open the app with only ?user_id=999999&role=admin#users appended to its URL; do not supply tgWebAppData or any real identity.',
                      'Choose Check access once and inspect the rendered page.'],
            'expected': 'The Telegram access gate remains visible. No Users page, private workspace or account connection UI appears and the unverified URL identity is never sent as authentication.',
        },
    ]


def safe_relative(path: str) -> bool:
    candidate = Path(path)
    return not candidate.is_absolute() and '..' not in candidate.parts and '\\' not in path


def build_changes(source_root: Path = ROOT) -> tuple[dict[str, str], dict]:
    static = source_root / 'static'
    originals = {name: (static / name).read_text() for name in (
        'index.html', 'app.js', 'styles.css', 'icon.svg', 'manifest.webmanifest',
    )}
    js = hosted_script(originals['app.js'])
    css = readable_css(originals['styles.css'])
    icon = originals['icon.svg']
    asset_map = {}
    changes = {}
    for source, label, content, extension in [
        ('app.js', 'app', js, 'js'), ('styles.css', 'styles', css, 'css'),
        ('icon.svg', 'icon', icon, 'svg'),
    ]:
        filename = f'becs-private-workspaces-{label}-{digest(content)[:16]}.{extension}'
        asset_map[source] = f'/assets/{filename}'
        changes[f'public/assets/{filename}'] = content
    manifest = json.loads(originals['manifest.webmanifest'])
    manifest['icons'][0]['src'] = asset_map['icon.svg']
    manifest_content = serialized(manifest)
    manifest_name = f'becs-private-workspaces-manifest-{digest(manifest_content)[:16]}.webmanifest'
    asset_map['manifest.webmanifest'] = f'/assets/{manifest_name}'
    changes[f'public/assets/{manifest_name}'] = manifest_content
    index = originals['index.html']
    for original, target in asset_map.items():
        pattern = re.compile(r'/assets/' + re.escape(original) + r'(?:\?[^"\s<>]*)?')
        index, count = pattern.subn(target, index)
        if count != 1:
            raise ValueError(f'Expected one index reference to {original}, got {count}')
    # Preserve text and elements; break adjacent tags into readable source lines.
    index = re.sub(r'>\s*<', '>\n<', index)
    changes['index.html'] = index.rstrip() + '\n'
    changes['tests/tests.json'] = serialized(production_tests())
    changes = dict(sorted(changes.items()))
    for path in changes:
        if not safe_relative(path):
            raise ValueError(f'Unsafe output path: {path}')
        if path in BASE_HASHES and digest(changes[path]) == BASE_HASHES[path]:
            raise ValueError(f'Unchanged file would be submitted: {path}')
    info = {
        'base_version': BASE_VERSION,
        'base_version_label': 'v3',
        'app_id': APP_ID,
        'app_url': APP_URL,
        'api_url': API_URL,
        'publication_performed': False,
        'assets': asset_map,
        'source_sha256': {f'static/{name}': digest(content) for name, content in sorted(originals.items())},
        'changed_sha256': {path: digest(content) for path, content in changes.items()},
        'base_sha256': BASE_HASHES,
        'unchanged_scaffold': list(BUILD_BASE_PATHS),
        'service_worker': 'No registration in hosted script; preserved v3 worker file is dormant.',
    }
    return changes, info


def deployment_payload(changes: dict[str, str]) -> dict:
    return {
        'link_id': LINK_ID,
        'app_id': APP_ID,
        'app_name': APP_NAME,
        'app_type': 'frontend-only',
        'frontend_template': 'html-static',
        'model': 'chat',
        'intent': 'feature',
        'initiator': 'user',
        'type': 'feature',
        'description': 'Private workspace Users and invite management with Telegram-only hosted access and the existing Railway API.',
        'files': [{'filename': path, 'content': content} for path, content in changes.items()],
    }


def verified_base(base: Path, full_snapshot: bool) -> dict[str, bytes]:
    expected = BASE_HASHES if full_snapshot else {name: BASE_HASHES[name] for name in BUILD_BASE_PATHS}
    result = {}
    for name, expected_hash in expected.items():
        file = base / name
        if file.is_symlink() or not file.is_file():
            raise ValueError(f'Missing or unsafe pinned base file: {name}')
        content = file.read_bytes()
        if digest(content) != expected_hash:
            raise ValueError(f'Pinned v3 snapshot changed: {name}; reread the live snapshot before release.')
        result[name] = content
    actual = {str(file.relative_to(base)) for file in base.rglob('*') if file.is_file()}
    if actual != set(expected):
        raise ValueError(f'Unexpected base file set: {sorted(actual ^ set(expected))}')
    return result


def write_file(root: Path, name: str, content: str | bytes):
    target = root / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content.encode() if isinstance(content, str) else content)


def build_bundle(output: Path, source_root: Path = ROOT, snapshot: Path | None = None) -> dict:
    output = output.resolve()
    repo = source_root.resolve()
    if output == repo or output.is_relative_to(repo) or repo.is_relative_to(output):
        raise ValueError('Bundle output must be outside the source repository.')
    if output.exists() and any(output.iterdir()):
        raise ValueError('Output directory must be empty; choose a new directory for each build.')
    # Verify everything before writing, and never delete an existing directory.
    changes, info = build_changes(source_root)
    base = verified_base(snapshot or source_root / 'scripts/appdeploy_base', snapshot is not None)
    info['full_snapshot_preserved'] = snapshot is not None
    output.mkdir(parents=True, exist_ok=True)
    for path, content in base.items():
        write_file(output / 'project', path, content)
    for path, content in changes.items():
        write_file(output / 'changed', path, content)
        write_file(output / 'project', path, content)
    write_file(output, 'deployment_payload.json', serialized(deployment_payload(changes)))
    write_file(output, 'release_manifest.json', serialized(info))
    release_doc = source_root / 'APPDEPLOY_RELEASE.md'
    if release_doc.exists():
        shutil.copyfile(release_doc, output / 'APPDEPLOY_RELEASE.md')
    zip_path = output.with_suffix('.zip')
    if zip_path.exists():
        raise ValueError(f'Archive already exists: {zip_path}')
    with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for file in sorted(output.rglob('*')):
            if file.is_file():
                entry = zipfile.ZipInfo(str(file.relative_to(output)), date_time=(1980, 1, 1, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                entry.external_attr = 0o100644 << 16
                archive.writestr(entry, file.read_bytes())
    return info


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True, help='New bundle directory outside this repository')
    parser.add_argument('--snapshot', type=Path, help='Optional exact read-only AppDeploy v3 snapshot for a complete source merge')
    args = parser.parse_args()
    info = build_bundle(args.output, snapshot=args.snapshot)
    print(f'Prepared {len(info["changed_sha256"])} changed files for {APP_ID}; no deployment performed.')
    print(f'Payload: {args.output / "deployment_payload.json"}')
    print(f'Build directory: {args.output / "project"}')
    print(f'Archive: {args.output.with_suffix(".zip")}')


if __name__ == '__main__':
    main()
