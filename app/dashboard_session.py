"""Five-minute dashboard sessions, independent of Telegram forwarding sessions."""
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
from collections import OrderedDict, deque
from contextlib import closing
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from .db import connection

LIFETIME = 300  # Absolute seconds from login. Never refresh this on activity.
COOKIE = '__Host-becs_dashboard'
PUBLIC_PATHS = {'/api/health', '/api/auth/login', '/api/auth/session', '/api/auth/logout'}
SAFE_METHODS = {'GET', 'HEAD', 'OPTIONS'}
_attempts = OrderedDict()
_attempt_lock = threading.Lock()


def init_sessions():
    with closing(connection()) as db, db:
        db.execute('''CREATE TABLE IF NOT EXISTS dashboard_sessions (
            token_hash TEXT PRIMARY KEY, issued_at REAL NOT NULL,
            expires_at REAL NOT NULL, method TEXT NOT NULL,
            credential_tag TEXT NOT NULL, csrf TEXT NOT NULL
        )''')
        db.execute('CREATE INDEX IF NOT EXISTS dashboard_session_expiry ON dashboard_sessions(expires_at)')
        db.execute('DELETE FROM dashboard_sessions WHERE expires_at<=?', (time.time(),))


def credential_tag(method):
    secret = os.getenv('BECS_SESSION_SECRET', '')
    if len(secret) < 32:
        return ''
    if method == 'admin':
        credential = os.getenv('BECS_ADMIN_TOKEN', '')
    elif method == 'telegram':
        credential = os.getenv('TELEGRAM_BOT_TOKEN', '')
        if not os.getenv('BECS_ALLOWED_TELEGRAM_ID', ''):
            return ''
        credential += ':' + os.getenv('BECS_ALLOWED_TELEGRAM_ID', '')
    else:
        return ''
    if not credential:
        return ''
    return hmac.new(secret.encode(), (method + ':' + credential).encode(), hashlib.sha256).hexdigest()


def token_hash(request):
    token = request.cookies.get(COOKIE, '')
    if not re.fullmatch(r'[A-Za-z0-9_-]{43}', token):
        return None
    return hashlib.sha256(token.encode()).hexdigest()


def read_session(request):
    digest = token_hash(request)
    if not digest:
        return None
    with closing(connection()) as db:
        row = db.execute('SELECT * FROM dashboard_sessions WHERE token_hash=?', (digest,)).fetchone()
    if row is None:
        return None
    now = time.time()
    if not row['issued_at'] <= now < row['expires_at']:
        return None
    if row['expires_at'] - row['issued_at'] != LIFETIME:
        return None
    tag = credential_tag(row['method'])
    if not tag or not hmac.compare_digest(tag, row['credential_tag']):
        return None
    return dict(row)


def trusted_browser(request):
    # Custom header prevents a cross-origin HTML form from invoking login/logout.
    if request.headers.get('x-becs-client') != 'mini-app':
        return False
    if request.headers.get('sec-fetch-site') == 'cross-site':
        return False
    origin = request.headers.get('origin')
    if origin:
        parsed = urlsplit(origin)
        if parsed.netloc.lower() != request.url.netloc.lower():
            return False
        if parsed.scheme != 'https' and not (
            parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1', '::1')
        ):
            return False
    return True


def valid_write(request, session):
    csrf = request.headers.get('x-becs-csrf', '')
    return trusted_browser(request) and hmac.compare_digest(csrf.encode(), session['csrf'].encode())


def authorize(request):
    session = read_session(request)
    request.state.dashboard_session = session
    if session is None:
        return False
    return request.method in SAFE_METHODS or valid_write(request, session)


def clear_cookie(response):
    response.delete_cookie(COOKIE, path='/', secure=True, httponly=True, samesite='strict')


def denial(request):
    active = getattr(request.state, 'dashboard_session', None)
    response = JSONResponse(
        status_code=403 if active else 401,
        content={'detail': 'Request verification failed. Reopen Becs.' if active else
                 'Dashboard locked. Unlock for five minutes; forwarding continues.',
                 'code': 'request_verification' if active else 'session_required'},
        headers={'Cache-Control': 'no-store'},
    )
    if not active:
        clear_cookie(response)
    return response


def session_response(session):
    return JSONResponse({
        'authenticated': True,
        'issued_at': session['issued_at'] * 1000,
        'expires_at': session['expires_at'] * 1000,
        'server_time': time.time() * 1000,
        'csrf_token': session['csrf'],
        'lifetime_seconds': LIFETIME,
    }, headers={'Cache-Control': 'no-store'})


def check_login_limit(request):
    # Bounded per-process login limiter. No credentials, headers or payloads are logged.
    address = request.client.host if request.client else 'unknown'
    now = time.monotonic()
    with _attempt_lock:
        attempts = _attempts.setdefault(address, deque())
        while attempts and attempts[0] <= now - 60:
            attempts.popleft()
        if len(attempts) >= 8:
            raise HTTPException(429, 'Too many unlock attempts. Wait one minute.', headers={'Retry-After': '60'})
        attempts.append(now)
        _attempts.move_to_end(address)
        while len(_attempts) > 512:
            _attempts.popitem(last=False)


async def read_login_payload(request):
    if request.headers.get('content-type', '').split(';')[0].strip() != 'application/json':
        raise HTTPException(415, 'Send JSON from the Becs unlock screen.')
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 12288:
            raise HTTPException(413, 'Unlock request is too large.')
    try:
        data = json.loads(body)
    except (ValueError, UnicodeError):
        raise HTTPException(400, 'Invalid unlock request.')
    if not isinstance(data, dict) or set(data) - {'admin_token', 'init_data'}:
        raise HTTPException(400, 'Invalid unlock request.')
    key, raw = data.get('admin_token', ''), data.get('init_data', '')
    if not isinstance(key, str) or not isinstance(raw, str) or len(key) > 2048 or len(raw) > 8192:
        raise HTTPException(400, 'Invalid unlock request.')
    if bool(key) == bool(raw):
        raise HTTPException(400, 'Supply one authentication method.')
    return key, raw


def install(app, telegram_validator):
    router = APIRouter(prefix='/api/auth')

    @router.get('/session')
    def status(request: Request):
        session = read_session(request)
        if not session:
            return denial(request)
        # Do not set a new cookie or extend the expiry on a read/reopen.
        return session_response(session)

    @router.post('/login')
    async def login(request: Request):
        if not trusted_browser(request):
            raise HTTPException(403, 'Open the Becs unlock screen to sign in.')
        active = read_session(request)
        if active:
            # Repeated login clicks cannot renew an already active session.
            if not valid_write(request, active):
                raise HTTPException(403, 'Request verification failed.')
            return session_response(active)
        check_login_limit(request)
        key, raw = await read_login_payload(request)
        configured = os.getenv('BECS_ADMIN_TOKEN', '')
        if key:
            accepted = bool(configured) and hmac.compare_digest(key.encode(), configured.encode())
            method = 'admin'
        else:
            accepted = telegram_validator(raw)
            method = 'telegram'
        if not accepted:
            raise HTTPException(401, 'Unable to unlock. Check your access key or Telegram account.')
        tag = credential_tag(method)
        if not tag:
            raise HTTPException(503, 'Dashboard session security is not configured on the server.')
        token = secrets.token_urlsafe(32)
        now = time.time()
        session = {'issued_at': now, 'expires_at': now + LIFETIME, 'csrf': secrets.token_urlsafe(24)}
        with closing(connection()) as db, db:
            db.execute('DELETE FROM dashboard_sessions WHERE expires_at<=?', (now,))
            db.execute('INSERT INTO dashboard_sessions VALUES(?,?,?,?,?,?)', (
                hashlib.sha256(token.encode()).hexdigest(), now, now + LIFETIME,
                method, tag, session['csrf'],
            ))
        response = session_response(session)
        response.set_cookie(COOKIE, token, max_age=LIFETIME, path='/',
                            secure=True, httponly=True, samesite='strict')
        return response

    @router.post('/logout')
    def logout(request: Request):
        if not trusted_browser(request):
            raise HTTPException(403, 'Open Becs to log out.')
        session = read_session(request)
        if session and not valid_write(request, session):
            raise HTTPException(403, 'Request verification failed.')
        digest = token_hash(request)
        if digest:
            with closing(connection()) as db, db:
                db.execute('DELETE FROM dashboard_sessions WHERE token_hash=?', (digest,))
        response = JSONResponse({'authenticated': False}, headers={'Cache-Control': 'no-store'})
        clear_cookie(response)
        return response

    app.include_router(router)
