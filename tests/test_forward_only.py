import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from app import db, service

class ForwardOnlyTests(unittest.TestCase):
    def test_message_content_never_persisted(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(db,'DB_PATH',Path(folder)/'becs.sqlite'), patch.object(service,'connection',db.connection), patch.object(service,'get_setting',db.get_setting):
            db.init_db()
            with db.connection() as con:
                con.execute("""INSERT INTO routes(name,mode,enabled,sources,destinations,allowed,blocked,pattern,match_mode,network,require_contract,dedup_minutes,delivery_style,created_at,updated_at)
                VALUES ('forward','smart',1,'["-1001"]','["-1002"]','secretword','', '', 'any','both',0,60,'text',1,1)""")
            with patch.object(service,'get_routes',return_value=[{'id':1,'enabled':True,'sources':['-1001'],'destinations':['-1002'],'mode':'ai-gated','dedup_minutes':60}]):
                asyncio.run(service.ingest_message('-1001',42,'SENSITIVE_MESSAGE_CONTENT',None))
                asyncio.run(service.ingest_message('-1001',42,'SENSITIVE_MESSAGE_CONTENT',None))
            with db.connection() as con:
                jobs=con.execute('SELECT * FROM jobs').fetchall()
                self.assertEqual(len(jobs),1)
                self.assertEqual(jobs[0]['message_preview'],'')
                self.assertEqual(jobs[0]['message_id'],42)
                self.assertEqual(con.execute('SELECT COUNT(*) FROM contracts').fetchone()[0],0)
                self.assertEqual(con.execute('SELECT COUNT(*) FROM reviews').fetchone()[0],0)
                events=' '.join(row['detail'] for row in con.execute('SELECT detail FROM events'))
                self.assertNotIn('SENSITIVE_MESSAGE_CONTENT',events)

if __name__=='__main__': unittest.main()
