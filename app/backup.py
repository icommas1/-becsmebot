"""Bounded, secret-free configuration ZIPs. No automatic restore or cloud storage."""
import base64
import hashlib
import io
import json
import sqlite3
import zipfile
import stat
from datetime import datetime, timezone
from contextlib import closing

from . import access
from .db import as_dict, current_workspace, validated_workspace_id, workspace_path
from .models import RouteInput

MAX_BYTES = 6 * 1024 * 1024
MAX_ROUTES = 1000
# Schema-v1 fields are intentionally pinned; model growth must not expand an export.
FIELDS = ('name', 'mode', 'enabled', 'sources', 'destinations', 'allowed', 'blocked', 'pattern',
          'match_mode', 'network', 'require_contract', 'dedup_minutes', 'delivery_style')
EXCLUSIONS = ['Sessions and credentials', 'API keys and server environment', 'Invitations and access tokens',
              'Message history, reviews and logs', 'Queued jobs and deduplication history', 'Unapproved or revoked workspaces']
RECOVERY = """Becs configuration backup, schema version 1

PRIVATE FILE: This unencrypted archive includes the approved users' private chat identifiers,
route names and filters. Keep it private. It is outside Railway only once you save your own copy.
Each workspace has its own JSON file. The manifest lists inert Telegram IDs/status and checksums.
Workspace snapshots are individually consistent, not a global transaction across all accounts.
SHA-256 detects accidental changes; it does not prove authenticity or prevent malicious tampering.

VALIDATE OFFLINE
From a trusted Becs checkout: python scripts/validate_backup.py PATH_TO_BACKUP.zip
The output is a recovery inventory. --plan PATH writes a local JSON dry-run plan with forwarding
paused, every route disabled, and membership requiring fresh owner approval. It never restores
anything, contacts Telegram, uploads files or grants access.

MANUAL RECOVERY
1. Install a trusted compatible Becs release on a new server. Supply credentials separately.
2. Owner signs in and pauses forwarding BEFORE reconnecting Telegram. Keep all routes disabled.
3. Review the manifest's IDs. Invite and approve each member again; archived membership grants
   no access. Each person reconnects their OWN Telegram account in their OWN workspace.
4. The owner recreates owner routes; each member recreates their routes from their workspace's
   routes/settings JSON using the route editor. Distribute a member's config only with permission.
5. Recheck sources, destinations, filters, mode, delivery style and cooldown; test each route.
6. Enable selected routes and resume only after explicit review. Saved enabled/paused values
   describe previous intent, not permission to restart. Old messages/queues are never replayed.

No import/live restore is implemented. Revoked/pending users, histories, queues, deduplication,
sessions, login state, invitations, API keys and server secrets cannot be restored from this file.
Export before migrations, data-affecting updates or server moves, after important config changes,
and periodically. The app can confirm preparation, never that your device saved the file.
"""


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf-8')


def checksum(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def approved_members():
    owner = access.owner_id()
    if current_workspace.get() != owner:
        raise ValueError('Owner workspace context required.')
    result = [{'telegram_id': validated_workspace_id(u['telegram_id']), 'status': 'approved'}
              for u in access.list_users(owner) if u['status'] == 'approved']
    result.sort(key=lambda u: u['telegram_id'])
    if not 1 <= len(result) <= 3 or owner not in [u['telegram_id'] for u in result]:
        raise ValueError('Approved workspace inventory is invalid.')
    return result


def configuration(user_id):
    # Read-only SQLite: missing member storage is an error, never create empty backups.
    path = workspace_path(validated_workspace_id(user_id))
    with closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)) as db:
        db.row_factory = sqlite3.Row
        db.execute('BEGIN')
        rows = db.execute('SELECT ' + ','.join(FIELDS) + ' FROM routes ORDER BY id LIMIT ?', (MAX_ROUTES + 1,)).fetchall()
        if len(rows) > MAX_ROUTES:
            raise ValueError('Too many routes for a portable export (maximum 1000 per workspace).')
        routes = [{key: value for key, value in RouteInput.model_validate(as_dict(row)).model_dump().items() if key in FIELDS} for row in rows]
        paused = db.execute("SELECT value FROM settings WHERE key='paused'").fetchone()
    payload = {'routes': routes, 'settings': {'paused': bool(paused and paused['value'] == 'true')}}
    if len(canonical(payload)) > 2 * 1024 * 1024 - 16384:
        raise ValueError('Workspace configuration exceeds 2 MiB.')
    return payload


def snapshot():
    members = approved_members()
    workspaces = {u['telegram_id']: configuration(u['telegram_id']) for u in members}
    if approved_members() != members:
        raise ValueError('Workspace access changed during export. Try again.')
    return {'members': members, 'workspaces': workspaces}


def backup_status():
    data = snapshot()
    return {'configuration_checksum': checksum(data), 'workspace_count': len(data['members']), 'schema_version': 1}


def export_backup():
    data = snapshot()
    created = datetime.now(timezone.utc)
    files = {'README.txt': RECOVERY.encode()}
    for user_id, payload in data['workspaces'].items():
        files[f'workspaces/{user_id}/configuration.json'] = canonical(payload)
    manifest = {'format': 'becs-configuration-backup', 'schema_version': 1, 'created_at': created.isoformat(),
                'scope': 'currently-approved-workspaces', 'members': data['members'], 'excluded': EXCLUSIONS,
                'configuration_checksum': checksum(data),
                'files': {name: {'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)} for name, raw in files.items()}}
    files['manifest.json'] = canonical(manifest)
    output = io.BytesIO()
    # Stored ZIP bounds decoding cost and avoids zip-bomb decompression.
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_STORED) as archive:
        for name, raw in files.items():
            archive.writestr(name, raw)
    raw = output.getvalue()
    validate_backup(raw)
    return {'filename': 'becs-backup-' + created.strftime('%Y-%m-%d-%H%M%S') + '-UTC.zip',
            'content_base64': base64.b64encode(raw).decode(), 'created_at': created.isoformat(),
            'configuration_checksum': manifest['configuration_checksum'], 'schema_version': 1}


def parse_json(raw):
    def unique(pairs):
        out = {}
        for key, value in pairs:
            if key in out:
                raise ValueError('Duplicate JSON field.')
            out[key] = value
        return out
    return json.loads(raw, object_pairs_hook=unique, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-finite JSON value.')))


def validate_backup(raw, include_plan=False):
    """Bounded offline validation and disabled/paused recovery plan. Never restores."""
    if not isinstance(raw, bytes) or len(raw) > MAX_BYTES:
        raise ValueError('Backup must be at most 6 MiB.')
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            infos = archive.infolist()
            names = [i.filename for i in infos]
            if not 3 <= len(names) <= 5 or len(set(names)) != len(names) or sum(i.file_size for i in infos) > MAX_BYTES or any(i.compress_type != zipfile.ZIP_STORED or i.flag_bits & 1 or stat.S_IFMT(i.external_attr >> 16) not in (0, stat.S_IFREG) for i in infos):
                raise ValueError('Unsupported or oversized ZIP inventory.')
            manifest = parse_json(archive.read('manifest.json'))
            if set(manifest) != {'format', 'schema_version', 'created_at', 'scope', 'members', 'excluded', 'configuration_checksum', 'files'} or manifest['format'] != 'becs-configuration-backup' or type(manifest['schema_version']) is not int or manifest['schema_version'] != 1 or manifest['scope'] != 'currently-approved-workspaces':
                raise ValueError('Unsupported manifest or schema.')
            if datetime.fromisoformat(manifest['created_at']).tzinfo is None or manifest['excluded'] != EXCLUSIONS:
                raise ValueError('Invalid manifest metadata.')
            members = manifest['members']
            if not isinstance(members, list) or not 1 <= len(members) <= 3:
                raise ValueError('Invalid membership inventory.')
            ids = []
            for member in members:
                if set(member) != {'telegram_id', 'status'} or not isinstance(member['telegram_id'], str) or member['status'] != 'approved':
                    raise ValueError('Invalid inert membership metadata.')
                uid = validated_workspace_id(member['telegram_id'])
                if int(uid) >= 2**63:
                    raise ValueError('Invalid Telegram identity.')
                ids.append(uid)
            if len(set(ids)) != len(ids):
                raise ValueError('Duplicate workspace identity.')
            expected = {'README.txt'} | {f'workspaces/{uid}/configuration.json' for uid in ids}
            if set(names) != expected | {'manifest.json'} or set(manifest['files']) != expected:
                raise ValueError('Unexpected ZIP paths or files.')
            contents = {}
            for name in expected:
                content = archive.read(name)
                if manifest['files'][name] != {'sha256': hashlib.sha256(content).hexdigest(), 'bytes': len(content)}:
                    raise ValueError('Backup integrity check failed.')
                contents[name] = content
            # README wording is informational, integrity checked, never executed.
            # Future wording changes must not invalidate an older schema-v1 file.
            contents['README.txt'].decode('utf-8')
            workspaces = {}
            for uid in ids:
                config_raw = contents[f'workspaces/{uid}/configuration.json']
                if len(config_raw) > 2 * 1024 * 1024:
                    raise ValueError('Workspace exceeds 2 MiB.')
                payload = parse_json(config_raw)
                if set(payload) != {'routes', 'settings'} or payload['settings'].keys() != {'paused'} or type(payload['settings']['paused']) is not bool:
                    raise ValueError('Invalid settings.')
                if not isinstance(payload['routes'], list) or len(payload['routes']) > MAX_ROUTES:
                    raise ValueError('Invalid route inventory.')
                for route in payload['routes']:
                    if set(route) != set(FIELDS):
                        raise ValueError('Unexpected route fields.')
                    RouteInput.model_validate(route, strict=True)
                workspaces[uid] = payload
            if checksum({'members': members, 'workspaces': workspaces}) != manifest['configuration_checksum']:
                raise ValueError('Configuration integrity check failed.')
            result = {'valid': True, 'validation_scope': 'Structure and checksums only; authenticity is not verified. Use recovery instructions from your trusted Becs checkout, not untrusted archive text.', 'schema_version': 1, 'workspace_count': len(ids),
                      'route_count': sum(len(w['routes']) for w in workspaces.values()), 'created_at': manifest['created_at'],
                      'restore_mode': 'manual-disabled-first', 'membership_requires_reapproval': True,
                      'manual_checks_required': ['Chat access and identities', 'Regex validity and behavior', 'Source/destination loop protection', 'AI provider setup', 'Route simulation before enabling']}
            if include_plan:
                result['workspaces'] = {uid: {'settings': {'paused': True}, 'routes': [{**r, 'enabled': False} for r in w['routes']], 'membership': 'requires-owner-reapproval'} for uid, w in workspaces.items()}
            return result
    except (TypeError, KeyError, AttributeError, UnicodeError, RecursionError, OverflowError, zipfile.BadZipFile, RuntimeError) as exc:
        raise ValueError('Invalid backup structure or archive.') from exc
