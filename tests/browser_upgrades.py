"""Real UI workflows with intercepted APIs and synthetic identities only."""
import argparse
import io
import json
import mimetypes
from pathlib import Path
from urllib.parse import urlsplit
import zipfile

from playwright.sync_api import expect, sync_playwright

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--script',type=Path)
args=parser.parse_args()
SOURCE={'id':'-1000000000101','title':'Synthetic source','kind':'channel','username':'@synthetic_source','is_bot':False}
DEST={'id':'900123','title':'Synthetic destination','kind':'bot','username':'@example_test_bot','is_bot':True}


def exercise(browser,width,height):
    routes=[{'id':1,'name':'Existing Express route','mode':'express','enabled':True,'shadow_mode':False,
             'sources':[SOURCE['id']],'destinations':[DEST['id']],'allowed':'','blocked':'','pattern':'',
             'match_mode':'any','network':'both','require_contract':True,'dedup_minutes':60,
             'delivery_style':'text','created_at':1,'updated_at':1}]
    presets=[]
    writes=[]
    errors=[]
    unexpected=[]
    gate={'status':'approved'}
    context=browser.new_context(viewport={'width':width,'height':height},is_mobile=width<600,
                                has_touch=width<600,service_workers='block')
    context.add_init_script("window.Telegram={WebApp:{initData:'SYNTHETIC_INTERCEPTED_LAUNCH',ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};")
    def respond(route):
        request=route.request
        url=urlsplit(request.url)
        path,method=url.path,request.method
        if path.startswith('/api/'):
            if method!='GET':writes.append((method,path))
            if path=='/api/me':
                data={'user':{'telegram_id':'123456','status':gate['status'],'role':'admin'},'is_admin':True,'capacity':3}
            elif path=='/api/overview':
                stats=dict.fromkeys(['routes','enabled_routes','forwarded','queued','failed','duplicates','contracts','reviews'],0)
                stats.update(routes=len(routes),enabled_routes=sum(r['enabled'] for r in routes))
                data={'stats':stats,'activity':[],'graph':[0]*12,'paused':False,'cooldown_seconds':0,
                      'telegram':{'authorized':True,'configured':True,'detail':'Synthetic connected account'},
                      'ai_configured':False,'bot_configured':True,'upgrade_level':7,'upgrade_release':'Mobile polish',
                      'route_health':[{'id':r['id'],'delivered':0,'queued':0,'failed':0,'last_seen':1,
                                       'oldest_queued_seconds':0,'shadow_mode':r['shadow_mode']} for r in routes]}
            elif path=='/api/routes' and method=='GET':data={'routes':routes}
            elif path.startswith('/api/routes/') and method=='PUT':
                index=next(i for i,r in enumerate(routes) if r['id']==int(path.rsplit('/',1)[1]))
                routes[index]={**request.post_data_json,'id':routes[index]['id'],'created_at':1,'updated_at':2}
                data={'route':routes[index]}
            elif path=='/api/telegram/chats':data={'chats':[SOURCE,DEST]}
            elif path=='/api/jobs':data={'jobs':[]}
            elif path=='/api/reviews':data={'reviews':[]}
            elif path=='/api/inspector':data={'items':[]}
            elif path in ('/api/shadow','/api/decisions'):
                data={'items':[{'id':1,'route_name':routes[0]['name'],'source_id':SOURCE['id'],'destination_id':DEST['id'],
                    'message_id':7,'network':'solana','address':'So11111111111111111111111111111111111111112',
                    'decision':'would_forward','reason':'Shadow Mode: would send this address; nothing was queued','shadow':1,'created_at':1}],
                    'scope':'Synthetic address-only observations.','retention_days':7,'maximum_records':5000}
            elif path=='/api/presets' and method=='GET':data={'presets':presets}
            elif path=='/api/presets' and method=='POST':
                presets.append({**request.post_data_json,'id':1})
                data={'id':1}
            elif path.startswith('/api/presets/') and method=='DELETE':
                presets.clear();data={'deleted':True}
            elif path=='/api/sources/comparison':
                data={'scope':'Synthetic observations since installation.','sources':[{'source_id':SOURCE['id'],
                    'unique_addresses':2,'first_observations':1,'repeat_percent':50,'mentions':4,'last_seen':1}]}
            elif path=='/api/admin/backups/status':data={'configuration_checksum':'a'*64,'workspace_count':1,'schema_version':1}
            elif path=='/api/admin/backups/preview':
                data={'valid':True,'route_count':1,'workspace_count':1,'current_checksum':'a'*64,
                    'current_routes':[{'id':1,'name':routes[0]['name']}],
                    'routes':[{'index':0,'name':'Archived route','sources':[SOURCE['id']],'destinations':[DEST['id']],
                               'comparison':'New route name','filters':{}}],
                    'notice':'Selected routes will be added disabled and in Shadow Mode. Existing routes are retained.'}
            elif path=='/api/admin/backups/import':
                assert request.post_data_json['route_indices']==[0]
                routes.append({**routes[0],'id':2,'name':'Archived route','enabled':False,'shadow_mode':True})
                data={'imported':1,'route_ids':[2],'enabled':False,'shadow_mode':True}
            elif path=='/api/admin/status':
                data={'components':{'api':'running','sqlite':'available','worker':'running'},'telegram':{'authorized':True},
                      'bot_configured':True,'paused':False,'counts':dict(active_routes=1,queued=0,sending=0,failed=0),
                      'cooldown_seconds':0,'uptime_seconds':100}
            elif path=='/api/recovery/consent':data={'required':False,'enabled':False}
            else:
                unexpected.append((method,path));route.fulfill(status=500,body='Unexpected mocked endpoint');return
            route.fulfill(status=200,content_type='application/json',body=json.dumps(data));return
        if url.netloc!='becs.test':route.abort();return
        target=ROOT/'static'/('index.html' if path=='/' else path.removeprefix('/assets/'))
        if args.script and path=='/assets/app.js':target=args.script.resolve()
        if not target.is_file():route.fulfill(status=404,body='Missing fixture');return
        route.fulfill(status=200,content_type=mimetypes.guess_type(str(target))[0] or 'text/plain',body=target.read_bytes())
    context.route('**/*',respond)
    page=context.new_page()
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.on('dialog',lambda dialog:dialog.accept())
    page.goto('https://becs.test/')
    page.locator('button[data-nav="routes"]:visible').first.click()
    page.locator('[data-edit="1"]').click()
    expect(page.locator('#routeMode')).to_have_value('express')
    page.locator('#routeShadow').check()
    page.locator('#routeForm button[type="submit"]').click()
    expect(page.locator('#modal')).to_have_class('modal-backdrop hidden')
    assert routes[0]['shadow_mode'] and routes[0]['mode']=='express'
    expect(page.locator('.upgrade-route-health').first).to_contain_text('Shadow Mode')
    page.locator('button[data-nav="queue"]:visible').first.click()
    page.locator('.upgrade-decision summary').first.click()
    expect(page.locator('.upgrade-decision').first).to_contain_text('nothing was queued')
    page.locator('[data-upgrade-action="compare-sources"]').click()
    expect(page.locator('.upgrade-table')).to_contain_text('50%')
    page.locator('#modalClose').click()
    page.locator('button[data-nav="routes"]:visible').first.click()
    page.locator('[data-edit="1"]').click()
    page.locator('[data-filter-mode="both"]').click()
    page.locator('#routeAllow').fill('launch')
    page.locator('#upgradePresetName').fill('Launch rules')
    page.locator('[data-upgrade-action="save-preset"]').click()
    page.locator('#upgradePreset').select_option('1')
    page.locator('#routeAllow').fill('changed')
    page.locator('[data-upgrade-action="apply-preset"]').click()
    expect(page.locator('#routeAllow')).to_have_value('launch')
    expect(page.locator('#routeMode')).to_have_value('express')
    page.locator('[data-upgrade-action="delete-preset"]').click()
    expect(page.locator('#upgradePreset option')).to_have_count(1)
    assert not presets
    page.locator('#modalClose').click()
    page.locator('button[data-nav="more"]:visible').first.click()
    page.locator('[data-action="open-backups"]').click()
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w') as archive:archive.writestr('synthetic.txt','Interception fixture; backend archive validation has separate tests.')
    page.locator('#upgradeBackupFile').set_input_files({'name':'synthetic.zip','mimeType':'application/zip','buffer':output.getvalue()})
    expect(page.locator('#upgradeBackupPreview')).to_contain_text('Selected routes will be added',timeout=8000)
    page.locator('[data-upgrade-import-index="0"]').check()
    page.locator('[data-upgrade-action="import-backup"]').click()
    expect(page.locator('#upgradeBackupPreview')).to_contain_text('Previewing does not change routes')
    assert len(routes)==2 and routes[0]['enabled'] and not routes[1]['enabled'] and routes[1]['shadow_mode']
    page.locator('button[data-nav="filters"]:visible').first.click()
    page.locator('#labAllow').fill('preserve this draft')
    page.locator('#labNetwork').select_option('evm')
    page.locator('button[data-nav="queue"]:visible').first.click()
    page.locator('button[data-nav="filters"]:visible').first.click()
    expect(page.locator('#labAllow')).to_have_value('preserve this draft')
    expect(page.locator('#labNetwork')).to_have_value('evm')
    gate['status']='pending'
    page.locator('#refreshBtn').click()
    expect(page.locator('.access-card')).to_be_visible()
    assert page.locator('[data-upgrade-action]').count()==0
    assert not errors,errors
    assert not unexpected,unexpected
    assert all(path!='/api/control/resume' for _,path in writes)
    context.close()


with sync_playwright() as p:
    browser=p.chromium.launch()
    for viewport in [(390,844),(1280,800)]:exercise(browser,*viewport)
    browser.close()
print('PASS: shadow, explanations, health, private presets, sources, disabled import, draft preservation and revocation; intercepted APIs only')
