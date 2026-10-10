import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock,patch
from types import SimpleNamespace
from app import db,service
from app.telegram_client import PersonalTelegram

SOL='So11111111111111111111111111111111111111112'
class FakeClient:
    def __init__(self): self.send_message=AsyncMock()
    async def is_user_authorized(self):return True
    async def iter_dialogs(self,limit=None):
        yield SimpleNamespace(id=5486942816,entity=SimpleNamespace(id='target'))
    async def get_input_entity(self,entity):return 'resolved-peer'

class AddressOnlyTests(unittest.TestCase):
    def test_extracts_only_address_not_words_or_media(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(db,'DB_PATH',Path(folder)/'becs.sqlite'),patch.object(service,'connection',db.connection),patch.object(service,'get_setting',db.get_setting):
            db.init_db()
            route={'id':1,'enabled':True,'sources':['-1001'],'destinations':['5486942816'],'dedup_minutes':60,'network':'both','allowed':'','blocked':''}
            with db.connection() as con:
                con.execute("INSERT INTO routes(id,name,mode,enabled,sources,destinations,created_at,updated_at) VALUES(1,'test','smart',1,'[\\\"-1001\\\"]','[\\\"5486942816\\\"]',1,1)")
            with patch.object(service,'get_routes',return_value=[route]):
                asyncio.run(service.ingest_message('-1001',55,'Buy now '+SOL+' with image!',None))
                asyncio.run(service.ingest_message('-1001',56,'Buy now '+SOL+' with image!',None))
            with db.connection() as con:
                jobs=con.execute('SELECT * FROM jobs').fetchall()
                self.assertEqual(len(jobs),1)
                self.assertEqual(jobs[0]['message_preview'],SOL)
                self.assertNotIn('Buy now',str(dict(jobs[0])))
    def test_only_address_sent_and_old_queued_words_rejected(self):
        manager=PersonalTelegram();fake=FakeClient()
        manager.ensure_client=AsyncMock(return_value=fake)
        job={'destination_id':'5486942816','message_preview':SOL}
        asyncio.run(manager.send(job,'native'))
        fake.send_message.assert_awaited_once_with('resolved-peer',SOL,link_preview=False,parse_mode=None)
        with self.assertRaises(ValueError):
            asyncio.run(manager.send({'destination_id':'5486942816','message_preview':'Buy '+SOL},'native'))
if __name__=='__main__':unittest.main()
