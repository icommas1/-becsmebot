"""Network-isolated browser QA of the actual built AppDeploy dist.

Every request is fulfilled or aborted by Playwright before reaching the network.
The hosted AppDeploy origin and external Railway origin are simulated locally.
No real Telegram launch, credential, account, invitation or write is used.

Run after the bundle's `npm run build`:
  python tests/browser_appdeploy.py --dist /tmp/becs-appdeploy-update/project/dist
"""
from __future__ import annotations

import argparse
import copy
import json
import mimetypes
import os
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

APP_ORIGIN = 'https://app.example.test'
API_ORIGIN = 'https://api.example.test'
SIGNED = 'query_id=SYNTHETIC_OFFLINE_ONLY&auth_date=1234567890&hash=NOT_A_REAL_SIGNATURE'
TOKEN = 'SYNTHETIC_OFFLINE_INVITE_ONLY'
OWNER = {'telegram_id': '1001', 'display_name': 'Owner', 'status': 'approved', 'role': 'admin'}
MEMBER = {'telegram_id': '2002', 'display_name': 'Morgan', 'status': 'approved', 'role': 'member'}
PENDING = {'telegram_id': '3003', 'display_name': 'Casey', 'status': 'pending', 'role': 'member'}
OVERVIEW = {
    'stats': dict.fromkeys(['routes', 'enabled_routes', 'forwarded', 'queued', 'failed', 'duplicates', 'contracts', 'reviews'], 0),
    'activity': [], 'graph': [0] * 12, 'cooldown_seconds': 0, 'paused': False,
    'telegram': {'authorized': True, 'configured': True, 'connected': True, 'detail': 'Synthetic workspace'},
    'ai_configured': False, 'bot_configured': True,
}


class HostedMock:
    def __init__(self, dist, me=OWNER, signed=SIGNED):
        self.dist = dist.resolve()
        self.me = copy.deepcopy(me)
        self.signed = signed
        self.users = copy.deepcopy([OWNER, MEMBER, PENDING])
        self.invites = []
        self.overview = copy.deepcopy(OVERVIEW)
        self.calls, self.unexpected, self.errors, self.blocked_sdk = [], [], [], []
        self.reject_signed = False
        self.expire_invite = False
        self.fail = {}

    def respond(self, route):
        request = route.request
        url = urlsplit(request.url)
        origin = f'{url.scheme}://{url.netloc}'
        path, method = url.path, request.method
        if origin == 'https://telegram.org' and path == '/js/telegram-web-app.js':
            self.blocked_sdk.append(request.url)
            route.abort()
            return
        if origin == API_ORIGIN and path.startswith('/api/'):
            cors = {'Access-Control-Allow-Origin': APP_ORIGIN,
                    'Access-Control-Allow-Headers': 'X-Telegram-Init-Data, Content-Type',
                    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'}
            if method == 'OPTIONS':
                route.fulfill(status=204, headers=cors)
                return
            self.calls.append((method, path))
            headers = request.all_headers()
            if headers.get('x-telegram-init-data') != self.signed or not self.signed:
                self.unexpected.append(('signed identity missing or changed', method, path))
            if 'x-becs-key' in headers or 'authorization' in headers or 'cookie' in headers:
                self.unexpected.append(('unexpected credential', method, path))
            status = 200
            if self.reject_signed:
                status, data = 401, {'detail': 'Telegram launch expired'}
            elif (method, path) in self.fail:
                status, data = self.fail[(method, path)]
            elif method == 'GET' and path == '/api/me':
                data = {'user': self.me, 'is_admin': self.me['role'] == 'admin', 'capacity': 3}
            elif method == 'GET' and path == '/api/recovery/consent':
                data = {'required':False,'choice':'no','scope_version':'1','administrator':{'user_id':'1001','display_name':'Owner'}}
            elif method == 'GET' and path == '/api/overview':
                data = self.overview
            elif method == 'GET' and path in ['/api/routes', '/api/jobs', '/api/reviews', '/api/inspector', '/api/telegram/chats']:
                data = {path.rsplit('/', 1)[-1] if path != '/api/inspector' else 'items': []}
            elif method == 'GET' and path == '/api/admin/users':
                data = {'users': self.users, 'capacity': 3}
            elif method == 'GET' and path == '/api/admin/invites':
                data = {'invites': self.invites}
            elif method == 'GET' and path == '/api/admin/status':
                data = {'components': {'api': 'ok', 'sqlite': 'ok', 'worker': 'ok'},
                        'telegram': {'authorized': True}, 'bot_configured': True, 'paused': False,
                        'counts': dict.fromkeys(['active_routes', 'queued', 'sending', 'failed'], 0),
                        'cooldown_seconds': 0, 'uptime_seconds': 90}
            elif method == 'POST' and (path == '/api/admin/invites' or path.endswith('/reinvite')):
                invite = {'id': f'invite{len(self.invites) + 1}', 'expires_at': 1 if self.expire_invite else 4102444800,
                          'used_at': None, 'revoked_at': None, 'status': 'active'}
                self.invites.append(invite)
                status, data = 201, dict(invite, url=f'https://t.me/mock_becs_bot?start=invite_{TOKEN}')
            elif method == 'DELETE' and path.startswith('/api/admin/invites/'):
                item = next(item for item in self.invites if item['id'] == path.rsplit('/', 1)[-1])
                item.update(status='revoked', revoked_at=1)
                data = {'revoked': True}
            elif method == 'POST' and path.startswith('/api/admin/users/'):
                uid, action = path.split('/')[-2:]
                item = next(item for item in self.users if item['telegram_id'] == uid)
                item['status'] = {'approve': 'approved', 'revoke': 'revoked', 'reject': 'rejected'}[action]
                data = {'user': item}
            elif method == 'POST' and path == '/api/telegram/start':
                assert json.loads(request.post_data) == {'phone': '+15550000000'}
                data = {'status': 'code_sent'}
            elif method == 'POST' and path == '/api/telegram/code':
                assert json.loads(request.post_data) == {'code': '00000'}
                data = {'status': 'password_required'}
            elif method == 'POST' and path == '/api/telegram/password':
                assert json.loads(request.post_data) == {'password': 'SYNTHETIC_TEST_PASSWORD'}
                self.overview['telegram']['authorized'] = True
                data = {'status': 'authorized'}
            else:
                self.unexpected.append((method, request.url))
                status, data = 500, {'detail': 'Unexpected offline test API request'}
            route.fulfill(status=status, headers=cors, content_type='application/json', body=json.dumps(data))
            return
        if origin != APP_ORIGIN:
            self.unexpected.append(('unexpected host', method, request.url))
            route.abort()
            return
        if method != 'GET' or path.startswith('/api/'):
            self.unexpected.append(('same-origin API or mutation', method, request.url))
            route.abort()
            return
        target = (self.dist / ('index.html' if path == '/' else path.lstrip('/'))).resolve()
        if not target.is_relative_to(self.dist) or not target.is_file():
            self.unexpected.append(('missing built asset', method, request.url))
            route.fulfill(status=404, body='Missing test asset')
            return
        route.fulfill(status=200, body=target.read_bytes(),
                      content_type=mimetypes.guess_type(str(target))[0] or 'application/octet-stream')

    def start(self, browser, width=390, suffix=''):
        self.context = browser.new_context(viewport={'width': width, 'height': 844 if width == 390 else 960},
                                          is_mobile=width == 390, has_touch=width == 390, service_workers='block')
        self.context.route('**/*', self.respond)
        self.context.add_init_script("""
          window.Telegram = {WebApp: {
            initData: SIGNED_PLACEHOLDER,
            ready() {}, expand() {}, setHeaderColor() {}, setBackgroundColor() {},
          }};
          window.workerRegistrations = 0;
          if (navigator.serviceWorker) {
            navigator.serviceWorker.register = async () => { window.workerRegistrations++; throw new Error('Registration forbidden in hosted test'); };
          }
          Object.defineProperty(navigator, 'clipboard', {value: {writeText: async value => {window.copiedInvite = value;}}});
          sessionStorage.setItem('becs_key', 'IGNORED_LEGACY_KEY');
        """.replace('SIGNED_PLACEHOLDER', json.dumps(self.signed)))
        page = self.context.new_page()
        page.on('pageerror', lambda error: self.errors.append(str(error)))
        page.goto(APP_ORIGIN + '/' + suffix)
        self.page = page
        return page

    def check(self):
        assert not self.errors, self.errors
        assert not self.unexpected, self.unexpected
        assert self.blocked_sdk, 'Expected the external Telegram SDK to be explicitly blocked'
        assert self.page.evaluate('window.workerRegistrations') == 0
        assert self.page.locator('#adminKey,[data-action="unlock"]').count() == 0
        self.context.close()

    def mutations(self):
        return [(method, path) for method, path in self.calls if method not in ('GET', 'HEAD')]


def show_users(page):
    expect(page.locator('h1')).to_have_text('Command Center')
    page.locator('[data-nav="more"]:visible').click()
    page.locator('[data-action="open-users"]').click()
    expect(page.locator('[data-user-row="1001"]')).to_be_visible()


def no_overflow(page):
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), page.viewport_size


def run(dist: Path, screenshots: Path | None = None):
    if not (dist / 'index.html').is_file():
        raise SystemExit('Built dist/index.html is required. Generate the bundle and run npm run build first.')
    if screenshots:
        screenshots.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=os.environ.get('BECS_CHROMIUM_EXECUTABLE') or None)
        for width in [390, 1440]:
            mock = HostedMock(dist)
            page = mock.start(browser, width)
            show_users(page)
            expect(page.locator('.users-capacity')).to_contain_text('2 of 3')
            expect(page.locator('[data-user-row="1001"] button')).to_have_count(0)
            no_overflow(page)
            if screenshots:
                page.screenshot(path=str(screenshots / f'appdeploy-users-{width}.png'), full_page=True)
            assert not mock.mutations()
            page.locator('[data-action="invite-user"]').click()
            expect(page.locator('#modalTitle')).to_have_text('Invite User')
            assert not mock.mutations()
            page.locator('[data-action="create-invite"]').evaluate('(button) => {button.click(); button.click();}')
            expect(page.locator('#privateInviteLink')).to_have_value(f'https://t.me/mock_becs_bot?start=invite_{TOKEN}')
            assert mock.mutations() == [('POST', '/api/admin/invites')]
            page.locator('[data-action="copy-invite"]').click()
            assert page.evaluate('window.copiedInvite').endswith(TOKEN)
            assert TOKEN not in page.evaluate('JSON.stringify([sessionStorage, localStorage])')
            # Simulate a background refresh while the intentional modal backdrop
            # prevents a real pointer from clicking the underlying toolbar.
            page.evaluate("document.getElementById('refreshBtn').click()")
            expect(page.locator('#privateInviteLink')).to_be_visible()
            page.locator('[data-action="close-modal"]').click()
            expect(page.locator('#modal')).to_be_hidden()
            assert TOKEN not in page.content()
            page.locator('[data-user-id="2002"][data-user-action="revoke"]').click()
            expect(page.locator('.confirm-person')).to_contain_text('2002')
            page.keyboard.press('Escape')
            assert len(mock.mutations()) == 1
            page.locator('[data-user-id="2002"][data-user-action="revoke"]').click()
            page.locator('[data-action="confirm-user"]').click()
            expect(page.locator('[data-user-row="2002"]')).to_contain_text('Revoked')
            page.locator('[data-user-id="3003"][data-user-action="approve"]').click()
            expect(page.locator('.confirm-person')).to_contain_text('3003')
            page.locator('[data-action="confirm-user"]').click()
            expect(page.locator('[data-user-row="3003"]')).to_contain_text('Approved')
            page.locator('[data-invite-revoke="invite1"]').click()
            page.locator('[data-action="confirm-user"]').click()
            expect(page.locator('[data-invite-revoke="invite1"]')).to_have_count(0)
            assert mock.mutations() == [('POST', '/api/admin/invites'), ('POST', '/api/admin/users/2002/revoke'),
                                        ('POST', '/api/admin/users/3003/approve'), ('DELETE', '/api/admin/invites/invite1')]
            page.locator('[data-action="users-refresh"]').click()
            expect(page.locator('[data-user-row="3003"]')).to_contain_text('Approved')
            expect(page.locator('[data-user-row="2002"]')).to_contain_text('Revoked')
            mock.check()

        # Members retain their own account connection controls, never owner controls.
        mock = HostedMock(dist, MEMBER)
        mock.overview['telegram']['authorized'] = False
        page = mock.start(browser)
        expect(page.locator('h1')).to_have_text('Command Center')
        page.locator('[data-nav="more"]:visible').click()
        expect(page.locator('[data-action="open-users"],#ownerStatusPanel')).to_have_count(0)
        expect(page.locator('#phone')).to_be_visible()
        page.locator('#phone').fill('+15550000000')
        page.locator('#refreshBtn').click()
        expect(page.locator('#phone')).to_have_value('+15550000000')
        page.locator('[data-action="login-start"]').click()
        expect(page.locator('#telegramCode')).to_be_visible()
        page.locator('#telegramCode').fill('00000')
        page.locator('[data-action="login-code"]').click()
        expect(page.locator('#telegramPassword')).to_be_visible()
        page.locator('#telegramPassword').fill('SYNTHETIC_TEST_PASSWORD')
        page.locator('[data-action="login-password"]').click()
        expect(page.locator('[data-action="disconnect"]')).to_be_visible()
        assert not any('/admin/' in path for _, path in mock.calls)
        assert mock.mutations() == [('POST', '/api/telegram/start'), ('POST', '/api/telegram/code'), ('POST', '/api/telegram/password')]
        mock.check()

        for user, title in [(PENDING, 'Approval pending'), (dict(MEMBER, status='revoked'), 'Access revoked'),
                            (dict(MEMBER, status='not_invited'), 'Private access only')]:
            mock = HostedMock(dist, user)
            page = mock.start(browser)
            expect(page.locator('h1')).to_have_text(title)
            expect(page.locator('#bottomNav')).to_be_hidden()
            expect(page.locator('#phone,#telegramCode,#telegramPassword')).to_have_count(0)
            page.locator('[data-action="retry-access"]').click()
            expect(page.locator('h1')).to_have_text(title)
            assert all(method == 'GET' and path == '/api/me' for method, path in mock.calls), mock.calls
            assert not mock.mutations()
            no_overflow(page)
            mock.check()

        for suffix in ['', '?user_id=999999&role=admin#users']:
            mock = HostedMock(dist, signed='')
            page = mock.start(browser, suffix=suffix)
            expect(page.locator('h1')).to_have_text('Open Becs in Telegram')
            expect(page.locator('#accountButton')).to_be_disabled()
            expect(page.locator('#bottomNav')).to_be_hidden()
            expect(page.locator('input')).to_have_count(0)
            page.locator('[data-action="retry-access"]').click()
            expect(page.locator('h1')).to_have_text('Open Becs in Telegram')
            assert mock.calls == [], mock.calls
            no_overflow(page)
            if screenshots and not suffix:
                page.screenshot(path=str(screenshots / 'appdeploy-telegram-gate.png'), full_page=True)
            mock.check()

        # Losing launch data after approval clears private UI before any API call.
        mock = HostedMock(dist)
        page = mock.start(browser)
        show_users(page)
        page.locator('[data-action="invite-user"]').click()
        call_count = len(mock.calls)
        page.evaluate("window.Telegram.WebApp.initData = ''")
        page.locator('[data-action="create-invite"]').click()
        expect(page.locator('h1')).to_have_text('Open Becs in Telegram')
        expect(page.locator('#modal')).to_be_hidden()
        expect(page.locator('#modalBody')).to_be_empty()
        assert len(mock.calls) == call_count
        assert mock.mutations() == []
        mock.check()

        # Expiration after approved access clears private data and an open invite.
        mock = HostedMock(dist)
        page = mock.start(browser)
        show_users(page)
        page.locator('[data-action="invite-user"]').click()
        page.locator('[data-action="create-invite"]').click()
        expect(page.locator('#privateInviteLink')).to_be_visible()
        mock.reject_signed = True
        # The invite remains open; trigger background refresh, not a pointer
        # through the modal's intentionally blocking backdrop.
        page.evaluate("document.getElementById('refreshBtn').click()")
        expect(page.locator('h1')).to_have_text('Open Becs in Telegram')
        expect(page.locator('#mainView')).to_contain_text('expired')
        expect(page.locator('#modal')).to_be_hidden()
        expect(page.locator('#modalBody')).to_be_empty()
        expect(page.locator('#bottomNav')).to_be_hidden()
        assert TOKEN not in page.content()
        mock.check()

        # A failed invite shows an error; an expired invite never exposes a usable link.
        mock = HostedMock(dist)
        page = mock.start(browser)
        show_users(page)
        mock.fail[('POST', '/api/admin/invites')] = (503, {'detail': 'Try again later'})
        page.locator('[data-action="invite-user"]').click()
        page.locator('[data-action="create-invite"]').click()
        expect(page.locator('#modalBody [role="alert"]')).to_contain_text('Try again later')
        assert len(mock.mutations()) == 1
        mock.fail.clear()
        mock.expire_invite = True
        page.locator('[data-action="create-invite"]').click()
        expect(page.locator('#modalBody')).to_contain_text('This invitation has expired')
        expect(page.locator('#privateInviteLink')).to_have_count(0)
        assert len(mock.mutations()) == 2
        mock.check()
        browser.close()
    print('PASS: built AppDeploy dist; owner invite/approve/revoke, member account controls, pending/revoked denial, Telegram-only missing/expired launch, correct external API and signed header. All traffic intercepted; no live writes.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dist', type=Path, required=True, help='Vite-built dist directory')
    parser.add_argument('--screenshots', type=Path, help='Optional synthetic screenshots directory')
    args = parser.parse_args()
    run(args.dist, args.screenshots)
