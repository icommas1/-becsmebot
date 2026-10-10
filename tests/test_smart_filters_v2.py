import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import db
from app.engine import decide, dedup_fingerprint
from app.main import inspector

class SmartFiltersV2Tests(unittest.TestCase):
    def test_solana_contract_rule(self):
        route={'mode':'smart','network':'solana','require_contract':True,'allowed':'','blocked':'','pattern':''}
        self.assertEqual(decide('CA: So11111111111111111111111111111111111111112',route)['decision'],'forward')
        self.assertEqual(decide('no token address here',route)['decision'],'block')

    def test_blocklist_precedence(self):
        route={'mode':'smart','network':'both','require_contract':False,'allowed':'launch','blocked':'scam','pattern':''}
        self.assertEqual(decide('launch scam',route)['decision'],'block')

    def test_duplicate_contract_fingerprint(self):
        route={'mode':'smart','network':'solana','require_contract':True,'allowed':'','blocked':'','pattern':''}
        a='So11111111111111111111111111111111111111112'
        self.assertEqual(dedup_fingerprint('Launch '+a,decide('Launch '+a,route)),
                         dedup_fingerprint('New alert '+a,decide('New alert '+a,route)))

    def test_inspector_returns_only_real_events(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(db,'DB_PATH',Path(folder)/'test.sqlite'):
                db.init_db()
                with db.connection() as connection:
                    db.event(connection,'blocked','Allowlist condition not met',None,'-100123',None)
                result=inspector()
                self.assertEqual(len(result['items']),1)
                self.assertEqual(result['items'][0]['detail'],'Allowlist condition not met')
                self.assertEqual(result['source'],'recorded_events')

if __name__=='__main__':
    unittest.main()
