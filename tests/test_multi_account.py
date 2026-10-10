"""Isolation and real application delivery pipeline with a fake Telegram transport."""
import asyncio
import hashlib
import hmac
import json
import logging
import os
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from urllib.parse import urlencode

import httpx
from telethon.sessions import StringSession
from telethon.crypto import AuthKey

from app import db, main
from app.accounts import ACCOUNT_IDS, access_key, account_scope, browser_token, current_account
from app.models import RouteInput
from app.service import delivery_worker, ingest_message
from app.telegram_client import PersonalTelegram

logging.getLogger('httpx').setLevel(logging.WARNING)


class MultiAccountTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.env = patch.dict(os.environ, {
            'BECS_ADMIN_TOKEN':'primary-test-key', 'BECS_SESSION_SECRET':'s'*40,
            'BECS_DEV_AUTH_BYPASS':'false', 'BECS_ALLOWED_TELEGRAM_ID':'101',
            'BECS_ACCOUNT_2_ALLOWED_TELEGRAM_ID':'202', 'BECS_ACCOUNT_3_ALLOWED_TELEGRAM_ID':'303',
            'BECS_ACCOUNT_2_ADMIN_TOKEN':'second-test-key', 'BECS_ACCOUNT_3_ADMIN_TOKEN':'third-test-key',
            'TELEGRAM_BOT_TOKEN':'test-bot-token', 'TELEGRAM_API_ID':'12345', 'TELEGRAM_API_HASH':'test-hash',
            'BECS_SESSION_DIR':str(Path(self.temp.name)/'sessions'),
        })
        self.env.start(); self.addCleanup(self.env.stop)
        self.db_patch = patch.object(db, 'DB_PATH', Path(self.temp.name)/'legacy.sqlite')
        self.db_patch.start(); self.addCleanup(self.db_patch.stop)
        self.managers = {}
        self.clients = {}
        for index, account in enumerate(ACCOUNT_IDS, 1):
            with account_scope(account): db.init_db()
            manager = PersonalTelegram(account)
            manager._identity_verified = True
            client = SimpleNamespace(
                is_user_authorized=AsyncMock(return_value=True),
                send_message=AsyncMock(return_value=SimpleNamespace(id=index*1000+1)),
                forward_messages=AsyncMock(return_value=SimpleNamespace(id=index*1000+2)))
            manager.ensure_client = AsyncMock(return_value=client)
            manager.status = AsyncMock(return_value={'authorized':True,'connected':True,'configured':True})
            manager.resolve_chat = AsyncMock(side_effect=self.resolve)
            manager.chats = AsyncMock(return_value=[{'id':str(index),'title':account}])
            self.managers[account] = manager; self.clients[account] = client
        self.mp = patch.dict(main.managers, self.managers)
        self.mp.start(); self.addCleanup(self.mp.stop)
        self.api = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app, client=('remote', 123)), base_url='https://becs.test')
        self.addAsyncCleanup(self.api.aclose)

    async def resolve(self, ref, role):
        await asyncio.sleep(0)
        return {'id':ref,'role':role,'validated':True}

    async def request(self, account, path, method='GET', token=None, **kwargs):
        return await self.api.request(method, '/api/accounts/'+account+path,
                                      headers={'X-Becs-Key':token or access_key(account)}, **kwargs)

    def seed(self, account, name=None, mode='smart', style='text'):
        with account_scope(account), db.connection() as conn:
            return main.save_route(conn, RouteInput(name=name or account, enabled=True, sources=['-1001'],
                destinations=['999'], mode=mode, delivery_style=style))

    def rows(self, account, table='jobs'):
        assert table in ('jobs','routes','reviews','events','contracts')
        with account_scope(account), db.connection() as conn:
            return [dict(row) for row in conn.execute('SELECT * FROM '+table)]

    async def run_workers_until(self, predicate, timeout=2):
        stop=asyncio.Event()
        tasks=[asyncio.create_task(delivery_worker(m,stop)) for m in self.managers.values()]
        try:
            async with asyncio.timeout(timeout):
                while not predicate(): await asyncio.sleep(0.01)
        finally:
            stop.set()
            for task in tasks: task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

    async def test_each_key_is_rejected_by_every_other_account_and_legacy_api(self):
        for owner in ACCOUNT_IDS:
            for target in ACCOUNT_IDS:
                for suffix in ('/routes','/jobs','/reviews','/inspector','/telegram/chats'):
                    response=await self.request(target,suffix,token=access_key(owner))
                    self.assertEqual(response.status_code,200 if target==owner else 401)
                    self.assertEqual(response.headers['cache-control'],'no-store')
        response=await self.api.get('/api/routes',headers={'X-Becs-Key':access_key('account-2')})
        self.assertEqual(response.status_code,401)

    async def test_host_header_cannot_bypass_auth_and_unknown_slot_rejected(self):
        response=await self.api.get('/api/routes',headers={'Host':'localhost'})
        self.assertEqual(response.status_code,401)
        response=await self.request('account-99','/routes',token=access_key('primary'))
        self.assertEqual(response.status_code,404)
        response=await self.request('account-2','/accounts/primary/routes')
        self.assertEqual(response.status_code,404)

    async def test_concurrent_api_writes_reads_and_chat_clients_remain_isolated(self):
        async def work(account):
            payload=RouteInput(name=account, sources=['-1001'], destinations=['999']).model_dump()
            response=await self.request(account,'/routes',method='POST',json=payload)
            self.assertEqual(response.status_code,200)
            routes=(await self.request(account,'/routes')).json()['routes']
            self.assertEqual([r['name'] for r in routes],[account])
            chats=(await self.request(account,'/telegram/chats')).json()['chats']
            self.assertEqual(chats[0]['title'],account)
        await asyncio.gather(*(work(account) for account in ACCOUNT_IDS))
        self.assertEqual(current_account.get(),'primary')
        self.seed('primary','primary extra')
        response=await self.request('account-2','/routes/2',method='DELETE')
        self.assertEqual(response.status_code,404)
        self.assertEqual(len(self.rows('primary','routes')),2)

    async def test_account_pause_jobs_reviews_inspector_and_stats_do_not_leak(self):
        for account in ACCOUNT_IDS: self.seed(account,mode='ai-gated')
        with patch('app.service.evaluate_text',AsyncMock(return_value={'status':'unavailable','reason':'test hold'})):
            await ingest_message('-1001',7,'0x'+'a'*40,self.managers['primary'])
        primary=(await self.request('primary','/reviews')).json()['reviews']
        self.assertEqual(len(primary),1)
        for account in ACCOUNT_IDS[1:]:
            self.assertEqual((await self.request(account,'/reviews')).json()['reviews'],[])
            self.assertEqual((await self.request(account,'/inspector')).json()['items'],[])
            self.assertEqual((await self.request(account,'/overview')).json()['stats']['contracts'],0)
            self.assertEqual((await self.request(account,'/reviews/1',method='POST',json={'approve':True})).status_code,404)
            self.assertEqual((await self.request(account,'/jobs/1/retry',method='POST')).status_code,404)
        await self.request('account-2','/control/pause',method='POST')
        self.assertFalse((await self.request('primary','/overview')).json()['paused'])
        self.assertTrue((await self.request('account-2','/overview')).json()['paused'])

    async def test_full_ingest_filter_dedupe_queue_adapter_receipt_for_three_accounts(self):
        for account in ACCOUNT_IDS: self.seed(account, style='native' if account=='account-3' else 'text')
        text='same contract 0x'+'a'*40
        # Enter with the WRONG ambient context deliberately. Manager ownership must win.
        with account_scope('account-3'):
            await asyncio.gather(*(ingest_message('-1001',77,text,m) for m in self.managers.values()))
            await asyncio.gather(*(ingest_message('-1001',78,text,m) for m in self.managers.values()))
            await self.run_workers_until(lambda: all(self.rows(a)[0]['status']=='sent' for a in ACCOUNT_IDS))
        for index,account in enumerate(ACCOUNT_IDS,1):
            jobs=self.rows(account)
            self.assertEqual(len(jobs),1)
            self.assertEqual(jobs[0]['telegram_message_id'], index*1000+(2 if account=='account-3' else 1))
            self.assertEqual(sum(e['kind']=='duplicate' for e in self.rows(account,'events')),1)
            client=self.clients[account]
            if account=='account-3':
                client.forward_messages.assert_awaited_once_with(999,77,from_peer=-1001)
                client.send_message.assert_not_awaited()
            else:
                client.send_message.assert_awaited_once_with(999,text,link_preview=False,parse_mode=None)
                client.forward_messages.assert_not_awaited()

    async def test_flood_wait_of_one_account_does_not_stop_others(self):
        class FloodWaitError(Exception): seconds=60
        for account in ACCOUNT_IDS:
            self.seed(account)
            await ingest_message('-1001',8,account,self.managers[account])
        self.clients['primary'].send_message.side_effect=FloodWaitError()
        await self.run_workers_until(lambda: self.rows('primary')[0]['attempts']==1 and all(self.rows(a)[0]['status']=='sent' for a in ACCOUNT_IDS[1:]))
        with account_scope('primary'): self.assertGreater(float(db.get_setting('account_cooldown_until')),time.time())
        for account in ACCOUNT_IDS[1:]:
            with account_scope(account): self.assertEqual(db.get_setting('account_cooldown_until'),'')
        self.assertEqual(self.rows('primary')[0]['status'],'queued')

    async def test_no_delivery_receipt_never_counts_as_sent(self):
        self.seed('account-2')
        self.clients['account-2'].send_message.return_value=None
        await ingest_message('-1001',9,'test receipt',self.managers['account-2'])
        await self.run_workers_until(lambda:self.rows('account-2')[0]['attempts']==1)
        self.assertEqual(self.rows('account-2')[0]['status'],'failed')
        self.assertIsNone(self.rows('account-2')[0]['telegram_message_id'])
        self.assertFalse(any(e['kind']=='forwarded' for e in self.rows('account-2','events')))

    async def test_persistent_tokens_bound_to_account_and_revoked_by_key_rotation(self):
        tokens={}
        for account in ACCOUNT_IDS:
            response=await self.request(account,'/auth/session',method='POST')
            self.assertIsNone(response.json()['expires_at'])
            tokens[account]=response.json()['token']
        self.assertEqual(len(set(tokens.values())),3)
        with patch('time.time',return_value=time.time()+10*365*86400):
            for account in ACCOUNT_IDS:
                self.assertEqual((await self.request(account,'/routes',token=tokens[account])).status_code,200)
                for other in ACCOUNT_IDS:
                    if other!=account:self.assertEqual((await self.request(other,'/routes',token=tokens[account])).status_code,401)
        with patch.dict(os.environ,{'BECS_ACCOUNT_2_ADMIN_TOKEN':'rotated-key'}):
            self.assertEqual((await self.request('account-2','/routes',token=tokens['account-2'])).status_code,401)
            self.assertEqual((await self.request('primary','/routes',token=tokens['primary'])).status_code,200)

    async def test_signed_telegram_identity_is_account_scoped(self):
        data={'auth_date':str(int(time.time())),'user':json.dumps({'id':202})}
        secret=hmac.new(b'WebAppData',b'test-bot-token',hashlib.sha256).digest()
        data['hash']=hmac.new(secret,'\n'.join(f'{k}={v}' for k,v in sorted(data.items())).encode(),hashlib.sha256).hexdigest()
        for account in ACCOUNT_IDS:
            response=await self.api.get('/api/accounts/'+account+'/routes',headers={'X-Telegram-Init-Data':urlencode(data)})
            self.assertEqual(response.status_code,200 if account=='account-2' else 401)

    async def test_invites_owner_only_and_generated_keys_are_distinct(self):
        self.assertEqual((await self.request('account-2','/account-invites')).status_code,403)
        self.assertEqual((await self.request('account-3','/account-invites')).status_code,403)
        response=await self.request('primary','/account-invites')
        self.assertEqual([a['id'] for a in response.json()['accounts']],list(ACCOUNT_IDS[1:]))
        with patch.dict(os.environ,{'BECS_ACCOUNT_2_ADMIN_TOKEN':'','BECS_ACCOUNT_3_ADMIN_TOKEN':''}):
            self.assertEqual(len({access_key(a) for a in ACCOUNT_IDS}),3)
            self.assertEqual(access_key('account-2'),access_key('account-2'))

    async def test_legacy_database_and_restart_recovery_are_preserved(self):
        self.seed('primary','legacy route')
        await ingest_message('-1001',1,'old job',self.managers['primary'])
        with account_scope('primary'),db.connection() as conn:
            conn.execute("UPDATE jobs SET status='sending'")
        for account in ACCOUNT_IDS:
            with account_scope(account):db.init_db()
        self.assertEqual(self.rows('primary','routes')[0]['name'],'legacy route')
        self.assertEqual(self.rows('primary')[0]['status'],'failed')
        self.assertEqual(self.rows('account-2'),[])
        self.assertTrue((Path(self.temp.name)/'legacy.sqlite').exists())
        self.assertTrue((Path(self.temp.name)/'accounts/account-2/legacy.sqlite').exists())

    async def test_identity_binding_and_duplicate_account_rejected(self):
        m=PersonalTelegram('account-2')
        fake=SimpleNamespace(get_me=AsyncMock(return_value=SimpleNamespace(id=202,bot=False)))
        await m.verify_identity(fake)
        with account_scope('account-2'):self.assertEqual(db.get_setting('telegram_user_id'),'202')
        with patch.dict(os.environ,{'BECS_ACCOUNT_3_ALLOWED_TELEGRAM_ID':''}):
            with self.assertRaisesRegex(RuntimeError,'another slot'):
                await PersonalTelegram('account-3').verify_identity(fake)
        with patch.dict(os.environ,{'BECS_ACCOUNT_2_ALLOWED_TELEGRAM_ID':''}):
            fake.get_me.return_value=SimpleNamespace(id=404,bot=False)
            with self.assertRaisesRegex(RuntimeError,'different Telegram user'):
                await m.verify_identity(fake)

    async def test_encrypted_sessions_restore_independently_and_wrong_slot_cannot_decrypt(self):
        created=[]
        identities=iter([101,202,303,101,202,303])
        def factory(session,*args,**kwargs):
            identity=next(identities)
            if not session.auth_key:
                session.set_dc(2,'149.154.167.50',443)
                session.auth_key=AuthKey(bytes([identity%256])*256)
            client=SimpleNamespace(session=session, connect=AsyncMock(), disconnect=AsyncMock(),
                is_user_authorized=AsyncMock(return_value=True),get_me=AsyncMock(return_value=SimpleNamespace(id=identity,bot=False)),
                on=lambda event:lambda handler:handler)
            created.append(client)
            return client
        originals=[]
        with patch('telethon.TelegramClient',side_effect=factory):
            for account in ACCOUNT_IDS:
                manager=PersonalTelegram(account)
                # Concurrent construction must create one client only.
                a,b=await asyncio.gather(manager.ensure_client(),manager.ensure_client())
                self.assertIs(a,b)
                manager.persist_session();originals.append(manager)
            self.assertEqual(len(created),3)
            self.assertEqual(originals[0].session_path.name,'personal.session.enc')
            self.assertEqual(len({m.session_path for m in originals}),3)
            for index, account in enumerate(ACCOUNT_IDS):
                restored=PersonalTelegram(account)
                client=await restored.ensure_client()
                self.assertEqual(client.session.save(),originals[index].client.session.save())
            originals[2].session_path.write_bytes(originals[1].session_path.read_bytes())
            with self.assertRaisesRegex(RuntimeError,'cannot be decrypted'):
                await PersonalTelegram('account-3').ensure_client()

    async def test_login_challenges_and_disconnect_are_independent(self):
        one=PersonalTelegram('primary');two=PersonalTelegram('account-2')
        one.client=SimpleNamespace(session=SimpleNamespace(save=lambda:''),disconnect=AsyncMock())
        two.client=SimpleNamespace(session=SimpleNamespace(save=lambda:''),disconnect=AsyncMock())
        one.phone='+11111111';two.phone='+22222222';two._password_pending=True
        await one.disconnect()
        self.assertIsNone(one.phone)
        self.assertEqual(two.phone,'+22222222')
        self.assertTrue(two._password_pending)
        two.client.disconnect.assert_not_awaited()
        with self.assertRaisesRegex(RuntimeError,'code challenge'):
            await one.sign_in_password('not-a-real-password')

    async def test_unverified_identity_cannot_forward_during_login(self):
        manager=self.managers['account-2']
        manager._identity_verified=False
        with self.assertRaisesRegex(RuntimeError,'sign-in required'):
            await manager.send({'source_id':'-1001','destination_id':'999','message_id':1,'message_preview':'test'},'text')
        self.clients['account-2'].send_message.assert_not_awaited()

    async def test_control_bot_dispatches_only_to_matching_private_account(self):
        from app.telegram_client import telegram_bot_poll
        stop=asyncio.Event()
        updates=[]
        for number,identity,kind in ((1,202,'private'),(2,101,'group'),(3,999,'private')):
            updates.append({'update_id':number,'message':{'from':{'id':identity},'chat':{'id':identity,'type':kind},'text':'/pause'}})
        async def get(*args,**kwargs):
            stop.set()
            return SimpleNamespace(json=lambda:{'ok':True,'result':updates})
        client=SimpleNamespace(get=get,post=AsyncMock())
        context=AsyncMock();context.__aenter__.return_value=client
        with patch('app.telegram_client.httpx.AsyncClient',return_value=context), account_scope('account-3'):
            await telegram_bot_poll(self.managers,stop)
        for account in ACCOUNT_IDS:
            with account_scope(account):self.assertEqual(db.get_setting('paused'),'true' if account=='account-2' else 'false')
        client.post.assert_awaited_once()
        self.assertEqual(client.post.call_args.kwargs['json']['chat_id'],202)

    async def test_duplicate_configured_credentials_fail_before_workers_start(self):
        with patch.dict(os.environ,{'BECS_ACCOUNT_2_ADMIN_TOKEN':'primary-test-key'}):
            with self.assertRaisesRegex(RuntimeError,'must be unique'):
                async with main.lifespan(main.app):pass
        for manager in self.managers.values():manager.ensure_client.assert_not_awaited()


if __name__=='__main__': unittest.main()
