import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock
from app.telegram_client import PersonalTelegram

class FakeClient:
    def __init__(self):
        self.forward_messages=AsyncMock()
    async def is_user_authorized(self): return True
    async def iter_dialogs(self,limit=None):
        for peer_id in ('-1004491672783','5486942816'):
            yield SimpleNamespace(id=int(peer_id),entity=SimpleNamespace(id=peer_id))
    async def get_input_entity(self,entity):
        return 'resolved:'+entity.id

class NativeForwardTests(unittest.TestCase):
    def test_resolves_both_peers_without_message_content(self):
        manager=PersonalTelegram()
        fake=FakeClient()
        manager.ensure_client=AsyncMock(return_value=fake)
        job={'source_id':'-1004491672783','destination_id':'5486942816','message_id':273010,'message_preview':'SHOULD NOT SEND'}
        asyncio.run(manager.send(job,'text'))
        fake.forward_messages.assert_awaited_once_with('resolved:5486942816',273010,from_peer='resolved:-1004491672783')
    def test_missing_chat_fails_clearly(self):
        manager=PersonalTelegram()
        fake=FakeClient()
        async def dialogs(limit=None):
            yield SimpleNamespace(id=-1004491672783,entity=SimpleNamespace(id='-1004491672783'))
        fake.iter_dialogs=dialogs
        manager.ensure_client=AsyncMock(return_value=fake)
        with self.assertRaisesRegex(LookupError,'5486942816'):
            asyncio.run(manager.send({'source_id':'-1004491672783','destination_id':'5486942816','message_id':1},'native'))
        fake.forward_messages.assert_not_awaited()

if __name__=='__main__':unittest.main()
