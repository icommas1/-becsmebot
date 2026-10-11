"""Offline adversarial HTTP coverage for private, isolated Telegram workspaces.

Requests use an external ASGI address rather than the deliberate legacy testclient
bypass. Telegram initData is genuinely HMAC-signed with an entirely synthetic bot
token. No lifespan, Telegram client, outbound HTTP, or delivery worker is started.
"""
import asyncio
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import tempfile
import time
import unittest
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qsl, urlencode

import httpx

from app import access, db, main
from app.models import RouteInput


OWNER = '123456'
MEMBER_A = '222222'
MEMBER_B = '333333'
UNKNOWN = '444444'
BOT_TOKEN = 'synthetic-offline-bot-token:workspace-security'


def signed_init_data(user_id, *, token=BOT_TOKEN, timestamp=None, user=None,
                     extra=None, exclude_signature=False):
    """Use Telegram's bot-token HMAC, including signature in the signed fields."""
    fields = {
        'auth_date': str(int(time.time()) if timestamp is None else timestamp),
        'query_id': 'offline-query-+-%',
        'signature': 'synthetic-ed25519-value_-+/%=',
        'user': json.dumps({'id': int(user_id), 'first_name': 'Offline + User'}
                           if user is None else user, separators=(',', ':')),
    }
    fields.update(extra or {})
    checked = {k: v for k, v in fields.items()
               if not (exclude_signature and k == 'signature')}
    check_string = '\n'.join(f'{key}={value}' for key, value in sorted(checked.items()))
    key = hmac.new(b'WebAppData', token.encode(), hashlib.sha256).digest()
    fields['hash'] = hmac.new(key, check_string.encode(), hashlib.sha256).hexdigest()
    return urlencode(fields)


class OfflineManager:
    """A separate manager per identity; snapshots detect async context leakage."""
    def __init__(self, user_id):
        self.user_id = str(user_id)
        self.observations = []
        self.calls = []
        self.entered = None
        self.release = None

    def snapshot(self):
        value = (db.current_workspace.get(), db.get_setting('workspace_marker'))
        self.observations.append(value)
        return value

    async def status(self):
        before = self.snapshot()
        await asyncio.sleep(0)
        after = self.snapshot()
        return {'authorized': True, 'configured': False, 'user_id': self.user_id,
                'context_before': list(before), 'context_after': list(after)}

    async def chats(self):
        self.snapshot()
        await asyncio.sleep(0)
        self.snapshot()
        return [{'id': self.user_id + '-chat', 'title': 'Private ' + self.user_id}]

    async def resolve_chat(self, reference, role):
        self.calls.append(('resolve', reference, role))
        self.snapshot()
        if self.entered is not None:
            self.entered.set()
            await self.release.wait()
        await asyncio.sleep(0)
        self.snapshot()
        return {'id': str(reference), 'title': self.user_id, 'validated': True,
                'workspace': self.user_id}

    async def start_phone(self, phone):
        self.snapshot()
        self.calls.append(('start', phone))
        return {'step': 'code', 'workspace': self.user_id}

    async def sign_in_code(self, code):
        self.snapshot()
        self.calls.append(('code', code))
        return {'step': 'password', 'workspace': self.user_id}

    async def sign_in_password(self, password):
        self.snapshot()
        self.calls.append(('password', password))
        return {'authorized': True, 'workspace': self.user_id}

    async def disconnect(self, logout=False):
        self.snapshot()
        self.calls.append(('disconnect', logout))


class OfflineRuntime:
    def __init__(self):
        self.managers = {}
        self.selected = []
        self.activate = AsyncMock(side_effect=self._activate)
        self.revoke = AsyncMock()

    def get(self, user_id):
        user_id = str(user_id)
        self.selected.append((user_id, db.current_workspace.get()))
        return self.managers.setdefault(user_id, OfflineManager(user_id))

    async def _activate(self, user_id):
        with db.workspace(user_id):
            db.init_db()
            db.set_setting('workspace_marker', str(user_id))
        return self.get(user_id)

    def worker_for(self, user_id):
        return None


class WorkspaceAPIRegression(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='becs-workspace-api-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        config = patch.dict(os.environ, {
            'TELEGRAM_BOT_TOKEN': BOT_TOKEN,
            'BECS_ALLOWED_TELEGRAM_ID': OWNER,
            'BECS_ADMIN_TOKEN': '', 'BECS_DEV_MODE': '0',
            'TELEGRAM_API_ID': '', 'TELEGRAM_API_HASH': '',
            'GEMINI_API_KEY': '', 'BECS_SESSION_SECRET': '',
            'BECS_SESSION_DIR': str(self.root / 'sessions'),
        })
        config.start()
        self.addCleanup(config.stop)
        for name, value in [('app.db.DB_PATH', self.root / 'becs.sqlite'),
                            ('app.main._request_locks', {}),
                            ('app.main._login_attempts', main.defaultdict(main.deque))]:
            patcher = patch(name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.runtime = OfflineRuntime()
        runtime_patch = patch('app.main.runtime', self.runtime)
        runtime_patch.start()
        self.addCleanup(runtime_patch.stop)
        # Keep the real WorkspaceManager: replacing it would hide ID-selection bugs.
        self.assertIsInstance(main.manager, main.WorkspaceManager)
        access.init_access()
        self.initialize_workspace(OWNER)
        self.add_user(MEMBER_A)
        self.add_user(MEMBER_B)
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app, client=('203.0.113.90', 4521)),
            base_url='https://becs-offline.example')
        self.addAsyncCleanup(self.client.aclose)

    def initialize_workspace(self, user_id):
        with db.workspace(user_id):
            db.init_db()
            db.set_setting('workspace_marker', str(user_id))

    def add_user(self, user_id, approved=True):
        invite = access.create_invite(OWNER)
        access.redeem_invite(invite['token'], user_id, 'Synthetic ' + str(user_id))
        if approved:
            access.approve_user(OWNER, user_id)
            self.initialize_workspace(user_id)
        return invite

    async def request(self, method, path, user_id=OWNER, **kwargs):
        headers = dict(kwargs.pop('headers', {}))
        if user_id is not None:
            headers.setdefault('X-Telegram-Init-Data', signed_init_data(user_id))
        return await self.client.request(method, path, headers=headers, **kwargs)

    def seed_workspace(self, user_id, count=1):
        """Give all tenants colliding local IDs and unmistakably private content."""
        with db.workspace(user_id), db.connection() as connection:
            route_id = main.save_route(connection, RouteInput(
                name='Private route ' + str(user_id), mode='express',
                sources=['-1001'], destinations=['-1002']))
            now = time.time()
            connection.execute('''INSERT INTO jobs
                (route_id,source_id,destination_id,message_id,message_preview,
                 fingerprint,status,attempts,created_at,error)
                VALUES (?,?,'-1002',7,?,?,'failed',3,?,'Synthetic failure')''',
                (route_id, str(user_id), 'Private job ' + str(user_id),
                 'fingerprint-' + str(user_id), now))
            connection.execute('''INSERT INTO reviews
                (route_id,source_id,destination_id,message_id,text,fingerprint,
                 reason,status,created_at)
                VALUES (?,?,'-1002',8,?,?,'Synthetic reason','pending',?)''',
                (route_id, str(user_id), 'Private review ' + str(user_id),
                 'review-' + str(user_id), now))
            db.event(connection, 'contract', 'Private event ' + str(user_id), route_id)
            for index in range(count):
                connection.execute('INSERT INTO contracts VALUES (?,?,?,?,?)',
                                   ('evm', str(user_id) + '-' + str(index), now, now, 1))
            return route_id

    def read_row(self, user_id, table, row_id=1):
        self.assertIn(table, {'routes', 'jobs', 'reviews'})
        with db.workspace(user_id), db.connection() as connection:
            row = connection.execute(f'SELECT * FROM {table} WHERE id=?', (row_id,)).fetchone()
            return dict(row) if row else None

    def api_operations(self, admin=None):
        """Automatically cover new API endpoints instead of a stale manual list."""
        for route in main.app.routes:
            path = getattr(route, 'path', '')
            if not path.startswith('/api/') or path in ('/api/health', '/api/me'):
                continue
            if admin is not None and path.startswith('/api/admin/') != admin:
                continue
            path = re.sub(r'\{user_id\}', MEMBER_A, path)
            path = re.sub(r'\{[^}]+\}', '1', path)
            for method in getattr(route, 'methods', ()):
                if method not in {'HEAD', 'OPTIONS'}:
                    yield method, path

    async def test_real_hmac_with_signature_accepts_owner_and_approved_members(self):
        for user_id in (OWNER, MEMBER_A, MEMBER_B):
            with self.subTest(user_id=user_id):
                response = await self.request('GET', '/api/me', user_id)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(str(response.json()['user']['telegram_id']), user_id)
                self.assertEqual(response.json()['user']['status'], 'approved')
                self.assertEqual(response.json()['is_admin'], user_id == OWNER)
                self.assertEqual(response.headers['cache-control'], 'no-store')
                self.assertEqual(response.headers['x-content-type-options'], 'nosniff')
        self.assertEqual(db.current_workspace.get(), None)

    async def test_forged_duplicate_expired_and_malformed_init_data_fail_closed(self):
        good = signed_init_data(OWNER)
        fields = dict(parse_qsl(good))
        tampered_user = dict(fields, user=json.dumps({'id': int(MEMBER_A)}))
        malformed_payloads = [
            '', 'not-init-data', 'auth_date=123&user={}',
            signed_init_data(OWNER, token='wrong-synthetic-token'),
            signed_init_data(OWNER, timestamp=int(time.time()) - 86410),
            signed_init_data(OWNER, timestamp=int(time.time()) + 300),
            signed_init_data(OWNER, exclude_signature=True),
            urlencode(tampered_user),
            good + '&user=' + fields['user'],
            good + '&%75ser=' + fields['user'],
            good + '&auth_date=' + fields['auth_date'],
            good + '&hash=' + fields['hash'],
            good + '&signature=changed',
            good.replace('synthetic-ed25519', 'forged-ed25519'),
            'x=' + 'a' * 8192,
        ]
        for raw in malformed_payloads:
            with self.subTest(payload=raw[:60]):
                response = await self.request('GET', '/api/me', None,
                                              headers={'X-Telegram-Init-Data': raw})
                self.assertEqual(response.status_code, 401, response.text)
                self.assertIn(response.json()['reason'], {
                    'missing_init_data', 'invalid_init_data', 'invalid_signature', 'expired_init_data'})
                self.assertNotIn(BOT_TOKEN, response.text)
        self.assertEqual(self.runtime.selected, [])

    async def test_signed_invalid_telegram_id_types_never_create_a_workspace(self):
        for user in [{'id': True}, {'id': OWNER}, {'id': 0}, {'id': -1},
                     {'id': 2 ** 63}, {'id': 123.0}, {'id': int(OWNER), 'is_bot': True},
                     {'first_name': 'No ID'}, [], 'not-a-user-object']:
            with self.subTest(user=user):
                response = await self.request('GET', '/api/me', None, headers={
                    'X-Telegram-Init-Data': signed_init_data(OWNER, user=user)})
                self.assertEqual(response.status_code, 401, response.text)
        self.assertEqual({p.name for p in (self.root / 'workspaces').glob('*.sqlite')},
                         {MEMBER_A + '.sqlite', MEMBER_B + '.sqlite'})

    async def test_every_private_api_endpoint_rejects_unsigned_external_requests(self):
        count = 0
        for method, path in self.api_operations():
            with self.subTest(method=method, path=path):
                response = await self.request(method, path, None, json={})
                self.assertEqual(response.status_code, 401, response.text)
                self.assertEqual(response.json()['reason'], 'missing_init_data')
                count += 1
        self.assertGreaterEqual(count, 25)
        self.assertEqual((await self.request('GET', '/api/health', None)).status_code, 200)
        self.assertEqual((await self.request('GET', '/api/me', None)).status_code, 401)

    async def test_pending_unknown_and_revoked_users_can_only_read_their_own_me(self):
        access.revoke_user(OWNER, MEMBER_B)
        self.add_user(UNKNOWN, approved=False)
        for user_id, status in ((UNKNOWN, 'pending'), (MEMBER_B, 'revoked'),
                                ('555555', 'not_invited')):
            with self.subTest(user_id=user_id):
                response = await self.request('GET', '/api/me', user_id)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()['user']['status'], status)
                self.assertFalse(response.json()['is_admin'])
                for method, path in self.api_operations():
                    blocked = await self.request(method, path, user_id, json={})
                    self.assertEqual(blocked.status_code, 403, (method, path, blocked.text))
        self.assertFalse((self.root / 'workspaces' / (UNKNOWN + '.sqlite')).exists())
        self.assertFalse((self.root / 'workspaces' / '555555.sqlite').exists())
        self.assertEqual(self.runtime.selected, [])

    async def test_all_admin_apis_require_signed_owner_even_with_shared_key(self):
        with patch.dict(os.environ, {'BECS_ADMIN_TOKEN': 'synthetic-shared-key'}):
            for method, path in self.api_operations(admin=True):
                for user_id in (None, MEMBER_A):
                    with self.subTest(method=method, path=path, user_id=user_id):
                        response = await self.request(method, path, user_id, json={},
                            headers={'X-Becs-Key': 'synthetic-shared-key'})
                        self.assertEqual(response.status_code, 403, response.text)
                        self.assertEqual(response.json()['reason'], 'owner_required')
        self.runtime.activate.assert_not_awaited()
        self.runtime.revoke.assert_not_awaited()

    async def test_development_or_shared_key_cannot_upgrade_invalid_signed_identity(self):
        with patch.dict(os.environ, {'BECS_DEV_MODE': '1',
                                    'BECS_ADMIN_TOKEN': 'synthetic-shared-key'}):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=main.app, client=('127.0.0.1', 4321)),
                base_url='http://localhost') as local:
                for method, path in self.api_operations(admin=True):
                    response = await local.request(method, path, json={})
                    self.assertEqual(response.status_code, 403, (method, path, response.text))
                for path in ('/api/me', '/api/routes', '/api/admin/users'):
                    response = await local.get(path, headers={
                        'X-Becs-Key': 'synthetic-shared-key',
                        'X-Telegram-Init-Data': signed_init_data(OWNER, token='forged')})
                    self.assertEqual(response.status_code, 401, response.text)
            response = await self.request('GET', '/api/routes', None)
            self.assertEqual(response.status_code, 401, response.text)
            response = await self.request('GET', '/api/routes', None,
                                          headers={'X-Becs-Key': 'wrong-key'})
            self.assertEqual(response.status_code, 401, response.text)

    async def test_owner_invite_metadata_and_string_id_revocation(self):
        access.revoke_user(OWNER, MEMBER_B)
        response = await self.request('POST', '/api/admin/invites')
        self.assertEqual(response.status_code, 201, response.text)
        invitation = response.json()
        self.assertIsInstance(invitation['id'], str)
        self.assertTrue(invitation['url'].startswith('https://t.me/becsmebot?start=invite_'))
        token = invitation['url'].split('invite_', 1)[1]
        listed = await self.request('GET', '/api/admin/invites')
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertNotIn(token, listed.text)
        self.assertNotIn('token_hash', listed.text)
        self.assertNotIn('"token"', listed.text)
        revoked = await self.request('DELETE', '/api/admin/invites/' + invitation['id'])
        self.assertEqual(revoked.status_code, 200, revoked.text)
        with self.assertRaises(access.AccessError):
            access.redeem_invite(token, UNKNOWN)

    async def test_approval_and_revocation_lifecycle_invalidates_existing_init_data(self):
        access.revoke_user(OWNER, MEMBER_B)
        self.add_user(UNKNOWN, approved=False)
        original_headers = {'X-Telegram-Init-Data': signed_init_data(UNKNOWN)}
        before = await self.request('GET', '/api/routes', None, headers=original_headers)
        self.assertEqual(before.status_code, 403)
        approved = await self.request('POST', '/api/admin/users/' + UNKNOWN + '/approve')
        self.assertEqual(approved.status_code, 200, approved.text)
        self.runtime.activate.assert_awaited_once_with(UNKNOWN)
        after = await self.request('GET', '/api/routes', None, headers=original_headers)
        self.assertEqual(after.status_code, 200, after.text)
        revoked = await self.request('POST', '/api/admin/users/' + UNKNOWN + '/revoke')
        self.assertEqual(revoked.status_code, 200, revoked.text)
        self.runtime.revoke.assert_awaited_once_with(UNKNOWN)
        old_signed_data = await self.request('GET', '/api/routes', None, headers=original_headers)
        self.assertEqual(old_signed_data.status_code, 403, old_signed_data.text)
        self.assertEqual(old_signed_data.json()['reason'], 'access_revoked')
        me = await self.request('GET', '/api/me', None, headers=original_headers)
        self.assertEqual(me.json()['user']['status'], 'revoked')
        blocked_reapproval = await self.request('POST', '/api/admin/users/' + UNKNOWN + '/approve')
        self.assertEqual(blocked_reapproval.status_code, 409, blocked_reapproval.text)
        owner_revoke = await self.request('POST', '/api/admin/users/' + OWNER + '/revoke')
        self.assertEqual(owner_revoke.status_code, 409, owner_revoke.text)
        self.assertEqual(access.get_user(OWNER)['status'], 'approved')

    async def test_workspace_lists_stats_events_and_settings_are_isolated(self):
        for count, user_id in enumerate((OWNER, MEMBER_A, MEMBER_B), 1):
            self.assertEqual(self.seed_workspace(user_id, count), 1)
        for count, user_id in enumerate((OWNER, MEMBER_A, MEMBER_B), 1):
            with self.subTest(user_id=user_id):
                for path, key, field in [('/api/routes', 'routes', 'name'),
                                         ('/api/jobs', 'jobs', 'message_preview'),
                                         ('/api/reviews', 'reviews', 'text'),
                                         ('/api/inspector', 'items', 'detail')]:
                    response = await self.request('GET', path, user_id)
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertEqual(len(response.json()[key]), 1)
                    self.assertIn(user_id, response.json()[key][0][field])
                    for other in {OWNER, MEMBER_A, MEMBER_B} - {user_id}:
                        self.assertNotIn(other, response.text)
                overview = await self.request('GET', '/api/overview', user_id)
                self.assertEqual(overview.status_code, 200, overview.text)
                self.assertEqual(overview.json()['stats']['contracts'], count)
                self.assertEqual(overview.json()['telegram']['user_id'], user_id)
        self.assertEqual((await self.request('POST', '/api/control/pause', MEMBER_A)).status_code, 200)
        for user_id in (OWNER, MEMBER_A, MEMBER_B):
            response = await self.request('GET', '/api/overview', user_id)
            self.assertEqual(response.json()['paused'], user_id == MEMBER_A)
        self.assertEqual((await self.request('POST', '/api/control/resume', MEMBER_A)).status_code, 200)
        with db.workspace(MEMBER_A):
            self.assertEqual(db.get_setting('paused'), 'false')

    async def test_colliding_route_ids_update_and_delete_only_callers_workspace(self):
        for user_id in (OWNER, MEMBER_A, MEMBER_B):
            self.seed_workspace(user_id)
        response = await self.request('PUT', '/api/routes/1', MEMBER_A,
                                      json={'name': 'Only member A changed', 'sources': [], 'destinations': []})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.read_row(MEMBER_A, 'routes')['name'], 'Only member A changed')
        for other in (OWNER, MEMBER_B):
            self.assertEqual(self.read_row(other, 'routes')['name'], 'Private route ' + other)
        deleted = await self.request('DELETE', '/api/routes/1', MEMBER_A)
        self.assertEqual(deleted.status_code, 200, deleted.text)
        self.assertIsNone(self.read_row(MEMBER_A, 'routes'))
        self.assertIsNone(self.read_row(MEMBER_A, 'jobs'))
        for other in (OWNER, MEMBER_B):
            self.assertIsNotNone(self.read_row(other, 'routes'))
            self.assertEqual(self.read_row(other, 'jobs')['status'], 'failed')

    async def test_colliding_job_and_review_ids_only_mutate_callers_rows(self):
        for user_id in (OWNER, MEMBER_A, MEMBER_B):
            self.seed_workspace(user_id)
        retry = await self.request('POST', '/api/jobs/1/retry', MEMBER_A)
        self.assertEqual(retry.status_code, 200, retry.text)
        review = await self.request('POST', '/api/reviews/1', MEMBER_A, json={'approve': False})
        self.assertEqual(review.status_code, 200, review.text)
        self.assertEqual(self.read_row(MEMBER_A, 'jobs')['status'], 'queued')
        self.assertEqual(self.read_row(MEMBER_A, 'reviews')['status'], 'rejected')
        for other in (OWNER, MEMBER_B):
            self.assertEqual(self.read_row(other, 'jobs')['status'], 'failed')
            self.assertEqual(self.read_row(other, 'reviews')['status'], 'pending')

    async def test_guessed_ids_existing_only_in_other_workspace_are_not_found(self):
        self.seed_workspace(MEMBER_B)
        for method, path, body in [
            ('PUT', '/api/routes/1', {'name': 'Attempted overwrite'}),
            ('DELETE', '/api/routes/1', None),
            ('POST', '/api/jobs/1/retry', None),
            ('POST', '/api/reviews/1', {'approve': False}),
        ]:
            with self.subTest(path=path):
                response = await self.request(method, path, MEMBER_A, json=body)
                self.assertEqual(response.status_code, 404, response.text)
        self.assertEqual(self.read_row(MEMBER_B, 'routes')['name'], 'Private route ' + MEMBER_B)
        self.assertEqual(self.read_row(MEMBER_B, 'jobs')['status'], 'failed')
        self.assertEqual(self.read_row(MEMBER_B, 'reviews')['status'], 'pending')

    async def test_query_headers_and_payload_cannot_override_authenticated_tenant(self):
        for user_id in (OWNER, MEMBER_A, MEMBER_B):
            self.seed_workspace(user_id)
        overrides = {'X-User-Id': OWNER, 'X-Telegram-User-Id': OWNER,
                     'X-Workspace-Id': MEMBER_B, 'X-Tenant-Id': MEMBER_B,
                     'X-Becs-Key': 'synthetic-shared-key'}
        query = '?user_id=' + OWNER + '&workspace_id=' + MEMBER_B + '&tenant_id=' + OWNER
        with patch.dict(os.environ, {'BECS_ADMIN_TOKEN': 'synthetic-shared-key'}):
            response = await self.request('GET', '/api/overview' + query, MEMBER_A, headers=overrides)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['telegram']['user_id'], MEMBER_A)
            self.assertIn(MEMBER_A, response.json()['activity'][0]['detail'])
            changed = await self.request('PUT', '/api/routes/1' + query, MEMBER_A,
                headers=overrides, json={'name': 'My local change', 'user_id': OWNER,
                                        'workspace_id': MEMBER_B, 'telegram_id': int(OWNER)})
            self.assertEqual(changed.status_code, 200, changed.text)
        for other in (OWNER, MEMBER_B):
            self.assertEqual(self.read_row(other, 'routes')['name'], 'Private route ' + other)
        self.assertEqual(self.read_row(MEMBER_A, 'routes')['name'], 'My local change')
        self.assertTrue(all(identity == context == MEMBER_A for identity, context in self.runtime.selected))

    async def test_concurrent_requests_keep_database_and_manager_contexts_isolated(self):
        for user_id in (OWNER, MEMBER_A, MEMBER_B):
            self.seed_workspace(user_id)
        work = [(user_id, path) for _ in range(4) for user_id in (OWNER, MEMBER_A, MEMBER_B)
                for path in ('/api/overview', '/api/telegram/chats')]
        responses = await asyncio.gather(*(self.request('GET', path, user_id)
                                          for user_id, path in work))
        for (user_id, path), response in zip(work, responses):
            self.assertEqual(response.status_code, 200, response.text)
            if path == '/api/overview':
                telegram = response.json()['telegram']
                self.assertEqual(telegram['user_id'], user_id)
                self.assertEqual(telegram['context_before'], [user_id, user_id])
                self.assertEqual(telegram['context_after'], [user_id, user_id])
            else:
                self.assertEqual(response.json()['chats'][0]['id'], user_id + '-chat')
        for user_id, manager in self.runtime.managers.items():
            self.assertTrue(manager.observations)
            self.assertTrue(all(value == (user_id, user_id) for value in manager.observations))
        self.assertTrue(all(identity == context for identity, context in self.runtime.selected))
        self.assertIsNone(db.current_workspace.get())

    async def test_telegram_endpoints_use_callers_manager_and_rate_limit_per_identity(self):
        for user_id in (MEMBER_A, MEMBER_B):
            for path, body in [('/api/telegram/start', {'phone': '+15550000000'}),
                               ('/api/telegram/code', {'code': '12345'}),
                               ('/api/telegram/password', {'password': 'synthetic-offline-password'}),
                               ('/api/telegram/resolve', {'reference': '@synthetic', 'role': 'source'})]:
                response = await self.request('POST', path, user_id, json=body)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()['workspace'], user_id)
            response = await self.request('POST', '/api/telegram/disconnect', user_id)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertIn(('disconnect', False), self.runtime.managers[user_id].calls)
        # Three sign-in attempts above count toward the shared per-workspace limit.
        for _ in range(9):
            response = await self.request('POST', '/api/telegram/code', MEMBER_A, json={'code': '12345'})
            self.assertEqual(response.status_code, 200, response.text)
        blocked = await self.request('POST', '/api/telegram/start', MEMBER_A,
                                     json={'phone': '+15550000000'})
        self.assertEqual(blocked.status_code, 429, blocked.text)
        self.assertEqual(blocked.json()['reason'], 'rate_limited')
        unaffected = await self.request('POST', '/api/telegram/code', MEMBER_B, json={'code': '12345'})
        self.assertEqual(unaffected.status_code, 200, unaffected.text)
        self.assertTrue(all(identity == context for identity, context in self.runtime.selected))

    async def test_revoke_closes_access_before_draining_inflight_request(self):
        manager = self.runtime.managers.setdefault(MEMBER_A, OfflineManager(MEMBER_A))
        manager.entered = asyncio.Event()
        manager.release = asyncio.Event()
        active = asyncio.create_task(self.request('POST', '/api/telegram/resolve', MEMBER_A,
            json={'reference': '@synthetic', 'role': 'source'}))
        await asyncio.wait_for(manager.entered.wait(), 2)
        runtime_reached = asyncio.Event()

        async def observe_runtime_revoke(user_id):
            runtime_reached.set()

        self.runtime.revoke.side_effect = observe_runtime_revoke
        revoke = asyncio.create_task(self.request('POST', '/api/admin/users/' + MEMBER_A + '/revoke'))
        try:
            await asyncio.wait_for(runtime_reached.wait(), 2)
            self.assertFalse(revoke.done(), 'The response waits for the admitted request to drain')
            self.assertEqual(access.get_user(MEMBER_A)['status'], 'revoked')
            concurrent = await asyncio.wait_for(self.request('GET', '/api/routes', MEMBER_A), 2)
            self.assertEqual(concurrent.status_code, 403, concurrent.text)
            self.assertEqual(concurrent.json()['reason'], 'access_revoked')
            self.assertFalse(active.done(), 'The offline fake intentionally does not cancel active work')
        finally:
            manager.release.set()
        first, revoked = await asyncio.wait_for(asyncio.gather(active, revoke), 3)
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(revoked.status_code, 200, revoked.text)
        self.runtime.revoke.assert_awaited_once_with(MEMBER_A)
        denied = await self.request('GET', '/api/routes', MEMBER_A)
        self.assertEqual(denied.status_code, 403, denied.text)
        self.assertEqual(denied.json()['reason'], 'access_revoked')

    async def test_real_runtime_revoke_interrupts_slow_http_approval_without_resurrection(self):
        """A same-owner revoke must interrupt activation instead of waiting behind it."""
        access.revoke_user(OWNER, MEMBER_B)
        self.add_user(UNKNOWN, approved=False)
        registry = main.RuntimeRegistry()
        manager = main.PersonalTelegram(UNKNOWN)
        registry.managers[UNKNOWN] = manager
        connection_started = asyncio.Event()
        connection_cancelled = asyncio.Event()
        never_release_connection = asyncio.Event()

        async def slow_saved_session_connection():
            # Keep the real manager operation tracking and cancellation behavior;
            # only the nonexistent network connection itself is simulated.
            async with manager.operation():
                self.assertEqual(db.current_workspace.get(), UNKNOWN)
                connection_started.set()
                try:
                    await never_release_connection.wait()
                except asyncio.CancelledError:
                    connection_cancelled.set()
                    raise

        with patch('app.main.runtime', registry), \
             patch.dict(os.environ, {'TELEGRAM_API_ID': '123',
                                     'TELEGRAM_API_HASH': 'synthetic-offline-hash'}), \
             patch.object(manager, 'has_saved_session', return_value=True), \
             patch.object(manager, 'ensure_client', new=slow_saved_session_connection), \
             patch('app.service.delivery_worker', new_callable=AsyncMock) as worker:
            approval = asyncio.create_task(self.request(
                'POST', '/api/admin/users/' + UNKNOWN + '/approve'))
            revocation = None
            try:
                await asyncio.wait_for(connection_started.wait(), 2)
                self.assertEqual(access.get_user(UNKNOWN)['status'], 'approved')
                self.assertTrue(manager._operations)
                self.assertFalse(approval.done())
                revocation = asyncio.create_task(self.request(
                    'POST', '/api/admin/users/' + UNKNOWN + '/revoke'))
                revoked = await asyncio.wait_for(revocation, 2)
                interrupted = await asyncio.wait_for(approval, 2)
                self.assertEqual(revoked.status_code, 200, revoked.text)
                self.assertEqual(interrupted.status_code, 409, interrupted.text)
                self.assertTrue(connection_cancelled.is_set())
                self.assertFalse(never_release_connection.is_set())
                self.assertEqual(access.get_user(UNKNOWN)['status'], 'revoked')
                self.assertTrue(manager._revoked)
                self.assertEqual(manager._operations, {})
                self.assertIsNone(registry.worker_for(UNKNOWN))
                worker.assert_not_called()
                with self.assertRaises(PermissionError):
                    registry.get(UNKNOWN)
                blocked = await self.request('GET', '/api/routes', UNKNOWN)
                self.assertEqual(blocked.status_code, 403, blocked.text)
                self.assertEqual(blocked.json()['reason'], 'access_revoked')
                with db.workspace(UNKNOWN):
                    self.assertEqual(db.get_setting('paused'), 'true')
                self.assertEqual(access.get_user(OWNER)['status'], 'approved')
                self.assertEqual(access.get_user(MEMBER_A)['status'], 'approved')
            finally:
                tasks = [task for task in (approval, revocation) if task is not None]
                for task in tasks:
                    if not task.done():
                        task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                await registry.shutdown()

    async def test_owner_legacy_database_path_and_rows_survive_member_activity(self):
        self.seed_workspace(OWNER)
        with db.workspace(OWNER):
            self.assertEqual(db.workspace_path(), self.root / 'becs.sqlite')
            db.set_setting('legacy_owner_setting', 'unchanged-private-owner-value')
        before = {table: self.read_row(OWNER, table) for table in ('routes', 'jobs', 'reviews')}
        for user_id in (MEMBER_A, MEMBER_B):
            self.assertEqual(db.workspace_path(user_id), self.root / 'workspaces' / (user_id + '.sqlite'))
            created = await self.request('POST', '/api/routes', user_id,
                                          json={'name': 'New member route ' + user_id})
            self.assertEqual(created.status_code, 200, created.text)
            self.assertEqual(created.json()['route']['id'], 1)
            self.assertEqual((await self.request('POST', '/api/control/pause', user_id)).status_code, 200)
        access.init_access()
        for table, row in before.items():
            self.assertEqual(self.read_row(OWNER, table), row)
        with db.workspace(OWNER):
            self.assertEqual(db.get_setting('legacy_owner_setting'), 'unchanged-private-owner-value')
            self.assertEqual(db.get_setting('paused'), 'false')
        self.assertEqual(db.workspace_path(), self.root / 'becs.sqlite')
        self.assertNotEqual(db.workspace_path(OWNER), db.workspace_path(MEMBER_A))
        self.assertNotEqual(db.workspace_path(MEMBER_A), db.workspace_path(MEMBER_B))
        self.assertTrue((self.root / 'access.sqlite').exists())
        self.assertFalse((self.root / 'sessions').exists())


if __name__ == '__main__':
    unittest.main()
