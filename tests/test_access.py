"""Synthetic, offline checks of private invitation and access invariants."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import os
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch

from app import access, db


class AccessRegistryTests(unittest.TestCase):
    OWNER = '10001'

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)
        self.env = patch.dict(os.environ, {'BECS_ALLOWED_TELEGRAM_ID': self.OWNER})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.db_path = patch.object(db, 'DB_PATH', self.path / 'becs.sqlite')
        self.db_path.start()
        self.addCleanup(self.db_path.stop)
        # Pin time, so rate windows and expiry cannot change mid-test.
        self.now = 1_800_000_000.0
        self.clock = patch.object(access.time, 'time', side_effect=lambda: self.now)
        self.clock.start()
        self.addCleanup(self.clock.stop)
        access.init_access()

    def error(self, status_code, operation, *args, **kwargs):
        with self.assertRaises(access.AccessError) as caught:
            operation(*args, **kwargs)
        self.assertEqual(caught.exception.status_code, status_code)
        self.assertTrue(caught.exception.detail)
        return caught.exception

    def pending(self, user_id='20001', display_name='Synthetic Member'):
        invite = access.create_invite(self.OWNER)
        return access.redeem_invite(invite['token'], user_id, display_name)

    def query(self, sql, parameters=()):
        with sqlite3.connect(self.path / 'access.sqlite') as connection:
            connection.row_factory = sqlite3.Row
            return connection.execute(sql, parameters).fetchall()

    def test_idempotent_owner_migration_leaves_legacy_database_untouched(self):
        with sqlite3.connect(db.DB_PATH) as connection:
            connection.execute('CREATE TABLE legacy (name TEXT, value TEXT)')
            connection.execute('INSERT INTO legacy VALUES (?,?)', ('route', 'preserve-me'))
        before = db.DB_PATH.read_bytes()
        owner = access.get_user(self.OWNER)
        self.now += 5
        for _ in range(3):
            access.init_access()
        self.assertEqual(before, db.DB_PATH.read_bytes())
        self.assertEqual(owner, access.get_user(self.OWNER))
        self.assertEqual(access.owner_id(), self.OWNER)
        self.assertEqual(owner['status'], 'approved')
        self.assertEqual(owner['role'], 'admin')
        self.assertIs(owner['is_owner'], True)
        self.assertEqual(len(access.list_users(self.OWNER)), 1)
        self.assertEqual(len(self.query('SELECT * FROM user_events')), 1)

    def test_registry_never_uses_tenant_connection(self):
        with patch.object(db, 'connection', side_effect=AssertionError('tenant connection used')):
            self.pending()
            access.approve_user(self.OWNER, '20001')
            self.assertTrue(access.is_approved('20001'))
            access.list_invites(self.OWNER)

    def test_missing_and_invalid_owner_fail_closed(self):
        for owner in ('', 'not-a-number', '0', '-5', '01', '9' * 30):
            with self.subTest(owner=owner), patch.dict(os.environ, {'BECS_ALLOWED_TELEGRAM_ID': owner}):
                self.error(503, access.init_access)
                self.error(503, access.owner_id)
                self.error(503, access.is_approved, self.OWNER)

    def test_changed_owner_cannot_take_over_registry(self):
        before = access.get_user(self.OWNER)
        with patch.dict(os.environ, {'BECS_ALLOWED_TELEGRAM_ID': '99999'}):
            for operation, args in (
                (access.init_access, ()),
                (access.owner_id, ()),
                (access.get_user, ('99999',)),
                (access.list_users, ('99999',)),
                (access.create_invite, ('99999',)),
            ):
                with self.subTest(operation=operation.__name__):
                    self.error(503, operation, *args)
        self.assertEqual(before, access.get_user(self.OWNER))
        self.assertIsNone(access.get_user('99999'))

    def test_corrupt_owner_is_not_silently_restored(self):
        with sqlite3.connect(self.path / 'access.sqlite') as connection:
            connection.execute("UPDATE users SET status='revoked' WHERE is_owner=1")
        self.error(503, access.init_access)
        self.error(503, access.is_approved, self.OWNER)

    def test_invalid_user_ids_are_rejected(self):
        for user_id in ('', '0', '-2', '01', '2.5', '../123', True, None, 1.1, 2**63):
            with self.subTest(user_id=user_id):
                self.error(400, access.get_user, user_id)
        self.assertEqual(access.get_user(10001)['user_id'], self.OWNER)

    def test_token_is_random_and_only_hash_is_stored(self):
        first = access.create_invite(self.OWNER)
        second = access.create_invite(self.OWNER)
        self.assertEqual(len(first['token']), 43)
        self.assertNotEqual(first['token'], second['token'])
        rows = self.query('SELECT * FROM invites WHERE id=?', (first['id'],))
        self.assertEqual(rows[0]['token_hash'], hashlib.sha256(first['token'].encode()).hexdigest())
        self.assertNotIn('token', rows[0].keys())
        listing = access.list_invites(self.OWNER)
        self.assertNotIn('token', listing[0])
        self.assertNotIn('token_hash', listing[0])
        self.assertNotIn(first['token'], repr(listing))
        for path in self.path.glob('access.sqlite*'):
            self.assertNotIn(first['token'].encode(), path.read_bytes())

    def test_invitation_only_creates_pending_access(self):
        invite = access.create_invite(self.OWNER, ttl_seconds=60)
        self.assertEqual(invite['expires_at'], self.now + 60)
        user = access.redeem_invite(invite['token'], '20001', ' Member\nName ')
        self.assertEqual(user['user_id'], '20001')
        self.assertEqual(user['telegram_id'], '20001')
        self.assertEqual(user['role'], 'member')
        self.assertEqual(user['display_name'], 'MemberName')
        self.assertEqual(user['status'], 'pending')
        self.assertFalse(access.is_approved('20001'))
        self.assertIsNone(access.get_user('30001'))
        self.assertEqual(access.list_invites(self.OWNER)[0]['status'], 'redeemed')

    def test_expiry_and_replay_are_rejected(self):
        expired = access.create_invite(self.OWNER, ttl_seconds=1)
        self.now += 1
        self.error(400, access.redeem_invite, expired['token'], '20001')
        self.assertEqual(access.list_invites(self.OWNER)[0]['status'], 'expired')
        self.assertIsNone(access.get_user('20001'))
        fresh = access.create_invite(self.OWNER)
        access.redeem_invite(fresh['token'], '20001')
        self.error(400, access.redeem_invite, fresh['token'], '20001')
        self.error(400, access.redeem_invite, fresh['token'], '20002')
        self.assertIsNone(access.get_user('20002'))

    def test_every_admin_operation_rejects_other_actors(self):
        self.pending()
        access.approve_user(self.OWNER, '20001')
        invite = access.create_invite(self.OWNER)
        for actor in ('20001', '20002', '', None, True):
            for operation, args in (
                (access.list_users, ()),
                (access.list_invites, ()),
                (access.create_invite, ()),
                (access.approve_user, ('20001',)),
                (access.revoke_user, ('20001',)),
                (access.reject_user, ('20001',)),
                (access.reinvite_user, ('20001',)),
                (access.revoke_invite, (invite['id'],)),
            ):
                with self.subTest(actor=actor, operation=operation.__name__):
                    self.error(403, operation, actor, *args)
        self.assertTrue(access.is_approved('20001'))

    def test_owner_cannot_be_revoked(self):
        self.error(409, access.revoke_user, self.OWNER, self.OWNER)
        self.assertTrue(access.is_approved(self.OWNER))

    def test_approval_requires_existing_pending_account(self):
        self.error(404, access.approve_user, self.OWNER, '20001')
        self.pending()
        approved = access.approve_user(self.OWNER, '20001')
        self.now += 10
        self.assertEqual(access.approve_user(self.OWNER, '20001'), approved)
        self.assertEqual(len(self.query("SELECT * FROM user_events WHERE action='approved'")), 1)
        access.revoke_user(self.OWNER, '20001')
        self.error(409, access.approve_user, self.OWNER, '20001')

    def test_reject_only_affects_pending_requests(self):
        self.pending()
        self.pending('20002')
        approved = access.approve_user(self.OWNER, '20001')
        self.error(409, access.reject_user, self.OWNER, '20001')
        self.assertEqual(approved, access.get_user('20001'))
        self.error(409, access.reject_user, self.OWNER, self.OWNER)
        rejected = access.reject_user(self.OWNER, '20002')
        self.assertEqual(rejected['status'], 'revoked')
        self.assertEqual(rejected, access.reject_user(self.OWNER, '20002'))
        self.assertFalse(access.is_approved('20002'))

    def test_full_capacity_blocks_invite_creation_until_a_seat_is_released(self):
        self.pending('20001')
        self.pending('20002')
        access.approve_user(self.OWNER, '20001')
        access.approve_user(self.OWNER, '20002')
        self.error(409, access.create_invite, self.OWNER)
        access.revoke_user(self.OWNER, '20001')
        access.create_invite(self.OWNER)

    def test_unbound_nonempty_registry_cannot_be_adopted(self):
        with sqlite3.connect(self.path / 'access.sqlite') as connection:
            connection.execute("DELETE FROM registry_meta WHERE key='owner_telegram_id'")
        self.error(503, access.init_access)
        self.assertEqual(len(self.query('SELECT * FROM users')), 1)

    def test_invalid_owner_does_not_create_registry_files(self):
        fresh_path = self.path / 'other-directory' / 'becs.sqlite'
        with patch.object(db, 'DB_PATH', fresh_path), patch.dict(os.environ, {'BECS_ALLOWED_TELEGRAM_ID': ''}):
            self.error(503, access.init_access)
        self.assertFalse(fresh_path.parent.exists())

    def test_three_approved_accounts_include_owner(self):
        for user_id in ('20001', '20002', '20003'):
            self.pending(user_id)
        access.approve_user(self.OWNER, '20001')
        access.approve_user(self.OWNER, '20002')
        self.error(409, access.approve_user, self.OWNER, '20003')
        self.assertEqual(access.get_user('20003')['status'], 'pending')
        access.revoke_user(self.OWNER, '20001')
        access.approve_user(self.OWNER, '20003')
        self.assertEqual(len([u for u in access.list_users(self.OWNER) if u['status'] == 'approved']), 3)

    def test_concurrent_approvals_cannot_claim_same_last_seat(self):
        for user_id in ('20001', '20002', '20003'):
            self.pending(user_id)
        access.approve_user(self.OWNER, '20001')
        barrier = threading.Barrier(2)

        def approve(user_id):
            barrier.wait(timeout=5)
            try:
                access.approve_user(self.OWNER, user_id)
                return 'approved'
            except access.AccessError as error:
                return error.status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(approve, ('20002', '20003')))
        self.assertCountEqual(results, ['approved', 409])
        self.assertEqual(self.query("SELECT COUNT(*) AS n FROM users WHERE status='approved'")[0]['n'], 3)

    def test_concurrent_redemption_is_single_use(self):
        invite = access.create_invite(self.OWNER)
        barrier = threading.Barrier(2)

        def redeem(user_id):
            barrier.wait(timeout=5)
            try:
                return access.redeem_invite(invite['token'], user_id)['status']
            except access.AccessError as error:
                return error.status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(redeem, ('20001', '20002')))
        self.assertCountEqual(results, ['pending', 400])
        self.assertEqual(len(access.list_users(self.OWNER)), 2)

    def test_revocation_preserves_account_and_requires_explicit_reinvite(self):
        original = self.pending()
        access.approve_user(self.OWNER, '20001')
        self.now += 5
        revoked = access.revoke_user(self.OWNER, '20001')
        self.assertEqual(revoked['status'], 'revoked')
        self.assertFalse(access.is_approved('20001'))
        self.assertEqual(revoked['display_name'], original['display_name'])
        self.assertEqual(revoked['created_at'], original['created_at'])
        generic = access.create_invite(self.OWNER)
        self.error(403, access.redeem_invite, generic['token'], '20001')
        explicit = access.reinvite_user(self.OWNER, '20001')
        self.error(403, access.redeem_invite, explicit['token'], '20002')
        self.now += 5
        returning = access.redeem_invite(explicit['token'], '20001', 'Returning Member')
        self.assertEqual(returning['status'], 'pending')
        self.assertEqual(returning['created_at'], original['created_at'])
        self.assertEqual(returning['revoked_at'], revoked['revoked_at'])
        self.assertFalse(access.is_approved('20001'))
        access.approve_user(self.OWNER, '20001')
        self.assertTrue(access.is_approved('20001'))
        events = [row['action'] for row in self.query('SELECT action FROM user_events WHERE user_id=? ORDER BY id', ('20001',))]
        self.assertEqual(events, ['invite_redeemed', 'approved', 'revoked', 'reinvited', 'invite_redeemed', 'approved'])

    def test_repeated_revoke_invalidates_outstanding_reinvitation(self):
        self.pending()
        access.revoke_user(self.OWNER, '20001')
        explicit = access.reinvite_user(self.OWNER, '20001')
        access.revoke_user(self.OWNER, '20001')
        self.error(400, access.redeem_invite, explicit['token'], '20001')

    def test_invite_revocation_is_idempotent_and_does_not_delete_metadata(self):
        invite = access.create_invite(self.OWNER)
        revoked = access.revoke_invite(self.OWNER, invite['id'])
        self.assertEqual(revoked['status'], 'revoked')
        self.assertEqual(revoked, access.revoke_invite(self.OWNER, invite['id']))
        self.error(400, access.redeem_invite, invite['token'], '20001')
        self.assertEqual(len(access.list_invites(self.OWNER)), 1)

    def test_used_invite_cannot_be_revoked_instead_of_account(self):
        invite = access.create_invite(self.OWNER)
        access.redeem_invite(invite['token'], '20001')
        self.error(409, access.revoke_invite, self.OWNER, invite['id'])
        self.assertEqual(access.get_user('20001')['status'], 'pending')

    def test_invite_lifetime_is_bounded(self):
        for ttl in (0, -1, 604801, 1.2, True, '60'):
            self.error(400, access.create_invite, self.OWNER, ttl_seconds=ttl)
        valid = access.create_invite(self.OWNER, ttl_seconds=604800)
        self.assertEqual(valid['expires_at'], self.now + 604800)

    def test_failed_redemptions_are_persistently_rate_limited(self):
        for _ in range(access.REDEEM_ATTEMPT_LIMIT):
            self.error(400, access.redeem_invite, 'invalid', '20001')
        # Reinitialization/reopening the SQLite file does not clear attempts.
        access.init_access()
        self.error(429, access.redeem_invite, 'invalid', '20001')
        row = self.query("SELECT attempts FROM rate_limits WHERE action='redeem' AND subject='20001'")[0]
        self.assertEqual(row['attempts'], access.REDEEM_ATTEMPT_LIMIT)
        self.error(400, access.redeem_invite, 'invalid', '20002')
        self.now += access.REDEEM_WINDOW_SECONDS
        self.error(400, access.redeem_invite, 'invalid', '20001')
        self.assertEqual(self.query("SELECT attempts FROM rate_limits WHERE action='redeem' AND subject='20001'")[0]['attempts'], 1)

    def test_global_redemption_limit_resists_identity_rotation(self):
        with patch.object(access, 'REDEEM_GLOBAL_LIMIT', 3):
            for i in range(3):
                self.error(400, access.redeem_invite, 'invalid', str(20000 + i))
            self.error(429, access.redeem_invite, 'invalid', '30000')
        self.assertIsNone(access.get_user('30000'))

    def test_attempt_storage_is_bounded_and_stale_buckets_are_pruned(self):
        with patch.object(access, 'MAX_RATE_BUCKETS', 5), patch.object(access, 'REDEEM_GLOBAL_LIMIT', 1000):
            for i in range(4):
                self.error(400, access.redeem_invite, 'invalid', str(20000 + i))
            self.error(429, access.redeem_invite, 'invalid', '30000')
            self.assertEqual(self.query('SELECT COUNT(*) AS n FROM rate_limits')[0]['n'], 5)
            self.now += access.REDEEM_WINDOW_SECONDS
            self.error(400, access.redeem_invite, 'invalid', '30000')
            self.assertEqual(self.query('SELECT COUNT(*) AS n FROM rate_limits')[0]['n'], 2)

    def test_invitation_creation_limit_is_persistent(self):
        for _ in range(access.INVITE_CREATE_LIMIT):
            invite = access.create_invite(self.OWNER)
            access.revoke_invite(self.OWNER, invite['id'])
        access.init_access()
        self.error(429, access.create_invite, self.OWNER)
        self.now += access.INVITE_CREATE_WINDOW_SECONDS
        access.create_invite(self.OWNER)

    def test_active_invitations_are_capped_independently_of_creation_window(self):
        with patch.object(access, 'MAX_ACTIVE_INVITES', 2):
            first = access.create_invite(self.OWNER)
            access.create_invite(self.OWNER)
            self.error(429, access.create_invite, self.OWNER)
            self.now += access.INVITE_CREATE_WINDOW_SECONDS
            self.error(429, access.create_invite, self.OWNER)
            access.revoke_invite(self.OWNER, first['id'])
            access.create_invite(self.OWNER)

    def test_already_registered_account_does_not_consume_new_invite(self):
        self.pending()
        invite = access.create_invite(self.OWNER)
        self.error(409, access.redeem_invite, invite['token'], '20001')
        user = access.redeem_invite(invite['token'], '20002')
        self.assertEqual(user['status'], 'pending')


if __name__ == '__main__':
    unittest.main()
