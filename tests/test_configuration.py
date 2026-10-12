"""Independent deployment destinations; no external service calls."""
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.config import https_url, load_config, validate_bot_username
from app import main


class ConfigurationTests(unittest.TestCase):
    def test_default_configuration_has_no_inherited_identity_or_origin(self):
        config = load_config({})
        self.assertEqual(config.project_name, 'BecsAutoForward')
        self.assertEqual(config.frontend_origins, ())
        self.assertEqual(config.telegram_bot_username, '')

    def test_explicit_frontend_origins_normalize_and_deduplicate(self):
        config = load_config({'BECS_FRONTEND_ORIGINS':
                              'https://APP.example.test/, https://app.example.test:443, https://second.example.test:8443'})
        self.assertEqual(config.frontend_origins,
                         ('https://app.example.test', 'https://second.example.test:8443'))

    def test_default_https_ports_match_browser_origins_and_ipv6_is_preserved(self):
        self.assertEqual(https_url('https://APP.example.test:443/', origin_only=True),
                         'https://app.example.test')
        self.assertEqual(https_url('https://[2001:db8::1]:443/', origin_only=True),
                         'https://[2001:db8::1]')
        self.assertEqual(https_url('https://[2001:db8::1]:8443/', origin_only=True),
                         'https://[2001:db8::1]:8443')

    def test_unsafe_or_ambiguous_origins_fail_closed(self):
        for value in ['*', 'http://example.test', 'https://example.test/path',
                      'https://example.test?key=value', 'https://example.test#fragment',
                      'https://user:password@example.test', 'https://example.test:bad',
                      'https://example.test,', 'https://example.test\\@other.test',
                      'https://bad..example.test', 'https://-bad.example.test', 'https://.']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                load_config({'BECS_FRONTEND_ORIGINS': value})

    def test_hosted_url_validation_preserves_explicit_api_path(self):
        self.assertEqual(https_url('https://API.example.test/api/'), 'https://api.example.test/api')
        with self.assertRaises(ValueError):
            https_url('https://api.example.test/api?token=secret')

    def test_bot_username_requires_valid_explicit_bot_identity(self):
        self.assertEqual(validate_bot_username('@independent_test_bot'), 'independent_test_bot')
        self.assertEqual(validate_bot_username(''), '')
        for value in ['', 'short', 'name/no_bot', 'ordinary_user', 'https://t.me/example_bot', "bad'bot"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_bot_username(value, required=True)

    def test_missing_bot_identity_creates_no_invite_or_reinvite(self):
        request = SimpleNamespace(state=SimpleNamespace(identity={'user_id': '123456'}))
        with patch.dict('os.environ', {'BECS_TELEGRAM_BOT_USERNAME': ''}):
            for method, arguments, mutation in [
                    (main.invite_user, (request,), 'create_invite'),
                    (main.reinvite_user, ('222222', request), 'reinvite_user')]:
                with self.subTest(method=method.__name__), patch.object(main.access, mutation) as mocked:
                    with self.assertRaises(HTTPException) as raised:
                        method(*arguments)
                    self.assertEqual(raised.exception.status_code, 503)
                    mocked.assert_not_called()

    def test_invitation_link_uses_this_projects_bot(self):
        with patch.dict('os.environ', {'BECS_TELEGRAM_BOT_USERNAME': 'independent_test_bot'}):
            response = main.invite_response({'id': 'test', 'token': 'synthetic-token', 'expires_at': 42})
        self.assertEqual(response['url'], 'https://t.me/independent_test_bot?start=invite_synthetic-token')
        self.assertEqual(response['expires_at'], 42)


if __name__ == '__main__':
    unittest.main()
