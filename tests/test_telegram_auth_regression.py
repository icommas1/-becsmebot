import hashlib
import hmac
import json
import time
import unittest
from unittest.mock import patch
from urllib.parse import urlencode

import httpx
from fastapi.middleware.cors import CORSMiddleware

from app.main import app, init_data_status, is_valid_init_data


# Independently computed with OpenSSL HMAC-SHA256 (WebAppData -> token ->
# newline-separated decoded fields). This literal includes signature in the
# bot-token hash, unlike Telegram's separate third-party Ed25519 validation.
SIGNED_FIXTURE = (
    'auth_date=1791712800&query_id=AA123&signature=example-ed25519_signature-_%252F&'
    'user=%7B%22id%22%3A123456%2C%22first_name%22%3A%22Test+%2B+Owner%22%7D&'
    'hash=a1e2917a6e210e9e9cfe49801ef162f1fe3c3c459c0dc91ced9422338c24da5f'
)
ORIGIN = 'https://app.example.test'


def signed_payload(token, user_id, timestamp=None):
    data = {'auth_date': str(int(time.time()) if timestamp is None else timestamp),
            'query_id': 'AA123',
            'user': json.dumps({'id': user_id}, separators=(',', ':'))}
    message = chr(10).join(f'{key}={value}' for key, value in sorted(data.items()))
    secret = hmac.new(b'WebAppData', token.encode(), hashlib.sha256).digest()
    data['hash'] = hmac.new(secret, message.encode(), hashlib.sha256).hexdigest()
    return urlencode(data)


class TelegramAuthenticationRegression(unittest.TestCase):
    def setUp(self):
        self.config = patch.dict('os.environ', {
            'TELEGRAM_BOT_TOKEN': 'test-token-for-regression',
            'BECS_ALLOWED_TELEGRAM_ID': '123456'
        })
        self.config.start()

    def tearDown(self):
        self.config.stop()

    def test_valid_signed_owner(self):
        payload = signed_payload('test-token-for-regression', 123456)
        self.assertEqual(init_data_status(payload), 'ok')
        self.assertTrue(is_valid_init_data(payload))

    def test_independent_signed_fixture_with_signature(self):
        with patch('app.main.time.time', return_value=1791712801):
            self.assertEqual(init_data_status(SIGNED_FIXTURE), 'ok')

    def test_signature_and_user_tampering_fail(self):
        with patch('app.main.time.time', return_value=1791712801):
            for original, replacement in [('example-ed25519', 'tampered'),
                                          ('123456', '999999')]:
                with self.subTest(field=original):
                    self.assertEqual(init_data_status(SIGNED_FIXTURE.replace(original, replacement)),
                                     'invalid_signature')

    def test_signed_fixture_expiry_and_owner_restriction(self):
        with patch('app.main.time.time', return_value=1791802800):
            self.assertEqual(init_data_status(SIGNED_FIXTURE), 'expired_init_data')
        with patch('app.main.time.time', return_value=1791712799):
            self.assertEqual(init_data_status(SIGNED_FIXTURE), 'expired_init_data')
        with patch('app.main.time.time', return_value=1791712801), patch.dict(
                'os.environ', {'BECS_ALLOWED_TELEGRAM_ID': '999999'}):
            self.assertEqual(init_data_status(SIGNED_FIXTURE), 'unauthorized_user')

    def test_invalid_signature(self):
        payload = signed_payload('another-token', 123456)
        self.assertEqual(init_data_status(payload), 'invalid_signature')

    def test_unauthorized_user(self):
        payload = signed_payload('test-token-for-regression', 999999)
        self.assertEqual(init_data_status(payload), 'unauthorized_user')

    def test_expired_signed_data(self):
        payload = signed_payload('test-token-for-regression', 123456, int(time.time()) - 90000)
        self.assertEqual(init_data_status(payload), 'expired_init_data')

    def test_missing_payload(self):
        self.assertEqual(init_data_status(''), 'missing_init_data')


class TelegramCorsRegression(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        cors = next(middleware for middleware in app.user_middleware if middleware.cls is CORSMiddleware)
        self.origins = patch.object(cors, 'kwargs', {**cors.kwargs, 'allow_origins': [ORIGIN]})
        self.origins.start()
        self.stack = patch.object(app, 'middleware_stack', None)
        self.stack.start()
        self.config = patch.dict('os.environ', {
            'TELEGRAM_BOT_TOKEN': 'test-token-for-regression',
            'BECS_ALLOWED_TELEGRAM_ID': '123456', 'BECS_ADMIN_TOKEN': ''})
        self.config.start()
        # External host/client avoids the deliberate local-development bypass.
        # ASGITransport does not start lifespan/background Telegram workers.
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, client=('203.0.113.1', 1234)),
            base_url='https://becs.example')

    async def asyncTearDown(self):
        await self.client.aclose()
        self.config.stop()
        self.stack.stop()
        self.origins.stop()

    async def test_allowed_origin_can_read_early_401_reason(self):
        for path in ['/api/overview', '/api/routes', '/api/jobs']:
            with self.subTest(path=path):
                response = await self.client.get(path, headers={'Origin': ORIGIN})
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.json()['reason'], 'missing_init_data')
                self.assertEqual(response.headers.get('access-control-allow-origin'), ORIGIN)
                self.assertNotIn('access-control-allow-credentials', response.headers)

    async def test_invalid_payload_returns_safe_reason_with_cors(self):
        response = await self.client.get('/api/overview', headers={
            'Origin': ORIGIN, 'X-Telegram-Init-Data': 'not-valid'})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()['reason'], 'invalid_init_data')
        self.assertEqual(response.headers.get('access-control-allow-origin'), ORIGIN)
        self.assertNotIn('not-valid', response.text)

    async def test_unlisted_origin_cannot_read_401(self):
        response = await self.client.get('/api/overview', headers={'Origin': 'https://example.org'})
        self.assertEqual(response.status_code, 401)
        self.assertNotIn('access-control-allow-origin', response.headers)

    async def test_allowed_preflight(self):
        response = await self.client.options('/api/overview', headers={
            'Origin': ORIGIN, 'Access-Control-Request-Method': 'GET',
            'Access-Control-Request-Headers': 'X-Telegram-Init-Data,Content-Type'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get('access-control-allow-origin'), ORIGIN)
        self.assertEqual(response.headers['access-control-max-age'], '600')

    async def test_unapproved_preflight_is_denied(self):
        for overrides in [{'Origin': 'https://example.org'},
                          {'Access-Control-Request-Method': 'PATCH'},
                          {'Access-Control-Request-Headers': 'X-Becs-Key'}]:
            with self.subTest(overrides=overrides):
                response = await self.client.options('/api/overview', headers={
                    'Origin': ORIGIN, 'Access-Control-Request-Method': 'GET',
                    'Access-Control-Request-Headers': 'X-Telegram-Init-Data', **overrides})
                self.assertEqual(response.status_code, 400)

    async def test_valid_fixture_passes_auth_without_external_io(self):
        # An unknown API path reaches routing only if authentication succeeds.
        with patch('app.main.time.time', return_value=1791712801):
            response = await self.client.get('/api/auth-regression-not-a-route', headers={
                'Origin': ORIGIN, 'X-Telegram-Init-Data': SIGNED_FIXTURE})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.headers.get('access-control-allow-origin'), ORIGIN)


if __name__ == '__main__':
    unittest.main()
