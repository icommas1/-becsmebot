"""No production secrets or Telegram network calls; absolute expiry tested with a clock."""
import hashlib
import hmac
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlencode

from fastapi.testclient import TestClient
from app import db, dashboard_session as sessions, main
from app.models import RouteInput


class DashboardSessionTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.path_patch = patch.object(db, 'DB_PATH', Path(self.folder.name) / 'test.sqlite')
        self.path_patch.start()
        self.addCleanup(self.path_patch.stop)
        self.env_patch = patch.dict(os.environ, {
            'BECS_ADMIN_TOKEN': 'test-only-admin-key-12345678901234567890',
            'BECS_SESSION_SECRET': 'test-only-encryption-secret-12345678901234567890',
            'TELEGRAM_BOT_TOKEN': '123456:test-only-bot-token',
            'BECS_ALLOWED_TELEGRAM_ID': '42',
        })
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)
        self.clock = patch('app.dashboard_session.time.time', return_value=2000000000.0)
        self.now = self.clock.start()
        self.addCleanup(self.clock.stop)
        sessions._attempts.clear()
        db.init_db()
        sessions.init_sessions()
        # Do not start lifespan workers: no test may send or forward Telegram messages.
        self.client = TestClient(main.app, base_url='https://testserver')
        self.addCleanup(self.client.close)
        self.headers = {'X-Becs-Client': 'mini-app', 'Origin': 'https://testserver'}

    def login(self, client=None):
        client = client or self.client
        response = client.post('/api/auth/login', headers=self.headers,
                               json={'admin_token': os.environ['BECS_ADMIN_TOKEN']})
        self.assertEqual(response.status_code, 200, response.text)
        self.token = response.cookies.get(sessions.COOKIE)
        self.data = response.json()
        return response

    def cookie_header(self):
        return {'Cookie': sessions.COOKIE + '=' + self.token}

    def test_cookie_is_http_only_secure_five_minutes_and_contains_no_admin_key(self):
        response = self.login()
        cookie = response.headers['set-cookie']
        for marker in ['HttpOnly', 'Secure', 'Max-Age=300', 'SameSite=strict', 'Path=/']:
            self.assertIn(marker, cookie)
        self.assertNotIn('Domain=', cookie)
        self.assertNotIn(os.environ['BECS_ADMIN_TOKEN'], response.text + cookie)
        self.assertNotIn(self.token, response.text)
        self.assertEqual(self.data['expires_at'] - self.data['issued_at'], 300000)
        with db.connection() as connection:
            row = connection.execute('SELECT * FROM dashboard_sessions').fetchone()
            self.assertEqual(row['token_hash'], hashlib.sha256(self.token.encode()).hexdigest())
            self.assertNotIn(self.token, str(dict(row)))
            self.assertNotIn(os.environ['BECS_ADMIN_TOKEN'], str(dict(row)))

    def test_key_is_not_accepted_on_protected_api_without_timed_session(self):
        for headers in ({}, {'X-Becs-Key': os.environ['BECS_ADMIN_TOKEN']},
                        {'X-Telegram-Init-Data': 'not-a-session'}):
            result = self.client.get('/api/routes', headers=headers)
            self.assertEqual(result.status_code, 401)
            self.assertEqual(result.headers.get('cache-control'), 'no-store')

    def test_absolute_boundary_before_at_and_after_300_seconds(self):
        self.login()
        for offset, expected in [(0, 200), (299, 200), (299.999, 200), (300, 401), (301, 401)]:
            self.now.return_value = 2000000000.0 + offset
            # Supply the cookie even after browser expiry, proving server enforcement.
            response = self.client.get('/api/routes', headers=self.cookie_header())
            self.assertEqual(response.status_code, expected, f'offset={offset}')

    def test_activity_and_duplicate_login_never_extend_expiry(self):
        self.login()
        expiry = self.data['expires_at']
        for elapsed in [10, 50, 125, 299]:
            self.now.return_value = 2000000000.0 + elapsed
            result = self.client.get('/api/auth/session')
            self.assertEqual(result.json()['expires_at'], expiry)
            self.assertNotIn('set-cookie', result.headers)
            headers = {**self.headers, 'X-Becs-CSRF': self.data['csrf_token']}
            result = self.client.post('/api/auth/login', json={'admin_token': os.environ['BECS_ADMIN_TOKEN']}, headers=headers)
            self.assertEqual(result.json()['expires_at'], expiry)
            self.assertNotIn('set-cookie', result.headers)
        self.now.return_value = 2000000300.0
        self.assertEqual(self.client.get('/api/auth/session', headers=self.cookie_header()).status_code, 401)

    def test_reopen_recovers_same_session_and_remaining_time(self):
        self.login()
        self.now.return_value += 115
        reopened = TestClient(main.app, base_url='https://testserver')
        self.addCleanup(reopened.close)
        result = reopened.get('/api/auth/session', headers=self.cookie_header())
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['expires_at'], self.data['expires_at'])
        self.assertEqual(result.json()['expires_at'] - result.json()['server_time'], 185000)
        self.assertNotIn('set-cookie', result.headers)

    def test_database_reinitialization_preserves_sessions_routes_and_settings(self):
        self.login()
        route = RouteInput(name='Preserved route', sources=['-1001'], destinations=['-1002'])
        with db.connection() as connection:
            saved_id = main.save_route(connection, route)
            before = dict(connection.execute('SELECT * FROM routes WHERE id=?', (saved_id,)).fetchone())
        db.set_setting('paused', 'false')
        db.init_db()
        sessions.init_sessions()
        self.assertEqual(self.client.get('/api/routes').status_code, 200)
        with db.connection() as connection:
            after = dict(connection.execute('SELECT * FROM routes WHERE id=?', (saved_id,)).fetchone())
        self.assertEqual(before, after)
        self.assertEqual(db.get_setting('paused'), 'false')

    def test_logout_revokes_copied_cookie_without_pausing_forwarding(self):
        self.login()
        saved = self.cookie_header()
        db.set_setting('paused', 'false')
        response = self.client.post('/api/auth/logout', headers={**self.headers, 'X-Becs-CSRF': self.data['csrf_token']})
        self.assertEqual(response.status_code, 200)
        self.assertIn('Max-Age=0', response.headers['set-cookie'])
        self.assertEqual(self.client.get('/api/routes', headers=saved).status_code, 401)
        self.assertEqual(db.get_setting('paused'), 'false')
        with db.connection() as connection:
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM dashboard_sessions').fetchone()[0], 0)

    def test_state_changes_require_csrf_and_same_origin(self):
        self.login()
        payload = {'text': 'message', 'route': {'name': 'Test route'}}
        for headers in ({}, self.headers,
                        {**self.headers, 'X-Becs-CSRF': 'wrong'},
                        {**self.headers, 'X-Becs-CSRF': self.data['csrf_token'], 'Origin': 'https://other.example'}):
            result = self.client.post('/api/simulate', json=payload, headers=headers)
            self.assertEqual(result.status_code, 403)
        valid = {**self.headers, 'X-Becs-CSRF': self.data['csrf_token']}
        result = self.client.post('/api/simulate', json=payload, headers=valid)
        self.assertEqual(result.status_code, 200, result.text)

    def test_credential_rotation_revokes_existing_dashboard_session(self):
        self.login()
        with patch.dict(os.environ, {'BECS_ADMIN_TOKEN': 'changed-test-only-admin-key'}):
            self.assertEqual(self.client.get('/api/routes', headers=self.cookie_header()).status_code, 401)

    def test_wrong_credentials_cross_origin_login_and_limits(self):
        response = self.client.post('/api/auth/login', json={'admin_token': os.environ['BECS_ADMIN_TOKEN']},
                                    headers={**self.headers, 'Origin': 'https://attacker.example'})
        self.assertEqual(response.status_code, 403)
        for _ in range(8):
            result = self.client.post('/api/auth/login', json={'admin_token': 'wrong'}, headers=self.headers)
            self.assertEqual(result.status_code, 401)
        self.assertEqual(self.client.post('/api/auth/login', json={'admin_token': 'wrong'}, headers=self.headers).status_code, 429)

    def test_malformed_or_oversized_login_is_rejected_without_echoing_secrets(self):
        for payload in ({'admin_token': ['oops']}, {'admin_token': 'x' * 2100}, {},
                        {'admin_token': 'x', 'init_data': 'y'}, {'expires_at': 9999999999}):
            result = self.client.post('/api/auth/login', json=payload, headers=self.headers)
            self.assertEqual(result.status_code, 400)
            self.assertNotIn('oops', result.text)
        result = self.client.post('/api/auth/login', content=b'x' * 13000,
                                  headers={**self.headers, 'Content-Type': 'application/json'})
        self.assertEqual(result.status_code, 413)

    def test_reauthentication_after_expiry_requires_explicit_new_login(self):
        self.login()
        old_token = self.token
        self.now.return_value += 300
        self.assertEqual(self.client.get('/api/auth/session', headers=self.cookie_header()).status_code, 401)
        response = self.login()
        self.assertNotEqual(self.token, old_token)
        self.assertEqual(response.json()['issued_at'], self.now.return_value * 1000)
        self.assertEqual(response.json()['expires_at'], (self.now.return_value + 300) * 1000)

    def test_telegram_login_uses_same_absolute_timer_without_header_bypass(self):
        data = {'auth_date': str(int(self.now.return_value)), 'user': json.dumps({'id': 42})}
        secret = hmac.new(b'WebAppData', os.environ['TELEGRAM_BOT_TOKEN'].encode(), hashlib.sha256).digest()
        data['hash'] = hmac.new(secret, '\n'.join(f'{k}={v}' for k, v in sorted(data.items())).encode(), hashlib.sha256).hexdigest()
        raw = urlencode(data)
        result = self.client.post('/api/auth/login', json={'init_data': raw}, headers=self.headers)
        self.assertEqual(result.status_code, 200, result.text)
        token = result.cookies.get(sessions.COOKIE)
        self.now.return_value += 300
        result = self.client.get('/api/routes', headers={'Cookie': sessions.COOKIE + '=' + token, 'X-Telegram-Init-Data': raw})
        self.assertEqual(result.status_code, 401)

    def test_public_health_does_not_unlock_and_reports_timer(self):
        result = self.client.get('/api/health')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['dashboard_session_seconds'], 300)
        self.assertNotIn('set-cookie', result.headers)
        self.assertEqual(self.client.get('/api/auth/session').status_code, 401)

if __name__ == '__main__':
    unittest.main()
