"""Browser isolation, durable login and account switching; mocked API only."""
import json
import mimetypes
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect, sync_playwright

ROOT=Path(__file__).resolve().parents[1]
TOKENS={'primary':'primary-secret','account-2':'second-secret','account-3':'third-secret'}
errors=[]
requests=[]

def respond(route):
    req=route.request; url=urlsplit(req.url)
    if url.netloc!='becs.test':route.abort();return
    path=url.path
    if path.startswith('/api/'):
        parts=path.split('/',4)
        assert len(parts)==5 and parts[2]=='accounts',path
        account=parts[3];endpoint=parts[4]
        requests.append((account,endpoint))
        if req.headers.get('x-becs-key')!=TOKENS[account]:
            route.fulfill(status=401,content_type='application/json',body=json.dumps({'detail':'Access denied for '+account}));return
        if endpoint=='auth/session':data={'token':TOKENS[account],'expires_at':None,'account_id':account}
        elif endpoint=='overview':
            data={'account_id':account,'stats':dict.fromkeys(['routes','enabled_routes','forwarded','queued','failed','duplicates','contracts','reviews'],0),
                'activity':[],'graph':[0]*12,'cooldown_seconds':0,'paused':False,
                'telegram':{'authorized':False,'configured':True,'connected':False},'bot_configured':False,'ai_configured':False}
        elif endpoint=='routes':data={'routes':[]}
        elif endpoint=='jobs':data={'jobs':[]}
        elif endpoint=='reviews':data={'reviews':[]}
        elif endpoint=='inspector':data={'items':[]}
        else:raise AssertionError(endpoint)
        route.fulfill(status=200,content_type='application/json',body=json.dumps(data));return
    target=ROOT/'static'/('index.html' if path=='/' else path.removeprefix('/assets/'))
    assert target.resolve().is_relative_to((ROOT/'static').resolve())
    route.fulfill(status=200,content_type=mimetypes.guess_type(str(target))[0] or 'text/plain',body=target.read_bytes())

with sync_playwright() as p:
    browser=p.chromium.launch()
    for width in (390,1280):
        context=browser.new_context(viewport={'width':width,'height':844},service_workers='block')
        context.route('**/*',respond)
        page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto('https://becs.test/?account=account-2')
        expect(page.locator('h1')).to_have_text('Becs access required')
        page.locator('#adminKey').fill(TOKENS['primary'])
        page.locator('[data-action="unlock"]').click()
        expect(page.locator('h1')).to_have_text('Becs access required')
        page.locator('#adminKey').fill(TOKENS['account-2'])
        page.locator('[data-action="unlock"]').click()
        expect(page.locator('#accountButton')).to_contain_text('Account 2')
        expect(page.locator('#adminKey')).to_have_count(0)
        page.reload()
        expect(page.locator('#adminKey')).to_have_count(0)
        page.locator('#accountButton').click()
        expect(page.locator('h1')).to_have_text('Account & Settings')
        expect(page.locator('[data-action="account-invites"]')).to_have_count(0)
        expect(page.locator('#phone')).to_be_visible()
        page.locator('a[href="/?account=account-3"]').click()
        expect(page.locator('#adminKey')).to_be_visible()
        assert page.evaluate("localStorage.getItem('becs_key:account-3')") is None
        page.locator('#adminKey').fill(TOKENS['account-3'])
        page.locator('[data-action="unlock"]').click()
        expect(page.locator('#adminKey')).to_have_count(0)
        page.locator('#accountButton').click()
        page.locator('a[href="/?account=account-2"]').click()
        expect(page.locator('#adminKey')).to_have_count(0)
        expect(page.locator('#accountButton')).to_contain_text('Account 2')
        page.locator('#accountButton').click()
        page.locator('[data-action="lock-browser"]').click()
        expect(page.locator('#adminKey')).to_be_visible()
        assert page.evaluate("localStorage.getItem('becs_key:account-2')") is None
        assert page.evaluate("localStorage.getItem('becs_key:account-3')")==TOKENS['account-3']
        assert page.evaluate("localStorage.getItem('becs_key:primary')") is None
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
        context.close()
    browser.close()
assert not errors,errors
assert all(account!='primary' for account,endpoint in requests)
print('PASS: mobile and desktop account access, rejected foreign key, persistent login, account switching and independent browser lock')
