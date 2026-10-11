"""Bot destination regressions. All Telegram operations use mocks; no live messages."""
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from telethon import utils
from telethon.tl.functions.users import GetFullUserRequest
from telethon.tl.types import Channel, Chat, User

from app import db as database
from app.main import app, canonicalize_route
from app.models import RouteInput
from app.telegram_client import PersonalTelegram


SOL = 'So11111111111111111111111111111111111111112'


class Dialog:
    def __init__(self, entity, name):
        self.entity = entity
        self.id = utils.get_peer_id(entity)
        self.name = name
        self.is_user = isinstance(entity, User)
        self.is_channel = isinstance(entity, Channel)
        self.is_group = isinstance(entity, Chat) or bool(getattr(entity, 'megagroup', False))


class FakeClient:
    def __init__(self, dialogs):
        self.dialogs = dialogs
        self.authorized = True
        self.sender_bot = False
        self.blocked = False
        self.outsider = None
        self.requests = []
        self.send_message = AsyncMock()
        self.forward_messages = AsyncMock()

    async def is_user_authorized(self):
        return self.authorized

    async def is_bot(self):
        return self.sender_bot

    async def iter_dialogs(self, limit=None):
        for dialog in self.dialogs:
            yield dialog

    async def get_input_entity(self, entity):
        return utils.get_peer_id(entity)

    async def get_entity(self, reference):
        entities = [d.entity for d in self.dialogs]
        if self.outsider is not None:
            entities.append(self.outsider)
        for entity in entities:
            if reference == '@' + (getattr(entity, 'username', None) or ''):
                return entity
        raise ValueError('Unknown test chat')

    async def __call__(self, request):
        # Fail if resolution ever tries to start/unblock a bot or send a probe.
        if not isinstance(request, GetFullUserRequest):
            raise AssertionError('Unexpected Telegram operation in read-only validation')
        self.requests.append(request)
        return SimpleNamespace(full_user=SimpleNamespace(blocked=self.blocked))


class BotDestinationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.source = Channel(id=101, title='Signals', photo=None, date=None,
                              broadcast=True, access_hash=1, username='signalfeed')
        self.bot = User(id=900123, first_name='Example Bot', username='example_test_bot',
                        bot=True, access_hash=2)
        self.person = User(id=900456, first_name='Example Person', username='example_person',
                           access_hash=3)
        self.client = FakeClient([Dialog(self.source, 'Signals'), Dialog(self.bot, 'Example Bot'),
                                  Dialog(self.person, 'Example Person')])
        self.manager = PersonalTelegram()
        self.manager.ensure_client = AsyncMock(return_value=self.client)

    async def test_bot_username_resolves_as_destination(self):
        result = await self.manager.resolve_chat('@example_test_bot', 'destination')
        self.assertEqual(result['id'], '900123')
        self.assertEqual(result['kind'], 'bot')
        self.assertTrue(result['is_bot'])
        self.assertTrue(result['validated'])
        self.assertEqual(result['role'], 'destination')

    async def test_bot_numeric_id_resolves_as_destination(self):
        result = await self.manager.resolve_chat('900123', 'destination')
        self.assertEqual(result['username'], '@example_test_bot')
        self.assertEqual(result['id'], '900123')

    async def test_bot_remains_valid_source(self):
        result = await self.manager.resolve_chat('900123', 'source')
        self.assertEqual(result['role'], 'source')
        self.assertTrue(result['is_bot'])
        self.assertEqual(self.client.requests, [])

    async def test_chat_list_identifies_bots_and_keeps_stable_ids(self):
        chats = await self.manager.chats()
        self.assertEqual(chats[1]['id'], '900123')
        self.assertEqual(chats[1]['kind'], 'bot')
        self.assertTrue(chats[1]['is_bot'])
        self.assertEqual(chats[2]['kind'], 'private')
        self.assertFalse(chats[2]['is_bot'])

    async def test_regular_private_user_still_supported(self):
        result = await self.manager.resolve_chat('900456', 'destination')
        self.assertEqual(result['kind'], 'private')
        self.assertFalse(result['is_bot'])

    async def test_deleted_bot_still_rejected(self):
        self.bot.deleted = True
        with self.assertRaisesRegex(ValueError, 'deleted Telegram account'):
            await self.manager.resolve_chat('900123', 'destination')

    async def test_deleted_user_still_rejected(self):
        self.person.deleted = True
        with self.assertRaisesRegex(ValueError, 'deleted Telegram account'):
            await self.manager.resolve_chat('900456', 'destination')

    async def test_blocked_bot_explains_manual_unblock(self):
        self.client.blocked = True
        with self.assertRaisesRegex(ValueError, 'Unblock this bot'):
            await self.manager.resolve_chat('900123', 'destination')
        self.client.send_message.assert_not_awaited()
        self.client.forward_messages.assert_not_awaited()

    async def test_requires_personal_account_for_bot_destination(self):
        self.client.sender_bot = True
        with self.assertRaisesRegex(ValueError, 'personal Telegram account, not a bot session'):
            await self.manager.resolve_chat('900123', 'destination')
        self.assertEqual(self.client.requests, [])

    async def test_unknown_bot_requires_user_to_start_it(self):
        self.client.outsider = User(id=999001, first_name='Not started',
                                   username='not_started_bot', bot=True, access_hash=4)
        with self.assertRaisesRegex(ValueError, 'press Start'):
            await self.manager.resolve_chat('@not_started_bot', 'destination')
        self.client.send_message.assert_not_awaited()

    async def test_unauthorized_account_cannot_resolve_bot(self):
        self.client.authorized = False
        with self.assertRaisesRegex(ValueError, 'Sign in'):
            await self.manager.resolve_chat('900123', 'destination')

    async def test_resolution_is_read_only(self):
        await self.manager.resolve_chat('900123', 'destination')
        self.assertEqual(len(self.client.requests), 1)
        self.assertIsInstance(self.client.requests[0], GetFullUserRequest)
        self.client.send_message.assert_not_awaited()
        self.client.forward_messages.assert_not_awaited()

    async def test_route_normalization_preserves_filters_and_delivery_choice(self):
        route = RouteInput(name='Example Bot route', enabled=False, mode='smart',
                           sources=['@signalfeed'], destinations=['@example_test_bot', '900123'],
                           allowed='launch', blocked='giveaway', network='solana',
                           require_contract=True, dedup_minutes=60, delivery_style='text')
        with patch('app.main.manager', self.manager):
            result = await canonicalize_route(route)
        expected = route.model_dump()
        expected.update(sources=[str(utils.get_peer_id(self.source))], destinations=['900123'])
        self.assertEqual(result.model_dump(), expected)

    async def test_bot_cannot_be_own_source_and_destination(self):
        route = RouteInput(name='Loop test', sources=['@example_test_bot'], destinations=['900123'])
        with patch('app.main.manager', self.manager):
            with self.assertRaisesRegex(Exception, 'both source and destination'):
                await canonicalize_route(route)

    async def test_channel_posting_permissions_not_relaxed(self):
        with self.assertRaisesRegex(ValueError, 'posting permission'):
            await self.manager.resolve_chat('@signalfeed', 'destination')

    async def test_contract_delivery_uses_personal_client(self):
        job = {'source_id':str(utils.get_peer_id(self.source)), 'destination_id':'900123',
               'message_id':17, 'message_preview':SOL}
        await self.manager.send(job, 'text')
        self.client.send_message.assert_awaited_once_with(
            900123, job['message_preview'], link_preview=False, parse_mode=None)
        self.client.forward_messages.assert_not_awaited()

    async def test_native_setting_still_sends_only_contract_address(self):
        # Contract-only V1 supersedes the legacy native-forward behavior.
        job = {'source_id':str(utils.get_peer_id(self.source)), 'destination_id':'900123',
               'message_id':17, 'message_preview':SOL}
        await self.manager.send(job, 'native')
        self.client.send_message.assert_awaited_once_with(
            900123, SOL, link_preview=False, parse_mode=None)
        self.client.forward_messages.assert_not_awaited()

    async def test_original_text_is_rejected_without_sending(self):
        with self.assertRaisesRegex(ValueError, 'standalone contract address'):
            await self.manager.send({'destination_id':'900123',
                                     'message_preview':'Buy now ' + SOL}, 'native')
        self.client.send_message.assert_not_awaited()
        self.client.forward_messages.assert_not_awaited()

    async def test_unauthorized_account_cannot_send(self):
        self.client.authorized = False
        with self.assertRaisesRegex(RuntimeError, 'sign-in required'):
            await self.manager.send({'source_id':'-1000000000101', 'destination_id':'900123',
                                     'message_id':17, 'message_preview':SOL}, 'text')
        self.client.send_message.assert_not_awaited()

    async def test_api_create_and_update_bot_route_without_sending(self):
        # ASGITransport does not start the production lifespan or delivery worker.
        with tempfile.TemporaryDirectory() as temp, \
             patch.object(database, 'DB_PATH', Path(temp) / 'test.sqlite'), \
             patch('app.main.manager', self.manager), \
             patch('app.main.is_development_request', return_value=True):
            database.init_db()
            transport = httpx.ASGITransport(app=app, client=('testclient', 123))
            async with httpx.AsyncClient(transport=transport, base_url='http://testserver') as api:
                first = RouteInput(name='Existing route', sources=['@signalfeed'],
                                   destinations=['@example_person']).model_dump()
                original = (await api.post('/api/routes', json=first)).json()['route']
                payload = RouteInput(name='Bot route', enabled=True, sources=['@signalfeed'],
                                     destinations=['@example_test_bot'], delivery_style='text').model_dump()
                response = await api.post('/api/routes', json=payload)
                self.assertEqual(response.status_code, 200, response.text)
                saved = response.json()['route']
                self.assertEqual(saved['destinations'], ['900123'])
                self.assertEqual(saved['delivery_style'], 'text')
                payload.update(name='Updated bot route', destinations=['900123'])
                response = await api.put('/api/routes/' + str(saved['id']), json=payload)
                self.assertEqual(response.status_code, 200, response.text)
                routes = (await api.get('/api/routes')).json()['routes']
                self.assertEqual(next(r for r in routes if r['id'] == original['id']), original)
                self.assertEqual((await api.get('/api/jobs')).json()['jobs'], [])
            self.client.send_message.assert_not_awaited()
            self.client.forward_messages.assert_not_awaited()

    async def test_api_does_not_save_blocked_bot_route(self):
        self.client.blocked = True
        with tempfile.TemporaryDirectory() as temp, \
             patch.object(database, 'DB_PATH', Path(temp) / 'test.sqlite'), \
             patch('app.main.manager', self.manager), \
             patch('app.main.is_development_request', return_value=True):
            database.init_db()
            transport = httpx.ASGITransport(app=app, client=('testclient', 123))
            async with httpx.AsyncClient(transport=transport, base_url='http://testserver') as api:
                payload = RouteInput(name='Blocked bot', sources=['@signalfeed'],
                                     destinations=['900123']).model_dump()
                response = await api.post('/api/routes', json=payload)
                self.assertEqual(response.status_code, 422)
                self.assertIn('Unblock this bot', response.json()['detail'])
                self.assertEqual((await api.get('/api/routes')).json()['routes'], [])


if __name__ == '__main__':
    unittest.main()
