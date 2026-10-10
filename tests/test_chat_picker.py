import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from telethon import utils
from telethon.tl.types import Channel, Chat

from app.telegram_client import PersonalTelegram
from app.main import canonicalize_route
from app.models import RouteInput

class Dialog:
    def __init__(self, entity, name="Test"):
        self.entity = entity
        self.id = utils.get_peer_id(entity)
        self.name = name
        self.is_channel = isinstance(entity, Channel)
        self.is_group = isinstance(entity, Chat)

class FakeClient:
    def __init__(self, dialogs):
        self.dialogs = dialogs
    async def is_user_authorized(self):
        return True
    async def get_entity(self, ref):
        if ref == "@signalfeed":
            return self.dialogs[0].entity
        if ref == "@destinationfeed":
            return self.dialogs[1].entity
        raise ValueError("Unknown chat")
    async def iter_dialogs(self, limit=None):
        for dialog in self.dialogs:
            yield dialog

class ChatPickerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.source = Channel(id=123, title="Signals", photo=None, date=None, broadcast=True,
                              megagroup=False, access_hash=1, creator=False)
        self.destination = Channel(id=456, title="Dest", photo=None, date=None, broadcast=True,
                                   megagroup=False, access_hash=2, creator=True)
        self.client = FakeClient([Dialog(self.source, "Signals"), Dialog(self.destination, "Dest")])
        self.manager = PersonalTelegram()
        self.manager.ensure_client = AsyncMock(return_value=self.client)

    async def test_username_resolves_to_stable_source_id(self):
        result = await self.manager.resolve_chat("@signalfeed", "source")
        self.assertEqual(result["id"], str(utils.get_peer_id(self.source)))
        self.assertTrue(result["validated"])

    async def test_destination_requires_channel_posting_rights(self):
        with self.assertRaisesRegex(ValueError, "posting permission"):
            await self.manager.resolve_chat("@signalfeed", "destination")

    async def test_allowed_destination(self):
        result = await self.manager.resolve_chat("@destinationfeed", "destination")
        self.assertEqual(result["id"], str(utils.get_peer_id(self.destination)))

    async def test_unknown_id_rejected(self):
        with self.assertRaisesRegex(ValueError, "not found"):
            await self.manager.resolve_chat("-100999999", "source")

    async def test_invalid_username_rejected(self):
        with self.assertRaisesRegex(ValueError, "Invalid public"):
            await self.manager.resolve_chat("@x", "source")

    async def test_existing_route_fields_preserved(self):
        route = RouteInput(name="Crypto Alerts", sources=["@signalfeed"],
                           destinations=["@destinationfeed"], allowed="launch", dedup_minutes=60)
        with patch("app.main.manager", self.manager):
            normalized = await canonicalize_route(route)
        self.assertEqual(normalized.sources, [str(utils.get_peer_id(self.source))])
        self.assertEqual(normalized.destinations, [str(utils.get_peer_id(self.destination))])
        self.assertEqual(normalized.allowed, "launch")
        self.assertEqual(normalized.dedup_minutes, 60)

    async def test_source_destination_loop_rejected(self):
        route = RouteInput(name="Loop Route", sources=["@destinationfeed"],
                           destinations=["@destinationfeed"])
        with patch("app.main.manager", self.manager):
            with self.assertRaisesRegex(Exception, "both source and destination"):
                await canonicalize_route(route)

if __name__ == "__main__":
    unittest.main()
