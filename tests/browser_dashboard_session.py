"""Mobile Chromium UI test, mocked API only. Never contacts Telegram or production."""
import json
import mimetypes
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
BASE_TIME = 2000000000000
KEY = 'test-only-ui-admin-key-not-a-production-secret'


def run():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        context = browser.new_context(viewport={'width': 390, 'height': 844}, service_workers='block')
        errors = []
        server = {'now': BASE_TIME, 'expiry': None, 'logins': 0, 'logout': 0, 'csrf': 'test-only-csrf'}
        requests = []

        def json_response(route, status, body, headers=None):
            route.fulfill(status=status, content_type='application/json', body=json.dumps(body),
                          headers={'Cache-Control': 'no-store', **(headers or {})})

        def serve(route):
            request = route.request
            url = urlsplit(request.url)
            if url.netloc != 'becs.test':
                route.fulfill(status=200, content_type='application/javascript', body='')
                return
            path = url.path
            if not path.startswith('/api/'):
                name = 'index.html' if path == '/' else path.removeprefix('/assets/')
                file = ROOT / 'static' / name
                if file.is_file():
                    route.fulfill(status=200, content_type=mimetypes.guess_type(str(file))[0] or 'text/plain', body=file.read_bytes())
                else:
                    route.fulfill(status=404, body='Not found')
                return
            requests.append((request.method, path))
            cookie = request.headers.get('cookie', '')
            authenticated = ('__Host-becs_dashboard=test-cookie' in cookie and server['expiry'] is not None
                             and server['now'] < server['expiry'])

            def info():
                return {'authenticated': True, 'issued_at': server['expiry'] - 300000,
                        'expires_at': server['expiry'], 'server_time': server['now'],
                        'csrf_token': server['csrf'], 'lifetime_seconds': 300}

            if path == '/api/auth/session':
                json_response(route, 200 if authenticated else 401, info() if authenticated else {'detail': 'Locked'})
            elif path == '/api/auth/login':
                assert request.post_data_json == {'admin_token': KEY}
                server['logins'] += 1
                server['expiry'] = server['now'] + 300000
                json_response(route, 200, info(), {'Set-Cookie': '__Host-becs_dashboard=test-cookie; Path=/; Max-Age=300; HttpOnly; Secure; SameSite=Strict'})
            elif path == '/api/auth/logout':
                assert request.headers.get('x-becs-csrf') == server['csrf']
                server['logout'] += 1
                server['expiry'] = None
                json_response(route, 200, {'authenticated': False}, {'Set-Cookie': '__Host-becs_dashboard=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict'})
            elif not authenticated:
                json_response(route, 401, {'detail': 'Session expired'})
            elif path == '/api/overview':
                json_response(route, 200, {'stats': {'routes': 0, 'enabled_routes': 0, 'forwarded': 0,
                    'queued': 0, 'failed': 0, 'duplicates': 0, 'contracts': 0, 'reviews': 0},
                    'activity': [], 'graph': [0] * 12, 'cooldown_seconds': 0, 'paused': False,
                    'telegram': {'configured': True, 'connected': True, 'authorized': True},
                    'ai_configured': False, 'bot_configured': True})
            elif path == '/api/routes':
                json_response(route, 200, {'routes': []})
            elif path == '/api/jobs':
                json_response(route, 200, {'jobs': []})
            elif path == '/api/reviews':
                json_response(route, 200, {'reviews': []})
            elif path == '/api/inspector':
                json_response(route, 200, {'items': []})
            else:
                raise AssertionError('Unexpected API call: ' + path)

        context.route('**/*', serve)
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.clock.install(time=datetime.fromtimestamp(BASE_TIME / 1000, timezone.utc))
        page.goto('https://becs.test/')
        expect(page.get_by_role('heading', name='Unlock Becs')).to_be_visible()
        page.locator('#adminKey').fill(KEY)
        page.get_by_role('button', name='Unlock for 5 minutes').click()
        expect(page.get_by_role('heading', name='Command Center')).to_be_visible()
        expect(page.locator('#sessionBar')).to_be_visible()
        assert server['logins'] == 1
        assert page.evaluate("localStorage.getItem('becs_key')") is None
        assert page.evaluate("sessionStorage.getItem('becs_key')") is None
        assert '__Host-becs_dashboard' not in page.evaluate('document.cookie')
        original_expiry = server['expiry']
        server['now'] += 120000
        page.clock.fast_forward(120000)
        page.reload()
        expect(page.get_by_role('heading', name='Command Center')).to_be_visible()
        assert page.locator('#sessionCountdown').inner_text() in ('Locks in 3:00', 'Locks in 2:59')
        assert server['logins'] == 1 and server['expiry'] == original_expiry
        # Close/reopen the Mini App web page in the SAME cookie storage context.
        page.close()
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.clock.install(time=datetime.fromtimestamp(server['now'] / 1000, timezone.utc))
        page.goto('https://becs.test/')
        expect(page.get_by_role('heading', name='Command Center')).to_be_visible()
        assert server['logins'] == 1
        page.get_by_role('button', name='New route', exact=True).first.click()
        expect(page.locator('#routeForm')).to_be_visible()
        page.locator('#routeName').fill('Unsaved private draft')
        server['now'] = original_expiry
        page.clock.fast_forward(180000)
        expect(page.get_by_role('heading', name='Unlock Becs')).to_be_visible()
        expect(page.locator('#modal')).to_be_hidden()
        assert page.locator('#routeName').count() == 0
        assert server['logins'] == 1  # No silent login or refresh-token renewal.
        before = len(requests)
        status = page.evaluate("async () => { try { await BecsSession.request('/api/routes'); return 200; } catch(e) { return e.status; } }")
        assert status == 401 and len(requests) == before
        page.locator('#adminKey').fill(KEY)
        page.get_by_role('button', name='Unlock for 5 minutes').click()
        expect(page.get_by_role('heading', name='Command Center')).to_be_visible()
        page.get_by_role('button', name='Log out', exact=True).click()
        expect(page.get_by_role('heading', name='Unlock Becs')).to_be_visible()
        assert server['logout'] == 1
        page.reload()
        expect(page.get_by_role('heading', name='Unlock Becs')).to_be_visible()
        assert server['logins'] == 2
        assert not any(path in ('/api/control/pause', '/api/telegram/disconnect') for _, path in requests)
        assert not errors, errors
        print('PASS: mobile login, cookie-only persistence, reload/reopen, fixed expiry, stale-draft clearing, manual logout; forwarding untouched')
        browser.close()


if __name__ == '__main__':
    run()
