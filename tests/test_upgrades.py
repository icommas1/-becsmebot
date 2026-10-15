"""Offline upgrade regressions. Synthetic identities, stores and delivery only."""
import asyncio
import hashlib
import json
import time
import unittest
from unittest.mock import patch

from app import db, engine, service, upgrade_store
from app.models import RouteInput
from test_workspace_api import WorkspaceAPIRegression, OWNER, MEMBER_A

SOL='So11111111111111111111111111111111111111112'


class UpgradeAPIRegression(unittest.IsolatedAsyncioTestCase):
    asyncSetUp=WorkspaceAPIRegression.asyncSetUp
    initialize_workspace=WorkspaceAPIRegression.initialize_workspace
    add_user=WorkspaceAPIRegression.add_user
    request=WorkspaceAPIRegression.request
    seed_workspace=WorkspaceAPIRegression.seed_workspace

    async def asyncSetUp(self):
        await WorkspaceAPIRegression.asyncSetUp(self)
        setting=patch.object(upgrade_store,'RELEASE_LEVEL',7)
        setting.start()
        self.addCleanup(setting.stop)

    async def route(self,**changes):
        payload={'name':'Synthetic route','mode':'smart','enabled':True,
                 'sources':['-1001'],'destinations':['-1002'],**changes}
        response=await self.request('POST','/api/routes',json=payload)
        self.assertEqual(response.status_code,200,response.text)
        return response.json()['route']

    async def ingest(self,text,source='-1001',message_id=1,user=OWNER):
        with db.workspace(user):
            await service.ingest_message(source,message_id,text,None)

    def rows(self,table,user=OWNER):
        with db.workspace(user),db.connection() as con:
            return [dict(row) for row in con.execute('SELECT * FROM '+table)]

    async def test_shadow_records_without_jobs_or_live_dedupe(self):
        route=await self.route(shadow_mode=True)
        await self.ingest('Private message words '+SOL)
        await self.ingest('Different private words '+SOL,message_id=2)
        self.assertEqual(self.rows('jobs'),[])
        response=await self.request('GET','/api/shadow')
        self.assertEqual([row['decision'] for row in response.json()['items']],['duplicate','would_forward'])
        self.assertNotIn('Private message words',json.dumps(self.rows('route_decisions')))
        response=await self.request('PUT','/api/routes/'+str(route['id']),json={**route,'shadow_mode':False})
        self.assertEqual(response.status_code,200)
        await self.ingest(SOL,message_id=3)
        self.assertEqual(len(self.rows('jobs')),1)

    async def test_switch_to_shadow_holds_existing_queue_and_blocks_retry(self):
        route=await self.route()
        await self.ingest(SOL)
        response=await self.request('PUT','/api/routes/'+str(route['id']),json={**route,'shadow_mode':True})
        self.assertEqual(response.status_code,200)
        job=self.rows('jobs')[0]
        self.assertEqual(job['status'],'failed')
        response=await self.request('POST',f"/api/jobs/{job['id']}/retry")
        self.assertEqual(response.status_code,409)

    async def test_shadow_transition_rejects_in_flight_send(self):
        route=await self.route()
        await self.ingest(SOL)
        with db.workspace(OWNER),db.connection() as con:
            con.execute("UPDATE jobs SET status='sending'")
        response=await self.request('PUT','/api/routes/'+str(route['id']),json={**route,'shadow_mode':True})
        self.assertEqual(response.status_code,409)

    async def test_solana_case_is_preserved_and_evm_case_is_normalized(self):
        await self.route()
        first,second='A'*43,'a'+'A'*42
        self.assertTrue(engine.is_base58_32(first) and engine.is_base58_32(second))
        self.assertEqual(len(engine.extract_addresses(first+' '+second)),2)
        await self.ingest(first)
        await self.ingest(second,message_id=2)
        await self.ingest(first,message_id=3)
        self.assertEqual(len(self.rows('jobs')),2)
        a='0x'+'a'*40
        self.assertEqual(engine.dedup_fingerprint(a,{'addresses':[{'network':'evm','address':a}]}),
                         engine.dedup_fingerprint(a,{'addresses':[{'network':'evm','address':'0x'+'A'*40}]}))

    async def test_legacy_fingerprint_keeps_existing_cooldown(self):
        route=await self.route()
        await self.ingest(SOL)
        with db.workspace(OWNER),db.connection() as con:
            legacy=hashlib.sha256(('solana:'+SOL.lower()).encode()).hexdigest()
            con.execute("UPDATE jobs SET fingerprint=?,address_key='',address_network=''",(legacy,))
        await self.ingest(SOL,message_id=2)
        self.assertEqual(len(self.rows('jobs')),1)

    async def test_simulation_matches_live_address_and_filter_rules(self):
        route=await self.route(mode='express',allowed='re:launch|🚀')
        for index,(text,expected) in enumerate([('launch without an address','block'),
                                               ('unmatched '+SOL,'block'),('🚀 '+SOL,'forward')]):
            response=await self.request('POST','/api/simulate',json={'route':route,'text':text})
            self.assertEqual(response.json()['decision'],expected)
            await self.ingest(text,message_id=index+1)
        self.assertEqual(len(self.rows('jobs')),1)
        self.assertEqual(self.rows('jobs')[0]['message_preview'],SOL)

    async def test_interrupted_sending_is_failed_without_replaying(self):
        await self.route()
        await self.ingest(SOL)
        with db.workspace(OWNER),db.connection() as con:
            con.execute("UPDATE jobs SET status='sending'")
        sent=[]
        class Manager:
            user_id=OWNER
            async def status(self):return {'authorized':False}
            async def send(self,*args):sent.append(args)
        stop=asyncio.Event()
        task=asyncio.create_task(service.delivery_worker(Manager(),stop,user_id=OWNER))
        await asyncio.sleep(0.01)
        task.cancel()
        await asyncio.gather(task,return_exceptions=True)
        self.assertFalse(sent)
        job=self.rows('jobs')[0]
        self.assertEqual(job['status'],'failed')
        self.assertIn('unknown after restart',job['error'])

    async def test_feature_levels_and_workspace_isolation(self):
        await self.route(shadow_mode=True)
        await self.ingest(SOL)
        response=await self.request('GET','/api/decisions',user_id=MEMBER_A)
        self.assertEqual(response.json()['items'],[])
        with patch.object(upgrade_store,'RELEASE_LEVEL',1):
            for path in ['/api/decisions','/api/presets','/api/sources/comparison']:
                self.assertEqual((await self.request('GET',path)).status_code,404)
            self.assertEqual((await self.request('GET','/api/shadow')).status_code,200)
        self.assertEqual((await self.request('GET','/api/shadow',user_id=None)).status_code,401)

    async def test_presets_are_filter_only_and_private(self):
        response=await self.request('POST','/api/presets',json={'name':'Launch rules','filters':{'allowed':'launch'}})
        self.assertEqual(response.status_code,201)
        preset_id=response.json()['id']
        self.assertEqual((await self.request('GET','/api/presets',user_id=MEMBER_A)).json()['presets'],[])
        self.assertEqual((await self.request('DELETE',f'/api/presets/{preset_id}',user_id=MEMBER_A)).status_code,404)
        response=await self.request('POST','/api/presets',json={'name':'Unsafe routing','filters':{'destinations':['-1003']}})
        self.assertEqual(response.status_code,422)
        self.assertEqual((await self.request('DELETE',f'/api/presets/{preset_id}')).status_code,200)

    async def test_health_and_source_comparison_are_observation_scoped(self):
        await self.route(sources=['-1001','-1003'])
        await self.ingest(SOL)
        await self.ingest(SOL,message_id=2)
        await self.ingest(SOL,source='-1003',message_id=3)
        overview=(await self.request('GET','/api/overview')).json()
        self.assertEqual(overview['route_health'][0]['queued'],1)
        sources=(await self.request('GET','/api/sources/comparison')).json()['sources']
        source=next(row for row in sources if row['source_id']=='-1001')
        self.assertEqual(source['mentions'],2)
        self.assertEqual(source['repeat_percent'],50)
        self.assertEqual((await self.request('GET','/api/sources/comparison',user_id=MEMBER_A)).json()['sources'],[])

    async def test_decision_retention_is_bounded(self):
        route=await self.route(shadow_mode=True)
        with db.workspace(OWNER),db.connection() as con:
            con.executemany('''INSERT INTO route_decisions
                (route_id,source_id,message_id,decision,reason,created_at)
                VALUES (?,'-1001',1,'block','synthetic',?)''',[(route['id'],time.time())]*5005)
            upgrade_store.record_decision(con,route,'-1001',None,1,'block','Synthetic')
            self.assertEqual(con.execute('SELECT COUNT(*) FROM route_decisions').fetchone()[0],5000)

    async def test_backup_preview_and_import_are_disabled_additive_and_owner_only(self):
        await self.route()
        exported=(await self.request('GET','/api/admin/backups/export')).json()
        payload={'content_base64':exported['content_base64']}
        preview=await self.request('POST','/api/admin/backups/preview',json=payload)
        self.assertEqual(preview.status_code,200,preview.text)
        self.assertEqual(preview.json()['route_count'],1)
        self.assertEqual((await self.request('POST','/api/admin/backups/preview',user_id=MEMBER_A,json=payload)).status_code,403)
        imported=await self.request('POST','/api/admin/backups/import',json={**payload,'route_indices':[0],
            'expected_checksum':preview.json()['current_checksum']})
        self.assertEqual(imported.status_code,200,imported.text)
        routes=self.rows('routes')
        self.assertEqual(len(routes),2)
        self.assertEqual(routes[0]['enabled'],1)
        self.assertEqual(routes[1]['enabled'],0)
        self.assertEqual(routes[1]['shadow_mode'],1)
        repeat=await self.request('POST','/api/admin/backups/import',json={**payload,'route_indices':[0],
            'expected_checksum':preview.json()['current_checksum']})
        self.assertEqual(repeat.status_code,409)
        self.assertEqual((await self.request('POST','/api/admin/backups/preview',json={'content_base64':'invalid!'})).status_code,422)
