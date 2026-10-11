"""Synthetic-only runtime, session, worker, and trusted Bot API isolation tests."""
import asyncio
import base64
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from cryptography.fernet import Fernet, InvalidToken

from app import access, db
from app.runtime import RuntimeRegistry
from app.service import delivery_worker
from app.telegram_client import PersonalTelegram, handle_bot_update, numeric_user_id, telegram_bot_poll

OWNER, FIRST, SECOND = '710001', '710002', '710003'
SOL = 'So11111111111111111111111111111111111111112'
SECRET = 'synthetic-session-secret-never-use-in-production-123456'


class FakeTelegram:
    def __init__(self, user_id=FIRST, authorized=True):
        self.user_id = user_id
        self.authorized = authorized
        self.session = SimpleNamespace(save=lambda: 'synthetic-session-material')
        self.connect = AsyncMock()
        self.disconnect = AsyncMock()
        self.log_out = AsyncMock()
        self.sign_in = AsyncMock()
        self.send_code_request = AsyncMock()
        self.send_message = AsyncMock()
        self.get_me = AsyncMock(return_value=SimpleNamespace(id=int(user_id), bot=False))
        self.remove_event_handler = Mock()
        self.handler = None
        self.dialog_gate = None
        self.dialog_started = asyncio.Event()

    def on(self, event):
        def register(handler):
            self.handler = handler
            return handler
        return register

    def is_connected(self):
        return True

    async def is_user_authorized(self):
        return self.authorized

    async def iter_dialogs(self, limit=None):
        self.dialog_started.set()
        if self.dialog_gate:
            await self.dialog_gate.wait()
        yield SimpleNamespace(id=90001, entity=SimpleNamespace(bot=False), name='Synthetic target',
                              is_group=False, is_channel=False, is_user=True)

    async def get_input_entity(self, entity):
        return 'synthetic-peer'


def private_update(user_id, text, **changes):
    message = {'from': {'id': int(user_id), 'is_bot': False, 'first_name': 'Synthetic'},
               'chat': {'id': int(user_id), 'type': 'private'}, 'text': text}
    message.update(changes)
    return {'update_id': 1, 'message': message}


class WorkspaceRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.environment = patch.dict('os.environ', {
            'BECS_ALLOWED_TELEGRAM_ID': OWNER, 'BECS_SESSION_SECRET': SECRET,
            'BECS_SESSION_DIR': str(Path(self.folder.name) / 'sessions'),
            'TELEGRAM_API_ID': '', 'TELEGRAM_API_HASH': '', 'TELEGRAM_BOT_TOKEN': '',
            'BECS_MINI_APP_URL': '',
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.database = patch.object(db, 'DB_PATH', Path(self.folder.name) / 'becs.sqlite')
        self.database.start()
        self.addCleanup(self.database.stop)
        access.init_access()
        for user_id in (FIRST, SECOND):
            invitation = access.create_invite(OWNER)
            access.redeem_invite(invitation['token'], user_id, 'Synthetic member')
            access.approve_user(OWNER, user_id)
        for user_id in (OWNER, FIRST, SECOND):
            with db.workspace(user_id):
                db.init_db()
        self.registry = RuntimeRegistry()
        self.addAsyncCleanup(self.registry.shutdown)

    def add_job(self, user_id, destination='90001'):
        with db.workspace(user_id), db.connection() as connection:
            connection.execute('''INSERT INTO routes(id,name,enabled,sources,destinations,created_at,updated_at)
                VALUES(1,?,1,?,?,1,1)''', ('Route ' + user_id, json.dumps(['-1001']), json.dumps([destination])))
            connection.execute('''INSERT INTO jobs(route_id,source_id,destination_id,message_id,
                message_preview,fingerprint,status,created_at,next_attempt)
                VALUES(1,'-1001',?,17,?,'synthetic','queued',1,0)''', (destination, SOL))

    def job_status(self, user_id):
        with db.workspace(user_id), db.connection() as connection:
            return connection.execute('SELECT status FROM jobs ORDER BY id').fetchall()

    async def test_registry_separates_clients_locks_caches_and_numeric_ids(self):
        first, second = self.registry.get(FIRST), self.registry.get(SECOND)
        self.assertIs(first, self.registry.get(FIRST))
        self.assertIsNot(first, second)
        self.assertIsNot(first._login_lock, second._login_lock)
        first._auth_cache = (123, True)
        self.assertEqual(second._auth_cache, (0, False))
        for bad in ('../personal', '01', '-1', '0', True, 1.5, '١', '9223372036854775808'):
            with self.subTest(value=bad), self.assertRaises(ValueError):
                numeric_user_id(bad)
        with self.assertRaises(PermissionError):
            self.registry.get('710004')

    async def test_owner_legacy_cipher_and_members_are_cryptographically_separate(self):
        owner = self.registry.get(OWNER)
        first, second = self.registry.get(FIRST), self.registry.get(SECOND)
        owner_path, owner_cipher = owner.session_storage()
        first_path, first_cipher = first.session_storage()
        second_path, second_cipher = second.session_storage()
        self.assertEqual(owner_path.name, 'personal.session.enc')
        self.assertEqual(first_path.name, f'user-{FIRST}.session.enc')
        self.assertEqual(second_path.name, f'user-{SECOND}.session.enc')
        legacy = Fernet(base64.urlsafe_b64encode(hashlib.sha256(SECRET.encode()).digest()))
        self.assertEqual(owner_cipher.decrypt(legacy.encrypt(b'legacy-owner')), b'legacy-owner')
        encrypted = first_cipher.encrypt(b'member-one')
        for other_cipher in (owner_cipher, second_cipher):
            with self.assertRaises(InvalidToken):
                other_cipher.decrypt(encrypted)

    async def test_wrong_account_code_never_overwrites_saved_session(self):
        manager = self.registry.get(FIRST)
        fake = FakeTelegram(SECOND)
        manager.client = fake
        manager.ensure_client = AsyncMock(return_value=fake)
        manager.phone = '+15555550100'
        manager.session_path, manager.cipher = manager.session_storage()
        manager.session_path.parent.mkdir()
        original = manager.cipher.encrypt(b'original-saved-session')
        manager.session_path.write_bytes(original)
        with self.assertRaisesRegex(ValueError, 'same Telegram account'):
            await manager.sign_in_code('synthetic-code')
        self.assertEqual(manager.session_path.read_bytes(), original)
        self.assertIsNone(manager.client)
        self.assertFalse(manager._identity_verified)
        fake.disconnect.assert_awaited()
        fake.log_out.assert_not_awaited()

    async def test_wrong_account_password_never_creates_session(self):
        manager = self.registry.get(FIRST)
        fake = FakeTelegram(SECOND)
        manager.client = fake
        manager.ensure_client = AsyncMock(return_value=fake)
        manager.session_path, manager.cipher = manager.session_storage()
        with self.assertRaisesRegex(ValueError, 'same Telegram account'):
            await manager.sign_in_password('synthetic-password')
        self.assertFalse(manager.session_path.exists())
        fake.log_out.assert_not_awaited()

    async def test_matching_account_is_persisted_only_to_its_own_encrypted_file(self):
        manager = self.registry.get(FIRST)
        fake = FakeTelegram(FIRST)
        manager.client = fake
        manager.ensure_client = AsyncMock(return_value=fake)
        manager.session_path, manager.cipher = manager.session_storage()
        manager.session_path.parent.mkdir()
        result = await manager.sign_in_password('synthetic-password')
        self.assertEqual(result['status'], 'authorized')
        self.assertEqual(manager.cipher.decrypt(manager.session_path.read_bytes()), b'synthetic-session-material')
        self.assertEqual(manager.session_path.stat().st_mode & 0o777, 0o600)
        self.assertFalse(self.registry.get(OWNER).session_storage()[0].exists())
        self.assertFalse(self.registry.get(SECOND).session_storage()[0].exists())

    async def test_saved_wrong_owner_identity_preserves_legacy_encrypted_file(self):
        manager = self.registry.get(OWNER)
        path, cipher = manager.session_storage()
        path.parent.mkdir()
        encrypted = cipher.encrypt(b'legacy-owner-session')
        path.write_bytes(encrypted)
        fake = FakeTelegram(FIRST)
        with patch.dict('os.environ', {'TELEGRAM_API_ID': '123', 'TELEGRAM_API_HASH': 'synthetic'}), \
             patch('telethon.TelegramClient', return_value=fake), \
             patch('telethon.sessions.StringSession'):
            with self.assertRaisesRegex(ValueError, 'same Telegram account'):
                await manager.ensure_client()
        self.assertEqual(path.read_bytes(), encrypted)
        self.assertIsNone(manager.client)
        fake.disconnect.assert_awaited()
        fake.log_out.assert_not_awaited()

    async def test_revocation_cancels_pending_operations_and_future_sends(self):
        manager = self.registry.get(FIRST)
        fake = FakeTelegram(FIRST)
        fake.dialog_gate = asyncio.Event()
        manager.client = fake
        manager.ensure_client = AsyncMock(return_value=fake)
        pending = asyncio.create_task(manager.chats())
        await fake.dialog_started.wait()
        access.revoke_user(OWNER, FIRST)
        await self.registry.revoke(FIRST)
        self.assertTrue(pending.done())
        with self.assertRaises(asyncio.CancelledError):
            await pending
        with self.assertRaises(PermissionError):
            await manager.send({'destination_id': '90001', 'message_preview': SOL}, 'text')
        fake.send_message.assert_not_awaited()
        fake.disconnect.assert_awaited()
        self.assertIsNone(manager.client)

    async def test_approval_is_rechecked_before_network_send(self):
        manager = self.registry.get(FIRST)
        fake = FakeTelegram(FIRST)
        fake.dialog_gate = asyncio.Event()
        manager.ensure_client = AsyncMock(return_value=fake)
        pending = asyncio.create_task(manager.send({'destination_id': '90001', 'message_preview': SOL}, 'text'))
        await fake.dialog_started.wait()
        access.revoke_user(OWNER, FIRST)
        fake.dialog_gate.set()
        with self.assertRaises(PermissionError):
            await pending
        fake.send_message.assert_not_awaited()

    async def test_delivery_worker_binds_scope_instead_of_inheriting_caller(self):
        self.add_job(FIRST)
        self.add_job(SECOND, '90002')
        stop = asyncio.Event()
        scopes = []
        async def send(job, style):
            scopes.append((db.current_workspace.get(), job['destination_id'], job['message_preview']))
            stop.set()
        manager = SimpleNamespace(user_id=FIRST, status=AsyncMock(return_value={'authorized': True}),
                                  send=send)
        with db.workspace(SECOND):
            await delivery_worker(manager, stop)
            self.assertEqual(db.current_workspace.get(), SECOND)
        self.assertEqual(scopes, [(FIRST, '90001', SOL)])
        self.assertEqual(self.job_status(FIRST)[0]['status'], 'sent')
        self.assertEqual(self.job_status(SECOND)[0]['status'], 'queued')

    async def test_listener_uses_own_scope_and_keeps_only_contract_addresses(self):
        for user_id in (FIRST, SECOND):
            self.add_job(user_id)
            with db.workspace(user_id), db.connection() as connection:
                connection.execute('DELETE FROM jobs')
        manager = self.registry.get(FIRST)
        fake = FakeTelegram(FIRST)
        with patch.dict('os.environ', {'TELEGRAM_API_ID': '123', 'TELEGRAM_API_HASH': 'synthetic'}), \
             patch('telethon.TelegramClient', return_value=fake):
            await manager.ensure_client()
        event = SimpleNamespace(chat_id=-1001, message=SimpleNamespace(id=25), raw_text='Private original ' + SOL)
        with db.workspace(SECOND):
            await fake.handler(event)
            self.assertEqual(db.current_workspace.get(), SECOND)
        with db.workspace(FIRST), db.connection() as connection:
            rows = connection.execute('SELECT message_preview FROM jobs').fetchall()
            self.assertEqual([row[0] for row in rows], [SOL])
            self.assertNotIn('Private original', str(connection.execute('SELECT detail FROM events').fetchall()))
        self.assertEqual(self.job_status(SECOND), [])

    async def test_bot_pause_and_routes_are_scoped_to_sender(self):
        self.add_job(FIRST)
        self.add_job(SECOND)
        with db.workspace(OWNER):
            result = await handle_bot_update(private_update(FIRST, '/pause'), self.registry)
            self.assertEqual(db.current_workspace.get(), OWNER)
        self.assertEqual(result['chat_id'], int(FIRST))
        with db.workspace(FIRST):
            self.assertEqual(db.get_setting('paused'), 'true')
        with db.workspace(SECOND):
            self.assertEqual(db.get_setting('paused'), 'false')
        result = await handle_bot_update(private_update(FIRST, '/routes'), self.registry)
        self.assertIn('Route ' + FIRST, result['text'])
        self.assertNotIn('Route ' + SECOND, result['text'])

    async def test_bot_redeems_once_then_returns_pending_without_workspace_creation(self):
        access.revoke_user(OWNER, SECOND)
        invitation = access.create_invite(OWNER)
        third = '710004'
        result = await handle_bot_update(private_update(third, '/start invite_' + invitation['token']), self.registry)
        self.assertIn('pending', result['text'])
        self.assertEqual(access.get_user(third)['status'], 'pending')
        self.assertFalse(db.workspace_path(third).exists())
        again = await handle_bot_update(private_update(third, '/start invite_' + invitation['token']), self.registry)
        self.assertIn('unavailable', again['text'])
        denied = await handle_bot_update(private_update(third, '/resume'), self.registry)
        self.assertIn('pending', denied['text'])
        self.assertFalse(db.workspace_path(third).exists())

    async def test_bot_ignores_forwarded_group_spoofed_and_malformed_commands(self):
        access.revoke_user(OWNER, SECOND)
        invitation = access.create_invite(OWNER)
        text = '/start invite_' + invitation['token']
        cases = [None, {}, {'message': []}, private_update('710004', ''),
                 private_update('710004', None), private_update('710004', '/unknown'),
                 private_update('710004', text, forward_origin={'type': 'user'}),
                 private_update('710004', text, forward_from={'id': int(OWNER)}),
                 private_update('710004', text, via_bot={'id': 1}),
                 private_update('710004', text, chat={'id': -1001, 'type': 'supergroup'}),
                 private_update('710004', text, chat={'id': int(OWNER), 'type': 'private'}),
                 private_update('710004', text, **{'from': {'id': '710004'}})]
        for case in cases:
            with self.subTest(case=case):
                self.assertIsNone(await handle_bot_update(case, self.registry))
        self.assertIsNone(access.get_user('710004'))
        self.assertEqual(access.list_invites(OWNER)[0]['status'], 'active')

    async def test_registry_start_is_idempotent_and_revoke_stops_only_member(self):
        with patch('app.runtime.telegram_bot_poll', new_callable=AsyncMock) as poller, \
             patch.dict('os.environ', {'TELEGRAM_BOT_TOKEN': 'synthetic-no-network'}):
            await self.registry.start()
            await asyncio.sleep(0)
            first_task = self.registry.worker_for(FIRST)
            second_task = self.registry.worker_for(SECOND)
            await self.registry.start()
            self.assertIs(first_task, self.registry.worker_for(FIRST))
            poller.assert_awaited_once()
            access.revoke_user(OWNER, FIRST)
            await self.registry.revoke(FIRST)
            self.assertTrue(first_task.done())
            self.assertFalse(second_task.done())
            self.assertIsNone(self.registry.worker_for(FIRST))
            invitation = access.reinvite_user(OWNER, FIRST)
            access.redeem_invite(invitation['token'], FIRST)
            access.approve_user(OWNER, FIRST)
            await self.registry.activate(FIRST)
            self.assertIsNot(first_task, self.registry.worker_for(FIRST))
            self.assertFalse(self.registry.worker_for(FIRST).done())

    async def test_revocation_interrupts_a_pending_saved_session_connection(self):
        manager = self.registry.get(FIRST)
        fake = FakeTelegram(FIRST)
        started = asyncio.Event()
        never = asyncio.Event()
        async def connect():
            started.set()
            await never.wait()
        fake.connect.side_effect = connect
        manager.has_saved_session = Mock(return_value=True)
        with patch.dict('os.environ', {'TELEGRAM_API_ID': '123', 'TELEGRAM_API_HASH': 'synthetic'}), \
             patch('telethon.TelegramClient', return_value=fake):
            activation = asyncio.create_task(self.registry.activate(FIRST))
            await started.wait()
            access.revoke_user(OWNER, FIRST)
            await asyncio.wait_for(self.registry.revoke(FIRST), 2)
        with self.assertRaises(asyncio.CancelledError):
            await activation
        fake.disconnect.assert_awaited()
        self.assertIsNone(manager.client)
        self.assertIsNone(self.registry.worker_for(FIRST))

    async def test_cancelled_inflight_delivery_is_not_automatically_retried(self):
        self.add_job(FIRST)
        manager = self.registry.get(FIRST)
        fake = FakeTelegram(FIRST)
        send_started = asyncio.Event()
        never = asyncio.Event()
        async def send_message(*args, **kwargs):
            send_started.set()
            await never.wait()
        fake.send_message.side_effect = send_message
        manager.client = fake
        manager.ensure_client = AsyncMock(return_value=fake)
        manager.status = AsyncMock(return_value={'authorized': True})
        await self.registry.activate(FIRST)
        await send_started.wait()
        access.revoke_user(OWNER, FIRST)
        await self.registry.revoke(FIRST)
        self.assertEqual(self.job_status(FIRST)[0]['status'], 'failed')
        fake.send_message.assert_awaited_once()
        with self.assertRaises(PermissionError):
            await manager.send({'destination_id': '90001', 'message_preview': SOL}, 'text')
        fake.send_message.assert_awaited_once()

    async def test_remote_acceptance_followed_by_revocation_never_requeues(self):
        self.add_job(FIRST)
        manager = self.registry.get(FIRST)
        fake = FakeTelegram(FIRST)
        async def accepted_then_revoked(*args, **kwargs):
            access.revoke_user(OWNER, FIRST)
        fake.send_message.side_effect = accepted_then_revoked
        manager.client = fake
        manager.ensure_client = AsyncMock(return_value=fake)
        manager.status = AsyncMock(return_value={'authorized': True})
        await delivery_worker(manager, asyncio.Event(), FIRST)
        fake.send_message.assert_awaited_once()
        self.assertEqual(self.job_status(FIRST)[0]['status'], 'failed')
        with db.workspace(FIRST), db.connection() as connection:
            error = connection.execute('SELECT error FROM jobs').fetchone()[0]
            self.assertIn('verify destination before retrying', error)

    async def test_explicit_revocation_pauses_retained_queue_but_shutdown_does_not(self):
        await self.registry.start()
        access.revoke_user(OWNER, FIRST)
        await self.registry.revoke(FIRST)
        with db.workspace(FIRST):
            self.assertEqual(db.get_setting('paused'), 'true')
        await self.registry.shutdown()
        with db.workspace(OWNER):
            self.assertEqual(db.get_setting('paused'), 'false')
        with db.workspace(SECOND):
            self.assertEqual(db.get_setting('paused'), 'false')
        invitation = access.reinvite_user(OWNER, FIRST)
        access.redeem_invite(invitation['token'], FIRST)
        access.approve_user(OWNER, FIRST)
        await self.registry.activate(FIRST)
        with db.workspace(FIRST):
            self.assertEqual(db.get_setting('paused'), 'true')
        self.assertFalse(db.workspace_path('710005').exists())
        await self.registry.revoke('710005')
        self.assertFalse(db.workspace_path('710005').exists())

    async def test_revoking_member_command_does_not_stop_shared_bot_poller(self):
        manager = self.registry.get(FIRST)
        member = FakeTelegram(FIRST)
        manager.client = member
        manager._identity_verified = True
        entered = asyncio.Event()
        owner_replied = asyncio.Event()
        never = asyncio.Event()
        async def held_authorization():
            entered.set()
            await never.wait()
            return True
        member.is_user_authorized = held_authorization
        batches = [
            {'ok': True, 'result': [private_update(FIRST, '/status')]},
            {'ok': True, 'result': [{**private_update(OWNER, '/status'), 'update_id': 2}]},
        ]
        async def get_updates(*args, **kwargs):
            if batches:
                data = batches.pop(0)
                return SimpleNamespace(json=lambda: data)
            await never.wait()
        async def reply(*args, **kwargs):
            if kwargs['json']['chat_id'] == int(OWNER):
                owner_replied.set()
            return SimpleNamespace(json=lambda: {'ok': True})
        client = SimpleNamespace(get=AsyncMock(side_effect=get_updates), post=AsyncMock(side_effect=reply))
        # Special methods are looked up on the type, not SimpleNamespace instances.
        class ClientContext:
            async def __aenter__(self):
                return client
            async def __aexit__(self, *args):
                return None
        stop = asyncio.Event()
        with patch.dict('os.environ', {'TELEGRAM_API_ID': '123', 'TELEGRAM_API_HASH': 'synthetic',
                                      'TELEGRAM_BOT_TOKEN': 'synthetic-no-network'}), \
             patch('app.telegram_client.httpx.AsyncClient', return_value=ClientContext()):
            poller = asyncio.create_task(telegram_bot_poll(self.registry, stop))
            try:
                await asyncio.wait_for(entered.wait(), 2)
                access.revoke_user(OWNER, FIRST)
                await self.registry.revoke(FIRST)
                await asyncio.wait_for(owner_replied.wait(), 2)
                self.assertFalse(poller.done())
                self.assertEqual(client.post.await_count, 1)
                self.assertEqual(client.post.await_args.kwargs['json']['chat_id'], int(OWNER))
            finally:
                stop.set()
                poller.cancel()
                await asyncio.wait_for(poller, 2)
        self.assertTrue(poller.done())
        self.assertEqual(manager._operations, {})
        member.disconnect.assert_awaited()

    async def test_bot_shutdown_cancels_and_drains_active_command_child(self):
        manager = self.registry.get(FIRST)
        member = FakeTelegram(FIRST)
        manager.client = member
        manager._identity_verified = True
        entered = asyncio.Event()
        never = asyncio.Event()
        async def held_authorization():
            entered.set()
            await never.wait()
            return True
        member.is_user_authorized = held_authorization
        response = SimpleNamespace(json=lambda: {'ok': True, 'result': [private_update(FIRST, '/status')]})
        client = SimpleNamespace(get=AsyncMock(return_value=response), post=AsyncMock())
        class ClientContext:
            async def __aenter__(self):
                return client
            async def __aexit__(self, *args):
                return None
        stop = asyncio.Event()
        with patch.dict('os.environ', {'TELEGRAM_API_ID': '123', 'TELEGRAM_API_HASH': 'synthetic',
                                      'TELEGRAM_BOT_TOKEN': 'synthetic-no-network'}), \
             patch('app.telegram_client.httpx.AsyncClient', return_value=ClientContext()):
            poller = asyncio.create_task(telegram_bot_poll(self.registry, stop))
            try:
                await asyncio.wait_for(entered.wait(), 2)
                self.assertTrue(manager._operations)
            finally:
                stop.set()
                poller.cancel()
                await asyncio.wait_for(poller, 2)
        self.assertEqual(manager._operations, {})
        client.post.assert_not_awaited()

    async def test_revocation_preserves_session_and_workspace_data(self):
        self.add_job(FIRST)
        manager = self.registry.get(FIRST)
        path, cipher = manager.session_storage()
        path.parent.mkdir()
        content = cipher.encrypt(b'preserved-session')
        path.write_bytes(content)
        access.revoke_user(OWNER, FIRST)
        await self.registry.revoke(FIRST)
        self.assertEqual(path.read_bytes(), content)
        self.assertEqual(self.job_status(FIRST)[0]['status'], 'queued')


if __name__ == '__main__':
    unittest.main()
