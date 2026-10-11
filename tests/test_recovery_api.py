"""Synthetic-only signed API/bot/export isolation checks; no Telegram networking."""
import json
import os
import time
import unittest
from unittest.mock import AsyncMock, patch
from app import access, db, recovery, recovery_access as ra
from app.recovery_crypto import decrypt_recovery_archive
from app.telegram_client import PersonalTelegram, handle_bot_update
import test_workspace_api as fixtures
from test_workspace_api import OWNER, MEMBER_A, MEMBER_B, UNKNOWN, signed_init_data

PASSWORD = 'synthetic recovery passphrase only'

class RecoveryAPITests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = fixtures.WorkspaceAPIRegression.asyncSetUp
    initialize_workspace = fixtures.WorkspaceAPIRegression.initialize_workspace
    add_user = fixtures.WorkspaceAPIRegression.add_user
    request = fixtures.WorkspaceAPIRegression.request
    seed_workspace = fixtures.WorkspaceAPIRegression.seed_workspace

    def choice(self, uid, yes=True):
        return ra.record_consent(uid, yes, expected_scope_version='1', expected_admin_id=OWNER)

    async def challenge(self):
        sent = []
        async def send(owner, challenge): sent.append(challenge)
        with patch('app.recovery.send_confirmation', side_effect=send):
            response = await self.request('POST', '/api/admin/recovery/challenge')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn('token', response.json())
        self.assertNotIn(sent[0]['token'], response.text)
        ra.confirm_export_challenge(OWNER, sent[0]['token'])
        return response.json()['challenge_id']

    async def test_consent_optional_bound_and_rescission_after_revoke(self):
        r = await self.request('GET', '/api/recovery/consent', MEMBER_A)
        self.assertTrue(r.json()['required'])
        body = {'choice':'no','scope_version':'1','administrator_id':OWNER}
        r = await self.request('POST','/api/recovery/consent',MEMBER_A,json=body)
        self.assertEqual(r.status_code,200,r.text)
        self.assertFalse(r.json()['required'])
        self.assertEqual((await self.request('GET','/api/routes',MEMBER_A)).status_code,200)
        body['administrator_id']=MEMBER_A
        self.assertEqual((await self.request('POST','/api/recovery/consent',MEMBER_A,json=body)).status_code,409)
        self.choice(MEMBER_B)
        access.revoke_user(OWNER,MEMBER_B)
        r=await self.request('POST','/api/recovery/rescind',MEMBER_B,json={})
        self.assertEqual(r.status_code,200,r.text)

    async def test_auth_origin_freshness_and_no_fallback(self):
        for uid in (MEMBER_A,UNKNOWN,None):
            r=await self.request('POST','/api/admin/recovery/challenge',uid)
            self.assertIn(r.status_code,(401,403))
        r=await self.request('POST','/api/admin/recovery/challenge',None,headers={'X-Telegram-Init-Data':signed_init_data(OWNER,timestamp=int(time.time())-301)})
        self.assertEqual(r.status_code,401)
        for origin in ('https://evil.example','https://becs-crypto-forwarding-terminal-59lgyp.v2.appdeploy.ai'):
            r=await self.request('POST','/api/admin/recovery/challenge',headers={'Origin':origin})
            self.assertEqual(r.status_code,403)
        with patch.dict(os.environ,{'BECS_ADMIN_TOKEN':'synthetic-fallback'}):
            r=await self.request('POST','/api/admin/recovery/challenge',None,headers={'X-Becs-Key':'synthetic-fallback'})
            self.assertEqual(r.status_code,403)

    async def test_export_encrypted_whitelisted_and_once(self):
        from telethon.sessions import StringSession
        from telethon.crypto import AuthKey
        for uid in (OWNER,MEMBER_A,MEMBER_B):self.seed_workspace(uid)
        self.choice(OWNER);self.choice(MEMBER_A);self.choice(MEMBER_B,False)
        with patch.dict(os.environ,{'BECS_SESSION_SECRET':'synthetic-root-key-only-'*3,'TELEGRAM_API_ID':'1234','TELEGRAM_API_HASH':'a'*32,'UNRELATED_SECRET':'NEVER_EXPORT_ME'}):
            expected={}
            for index,uid in enumerate((OWNER,MEMBER_A,MEMBER_B)):
                session=StringSession();session.set_dc(2,'149.154.167.50',443);session.auth_key=AuthKey(bytes([index+1])*256)
                expected[uid]=session.save()
                path,cipher=PersonalTelegram(uid).session_storage();path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(cipher.encrypt(expected[uid].encode()))
            cid=await self.challenge()
            r=await self.request('GET','/api/admin/recovery/challenge/'+cid)
            self.assertEqual(r.json()['status'],'confirmed')
            r=await self.request('POST','/api/admin/recovery/export',json={'challenge_id':cid,'password':PASSWORD})
            self.assertEqual(r.status_code,200,r.text if r.status_code!=200 else '')
            self.assertEqual(r.headers['cache-control'],'no-store')
            self.assertEqual(r.headers['content-type'],'application/zip')
            payload=decrypt_recovery_archive(r.content,PASSWORD)
            self.assertEqual({s['user_id'] for s in payload['sessions']},{OWNER,MEMBER_A})
            self.assertEqual(payload['sessions'][0]['telegram_session'],expected[OWNER])
            self.assertEqual(len(payload['configuration']['workspaces']),3)
            self.assertNotIn('NEVER_EXPORT_ME',json.dumps(payload));self.assertNotIn('synthetic-root',json.dumps(payload))
            for config in payload['configuration']['workspaces']:
                self.assertTrue(config['paused']);self.assertFalse(config['routes'][0]['enabled'])
            for secret in expected.values(): self.assertNotIn(secret.encode(),r.content)
            r=await self.request('POST','/api/admin/recovery/export',json={'challenge_id':cid,'password':PASSWORD})
            self.assertIn(r.status_code,(400,409))

    async def test_changed_consent_fails_before_session_read(self):
        self.choice(OWNER);self.choice(MEMBER_A)
        cid=await self.challenge();ra.rescind_consent(MEMBER_A)
        with patch('app.recovery.snapshot_payload') as snapshot:
            r=await self.request('POST','/api/admin/recovery/export',json={'challenge_id':cid,'password':PASSWORD})
            self.assertEqual(r.status_code,409);snapshot.assert_not_called()

    async def test_errors_never_echo_password_and_bounded_body(self):
        for body in ({'challenge_id':'bad','password':PASSWORD,'extra':PASSWORD},{'challenge_id':'bad','password':{'secret':PASSWORD}}):
            r=await self.request('POST','/api/admin/recovery/export',json=body)
            self.assertEqual(r.status_code,400);self.assertNotIn(PASSWORD,r.text)
        r=await self.request('POST','/api/admin/recovery/export',json={'challenge_id':'bad','password':'x'*5000})
        self.assertEqual(r.status_code,413)

    async def test_bot_confirmation_owner_private_and_replay(self):
        c=ra.create_export_challenge(OWNER,authenticated_at=time.time())
        def update(uid,chat_type='private'):
            return {'callback_query':{'from':{'id':int(uid)},'message':{'chat':{'id':int(uid),'type':chat_type}},'data':'rc_'+c['token']}}
        for item in (update(MEMBER_A),update(OWNER,'group')):
            await handle_bot_update(item,self.runtime)
            self.assertFalse(ra.export_challenge_status(OWNER,c['challenge_id'])['confirmed'])
        r=await handle_bot_update(update(OWNER),self.runtime)
        self.assertIn('confirmed',r['text'])
        r=await handle_bot_update(update(OWNER),self.runtime)
        self.assertIn('unavailable',r['text'])

    async def test_secure_page_has_no_external_script_and_csp(self):
        r=await self.client.get('/recovery')
        self.assertEqual(r.status_code,200)
        self.assertIn("default-src 'none'",r.headers['content-security-policy'])
        self.assertNotIn('<script src=',r.text)
        self.assertEqual(r.headers['cache-control'],'no-store')

    async def test_raw_recovery_template_not_public_asset(self):
        response=await self.client.get('/assets/recovery.html')
        self.assertEqual(response.status_code,404)
