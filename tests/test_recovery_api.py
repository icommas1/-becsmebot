"""Regression: disabled sensitive recovery cannot read secrets or record consent."""
import time
import unittest
from unittest.mock import patch
from app import access, db, recovery_access as ra
from app.telegram_client import handle_bot_update
import test_workspace_api as fixtures
from test_workspace_api import OWNER,MEMBER_A,UNKNOWN

class RecoveryDisabledTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp=fixtures.WorkspaceAPIRegression.asyncSetUp
    initialize_workspace=fixtures.WorkspaceAPIRegression.initialize_workspace
    add_user=fixtures.WorkspaceAPIRegression.add_user
    request=fixtures.WorkspaceAPIRegression.request
    seed_workspace=fixtures.WorkspaceAPIRegression.seed_workspace

    async def test_sensitive_routes_disabled_all_identities(self):
        operations=[('GET','/recovery'),('POST','/api/recovery/consent'),('POST','/api/recovery/rescind'),('POST','/api/admin/recovery/challenge'),('GET','/api/admin/recovery/challenge/old'),('POST','/api/admin/recovery/challenge/old/cancel'),('POST','/api/admin/recovery/export')]
        with patch('app.recovery.snapshot_payload') as snapshot,patch('app.recovery.send_confirmation') as send:
            for user in (OWNER,MEMBER_A,UNKNOWN,None):
                for method,path in operations:
                    r=await self.request(method,path,user)
                    self.assertEqual(r.status_code,410,(user,path,r.text))
                    self.assertEqual(r.json()['reason'],'recovery_disabled')
                    self.assertEqual(r.headers['cache-control'],'no-store')
            snapshot.assert_not_called();send.assert_not_called()

    async def test_cached_ui_can_proceed_no_consent_table_created(self):
        for uid in (OWNER,MEMBER_A):
            r=await self.request('GET','/api/recovery/consent',uid)
            self.assertEqual(r.status_code,200,r.text)
            self.assertFalse(r.json()['required']);self.assertFalse(r.json()['enabled'])
            self.assertEqual((await self.request('GET','/api/routes',uid)).status_code,200)
        with access._registry() as conn:
            self.assertIsNone(conn.execute("SELECT name FROM sqlite_master WHERE name='recovery_consents'").fetchone())

    async def test_stored_consent_and_challenge_preserved_but_unusable(self):
        ra.record_consent(OWNER,True,expected_scope_version='1',expected_admin_id=OWNER)
        c=ra.create_export_challenge(OWNER,authenticated_at=time.time())
        with access._registry() as conn:before=[tuple(r) for r in conn.execute('SELECT * FROM recovery_consents')]
        for item in ({'message':{'from':{'id':int(OWNER)},'chat':{'id':int(OWNER),'type':'private'},'text':'/start recovery'}},{'callback_query':{'from':{'id':int(OWNER)},'message':{'chat':{'id':int(OWNER),'type':'private'}},'data':'rc_'+c['token']}}):
            response=await handle_bot_update(item,self.runtime)
            self.assertEqual(response['text'],'Rollback Recovery is disabled.')
            self.assertNotIn('reply_markup',response)
        self.assertFalse(ra.export_challenge_status(OWNER,c['challenge_id'])['confirmed'])
        with access._registry() as conn:self.assertEqual(before,[tuple(r) for r in conn.execute('SELECT * FROM recovery_consents')])
        r=await self.request('POST','/api/admin/recovery/export',json={'challenge_id':c['challenge_id'],'password':'synthetic only password'})
        self.assertEqual(r.status_code,410)

    async def test_configuration_backup_still_available_and_ui_removed(self):
        from pathlib import Path
        r=await self.request('GET','/api/admin/backups/export')
        self.assertEqual(r.status_code,200,r.text)
        script=(Path(__file__).resolve().parents[1]/'static/app.js').read_text()
        self.assertNotIn('/recovery/consent',script)
        self.assertNotIn('start=recovery',script)
        self.assertNotIn('Rollback Recovery',script)
        self.assertIn('Export Backup',script)
        self.assertEqual((await self.client.get('/assets/recovery.html')).status_code,404)
