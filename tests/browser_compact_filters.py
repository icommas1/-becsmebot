"""Exercise the real mobile UI with an entirely mocked API; no network delivery."""
import json
import mimetypes
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SOURCE = {'id':'-1000000000101', 'title':'Signals', 'kind':'channel', 'username':'@signalfeed', 'is_bot':False}
BOT = {'id':'900123', 'title':'Example Bot', 'kind':'bot', 'username':'@example_test_bot', 'is_bot':True}
OVERVIEW = {'stats':dict.fromkeys(['routes','enabled_routes','forwarded','queued','failed','duplicates','contracts','reviews'], 0),
            'activity':[], 'graph':[0]*12, 'cooldown_seconds':0, 'paused':False,
            'telegram':{'authorized':True,'configured':True,'connected':True,'detail':'Mock connection'},
            'ai_configured':False, 'bot_configured':True}
saved = []
errors = []
unexpected = []


def respond(route):
    request = route.request
    url = urlsplit(request.url)
    if url.netloc != 'becs.test':
        # Never load Telegram SDK or contact any external service during tests.
        route.abort()
        return
    path = url.path
    method = request.method
    if path.startswith('/api/'):
        if path == '/api/me':
            data = {'user':{'telegram_id':'123456','status':'approved','role':'admin'},'is_admin':True,'capacity':3}
        elif path == '/api/overview':
            data = OVERVIEW
        elif path == '/api/routes' and method == 'GET':
            data = {'routes':saved}
        elif path == '/api/routes' and method == 'POST':
            record = dict(request.post_data_json, id=len(saved)+1, created_at=1, updated_at=1)
            saved.append(record)
            data = {'route':record}
        elif path.startswith('/api/routes/') and method == 'PUT':
            route_id = int(path.rsplit('/',1)[1])
            record = dict(request.post_data_json, id=route_id, created_at=1, updated_at=2)
            saved[route_id-1] = record
            data = {'route':record}
        elif path == '/api/telegram/chats':
            data = {'chats':[SOURCE,BOT]}
        elif path == '/api/telegram/resolve':
            payload = request.post_data_json
            item = next((c for c in [SOURCE,BOT] if payload['reference'] in (c['id'],c['username'])), None)
            if item is None:
                raise AssertionError('Unexpected mock reference')
            data = dict(item, role=payload['role'], validated=True)
        elif path == '/api/jobs':
            data = {'jobs':[]}
        elif path == '/api/reviews':
            data = {'reviews':[]}
        elif path == '/api/inspector':
            data = {'items':[]}
        else:
            unexpected.append((method,path))
            route.fulfill(status=500, content_type='application/json', body=json.dumps({'detail':'Unexpected test endpoint'}))
            return
        route.fulfill(status=200, content_type='application/json', body=json.dumps(data))
        return
    target = ROOT / 'static' / ('index.html' if path == '/' else path.removeprefix('/assets/'))
    if not target.is_file() or not target.resolve().is_relative_to((ROOT / 'static').resolve()):
        route.fulfill(status=404, body='Not found')
        return
    route.fulfill(status=200, content_type=mimetypes.guess_type(str(target))[0] or 'application/octet-stream',
                  body=target.read_bytes())




with sync_playwright() as p:
    browser=p.chromium.launch()
    context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,service_workers='block')
    context.route('**/*',respond)
    page=context.new_page()
    page.on('pageerror',lambda error: errors.append(str(error)))
    page.goto('https://becs.test/')
    page.locator('button[data-nav="routes"]:visible').first.click()
    page.locator('button[data-action="new-route"]:visible').first.click()
    expect(page.locator('#routeTemplate')).to_be_visible()
    expect(page.locator('.becs-smart-panel')).to_be_visible()
    page.locator('#routeTemplate').select_option('xposts')
    assert 'twitter' in page.locator('#routeAllow').input_value()
    page.locator('#routeTemplate').select_option('marketcap')
    assert 'mc' in page.locator('#routeAllow').input_value()
    page.locator('#routeTemplate').select_option('emoji')
    assert '📊' in page.locator('#routeAllow').input_value()
    page.locator('#routeAllow').fill('re:📊|📈|🧑🏽‍🚀')
    page.locator('#routeBlock').fill('scam, giveaway')
    page.locator('#routeReqLink').check()
    page.locator('#routeReqNumber').check()
    page.locator('#routeName').fill('Compact filter regression')
    page.locator('[data-action="refresh-route-chats"]').click()
    page.locator('#sourceChatList input[data-pickchat="-1000000000101"]').check()
    page.locator('#destChatList input[data-pickchat="900123"]').check()
    page.screenshot(path='compact-filters-preview.png',full_page=True)
    page.locator('#routeForm button[type="submit"]').click()
    assert len(saved)==1,saved
    assert saved[0]['allowed']=='re:📊|📈|🧑🏽‍🚀',saved
    assert saved[0]['blocked']=='scam, giveaway',saved
    assert 'https?' in saved[0]['pattern'] and 'd)' in saved[0]['pattern'],saved
    assert saved[0]['delivery_style']=='text',saved
    assert saved[0]['sources']==[SOURCE['id']] and saved[0]['destinations']==[BOT['id']],saved
    page.locator('[data-edit="1"]').click()
    expect(page.locator('#routeAllow')).to_have_value('re:📊|📈|🧑🏽‍🚀')
    expect(page.locator('#routeBlock')).to_have_value('scam, giveaway')
    assert not unexpected,unexpected
    assert not errors,errors
    browser.close()
print('PASS: compact iPhone filters, presets, Unicode, optional requirements and route persistence; mocked API only')
