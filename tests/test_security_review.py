"""Independent security-review regressions. All identities and I/O are synthetic."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
from urllib.parse import urlencode

import httpx
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app import access, db, main
from app.runtime import RuntimeRegistry


def signed_identity(user_id, *, token='review-bot-token', **extra):
    fields = {'auth_date': str(int(time.time())),
              'user': json.dumps({'id': int(user_id), 'first_name': 'Synthetic'}, separators=(',', ':')),
              'signature': 'synthetic-third-party-signature', **extra}
    secret = hmac.new(b'WebAppData', token.encode(), hashlib.sha256).digest()
    text = '\n'.join(f'{key}={value}' for key, value in sorted(fields.items()))
    fields['hash'] = hmac.new(secret, text.encode(), hashlib.sha256).hexdigest()
    return urlencode(fields)


class IndependentSecurityReview(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        for ctx in (
            patch.object(db, 'DB_PATH', Path(self.temp.name) / 'becs.sqlite'),
            patch.dict(os.environ, {
                'BECS_ALLOWED_TELEGRAM_ID': '10001', 'TELEGRAM_BOT_TOKEN': 'review-bot-token',
                'BECS_ADMIN_TOKEN': 'review-fallback-key', 'BECS_DEV_MODE': '0',
                'TELEGRAM_API_ID': '', 'TELEGRAM_API_HASH': '',
                'BECS_SESSION_DIR': str(Path(self.temp.name) / 'sessions'),
            }),
            patch.object(main, 'runtime', RuntimeRegistry()),
            patch.object(main, '_request_locks', {}),
        ):
            ctx.start()
            self.addCleanup(ctx.stop)
        access.init_access()
        for user_id in ('20001', '30001'):
            invite = access.create_invite('10001')
            access.redeem_invite(invite['token'], user_id)
            access.approve_user('10001', user_id)
        for user_id in ('10001', '20001', '30001'):
            with db.workspace(user_id):
                db.init_db()
                with db.connection() as connection:
                    connection.execute(
                        'INSERT INTO routes(id,name,created_at,updated_at) VALUES (1,?,?,?)',
                        (f'private-marker-{user_id}', time.time(), time.time()))
                    connection.execute(
                        '''INSERT INTO jobs(route_id,source_id,destination_id,message_id,
                           message_preview,fingerprint,created_at) VALUES(1,?,?,1,?,?,?)''',
                        (f'source-{user_id}', f'destination-{user_id}', f'private-marker-{user_id}',
                         user_id, time.time()))
                    db.event(connection, 'contract', f'private-marker-{user_id}', 1)
                    connection.execute(
                        '''INSERT INTO reviews(route_id,source_id,destination_id,message_id,
                           text,fingerprint,reason,created_at) VALUES(1,?,?,1,?,?,?,?)''',
                        (f'source-{user_id}', f'destination-{user_id}', f'private-marker-{user_id}',
                         user_id, 'test', time.time()))
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app, client=('203.0.113.9', 4231)),
            base_url='https://becs.example')
        self.addAsyncCleanup(self.client.aclose)

    def headers(self, user_id='20001', **extra):
        return {'X-Telegram-Init-Data': signed_identity(user_id), **extra}

    async def test_forwarded_testclient_cannot_bypass_production_auth(self):
        wrapped = ProxyHeadersMiddleware(main.app, trusted_hosts='127.0.0.1')
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=wrapped, client=('127.0.0.1', 4231)),
            base_url='http://testserver',
        ) as client:
            response = await client.post('/api/control/pause', headers={'X-Forwarded-For': 'testclient'})
        self.assertEqual(response.status_code, 401)
        with db.workspace('10001'):
            self.assertEqual(db.get_setting('paused'), 'false')

    async def test_signed_member_plus_owner_key_never_changes_principal(self):
        headers = self.headers(**{'X-Becs-Key': 'review-fallback-key'})
        response = await self.client.get('/api/me', headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['user']['user_id'], '20001')
        self.assertFalse(response.json()['is_admin'])
        for path, method in (('/api/admin/users', 'GET'), ('/api/admin/invites', 'POST'),
                             ('/api/admin/users/30001/revoke', 'POST')):
            with self.subTest(path=path):
                response = await self.client.request(method, path, headers=headers)
                self.assertEqual(response.status_code, 403)
        self.assertTrue(access.is_approved('30001'))

    async def test_bad_signature_cannot_fall_back_to_correct_owner_key(self):
        response = await self.client.post('/api/control/pause', headers={
            'X-Telegram-Init-Data': signed_identity('10001', token='incorrect-bot-token'),
            'X-Becs-Key': 'review-fallback-key',
        })
        self.assertEqual(response.status_code, 401)
        with db.workspace('10001'):
            self.assertEqual(db.get_setting('paused'), 'false')

    async def test_signature_field_is_authenticated_and_duplicate_ids_rejected(self):
        payload = signed_identity('10001')
        for bad in (payload.replace('synthetic-third-party-signature', 'forged'),
                    payload + '&user=' + json.dumps({'id': 20001}),
                    payload + '&hash=' + ('0' * 64)):
            with self.subTest(payload=bad):
                response = await self.client.get('/api/me', headers={'X-Telegram-Init-Data': bad})
                self.assertEqual(response.status_code, 401)

    async def test_parallel_sync_and_async_reads_remain_in_signed_workspace(self):
        import asyncio
        paths = ('/api/routes', '/api/jobs', '/api/reviews', '/api/inspector', '/api/overview')
        async def check(user_id, path):
            response = await self.client.get(path + '?user_id=10001&workspace=10001',
                                            headers=self.headers(user_id, **{'X-Workspace-Id': '10001'}))
            self.assertEqual(response.status_code, 200, response.text)
            self.assertIn(f'private-marker-{user_id}', response.text)
            for other in {'10001', '20001', '30001'} - {user_id}:
                self.assertNotIn(f'private-marker-{other}', response.text)
        await asyncio.gather(*(check(user_id, path) for user_id in ('10001', '20001', '30001') for path in paths))
        self.assertIsNone(db.current_workspace.get())

    async def test_same_numeric_record_id_mutates_only_members_workspace(self):
        response = await self.client.post('/api/control/pause', headers=self.headers())
        self.assertEqual(response.status_code, 200)
        with db.workspace('20001'):
            self.assertEqual(db.get_setting('paused'), 'true')
        for user_id in ('10001', '30001'):
            with db.workspace(user_id):
                self.assertEqual(db.get_setting('paused'), 'false')
        response = await self.client.post('/api/reviews/1', json={'approve': False}, headers=self.headers())
        self.assertEqual(response.status_code, 200)
        for user_id, status in (('10001', 'pending'), ('20001', 'rejected'), ('30001', 'pending')):
            with db.workspace(user_id), db.connection() as connection:
                self.assertEqual(connection.execute('SELECT status FROM reviews WHERE id=1').fetchone()[0], status)

    async def test_revoked_identity_loses_all_workspace_and_admin_reads(self):
        access.revoke_user('10001', '20001')
        for path in ('/api/routes', '/api/jobs', '/api/reviews', '/api/inspector', '/api/overview',
                     '/api/telegram/chats', '/api/admin/users'):
            response = await self.client.get(path, headers=self.headers(**{'X-Becs-Key': 'review-fallback-key'}))
            self.assertEqual(response.status_code, 403)
            self.assertNotIn('private-marker-', response.text)
        me = await self.client.get('/api/me', headers=self.headers())
        self.assertEqual(me.json()['user']['status'], 'revoked')


if __name__ == '__main__':
    unittest.main()
