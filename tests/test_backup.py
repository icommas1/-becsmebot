"""Synthetic configuration export security, integrity and recovery coverage."""
import base64
import io
import json
import os
import subprocess
import sys
import unittest
import zipfile
from unittest.mock import patch
from pathlib import Path

from app import backup, db
import test_workspace_api as fixtures
from test_workspace_api import OWNER, MEMBER_A, MEMBER_B, UNKNOWN, signed_init_data


class BackupTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = fixtures.WorkspaceAPIRegression.asyncSetUp
    initialize_workspace = fixtures.WorkspaceAPIRegression.initialize_workspace
    add_user = fixtures.WorkspaceAPIRegression.add_user
    request = fixtures.WorkspaceAPIRegression.request
    seed_workspace = fixtures.WorkspaceAPIRegression.seed_workspace

    async def exported(self):
        response = await self.request('GET', '/api/admin/backups/export')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        return response.json(), base64.b64decode(response.json()['content_base64'])

    async def test_export_all_three_whitelist_and_disabled_plan(self):
        for uid in (OWNER, MEMBER_A, MEMBER_B):
            self.seed_workspace(uid)
            with db.workspace(uid):
                db.set_setting('secret', 'MUST_NOT_EXPORT_SECRET')
                db.set_setting('telegram_bot_update_offset', 'MUST_NOT_EXPORT_OFFSET')
                with db.connection() as conn:
                    conn.execute('UPDATE routes SET enabled=1')
        data, raw = await self.exported()
        result = backup.validate_backup(raw, include_plan=True)
        self.assertEqual(result['workspace_count'], 3)
        self.assertEqual(result['route_count'], 3)
        self.assertIn('UTC.zip', data['filename'])
        for uid in (OWNER, MEMBER_A, MEMBER_B):
            config = result['workspaces'][uid]
            self.assertEqual(config['routes'][0]['name'], 'Private route ' + uid)
            self.assertFalse(config['routes'][0]['enabled'])
            self.assertTrue(config['settings']['paused'])
            self.assertEqual(config['membership'], 'requires-owner-reapproval')
        for forbidden in (b'MUST_NOT_EXPORT', b'Private job', b'Private review', b'workspace_marker', b'fingerprint-'):
            self.assertNotIn(forbidden, raw)
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            self.assertEqual(len(z.namelist()), 5)
            manifest = json.loads(z.read('manifest.json'))
            self.assertEqual(manifest['members'], [{'telegram_id': uid, 'status': 'approved'} for uid in (OWNER, MEMBER_A, MEMBER_B)])
        status = await self.request('GET', '/api/admin/backups/status')
        self.assertEqual(status.json()['configuration_checksum'], data['configuration_checksum'])

    async def test_auth_denials_and_untrusted_workspace_override(self):
        for path in ('/api/admin/backups/export', '/api/admin/backups/status'):
            for uid in (MEMBER_A, MEMBER_B, UNKNOWN, None):
                response = await self.request('GET', path, uid)
                self.assertIn(response.status_code, (401, 403))
            expired = await self.request('GET', path, None, headers={'X-Telegram-Init-Data': signed_init_data(OWNER, timestamp=1)})
            self.assertEqual(expired.status_code, 401)
            with patch.dict(os.environ, {'BECS_ADMIN_TOKEN': 'test-key'}):
                keyed = await self.request('GET', path, None, headers={'X-Becs-Key': 'test-key'})
                self.assertEqual(keyed.status_code, 403)
        with db.workspace(MEMBER_A), self.assertRaises(ValueError):
            backup.export_backup()
        self.seed_workspace(OWNER)
        response = await self.request('GET', '/api/admin/backups/export?workspace_id=../../etc&user_id=' + UNKNOWN)
        self.assertEqual(response.status_code, 200)

    async def test_revoke_and_missing_workspace_fail_closed(self):
        from app import access
        access.revoke_user(OWNER, MEMBER_B)
        _, raw = await self.exported()
        self.assertEqual(backup.validate_backup(raw)['workspace_count'], 2)
        db.workspace_path(MEMBER_A).unlink()
        response = await self.request('GET', '/api/admin/backups/export')
        self.assertEqual(response.status_code, 409)
        self.assertFalse(db.workspace_path(MEMBER_A).exists())

    async def test_corrupt_extra_compressed_duplicate_and_limits(self):
        _, raw = await self.exported()
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            contents = {name: z.read(name) for name in z.namelist()}
        def changed(mapping, compression=zipfile.ZIP_STORED):
            out = io.BytesIO()
            with zipfile.ZipFile(out, 'w', compression=compression) as z:
                for name, value in mapping.items(): z.writestr(name, value)
            return out.getvalue()
        bad = dict(contents);bad['README.txt'] += b'changed'
        cases = [b'not a zip', raw[:40], changed(bad), changed({**contents, '../escape': b'bad'}), changed(contents, zipfile.ZIP_DEFLATED), b'x'*(backup.MAX_BYTES+1)]
        bad = dict(contents);bad['manifest.json'] = b'{"format":1,"format":2}'
        cases.append(changed(bad))
        for candidate in cases:
            with self.assertRaises(ValueError): backup.validate_backup(candidate)
        with patch('app.backup.MAX_ROUTES', 0):
            self.seed_workspace(OWNER)
            response = await self.request('GET', '/api/admin/backups/export')
            self.assertEqual(response.status_code, 409)

    async def test_offline_validator_no_database_mutation(self):
        _, raw = await self.exported()
        source = self.root / 'backup.zip'; source.write_bytes(raw)
        plan = self.root / 'plan.json'
        before = {p: p.read_bytes() for p in self.root.rglob('*.sqlite')}
        command = [sys.executable, str(Path(__file__).resolve().parents[1] / 'scripts/validate_backup.py'), str(source), '--plan', str(plan)]
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)['valid'])
        self.assertEqual(plan.stat().st_mode & 0o777, 0o600)
        self.assertEqual(before, {p: p.read_bytes() for p in before})
        self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
