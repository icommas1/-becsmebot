"""Offline, synthetic-only browser checks for consent and secure recovery.

No real Telegram launch, password, session or archive is used. Every network
request is intercepted before it can leave the browser.
"""
import argparse
import json
import mimetypes
import os
import time
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'https://becs.test'
SIGNED = 'SYNTHETIC_RECOVERY_SIGNATURE'
ADMIN = {'user_id': '1001', 'display_name': '<img src=x onerror=alert(1)> Owner'}
OVERVIEW = {'stats': dict.fromkeys(['routes','enabled_routes','forwarded','queued','failed','duplicates','contracts','reviews'], 0), 'activity': [], 'graph': [0]*12, 'cooldown_seconds': 0, 'paused': False, 'telegram': {'authorized': True, 'configured': True}, 'ai_configured': False, 'bot_configured': True}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--dist', type=Path);args=parser.parse_args()
    app_origin='https://app.test' if args.dist else ORIGIN
    api_origin='https://api.example.test' if args.dist else ORIGIN
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get('BECS_CHROMIUM_EXECUTABLE') or None)
        for width in (390, 1440):
            context = browser.new_context(viewport={'width': width, 'height': 900}, service_workers='block', accept_downloads=True)
            context.add_init_script("""window.Telegram={WebApp:{initData:'SYNTHETIC_RECOVERY_SIGNATURE',ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};window.revoked=[];const revoke=URL.revokeObjectURL;URL.revokeObjectURL=(url)=>{window.revoked.push(url);revoke(url)};""")
            state = {'choice': None, 'posts': [], 'fail_save': False, 'required': True, 'status': 'pending', 'exports': 0, 'hold_export': False, 'held': None, 'reject': False, 'member': False, 'scope': '1', 'consent_error': False}
            errors = []; downloads = []; requests = []
            def route_request(route):
                req = route.request; url = urlsplit(req.url); path = url.path
                origin=f'{url.scheme}://{url.netloc}'
                if origin not in (ORIGIN,app_origin,api_origin):
                    route.abort(); return
                requests.append(path)
                if path.startswith('/api/'):
                    cors={'Access-Control-Allow-Origin':app_origin,'Access-Control-Allow-Headers':'X-Telegram-Init-Data, Content-Type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'}
                    if req.method=='OPTIONS':route.fulfill(status=204,headers=cors);return
                    assert req.headers.get('x-telegram-init-data') == SIGNED
                    assert 'x-becs-key' not in req.headers
                    code = 200
                    if path == '/api/me':
                        data = {'user': {'telegram_id': '2002' if state['member'] else '1001', 'status': 'approved', 'display_name': 'Test', 'role': 'member' if state['member'] else 'admin'}, 'is_admin': not state['member'], 'capacity': 3}
                    elif path == '/api/recovery/consent':
                        if req.method == 'POST':
                            body = req.post_data_json; state['posts'].append(body)
                            assert body['administrator_id'] == ADMIN['user_id'] and body['scope_version'] == state['scope']
                            if state['fail_save']: code = 503
                            else: state['choice'] = body['choice']; state['required'] = False
                        if state['consent_error']:code = 503
                        data = {'required': state['required'], 'choice': state['choice'], 'administrator': ADMIN, 'scope_version': state['scope']}
                    elif path == '/api/overview': data = OVERVIEW
                    elif path in ('/api/routes', '/api/jobs', '/api/reviews', '/api/inspector'): data = {path.rsplit('/', 1)[1] if path != '/api/inspector' else 'items': []}
                    elif path == '/api/admin/recovery/challenge':
                        if state['reject']:code = 401
                        data = {'challenge_id': 'synthetic-challenge', 'expires_at': time.time()+120}
                    elif path == '/api/admin/recovery/challenge/synthetic-challenge/cancel': data = {'canceled':True}
                    elif path == '/api/admin/recovery/challenge/synthetic-challenge': data = {'status': state['status']}
                    elif path == '/api/admin/recovery/export':
                        assert req.post_data_json == {'challenge_id': 'synthetic-challenge', 'password': 'SYNTHETIC-ONLY-PASSWORD'}
                        state['exports'] += 1
                        if state['hold_export']:state['held'] = route;return
                        route.fulfill(content_type='application/zip', body=b'PK\x03\x04SYNTHETIC-ENCRYPTED-PLACEHOLDER');return
                    else:raise AssertionError(path)
                    route.fulfill(status=code, headers=cors, content_type='application/json', body=json.dumps(data));return
                if args.dist and origin==app_origin:
                    file=args.dist/('index.html' if path=='/' else path.lstrip('/'))
                else:
                    file = ROOT/'app/recovery_page.html' if path == '/recovery' else ROOT/'static'/('index.html' if path == '/' else path.removeprefix('/assets/'))
                if not file.is_file():route.fulfill(status=404);return
                route.fulfill(content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream', body=file.read_bytes())
            context.route('**/*', route_request)
            page = context.new_page();page.on('pageerror', lambda error: errors.append(str(error)));page.on('download', lambda download: downloads.append(download))
            # The owner sees consent too; administrator name is text, never HTML.
            page.goto(app_origin);expect(page.locator('h1')).to_have_text('Rollback Recovery')
            expect(page.locator('#recoveryConsentCopy')).to_have_text('Allow '+ADMIN['display_name']+' to securely back up your Telegram session for @becsmebot updates and recovery? A saved session carries your account’s permissions, including reading and sending messages.')
            assert page.locator('#recoveryConsentCopy img').count() == 0
            assert '/api/overview' not in requests
            if width==390:
                preview=ROOT/'preview/recovery';preview.mkdir(parents=True,exist_ok=True)
                adversarial_name=ADMIN['display_name'];ADMIN['display_name']='Telegram user 1001'
                page.reload();expect(page.locator('#recoveryConsentCopy')).to_contain_text('Allow Telegram user 1001')
                page.screenshot(path=str(preview/('hosted-consent.png' if args.dist else 'source-consent.png')),full_page=True)
                ADMIN['display_name']=adversarial_name
            state['fail_save'] = True;page.get_by_role('button', name='No', exact=True).click()
            expect(page.locator('#recoveryConsentError')).to_contain_text('not saved')
            state['fail_save'] = False;page.get_by_role('button', name='No', exact=True).click()
            expect(page.locator('h1')).to_have_text('Command Center')
            count = len(state['posts']);page.reload();expect(page.locator('h1')).to_have_text('Command Center');assert len(state['posts']) == count
            # Every approved member also sees consent. A new scope asks again.
            state.update(member=True, required=True, scope='2')
            page.reload();expect(page.locator('h1')).to_have_text('Rollback Recovery')
            page.get_by_role('button', name='Yes', exact=True).click();expect(page.locator('h1')).to_have_text('Command Center');assert state['choice'] == 'yes'
            state['consent_error'] = True;page.reload();expect(page.get_by_role('alert')).to_contain_text('could not be loaded');assert page.get_by_role('button', name='Check access').is_visible()
            state['consent_error'] = False
            # Secure page never requests external resources, stores values or auto-downloads.
            requests.clear();page.goto(ORIGIN+'/recovery');expect(page.locator('#begin')).to_be_visible()
            page.locator('#begin').click();expect(page.locator('#status')).to_contain_text('explicitly confirm');assert page.locator('#passwordForm').is_hidden()
            state['status'] = 'confirmed';expect(page.locator('#passwordForm')).to_be_visible(timeout=7000)
            if width==390:
                assert page.locator('#password').input_value()==page.locator('#passwordAgain').input_value()==''
                page.screenshot(path=str(preview/'secure-page.png'),full_page=True)
            page.locator('#password').fill('SYNTHETIC-ONLY-PASSWORD');page.locator('#passwordAgain').fill('DIFFERENT-PASSWORD');page.locator('#generate').click()
            expect(page.locator('#status')).to_contain_text('same password twice');assert state['exports'] == 0
            page.locator('#passwordAgain').fill('SYNTHETIC-ONLY-PASSWORD');page.locator('#generate').click();expect(page.locator('#download')).to_be_visible()
            assert not downloads and state['exports'] == 1
            assert page.locator('#password').input_value() == page.locator('#passwordAgain').input_value() == ''
            assert page.evaluate('localStorage.length+sessionStorage.length') == 0
            with page.expect_download() as download:page.locator('#download').click()
            assert Path(download.value.path()).read_bytes() == b'PK\x03\x04SYNTHETIC-ENCRYPTED-PLACEHOLDER'
            page.locator('#cancel').click();expect(page.locator('#download')).to_be_hidden();assert page.evaluate('window.revoked.length') == 1
            # A late export response cannot resurrect an archive after cancel.
            state['hold_export'] = True;page.locator('#begin').click();expect(page.locator('#passwordForm')).to_be_visible()
            page.locator('#password').fill('SYNTHETIC-ONLY-PASSWORD');page.locator('#passwordAgain').fill('SYNTHETIC-ONLY-PASSWORD');page.locator('#generate').click()
            expect(page.locator('#status')).to_contain_text('Preparing encrypted');page.wait_for_timeout(100)
            page.locator('#cancel').click()
            if state['held']:
                try:state['held'].fulfill(content_type='application/zip', body=b'PK\x03\x04LATE-SYNTHETIC')
                except Exception:pass  # Browser may already have aborted the held route.
            page.wait_for_timeout(100);expect(page.locator('#download')).to_be_hidden();assert len(downloads) == 1
            state['reject'] = True;page.locator('#begin').click();expect(page.locator('#reopen')).to_be_visible();expect(page.locator('#passwordForm')).to_be_hidden()
            assert all(path == '/recovery' or path.startswith('/api/admin/recovery/') for path in requests), requests
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            assert not errors, errors
            context.close()
        # A plain external browser receives no access. Signed hash is scrubbed.
        context = browser.new_context(service_workers='block');context.route('**/*', lambda route: route.fulfill(content_type='text/html', body=(ROOT/'app/recovery_page.html').read_text()))
        page = context.new_page();page.goto(ORIGIN+'/recovery');expect(page.locator('#begin')).to_be_hidden();expect(page.locator('#reopen')).to_be_visible()
        # A fresh Telegram launch loads a new document; changing only the hash does not rerun scripts.
        page.close();page=context.new_page()
        page.goto(ORIGIN+'/recovery#tgWebAppData=SYNTHETIC_RECOVERY_SIGNATURE');expect(page.locator('#begin')).to_be_visible();assert page.url == ORIGIN+'/recovery'
        context.close();browser.close()
    print('PASS: synthetic recovery consent and encrypted archive UI (390px, 1440px)')


if __name__ == '__main__':main()
