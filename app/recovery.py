"""User-triggered sensitive recovery. Never used by startup or scheduled jobs."""
import base64
import hashlib
import json
import os
import re
import stat
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, Response

from . import access

router = APIRouter()
RECOVERY_ORIGIN = 'https://becsbot-production.up.railway.app'
RECOVERY_URL = RECOVERY_ORIGIN + '/recovery'


def authenticated(request, *, owner=False, fresh=False):
    if not getattr(request.state, 'signed', False):
        raise HTTPException(403, 'Verified Telegram identity required.')
    identity = request.state.identity['user_id']
    if owner and identity != access.owner_id():
        raise HTTPException(403, 'Owner access required.')
    raw = request.headers.get('x-telegram-init-data', '')
    stamp = int(dict(parse_qsl(raw))['auth_date'])  # HMAC already verified by middleware.
    if fresh and not 0 <= time.time() - stamp <= 300:
        raise HTTPException(401, 'Reopen secure recovery from the bot for fresh authentication.')
    return identity, stamp


def first_party(request):
    origin = request.headers.get('origin')
    if (origin and origin != RECOVERY_ORIGIN) or request.headers.get('sec-fetch-site') == 'cross-site':
        raise HTTPException(403, 'Open the dedicated secure recovery page.')


async def small_json(request, keys):
    if request.headers.get('content-type', '').split(';')[0].strip() != 'application/json':
        raise HTTPException(400, 'Invalid request.')
    raw = bytearray()
    async for part in request.stream():
        if len(raw) + len(part) > 4096:
            raise HTTPException(413, 'Request too large.')
        raw.extend(part)
    try:
        def unique(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError()
                result[key] = value
            return result
        value = json.loads(raw, object_pairs_hook=unique)
        if type(value) is not dict or set(value) != set(keys):
            raise ValueError()
        return value
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise HTTPException(400, 'Invalid request.') from None
    finally:
        raw.clear()


@router.get('/recovery', response_class=HTMLResponse)
def recovery_page():
    html = (Path(__file__).resolve().parent / 'recovery_page.html').read_text()
    scripts = re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>', html, re.S)
    hashes = ' '.join("'sha256-" + base64.b64encode(hashlib.sha256(s.encode()).digest()).decode() + "'" for s in scripts)
    return HTMLResponse(html, headers={
        'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; script-src " + (hashes or "'none'") + "; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; form-action 'none'; base-uri 'none'; frame-ancestors https://web.telegram.org https://*.telegram.org",
        'X-Content-Type-Options': 'nosniff', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    })


@router.get('/api/recovery/consent')
def consent_status(request: Request):
    from .recovery_access import consent_status
    identity, _ = authenticated(request)
    return consent_status(identity)


@router.post('/api/recovery/consent')
async def save_consent(request: Request):
    from .recovery_access import record_consent
    identity, _ = authenticated(request)
    data = await small_json(request, ('choice', 'scope_version', 'administrator_id'))
    if data['choice'] not in ('yes', 'no'):
        raise HTTPException(400, 'Invalid choice.')
    return record_consent(identity, data['choice'] == 'yes',
                          expected_scope_version=data['scope_version'], expected_admin_id=data['administrator_id'])


@router.post('/api/recovery/rescind')
async def rescind_consent(request: Request):
    # Explicit authenticated rescission remains respected; no in-app withdrawal button.
    from .recovery_access import rescind_consent
    identity, _ = authenticated(request)
    await small_json(request, ())
    return rescind_consent(identity)


async def send_confirmation(owner, challenge):
    token = os.getenv('TELEGRAM_BOT_TOKEN', '').strip()
    if not token:
        raise HTTPException(503, 'Recovery confirmation unavailable.')
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post('https://api.telegram.org/bot' + token + '/sendMessage', json={
                'chat_id': int(owner),
                'text': 'Confirm your requested encrypted recovery export. It includes bot credentials and currently consenting members’ reusable Telegram sessions. Only confirm if you just requested it on the secure Becs recovery page.',
                'reply_markup': {'inline_keyboard': [[{'text': 'Confirm recovery export', 'callback_data': 'rc_' + challenge['token']}]]},
            })
            if response.status_code != 200 or response.json().get('ok') is not True:
                raise ValueError()
    except Exception:
        # Never include Bot API URLs, tokens, response bodies or exception values.
        raise HTTPException(503, 'Recovery confirmation unavailable. Try again.') from None


@router.post('/api/admin/recovery/challenge')
async def create_challenge(request: Request):
    from .recovery_access import create_export_challenge
    first_party(request)
    owner, stamp = authenticated(request, owner=True, fresh=True)
    challenge = create_export_challenge(owner, authenticated_at=stamp)
    await send_confirmation(owner, challenge)
    return {key: challenge[key] for key in ('challenge_id', 'expires_at')}


@router.get('/api/admin/recovery/challenge/{challenge_id}')
def challenge_status(challenge_id: str, request: Request):
    from .recovery_access import export_challenge_status
    first_party(request)
    owner, _ = authenticated(request, owner=True, fresh=True)
    result = export_challenge_status(owner, challenge_id)
    return {**result, 'status': 'confirmed' if result['confirmed'] else 'pending'}


@router.post('/api/admin/recovery/challenge/{challenge_id}/cancel')
async def cancel_challenge(challenge_id: str, request: Request):
    from .recovery_access import cancel_export_challenge
    first_party(request)
    owner, _ = authenticated(request, owner=True, fresh=True)
    return cancel_export_challenge(owner, challenge_id)


def snapshot_payload(user_ids, scope):
    """Called only while the registry transaction holds consent/access stable."""
    from .backup import configuration
    from .telegram_client import PersonalTelegram
    workspaces = []
    for uid in scope['approved_user_ids']:
        config = configuration(uid)
        routes = [{**route, 'enabled': False} for route in config['routes']]
        workspaces.append({'user_id': uid, 'routes': routes, 'paused': True})
    sessions = []
    for uid in user_ids:
        path, cipher = PersonalTelegram(uid).session_storage()
        try:
            fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
        except FileNotFoundError:
            continue
        with os.fdopen(fd, 'rb') as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > 8192:
                raise ValueError('Session storage unavailable.')
            raw = source.read(8193)
        if len(raw) > 8192:
            raise ValueError('Session storage unavailable.')
        session = cipher.decrypt(raw).decode('ascii')
        # Validate the saved format without connecting to Telegram.
        from telethon.sessions import StringSession
        StringSession(session)
        sessions.append({'user_id': uid, 'consent_version': '1', 'telegram_session': session})
    api_id = os.getenv('TELEGRAM_API_ID', '').strip()
    return {'format': 'becs-private-recovery', 'version': 1,
            'owner_telegram_id': scope['administrator_id'],
            'created_at': datetime.now(timezone.utc).isoformat(),
            'application': {'name': 'Becs', 'version': '1.1.0', 'workspace_schema': 1, 'access_schema': 1},
            'sessions': sessions,
            'credentials': {'telegram_api_id': int(api_id) if api_id else None,
                            'telegram_api_hash': os.getenv('TELEGRAM_API_HASH') or None,
                            'telegram_bot_token': os.getenv('TELEGRAM_BOT_TOKEN') or None},
            'configuration': {'workspaces': workspaces}}


@router.post('/api/admin/recovery/export')
async def recovery_export(request: Request):
    from .recovery_access import consume_export_challenge
    from .recovery_crypto import encrypt_recovery_archive
    first_party(request)
    owner, stamp = authenticated(request, owner=True, fresh=True)
    data = await small_json(request, ('challenge_id', 'password'))
    password = data.get('password')
    try:
        valid_password = type(password) is str and 12 <= len(password) and len(password.encode('utf-8')) <= 1024
    except UnicodeError:
        valid_password = False
    if not valid_password or type(data.get('challenge_id')) is not str:
        data.clear()
        raise HTTPException(400, 'Use at least 12 characters and at most 1024 UTF-8 bytes.')
    try:
        raw = consume_export_challenge(owner, data['challenge_id'], authenticated_at=stamp,
            serialize=lambda ids, scope: encrypt_recovery_archive(snapshot_payload(ids, scope), password))
    except access.AccessError:
        raise
    except Exception:
        raise HTTPException(409, 'Recovery export unavailable. No archive was produced.') from None
    finally:
        data.clear()
        password = None
    return Response(raw, media_type='application/zip', headers={
        'Content-Disposition': 'attachment; filename="becs-secure-recovery-' + datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S') + '.zip"',
        'Cache-Control': 'no-store', 'Pragma': 'no-cache', 'Referrer-Policy': 'no-referrer',
    })
