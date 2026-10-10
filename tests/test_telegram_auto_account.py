import hashlib
import hmac
import json
import os
import time
import unittest
from unittest.mock import patch
from urllib.parse import urlencode
from fastapi.testclient import TestClient
from app.main import app, verified_telegram_user_id

def signed_launch(user_id, token):
    data={'auth_date':str(int(time.time())),'query_id':'AA_test','user':json.dumps({'id':user_id},separators=(',',':'))}
    text='\\n'.join(f'{k}={v}' for k,v in sorted(data.items()))
    secret=hmac.new(b'WebAppData',token.encode(),hashlib.sha256).digest()
    data['hash']=hmac.new(secret,text.encode(),hashlib.sha256).hexdigest()
    return urlencode(data)

class TelegramAutoAccountTests(unittest.TestCase):
    def setUp(self):
        self.env=patch.dict(os.environ,{'TELEGRAM_BOT_TOKEN':'test-bot-token',
          'BECS_ALLOWED_TELEGRAM_ID':'111','BECS_ACCOUNT_2_ALLOWED_TELEGRAM_ID':'222',
          'BECS_ACCOUNT_3_ALLOWED_TELEGRAM_ID':'5062534155'})
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_signed_hama_account_three(self):
        raw=signed_launch(5062534155,'test-bot-token')
        self.assertEqual(verified_telegram_user_id(raw),'5062534155')
        with TestClient(app) as client:
            response=client.post('/api/telegram/resolve-account',headers={'x-telegram-init-data':raw})
            self.assertEqual(response.status_code,200)
            self.assertEqual(response.json()['account_id'],'account-3')

    def test_unknown_signed_user_cannot_see_another_account(self):
        raw=signed_launch(999,'test-bot-token')
        with TestClient(app) as client:
            response=client.post('/api/telegram/resolve-account',headers={'x-telegram-init-data':raw})
            self.assertEqual(response.status_code,403)
            self.assertEqual(response.json()['verified_user_id'],'999')

    def test_forged_signature_rejected(self):
        raw=signed_launch(5062534155,'wrong-token')
        with TestClient(app) as client:
            response=client.post('/api/telegram/resolve-account',headers={'x-telegram-init-data':raw})
            self.assertEqual(response.status_code,403)
            self.assertNotIn('verified_user_id',response.json())

if __name__=='__main__':unittest.main()
