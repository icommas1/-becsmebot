"""Offline synthetic consent, authorization, replay and revocation-race tests."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import os
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch

from app import access, db, recovery_access as recovery


class RecoveryAccessTests(unittest.TestCase):
    OWNER = '10001'
    MEMBER = '20001'

    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.path = Path(temp.name)
        for mocked in (patch.dict(os.environ, {'BECS_ALLOWED_TELEGRAM_ID': self.OWNER}),
                       patch.object(db, 'DB_PATH', self.path / 'becs.sqlite')):
            mocked.start()
            self.addCleanup(mocked.stop)
        self.now = 1800000000.0
        clock = patch.object(recovery.time, 'time', side_effect=lambda: self.now)
        clock.start()
        self.addCleanup(clock.stop)
        access.init_access()

    def error(self, status, fn, *args, **kwargs):
        with self.assertRaises(access.AccessError) as caught:
            fn(*args, **kwargs)
        self.assertEqual(status, caught.exception.status_code)

    def approve(self):
        token = access.create_invite(self.OWNER)['token']
        access.redeem_invite(token, self.MEMBER, '@unverified_name')
        access.approve_user(self.OWNER, self.MEMBER)

    def consent(self, user=None, allowed=True):
        return recovery.record_consent(user or self.OWNER, allowed,
            expected_scope_version=recovery.SCOPE_VERSION, expected_admin_id=self.OWNER)

    def challenge(self, confirm=True):
        result = recovery.create_export_challenge(self.OWNER, authenticated_at=self.now)
        if confirm:
            recovery.confirm_export_challenge(self.OWNER, result['token'])
        return result

    def consume(self, challenge, serialize=lambda ids, scope: b'encrypted-fixture'):
        return recovery.consume_export_challenge(self.OWNER, challenge['challenge_id'],
            authenticated_at=self.now, serialize=serialize)

    def test_default_no_session_authority_and_verified_numeric_admin(self):
        status = recovery.consent_status(self.OWNER)
        self.assertIsNone(status['decision'])
        self.assertTrue(status['needs_decision'])
        self.assertIn(self.OWNER, status['question'])
        self.assertEqual(status['title'], 'Rollback Recovery')
        self.assertIn('reading and sending messages', status['warning'])
        self.assertEqual([], self.challenge()['user_ids'])

    def test_no_does_not_revoke_or_reprompt_and_cannot_silently_change(self):
        self.approve()
        self.consent(self.MEMBER, False)
        self.assertTrue(access.is_approved(self.MEMBER))
        self.assertFalse(recovery.consent_status(self.MEMBER)['needs_decision'])
        self.error(409, self.consent, self.MEMBER, True)
        self.assertFalse(self.consent(self.MEMBER, False)['decision'])

    def test_scope_and_admin_must_match_displayed_prompt(self):
        self.error(409, recovery.record_consent, self.OWNER, True,
                   expected_scope_version=0, expected_admin_id=self.OWNER)
        self.error(409, recovery.record_consent, self.OWNER, True,
                   expected_scope_version=1, expected_admin_id='99999')
        self.error(400, recovery.record_consent, self.OWNER, 'yes',
                   expected_scope_version=1, expected_admin_id=self.OWNER)
        self.consent()
        with patch.object(recovery, 'SCOPE_VERSION', 2):
            self.assertTrue(recovery.consent_status(self.OWNER)['needs_decision'])
            self.assertEqual(self.challenge()['user_ids'], [])

    def test_explicit_rescission_does_not_affect_normal_access(self):
        self.consent()
        challenge = self.challenge()
        recovery.rescind_consent(self.OWNER)
        self.error(409, self.consume, challenge)
        self.assertTrue(access.is_approved(self.OWNER))
        self.assertFalse(recovery.consent_status(self.OWNER)['decision'])

    def test_unapproved_and_nonowner_identities_fail_closed(self):
        self.error(403, recovery.consent_status, self.MEMBER)
        self.error(403, self.consent, self.MEMBER)
        self.error(403, recovery.create_export_challenge, self.MEMBER, authenticated_at=self.now)
        challenge = self.challenge(False)
        self.error(403, recovery.confirm_export_challenge, self.MEMBER, challenge['token'])
        self.error(403, recovery.export_challenge_status, self.MEMBER, challenge['challenge_id'])
        self.error(403, recovery.consume_export_challenge, self.MEMBER, challenge['challenge_id'],
                   authenticated_at=self.now, serialize=lambda *_: b'x')

    def test_owner_config_change_cannot_take_over(self):
        challenge = self.challenge()
        with patch.dict(os.environ, {'BECS_ALLOWED_TELEGRAM_ID': '99999'}):
            self.error(503, recovery.consent_status, '99999')
            self.error(503, recovery.create_export_challenge, '99999', authenticated_at=self.now)

    def test_token_hash_only_and_status_never_reveals_secret(self):
        challenge = self.challenge(False)
        with sqlite3.connect(self.path / 'access.sqlite') as connection:
            row = connection.execute('SELECT * FROM recovery_challenges').fetchone()
        self.assertNotIn(challenge['token'], row)
        self.assertIn(hashlib.sha256(challenge['token'].encode()).hexdigest(), row)
        status = recovery.export_challenge_status(self.OWNER, challenge['challenge_id'])
        self.assertNotIn('token', status)
        self.assertFalse(status['confirmed'])
        self.error(400, recovery.confirm_export_challenge, self.OWNER, challenge['challenge_id'])
        self.error(403, self.consume, challenge)

    def test_fresh_auth_is_required_on_create_and_consume(self):
        for auth in (self.now - 301, self.now + 1, True, float('nan')):
            self.error(403, recovery.create_export_challenge, self.OWNER, authenticated_at=auth)
        challenge = self.challenge()
        self.error(403, recovery.consume_export_challenge, self.OWNER, challenge['challenge_id'],
                   authenticated_at=self.now - 301, serialize=lambda *_: b'x')

    def test_expiry_and_replay(self):
        challenge = self.challenge()
        self.assertEqual(b'encrypted-fixture', self.consume(challenge))
        self.error(400, self.consume, challenge)
        self.error(400, recovery.confirm_export_challenge, self.OWNER, challenge['token'])
        challenge = self.challenge()
        self.now += recovery.CHALLENGE_TTL_SECONDS
        self.error(400, self.consume, challenge)

    def test_scope_has_all_approved_configuration_users_but_only_yes_sessions(self):
        self.approve()
        self.consent(self.OWNER, False)
        self.consent(self.MEMBER, True)
        challenge = self.challenge()
        def serialize(ids, scope):
            self.assertEqual(ids, (self.MEMBER,))
            self.assertEqual(scope['administrator_id'], self.OWNER)
            self.assertEqual(scope['approved_user_ids'], [self.OWNER, self.MEMBER])
            return b'encrypted'
        self.assertEqual(self.consume(challenge, serialize), b'encrypted')

    def test_current_approval_and_consent_bound_generation(self):
        self.approve()
        self.consent()
        self.consent(self.MEMBER)
        challenge = self.challenge()
        self.assertEqual([self.OWNER, self.MEMBER], challenge['user_ids'])
        access.revoke_user(self.OWNER, self.MEMBER)
        self.error(409, self.consume, challenge)
        self.assertEqual([self.OWNER], self.challenge()['user_ids'])
        # A revoked user can explicitly rescind without obtaining normal access.
        recovery.rescind_consent(self.MEMBER)
        self.assertFalse(access.is_approved(self.MEMBER))

    def test_confirmation_is_once_and_scope_change_invalidates(self):
        challenge = self.challenge()
        self.error(409, recovery.confirm_export_challenge, self.OWNER, challenge['token'])
        self.consent()
        self.error(409, self.consume, challenge)

    def test_concurrent_consumption_runs_serializer_once(self):
        self.consent()
        challenge = self.challenge()
        invocations = []
        barrier = threading.Barrier(2)
        def attempt():
            barrier.wait()
            try:
                return self.consume(challenge, lambda *_: invocations.append(1) or b'encrypted')
            except access.AccessError:
                return None
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: attempt(), range(2)))
        self.assertEqual(results.count(b'encrypted'), 1)
        self.assertEqual(len(invocations), 1)

    def test_serializer_error_burns_challenge(self):
        challenge = self.challenge()
        with self.assertRaises(RuntimeError):
            self.consume(challenge, lambda *_: (_ for _ in ()).throw(RuntimeError('synthetic')))
        self.error(400, self.consume, challenge)

    def test_serializer_cannot_return_lazy_data(self):
        challenge = self.challenge()
        with self.assertRaises(TypeError):
            self.consume(challenge, lambda *_: iter([b'secret']))
        self.error(400, self.consume, challenge)

    def test_revocation_serialized_against_snapshot(self):
        self.approve()
        self.consent(self.MEMBER)
        challenge = self.challenge()
        inside = threading.Event()
        release = threading.Event()
        revoke_started = threading.Event()
        revoked = threading.Event()
        def serialize(ids, scope):
            self.assertIn(self.MEMBER, ids)
            inside.set()
            self.assertTrue(release.wait(5))
            self.assertFalse(revoked.is_set())
            return b'encrypted'
        def revoke():
            revoke_started.set()
            access.revoke_user(self.OWNER, self.MEMBER)
            revoked.set()
        with ThreadPoolExecutor(max_workers=2) as pool:
            export = pool.submit(self.consume, challenge, serialize)
            self.assertTrue(inside.wait(5))
            pending = pool.submit(revoke)
            self.assertTrue(revoke_started.wait(5))
            self.assertFalse(revoked.is_set())
            release.set()
            self.assertEqual(export.result(timeout=5), b'encrypted')
            pending.result(timeout=5)
        self.assertTrue(revoked.is_set())
        self.assertEqual([], self.challenge()['user_ids'])

    def test_cancel_pending_and_confirmed_challenges_prevents_use(self):
        for confirmed in (False, True):
            with self.subTest(confirmed=confirmed):
                challenge = self.challenge(confirmed)
                result = recovery.cancel_export_challenge(self.OWNER, challenge['challenge_id'])
                self.assertEqual(result, {'challenge_id': challenge['challenge_id'], 'invalidated': True})
                self.assertEqual(recovery.cancel_export_challenge(self.OWNER, challenge['challenge_id']), result)
                self.error(400, self.consume, challenge)
                self.error(400, recovery.export_challenge_status, self.OWNER, challenge['challenge_id'])
                self.error(400, recovery.confirm_export_challenge, self.OWNER, challenge['token'])

    def test_cancel_used_and_expired_challenges_is_safe(self):
        consumed = self.challenge()
        self.consume(consumed)
        self.assertTrue(recovery.cancel_export_challenge(self.OWNER, consumed['challenge_id'])['invalidated'])
        expired = self.challenge(False)
        self.now += recovery.CHALLENGE_TTL_SECONDS
        self.assertTrue(recovery.cancel_export_challenge(self.OWNER, expired['challenge_id'])['invalidated'])
        self.error(400, self.consume, expired)

    def test_cancel_requires_verified_owner_and_valid_challenge_id(self):
        challenge = self.challenge()
        self.error(403, recovery.cancel_export_challenge, self.MEMBER, challenge['challenge_id'])
        self.error(400, recovery.cancel_export_challenge, self.OWNER, challenge['token'])
        self.error(404, recovery.cancel_export_challenge, self.OWNER, 'f' * 24)
        self.assertTrue(recovery.export_challenge_status(self.OWNER, challenge['challenge_id'])['confirmed'])
        with patch.dict(os.environ, {'BECS_ALLOWED_TELEGRAM_ID': self.MEMBER}):
            self.error(503, recovery.cancel_export_challenge, self.MEMBER, challenge['challenge_id'])

    def test_rate_limits_bound_invalid_confirmation_attempts(self):
        for _ in range(15):
            self.error(400, recovery.confirm_export_challenge, self.OWNER, 'bad')
        self.error(429, recovery.confirm_export_challenge, self.OWNER, 'bad')
        with sqlite3.connect(self.path / 'access.sqlite') as connection:
            self.assertLessEqual(connection.execute('SELECT COUNT(*) FROM rate_limits').fetchone()[0], access.MAX_RATE_BUCKETS)


if __name__ == '__main__':
    unittest.main()
