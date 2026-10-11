"""Synthetic, network-isolated Model C access UI checks and static preview captures.

Run: .venv/bin/python tests/browser_users.py
Every response is mocked; no Telegram SDK, login, or message can reach a network.
"""
import copy
import json
import mimetypes
import os
import time
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PREVIEW = ROOT / 'preview' / 'private-invites'
PREVIEW.mkdir(parents=True, exist_ok=True)
OWNER = {'telegram_id': '1001', 'display_name': 'Owner', 'status': 'approved', 'role': 'admin'}
GUEST = {'telegram_id': '2002', 'display_name': 'Morgan', 'status': 'approved', 'role': 'member'}
PENDING = {'telegram_id': '3003', 'display_name': 'Casey', 'status': 'pending', 'role': 'member'}
TOKEN = 'SYNTHETIC_PREVIEW_ONLY_TOKEN'
OVERVIEW = {
    'stats': dict.fromkeys(['routes', 'enabled_routes', 'forwarded', 'queued', 'failed', 'duplicates', 'contracts', 'reviews'], 0),
    'activity': [], 'graph': [0] * 12, 'cooldown_seconds': 0, 'paused': False,
    'telegram': {'authorized': True, 'configured': True, 'connected': True, 'detail': 'Synthetic private workspace'},
    'ai_configured': False, 'bot_configured': True,
}


class Mock:
    def __init__(self, me=None):
        self.me = copy.deepcopy(me or OWNER)
        self.users = copy.deepcopy([OWNER, GUEST, PENDING])
        self.invites = []
        self.overview = copy.deepcopy(OVERVIEW)
        self.calls, self.unexpected, self.errors = [], [], []
        self.fail = {}
        self.expired_invite = False
        self.workspace_revoked = False
        self.key_rejected = False

    def respond(self, route):
        request = route.request
        url = urlsplit(request.url)
        if url.netloc != 'becs.test':
            route.abort()
            return
        path, method = url.path, request.method
        if path.startswith('/api/'):
            self.calls.append((method, path))
            status = 200
            if (method, path) in self.fail:
                status, data = self.fail[(method, path)]
            elif path == '/api/me':
                if self.key_rejected:
                    status, data = 401, {'detail': 'Verified Telegram access required'}
                else:
                    data = {'user': self.me, 'is_admin': self.me['role'] == 'admin', 'capacity': 3}
            elif self.workspace_revoked and path == '/api/routes':
                status, data = 403, {'detail': 'Workspace access revoked', 'reason': 'access_revoked'}
            elif path == '/api/overview':
                data = self.overview
            elif path == '/api/routes':
                data = {'routes': []}
            elif path == '/api/jobs':
                data = {'jobs': []}
            elif path == '/api/reviews':
                data = {'reviews': []}
            elif path == '/api/inspector':
                data = {'items': []}
            elif path == '/api/admin/users':
                data = {'users': self.users, 'capacity': 3}
            elif path == '/api/admin/invites' and method == 'GET':
                data = {'invites': self.invites}
            elif (path == '/api/admin/invites' or path.endswith('/reinvite')) and method == 'POST':
                invite = {'id': f'invite{len(self.invites) + 1}', 'expires_at': time.time() + (-5 if self.expired_invite else 3600),
                          'used_at': None, 'revoked_at': None, 'status': 'active'}
                self.invites.append(invite)
                data = dict(invite, url=f'https://t.me/preview_bot?start=invite_{TOKEN}')
                status = 201
            elif path.startswith('/api/admin/invites/') and method == 'DELETE':
                item = next(item for item in self.invites if item['id'] == path.rsplit('/', 1)[-1])
                item.update(status='revoked', revoked_at=time.time())
                data = {'revoked': True}
            elif path.startswith('/api/admin/users/') and method == 'POST':
                uid, action = path.split('/')[-2:]
                item = next(item for item in self.users if item['telegram_id'] == uid)
                item['status'] = 'approved' if action == 'approve' else 'revoked'
                data = {'user': item}
            elif path == '/api/admin/status':
                data = {'components': {'api': 'ok', 'sqlite': 'ok', 'worker': 'ok'}, 'telegram': {'authorized': True},
                        'bot_configured': True, 'paused': False, 'counts': dict.fromkeys(['active_routes', 'queued', 'sending', 'failed'], 0),
                        'cooldown_seconds': 0, 'uptime_seconds': 90}
            elif path == '/api/telegram/chats':
                data = {'chats': []}
            else:
                self.unexpected.append((method, path))
                status, data = 500, {'detail': 'Unexpected synthetic test endpoint'}
            route.fulfill(status=status, content_type='application/json', body=json.dumps(data))
            return
        target = ROOT / 'static' / ('index.html' if path == '/' else path.removeprefix('/assets/'))
        if not target.is_file() or not target.resolve().is_relative_to((ROOT / 'static').resolve()):
            route.fulfill(status=404, body='Not found')
            return
        route.fulfill(status=200, content_type=mimetypes.guess_type(str(target))[0] or 'application/octet-stream', body=target.read_bytes())

    def start(self, browser, width=390):
        self.context = browser.new_context(viewport={'width': width, 'height': 844 if width == 390 else 960},
                                          is_mobile=width == 390, has_touch=width == 390, service_workers='block')
        self.context.route('**/*', self.respond)
        self.context.add_init_script("Object.defineProperty(navigator, 'clipboard', {value: {writeText: async value => {window.copiedInvite = value;}}});")
        page = self.context.new_page()
        page.on('pageerror', lambda error: self.errors.append(str(error)))
        page.goto('https://becs.test/')
        return page

    def check(self):
        assert not self.errors, self.errors
        assert not self.unexpected, self.unexpected
        assert self.calls[0] == ('GET', '/api/me'), self.calls
        self.context.close()


def users(page):
    expect(page.locator('h1')).to_have_text('Command Center')
    page.locator('[data-nav="more"]:visible').click()
    page.locator('[data-action="open-users"]').click()
    expect(page.locator('[data-user-row="1001"]')).to_be_visible()


def no_overflow(page):
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), page.viewport_size


def mutations(mock):
    return [(method, path) for method, path in mock.calls if method not in ('GET', 'HEAD')]


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('BECS_CHROMIUM_EXECUTABLE') or None)
    for width, label in [(390, 'mobile'), (1440, 'desktop')]:
        mock = Mock()
        page = mock.start(browser, width)
        users(page)
        expect(page.locator('.users-capacity')).to_contain_text('2 of 3')
        expect(page.locator('[data-user-row="1001"] button')).to_have_count(0)
        expect(page.locator('[data-user-row="3003"]')).to_contain_text('Pending approval')
        no_overflow(page)
        if width == 390:
            tabs = page.locator('#bottomNav .bottom-tab:visible')
            assert tabs.count() == 6
            tops = tabs.evaluate_all('(tabs) => tabs.map(tab => tab.getBoundingClientRect().top)')
            assert max(tops) - min(tops) < 1, tops
        page.screenshot(path=str(PREVIEW / f'users-{label}.png'), full_page=True)
        # Visiting either Users or its create dialog never creates an invitation.
        assert not mutations(mock)
        page.locator('[data-action="invite-user"]').click()
        expect(page.locator('#modalTitle')).to_have_text('Invite User')
        no_overflow(page)
        page.screenshot(path=str(PREVIEW / f'invite-{label}.png'), full_page=False)
        assert not mutations(mock)
        page.locator('[data-action="create-invite"]').evaluate('(button) => {button.click(); button.click();}')
        expect(page.locator('#privateInviteLink')).to_have_value(f'https://t.me/preview_bot?start=invite_{TOKEN}')
        assert mutations(mock) == [('POST', '/api/admin/invites')], mutations(mock)
        page.locator('[data-action="copy-invite"]').click()
        assert page.evaluate('window.copiedInvite').endswith(TOKEN)
        expect(page.locator('#toastRegion')).to_contain_text('Invite link copied')
        assert TOKEN not in page.evaluate('JSON.stringify([localStorage,sessionStorage])')
        # Refresh must not replace the one-time link or current dialog.
        page.evaluate("document.getElementById('refreshBtn').click()")
        expect(page.locator('#privateInviteLink')).to_have_value(f'https://t.me/preview_bot?start=invite_{TOKEN}')
        page.locator('[data-action="close-modal"]').click()
        expect(page.locator('#modal')).to_be_hidden()
        assert TOKEN not in page.locator('body').inner_text()
        assert TOKEN not in page.content()
        # A reopened dialog cannot recover the link and still does not auto-create.
        page.locator('[data-action="invite-user"]').click()
        expect(page.locator('#privateInviteLink')).to_have_count(0)
        expect(page.locator('#toastRegion')).to_be_empty()
        assert len(mutations(mock)) == 1
        page.locator('[data-action="close-modal"]').click()
        # Revoke confirmation is for an exact person and cancel performs no mutation.
        page.locator('[data-user-id="2002"][data-user-action="revoke"]').click()
        expect(page.locator('.confirm-person')).to_contain_text('Morgan')
        expect(page.locator('.confirm-person')).to_contain_text('2002')
        expect(page.locator('#toastRegion')).to_be_empty()
        page.screenshot(path=str(PREVIEW / f'revoke-{label}.png'), full_page=False)
        page.evaluate("document.getElementById('refreshBtn').click()")
        expect(page.locator('.confirm-person')).to_contain_text('2002')
        page.keyboard.press('Escape')
        expect(page.locator('#modal')).to_be_hidden()
        assert len(mutations(mock)) == 1
        # A network/server failure keeps the intended person and supports a deliberate retry.
        endpoint = '/api/admin/users/2002/revoke'
        mock.fail[('POST', endpoint)] = (503, {'detail': 'Please try again'})
        page.locator('[data-user-id="2002"][data-user-action="revoke"]').click()
        page.locator('[data-action="confirm-user"]').click()
        expect(page.locator('#userActionError')).to_contain_text('Please try again')
        expect(page.locator('.confirm-person')).to_contain_text('2002')
        mock.fail.clear()
        page.locator('[data-action="confirm-user"]').evaluate('(button) => {button.click(); button.click();}')
        expect(page.locator('#modal')).to_be_hidden()
        expect(page.locator('[data-user-row="2002"]')).to_contain_text('Revoked')
        assert mutations(mock).count(('POST', endpoint)) == 2
        assert not any('/1001/' in path or '/3003/' in path for _, path in mutations(mock))
        # Revoked users require an explicit, account-bound new invitation.
        page.locator('[data-user-id="2002"][data-user-action="reinvite"]').click()
        expect(page.locator('#modalBody')).to_contain_text('Telegram ID 2002')
        page.locator('[data-action="create-invite"]').click()
        expect(page.locator('#privateInviteLink')).to_be_visible()
        assert mutations(mock)[-1] == ('POST', '/api/admin/users/2002/reinvite')
        page.locator('[data-action="close-modal"]').click()
        mock.check()

    # Approving the final seat disables new invites and any additional approvals.
    mock = Mock()
    page = mock.start(browser)
    users(page)
    page.locator('[data-user-id="3003"][data-user-action="approve"]').click()
    page.locator('[data-action="confirm-user"]').click()
    expect(page.locator('.users-capacity')).to_contain_text('3 of 3')
    expect(page.locator('[data-action="invite-user"]')).to_be_disabled()
    assert mutations(mock) == [('POST', '/api/admin/users/3003/approve')]
    mock.check()

    # Pending users never fetch any workspace or owner endpoints before approval.
    mock = Mock(PENDING)
    mock.overview['telegram']['authorized'] = False
    page = mock.start(browser)
    expect(page.locator('h1')).to_have_text('Approval pending')
    expect(page.locator('#sideNav')).to_be_hidden()
    expect(page.locator('#bottomNav')).to_be_hidden()
    no_overflow(page)
    page.screenshot(path=str(PREVIEW / 'pending-mobile.png'), full_page=True)
    assert mock.calls == [('GET', '/api/me')]
    page.locator('[data-action="retry-access"]').click()
    expect(page.locator('h1')).to_have_text('Approval pending')
    assert all(path == '/api/me' for _, path in mock.calls)
    mock.me['status'] = 'approved'
    page.locator('[data-action="retry-access"]').click()
    expect(page.locator('h1')).to_have_text('Command Center')
    page.locator('[data-nav="more"]:visible').click()
    expect(page.locator('[data-action="open-users"]')).to_have_count(0)
    expect(page.locator('#ownerStatusPanel')).to_have_count(0)
    expect(page.locator('#phone')).to_be_visible()
    page.locator('#phone').fill('+15550000000')
    page.locator('#refreshBtn').click()
    expect(page.locator('#phone')).to_have_value('+15550000000')
    assert not any('/admin/' in path for _, path in mock.calls)
    mock.check()

    # An access denial clears rendered workspace data and an open route editor.
    mock = Mock(GUEST)
    page = mock.start(browser)
    expect(page.locator('h1')).to_have_text('Command Center')
    page.locator('[data-action="new-route"]').first.click()
    page.locator('#routeName').fill('Do not leave stale workspace data')
    mock.workspace_revoked = True
    page.evaluate("document.getElementById('refreshBtn').click()")
    expect(page.locator('h1')).to_have_text('Access revoked')
    expect(page.locator('#modal')).to_be_hidden()
    expect(page.locator('#modalBody')).to_be_empty()
    expect(page.locator('#bottomNav')).to_be_hidden()
    assert 'Do not leave stale workspace data' not in page.content()
    assert 'Command Center' not in page.locator('body').inner_text()
    page.screenshot(path=str(PREVIEW / 'access-revoked-mobile.png'), full_page=True)
    mock.check()

    # Invitation failures are explicit; no automatic retry, no secrets stored, no usable expired link.
    mock = Mock()
    page = mock.start(browser)
    users(page)
    mock.fail[('POST', '/api/admin/invites')] = (409, {'detail': 'The three-account limit has been reached.'})
    page.locator('[data-action="invite-user"]').click()
    page.locator('[data-action="create-invite"]').click()
    expect(page.locator('#modalBody [role="alert"]')).to_contain_text('All 3 workspaces')
    assert len(mutations(mock)) == 1
    expect(page.locator('#privateInviteLink')).to_have_count(0)
    mock.fail.clear()
    mock.expired_invite = True
    page.locator('[data-action="create-invite"]').click()
    expect(page.locator('#modalBody')).to_contain_text('This invitation has expired')
    expect(page.locator('#privateInviteLink')).to_have_count(0)
    expect(page.locator('[data-action="copy-invite"]')).to_have_count(0)
    assert TOKEN not in page.evaluate('JSON.stringify([localStorage,sessionStorage])')
    mock.check()

    # Escaped names and invite metadata are inert text; redeemed invitations are never shown as unused.
    mock = Mock()
    mock.users[1]['display_name'] = '<img src=x onerror="window.nameAttack=1"> & Guest'
    mock.invites = [dict(id='used', status='redeemed', expires_at=time.time() + 100, used_at=None, redeemed_at=None, revoked_at=None)]
    page = mock.start(browser)
    users(page)
    expect(page.locator('[data-user-row="2002"] strong')).to_contain_text('<img src=x')
    assert page.evaluate('window.nameAttack') is None
    expect(page.locator('[data-user-row="2002"] img')).to_have_count(0)
    expect(page.locator('[data-invite-revoke="used"]')).to_have_count(0)
    page.locator('[data-user-id="2002"][data-user-action="revoke"]').click()
    expect(page.locator('.confirm-person')).to_contain_text('<img src=x')
    expect(page.locator('.confirm-person img')).to_have_count(0)
    mock.check()

    for status, title in [('revoked', 'Access revoked'), ('not_invited', 'Private access only')]:
        mock = Mock(dict(GUEST, status=status))
        page = mock.start(browser)
        expect(page.locator('h1')).to_have_text(title)
        assert mock.calls == [('GET', '/api/me')]
        expect(page.locator('#adminKey')).to_have_count(0)
        mock.check()

    mock = Mock()
    mock.key_rejected = True
    page = mock.start(browser)
    expect(page.locator('h1')).to_have_text('Becs access required')
    expect(page.locator('#adminKey')).to_be_visible()
    assert mock.calls == [('GET', '/api/me')]
    mock.check()
    browser.close()

print('PASS: private Users UI on 390px mobile and desktop; approval, capacity, invites, revoke/reinvite, pending/revoked gates, escaping, refresh preservation, duplicate clicks and failures. Mocked API only.')
print(f'Synthetic previews: {PREVIEW}')
