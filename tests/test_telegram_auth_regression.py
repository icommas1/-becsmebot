import hashlib
import hmac
import json
import time
import unittest
from unittest.mock import patch
from urllib.parse import urlencode

from app.main import init_data_status, is_valid_init_data


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


if __name__ == '__main__':
    unittest.main()
