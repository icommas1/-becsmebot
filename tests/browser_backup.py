"""Offline source and actual hosted-bundle backup flows. All network is mocked."""
import argparse
import base64
import io
import json
import mimetypes
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import backup
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
APP = 'https://app.example.test'
API = 'https://api.example.test'
SIGNED = 'SYNTHETIC_BACKUP_BROWSER_SIGNATURE'
OWNER = {'telegram_id': '1001', 'role': 'admin', 'status': 'approved', 'display_name': 'Owner'}
OVERVIEW = {'stats': dict.fromkeys(['routes','enabled_routes','forwarded','queued','failed','duplicates','contracts','reviews'],0), 'activity': [], 'graph':[0]*12,'cooldown_seconds':0,'paused':False,'telegram':{'authorized':True,'configured':True},'ai_configured':False,'bot_configured':True}


def main():
    parser = argparse.ArgumentParser();parser.add_argument('--dist', type=Path);args = parser.parse_args()
    synthetic = {'members':[{'telegram_id':'1001','status':'approved'}], 'workspaces':{'1001':{'routes':[], 'settings':{'paused':False}}}}
    with patch('app.backup.snapshot', return_value=synthetic): envelope = backup.export_backup()
    raw = base64.b64decode(envelope['content_base64'])
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get('BECS_CHROMIUM_EXECUTABLE') or None)
        for width in (390, 1440):
            context = browser.new_context(viewport={'width':width,'height':900}, service_workers='block', accept_downloads=True)
            context.add_init_script("""window.Telegram={WebApp:{initData:'SYNTHETIC_BACKUP_BROWSER_SIGNATURE',ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};window.shared=[];window.revoked=[];const oldRevoke=URL.revokeObjectURL;URL.revokeObjectURL=(url)=>{window.revoked.push(url);oldRevoke(url)};Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>false});Object.defineProperty(navigator,'share',{configurable:true,value:async ({files})=>{window.shared.push({name:files[0].name,bytes:Array.from(new Uint8Array(await files[0].arrayBuffer()))})}});""")
            state = {'member':False,'reject':False,'checksum':envelope['configuration_checksum'],'exports':0,'hold':False,'pending':None,'bad':False,'export_error':False}
            calls=[];errors=[];downloads=[]
            def respond(route):
                req=route.request;url=urlsplit(req.url);origin=f'{url.scheme}://{url.netloc}';path=url.path
                if path.startswith('/api/'):
                    assert origin==(API if args.dist else APP), req.url
                    cors={'Access-Control-Allow-Origin':APP,'Access-Control-Allow-Headers':'X-Telegram-Init-Data, Content-Type','Access-Control-Allow-Methods':'GET, OPTIONS'}
                    if req.method=='OPTIONS':route.fulfill(status=204,headers=cors);return
                    assert req.headers.get('x-telegram-init-data')==SIGNED
                    assert 'x-becs-key' not in req.headers
                    calls.append(path);status=200
                    if state['reject']:status=401;data={'detail':'Telegram launch expired'}
                    elif path=='/api/me':data={'user':{**OWNER,**({'telegram_id':'2002','role':'member'} if state['member'] else {})},'is_admin':not state['member'],'capacity':3}
                    elif path=='/api/recovery/consent':data={'required':False,'choice':'no','scope_version':'1','administrator':{'user_id':'1001','display_name':'Owner'}}
                    elif path=='/api/overview':data=OVERVIEW
                    elif path in ('/api/routes','/api/jobs','/api/reviews','/api/inspector'):data={path.rsplit('/',1)[1] if path!='/api/inspector' else 'items':[]}
                    elif path=='/api/admin/backups/status':data={'configuration_checksum':state['checksum'],'workspace_count':1,'schema_version':1}
                    elif path=='/api/admin/backups/export':
                        state['exports']+=1
                        if state['hold']:state['pending']=(route,cors);return
                        data={**envelope,'content_base64':'not-base64!'} if state['bad'] else envelope
                        if state['export_error']:status=409;data={'detail':'Backup unavailable; retry'}
                    elif path=='/api/admin/status':data={'components':{'api':'ok','sqlite':'ok','worker':'ok'},'telegram':{'authorized':True},'counts':dict.fromkeys(['active_routes','queued','sending','failed'],0),'cooldown_seconds':0,'uptime_seconds':1}
                    else:raise AssertionError(path)
                    route.fulfill(status=status,headers=cors,content_type='application/json',body=json.dumps(data));return
                if origin!=APP:route.abort();return
                root=args.dist.resolve() if args.dist else ROOT/'static'
                relative='index.html' if path=='/' else path.lstrip('/') if args.dist else path.removeprefix('/assets/')
                file=(root/relative).resolve()
                if not file.is_relative_to(root.resolve()) or not file.is_file():route.fulfill(status=404);return
                route.fulfill(content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream',body=file.read_bytes())
            context.route('**/*',respond)
            page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)));page.on('download',lambda download:downloads.append(download))
            page.goto(APP);expect(page.locator('h1')).to_have_text('Command Center')
            page.locator('[data-nav="more"]:visible').click();expect(page.locator('#mainView')).to_contain_text('administrator can export')
            page.locator('[data-action="open-backups"]').click();expect(page.locator('h1')).to_have_text('Backups')
            assert not downloads and state['exports']==0
            page.locator('[data-action="backup-prepare"]').click();expect(page.locator('[data-action="backup-save"]')).to_be_visible()
            assert not downloads
            expect(page.locator('#mainView')).not_to_contain_text('over a week old')
            with page.expect_download() as event:page.locator('[data-action="backup-save"]').click()
            download=event.value;assert Path(download.path()).read_bytes()==raw
            assert backup.validate_backup(Path(download.path()).read_bytes())['valid']
            assert download.suggested_filename==envelope['filename']
            page.evaluate("Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true})")
            page.locator('[data-action="backup-save"]').click();page.wait_for_function('window.shared.length===1')
            assert bytes(page.evaluate('window.shared[0].bytes'))==raw
            state['checksum']='changed';page.locator('[data-action="backup-refresh"]').click();expect(page.locator('#mainView')).to_contain_text('Configuration changed')
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            out=ROOT/'preview/backups';out.mkdir(parents=True,exist_ok=True);page.screenshot(path=str(out/f'{"hosted" if args.dist else "source"}-{width}.png'),full_page=True)
            # Canceling a native share never claims that a copy was saved.
            page.evaluate("Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{throw new DOMException('Cancelled','AbortError')}})")
            page.locator('[data-action="backup-save"]').click()
            expect(page.locator('[data-action="backup-save"]')).to_be_visible()
            # Server errors and malformed payloads clear the old file and permit retry.
            state['export_error']=True;page.locator('[data-action="backup-prepare"]').click()
            expect(page.locator('[role="alert"]')).to_contain_text('Backup unavailable')
            expect(page.locator('[data-action="backup-save"]')).to_have_count(0)
            state['export_error']=False;state['bad']=True;page.locator('[data-action="backup-prepare"]').click()
            expect(page.locator('[role="alert"]')).to_be_visible()
            expect(page.locator('[data-action="backup-save"]')).to_have_count(0)
            state['bad']=False;page.locator('[data-action="backup-prepare"]').click()
            expect(page.locator('[data-action="backup-save"]')).to_be_visible()
            # An expired authorization clears the prepared file, including old blob URLs.
            state['reject']=True;page.locator('[data-action="backup-refresh"]').click();expect(page.locator('[data-action="backup-save"]')).to_have_count(0)
            assert page.evaluate('window.revoked.length')>=1
            state['reject']=False;page.reload();expect(page.locator('h1')).to_have_text('Command Center')
            page.locator('[data-nav="more"]:visible').click();page.locator('[data-action="open-backups"]').click()
            state['hold']=True
            before_exports=state['exports'];page.locator('[data-action="backup-prepare"]').click()
            expect(page.locator('[data-action="backup-prepare"]')).to_be_disabled()
            page.locator('[data-action="backup-prepare"]').dispatch_event('click')
            page.wait_for_timeout(100)
            assert state['exports']==before_exports+1 and state['pending'] is not None
            # Change authenticated account while the old owner's export is still in flight.
            state['member']=True;page.locator('#refreshBtn').click()
            expect(page.locator('[data-action="open-backups"]')).to_have_count(0)
            page.wait_for_timeout(100)
            held,cors=state['pending'];held.fulfill(status=200,headers=cors,content_type='application/json',body=json.dumps(envelope))
            page.wait_for_timeout(100)
            expect(page.locator('[data-action="backup-save"]')).to_have_count(0)
            state['hold']=False
            state['reject']=False;state['member']=True;page.reload();expect(page.locator('h1')).to_have_text('Command Center');page.locator('[data-nav="more"]:visible').click()
            expect(page.locator('[data-action="open-backups"]')).to_have_count(0);expect(page.locator('#mainView')).to_contain_text('administrator can export')
            assert not errors,errors
            assert page.evaluate('localStorage.length')==0
            context.close()
        browser.close()
    print('Backup source/hosted browser checks passed')


if __name__=='__main__':main()
