"""Becs: personal Telegram crypto forwarding bot and Mini App API."""
import asyncio
import hashlib
import hmac
import json
import logging
import sqlite3
import os
import time
from contextlib import asynccontextmanager, nullcontext
from collections import defaultdict, deque
from pathlib import Path
from urllib.parse import parse_qsl

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / '.env')

import regex as safe_regex
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from .models import RouteInput, Simulation, PhoneInput, CodeInput, PasswordInput, ReviewAction
from pydantic import BaseModel, Field
from typing import Literal
from .db import connection, init_db, as_dict, get_setting, set_setting, event, workspace, current_workspace
from . import access
from .runtime import RuntimeRegistry
from .engine import decide, dedup_fingerprint
from .service import get_routes, enqueue, delivery_worker
from .telegram_client import PersonalTelegram, telegram_bot_poll
from .config import load_config, telegram_bot_username
from .upgrade_store import overview_fields, RELEASE_LEVEL
from .upgrade_api import router as upgrade_router

logging.basicConfig(level=os.getenv('BECS_LOG_LEVEL','INFO'))
# HTTP client request logs can contain Telegram bot tokens in URL paths.
logging.getLogger('httpx').setLevel(logging.WARNING)
ROOT=Path(__file__).resolve().parents[1]
STATIC=ROOT / 'static'
runtime = RuntimeRegistry()
config = load_config()


class WorkspaceManager:
    """Resolve the account only from the server-authenticated workspace context."""
    def __getattr__(self, name):
        return getattr(runtime.get(current_workspace.get() or access.owner_id()), name)


manager = WorkspaceManager()
_request_locks = {}
_login_attempts = defaultdict(deque)


def request_lock(user_id):
    # Only approved users have workspace requests: at most three active locks.
    if user_id not in _request_locks:
        _request_locks[user_id] = asyncio.Lock()
    return _request_locks[user_id]


@asynccontextmanager
async def request_scope(user_id, administration=False):
    # Registry transactions and target lifecycle locks protect admin mutations.
    # Do not let a slow approval/reconnect block a different revoke request.
    if administration:
        yield
    else:
        async with request_lock(user_id):
            yield

STARTED_AT=time.time()


def telegram_identity(raw: str):
    """Verify bot-token HMAC before trusting any Telegram user field."""
    token = os.getenv('TELEGRAM_BOT_TOKEN', '').strip()
    allowed = os.getenv('BECS_ALLOWED_TELEGRAM_ID', '').strip()
    if not token or not allowed:
        return 'server_configuration', None
    if not raw:
        return 'missing_init_data', None
    if len(raw) > 8192:
        return 'invalid_init_data', None
    try:
        pairs = parse_qsl(raw, keep_blank_values=True, strict_parsing=True)
        data = dict(pairs)
        if len(data) != len(pairs):
            return 'invalid_init_data', None
        given = data.pop('hash')
        # Telegram bot-token HMAC includes signature, excluding only hash.
        timestamp = int(data['auth_date'])
        text = chr(10).join(f'{k}={v}' for k, v in sorted(data.items()))
        secret = hmac.new(b'WebAppData', token.encode(), hashlib.sha256).digest()
        expected = hmac.new(secret, text.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(given, expected):
            return 'invalid_signature', None
        if not 0 <= time.time() - timestamp <= 86400:
            return 'expired_init_data', None
        user = json.loads(data['user'])
        user_id = user['id']
        if type(user_id) is not int or not 0 < user_id < 2**63 or user.get('is_bot'):
            return 'invalid_init_data', None
        return 'ok', {'user_id': str(user_id), 'display_name': str(user.get('first_name', ''))[:80]}
    except (ValueError, KeyError, TypeError, OverflowError):
        return 'invalid_init_data', None


def init_data_status(raw: str) -> str:
    """Compatibility helper for owner-only diagnostics; membership is separate."""
    reason, identity = telegram_identity(raw)
    if reason == 'ok' and identity['user_id'] != os.getenv('BECS_ALLOWED_TELEGRAM_ID', '').strip():
        return 'unauthorized_user'
    return reason


def is_valid_init_data(raw: str) -> bool:
    return init_data_status(raw)=='ok'


def is_owner(request: Request)->bool:
    return is_valid_init_data(request.headers.get('x-telegram-init-data',''))

def is_development_request(request):
    host = request.url.hostname
    client = request.client.host if request.client else ''
    return (os.getenv('BECS_DEV_MODE') == '1' and host in ('localhost', '127.0.0.1', '::1')
            and client in ('127.0.0.1', '::1'))


def is_authorized(request: Request) -> bool:
    reason, identity = telegram_identity(request.headers.get('x-telegram-init-data', ''))
    if reason == 'ok':
        return access.is_approved(identity['user_id'])
    configured = os.getenv('BECS_ADMIN_TOKEN', '')
    key = request.headers.get('x-becs-key', '')
    return is_development_request(request) or bool(configured and key and hmac.compare_digest(key, configured))


@asynccontextmanager
async def lifespan(app: FastAPI):
    access.init_access()
    with workspace(access.owner_id()):
        init_db()
    stop = asyncio.Event()
    await runtime.start(stop)
    logging.getLogger('becs').info('Forwarding upgrade level %s is running',RELEASE_LEVEL)
    try:
        yield
    finally:
        stop.set()
        await runtime.shutdown()


app=FastAPI(title=config.project_name,version='1.1.0',lifespan=lifespan,docs_url=None,redoc_url=None)
app.include_router(upgrade_router)


def denial(status, detail, reason):
    return JSONResponse(status_code=status, content={'detail': detail, 'reason': reason},
                        headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})


@app.exception_handler(access.AccessError)
async def access_error_handler(request, exc):
    return denial(exc.status_code, exc.detail, getattr(exc, 'reason', 'access_denied'))


@app.middleware('http')
async def protect_api(request: Request, call_next):
    path = request.url.path
    # Explicitly disabled: deny every sensitive operation, including cached clients.
    if path == '/recovery' or path.startswith('/api/admin/recovery') or (path.startswith('/api/recovery') and not (path == '/api/recovery/consent' and request.method == 'GET')):
        return denial(410, 'Rollback Recovery is disabled.', 'recovery_disabled')
    if request.method == 'OPTIONS':
        return await call_next(request)
    if path.startswith('/api/') and path != '/api/health':
        reason, identity = telegram_identity(request.headers.get('x-telegram-init-data', ''))
        signed = reason == 'ok'
        if not signed:
            configured = os.getenv('BECS_ADMIN_TOKEN', '')
            key = request.headers.get('x-becs-key', '')
            fallback = is_development_request(request) or bool(configured and key and hmac.compare_digest(key, configured))
            # An explicitly supplied invalid signature can never fall back to another identity.
            if not fallback or request.headers.get('x-telegram-init-data'):
                return denial(401, 'Telegram Mini App authentication failed', reason)
            owner = os.getenv('BECS_ALLOWED_TELEGRAM_ID', '').strip()
            # Unconfigured offline tests retain the legacy owner sandbox; not production.
            identity = {'user_id': owner or '1', 'display_name': 'Owner'}
        if path.startswith('/api/admin/') and not is_owner(request):
            return denial(403, 'Verified owner Telegram Mini App required', 'owner_required')
        try:
            if os.getenv('BECS_ALLOWED_TELEGRAM_ID', '').strip():
                access.init_access()
                user = access.get_user(identity['user_id'])
            else:
                user = {'user_id': identity['user_id'], 'telegram_id': identity['user_id'], 'status': 'approved', 'role': 'admin'}
            request.state.identity = identity
            request.state.signed = signed
            request.state.user = user
            if path in ('/api/me', '/api/recovery/rescind'):
                response = await call_next(request)
            else:
                if not user or user['status'] != 'approved':
                    status = user['status'] if user else 'not_invited'
                    return denial(403, 'Workspace access requires administrator approval', 'access_' + status)
                async with request_scope(identity['user_id'], path.startswith('/api/admin/')):
                    # Revocation can occur while a request waits for its workspace lock.
                    if os.getenv('BECS_ALLOWED_TELEGRAM_ID', '').strip() and not access.is_approved(identity['user_id']):
                        return denial(403, 'Workspace access has been revoked', 'access_revoked')
                    if path in ('/api/telegram/start', '/api/telegram/code', '/api/telegram/password'):
                        attempts = _login_attempts[identity['user_id']]
                        now = time.monotonic()
                        while attempts and attempts[0] < now - 900:
                            attempts.popleft()
                        if len(attempts) >= 12:
                            return denial(429, 'Too many sign-in attempts. Try again in 15 minutes.', 'rate_limited')
                        attempts.append(now)
                    with workspace(identity['user_id']) if os.getenv('BECS_ALLOWED_TELEGRAM_ID', '').strip() else nullcontext():
                        response = await call_next(request)
        except access.AccessError as exc:
            return denial(exc.status_code, exc.detail, getattr(exc, 'reason', 'access_denied'))
    else:
        response = await call_next(request)
    if path.startswith('/api/'):
        response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response

# Register CORS last so it wraps authentication, including early 401 responses.
# Explicitly configured Mini App origins may read the owner diagnostics.
# Authorization still requires Telegram's signed initData on every request.
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(config.frontend_origins),
    allow_credentials=False,
    allow_methods=['GET','POST','PUT','DELETE'],
    allow_headers=['X-Telegram-Init-Data','Accept','Content-Type'],
    max_age=600,
)

@app.get('/api/health')
def health():return {'ok':True,'service':'becs','version':'1.1.0'}


@app.get('/api/me')
def me(request: Request):
    identity = request.state.identity
    user = request.state.user or {'telegram_id': identity['user_id'], 'user_id': identity['user_id'],
                                  'display_name': identity['display_name'], 'status': 'not_invited', 'role': 'member'}
    return {'user': user, 'is_admin': request.state.signed and is_owner(request), 'capacity': 3}


@app.get('/api/admin/backups/status')
def backup_status():
    from .backup import backup_status as status
    try:
        return status()
    except (ValueError, sqlite3.Error) as exc:
        raise HTTPException(409, 'Backup unavailable. Workspace data may be missing, changed, or over the export limit.')


@app.get('/api/admin/backups/export')
def backup_export():
    from .backup import export_backup
    try:
        return JSONResponse(export_backup(), headers={'Cache-Control': 'no-store'})
    except (ValueError, sqlite3.Error) as exc:
        raise HTTPException(409, 'Backup unavailable. Workspace data may be missing, changed, or over the export limit.')


@app.get('/api/admin/users')
def users(request: Request):
    return {'users': access.list_users(request.state.identity['user_id']), 'capacity': 3}


def invite_response(invite):
    # The bearer token is returned once; never put it in logs or persisted frontend state.
    return {'id': invite['id'], 'url': 'https://t.me/' + configured_bot_username() + '?start=invite_' + invite['token'],
            'expires_at': invite['expires_at']}


def configured_bot_username():
    try:
        return telegram_bot_username(required=True)
    except ValueError:
        raise HTTPException(503, 'Configure BECS_TELEGRAM_BOT_USERNAME before creating invitations.') from None


@app.post('/api/admin/invites', status_code=201)
def invite_user(request: Request):
    configured_bot_username()
    return invite_response(access.create_invite(request.state.identity['user_id']))


@app.get('/api/admin/invites')
def invites(request: Request):
    return {'invites': access.list_invites(request.state.identity['user_id'])}


@app.delete('/api/admin/invites/{invite_id}')
def revoke_invite(invite_id: str, request: Request):
    access.revoke_invite(request.state.identity['user_id'], invite_id)
    return {'revoked': True}


@app.post('/api/admin/users/{user_id}/approve')
async def approve_user(user_id: str, request: Request):
    user = access.approve_user(request.state.identity['user_id'], user_id)
    try:
        await runtime.activate(user_id)
    except (PermissionError, asyncio.CancelledError):
        raise HTTPException(409, 'Approval was interrupted. Refresh Users to check current access.') from None
    return {'user': user}


@app.post('/api/admin/users/{user_id}/revoke')
async def revoke_user(user_id: str, request: Request):
    if user_id == access.owner_id():
        raise HTTPException(409, 'The administrator cannot be removed')
    # Close the persistent gate before any wait: a slow member request must not
    # delay revocation or permit its queue to keep delivering in the meantime.
    user = access.revoke_user(request.state.identity['user_id'], user_id)
    await runtime.revoke(user_id)
    # Drain any non-Telegram request that was already admitted. Telegram work is
    # tracked and cancelled by runtime.revoke; queued requests recheck access.
    async with request_lock(user_id):
        pass
    _login_attempts.pop(user_id, None)
    return {'user': user}


@app.post('/api/admin/users/{user_id}/reject')
def reject_user(user_id: str, request: Request):
    return {'user': access.reject_user(request.state.identity['user_id'], user_id)}


@app.post('/api/admin/users/{user_id}/reinvite', status_code=201)
def reinvite_user(user_id: str, request: Request):
    configured_bot_username()
    return invite_response(access.reinvite_user(request.state.identity['user_id'], user_id))

@app.get('/api/admin/status')
async def admin_status(request: Request):
    if not is_owner(request):
        raise HTTPException(403,'Verified owner Telegram Mini App required')
    with connection() as db:
        counts={name:db.execute(sql).fetchone()[0] for name,sql in {
            'routes':'SELECT COUNT(*) FROM routes',
            'active_routes':'SELECT COUNT(*) FROM routes WHERE enabled=1',
            'queued':"SELECT COUNT(*) FROM jobs WHERE status='queued'",
            'sending':"SELECT COUNT(*) FROM jobs WHERE status='sending'",
            'failed':"SELECT COUNT(*) FROM jobs WHERE status='failed'"
        }.items()}
    session=await manager.status()
    worker=runtime.worker_for(access.owner_id())
    return {'service':'becs','uptime_seconds':int(time.time()-STARTED_AT),
        'telegram':{'authorized':bool(session.get('authorized')),'configured':bool(session.get('configured'))},
        'bot_configured':bool(os.getenv('TELEGRAM_BOT_TOKEN')),
        'cooldown_seconds':max(0,int(float(get_setting('account_cooldown_until','0'))-time.time())),
        'paused':get_setting('paused','false')=='true','counts':counts,
        'components':{'api':'running','sqlite':'available','worker':'running' if worker and not worker.done() else 'unavailable'},
        'checked_at':int(time.time())}

@app.get('/api/overview')
async def overview():
    with connection() as db:
        def count(sql):return db.execute(sql).fetchone()[0]
        stats={
            'routes':count('SELECT COUNT(*) FROM routes'),
            'enabled_routes':count('SELECT COUNT(*) FROM routes WHERE enabled=1'),
            'forwarded':count("SELECT COUNT(*) FROM jobs WHERE status='sent'"),
            'queued':count("SELECT COUNT(*) FROM jobs WHERE status='queued'"),
            'failed':count("SELECT COUNT(*) FROM jobs WHERE status='failed'"),
            'duplicates':count("SELECT COUNT(*) FROM events WHERE kind='duplicate'"),
            'contracts':count('SELECT COUNT(*) FROM contracts'),
            'reviews':count("SELECT COUNT(*) FROM reviews WHERE status='pending'"),
        }
        activity=[dict(row) for row in db.execute('SELECT * FROM events ORDER BY id DESC LIMIT 18')]
        # Actual activity, not fabricated chart data.
        graph=[]; now=time.time()
        for i in range(11,-1,-1):
            end=now-i*3600; start=end-3600
            graph.append(db.execute(
                "SELECT COUNT(*) FROM jobs WHERE status='sent' AND sent_at>=? AND sent_at<?",(start,end)).fetchone()[0])
    cooldown_remaining=max(0,int(float(get_setting('account_cooldown_until','0'))-time.time()))
    return {'stats':stats,'activity':activity,'graph':graph,'cooldown_seconds':cooldown_remaining,'paused':get_setting('paused','false')=='true',
            'telegram':await manager.status(),'ai_configured':bool(os.getenv('GEMINI_API_KEY')),
        'bot_configured':bool(os.getenv('TELEGRAM_BOT_TOKEN')), **overview_fields()}

@app.post('/api/control/pause')
def pause():
    set_setting('paused','true');return {'paused':True}

@app.post('/api/control/resume')
def resume():
    set_setting('paused','false');return {'paused':False}

@app.get('/api/routes')
def routes():return {'routes':get_routes()}


def validate_route(route:RouteInput):
    if route.enabled and (not route.sources or not route.destinations):
        raise HTTPException(422,'Select at least one source and one destination before enabling a route.')
    if set(route.sources) & set(route.destinations):
        raise HTTPException(422,'A source and destination must not be the same chat (loop protection).')
    if route.pattern:
        try:safe_regex.compile(route.pattern)
        except safe_regex.error as ex:raise HTTPException(422,f'Invalid regex: {str(ex)[:100]}')


def save_route(db, route:RouteInput,route_id=None):
    now=time.time()
    vals=[route.name,route.mode,int(route.enabled),json.dumps(route.sources),json.dumps(route.destinations),
          route.allowed,route.blocked,route.pattern,route.match_mode,route.network,int(route.require_contract),
          route.dedup_minutes,route.delivery_style,int(route.shadow_mode),now]
    if route_id:
        db.execute('''UPDATE routes SET name=?,mode=?,enabled=?,sources=?,destinations=?,allowed=?,blocked=?,pattern=?,
            match_mode=?,network=?,require_contract=?,dedup_minutes=?,delivery_style=?,shadow_mode=?,updated_at=? WHERE id=?''',
            [*vals,route_id])
        return route_id
    cur=db.execute('''INSERT INTO routes(name,mode,enabled,sources,destinations,allowed,blocked,pattern,match_mode,
        network,require_contract,dedup_minutes,delivery_style,shadow_mode,updated_at,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',[ *vals,now])
    return cur.lastrowid


class ChatResolveInput(BaseModel):
    reference: str = Field(min_length=1, max_length=80)
    role: Literal['source', 'destination']

@app.post('/api/telegram/resolve')
async def resolve_chat(payload: ChatResolveInput):
    try:
        return await manager.resolve_chat(payload.reference, payload.role)
    except Exception as ex:
        raise HTTPException(422, str(ex)[:180])

async def canonicalize_route(route: RouteInput):
    # Preserve all other route fields. Resolve both new and legacy references at save time.
    sources = [await manager.resolve_chat(ref, 'source') for ref in route.sources]
    destinations = [await manager.resolve_chat(ref, 'destination') for ref in route.destinations]
    source_ids = list(dict.fromkeys(item['id'] for item in sources))
    destination_ids = list(dict.fromkeys(item['id'] for item in destinations))
    if set(source_ids) & set(destination_ids):
        raise HTTPException(422, 'A chat cannot be both source and destination')
    return route.model_copy(update={'sources':source_ids, 'destinations':destination_ids})

@app.post('/api/routes')
async def create_route(route:RouteInput):
    validate_route(route)
    try: route = await canonicalize_route(route)
    except HTTPException: raise
    except Exception as ex: raise HTTPException(422, str(ex)[:180])
    with connection() as db:
        id=save_route(db,route)
        event(db,'route',f'Route created: {route.name}',id)
        return {'route':as_dict(db.execute('SELECT * FROM routes WHERE id=?',(id,)).fetchone())}

@app.put('/api/routes/{route_id}')
async def update_route(route_id:int,route:RouteInput):
    validate_route(route)
    if 'shadow_mode' not in route.model_fields_set:
        with connection() as db:
            existing=db.execute('SELECT shadow_mode FROM routes WHERE id=?',(route_id,)).fetchone()
        if existing:
            route=route.model_copy(update={'shadow_mode':bool(existing['shadow_mode'])})
    try: route = await canonicalize_route(route)
    except HTTPException: raise
    except Exception as ex: raise HTTPException(422, str(ex)[:180])
    with connection() as db:
        if not db.execute('SELECT 1 FROM routes WHERE id=?',(route_id,)).fetchone():raise HTTPException(404,'Route not found')
        if route.shadow_mode:
            if db.execute("SELECT 1 FROM jobs WHERE route_id=? AND status='sending' LIMIT 1",(route_id,)).fetchone():
                raise HTTPException(409,'A delivery is in progress. Try Shadow Mode when it finishes.')
            db.execute("UPDATE jobs SET status='failed',error=? WHERE route_id=? AND status='queued'",
                       ('Route switched to Shadow Mode; verify before retrying',route_id))
        save_route(db,route,route_id)
        event(db,'route',f'Route updated: {route.name}',route_id)
        return {'route':as_dict(db.execute('SELECT * FROM routes WHERE id=?',(route_id,)).fetchone())}

@app.delete('/api/routes/{route_id}')
def delete_route(route_id:int):
    with connection() as db:
        r=db.execute('SELECT name FROM routes WHERE id=?',(route_id,)).fetchone()
        if not r:raise HTTPException(404,'Route not found')
        # Preserve history; attached jobs prevent deletion while still in flight.
        pending=db.execute("SELECT COUNT(*) FROM jobs WHERE route_id=? AND status IN ('queued','sending')",(route_id,)).fetchone()[0]
        if pending:raise HTTPException(409,'Clear or finish pending jobs for this route before deleting it.')
        event(db,'route',f'Route deleted: {r["name"]}',None)
        db.execute('DELETE FROM routes WHERE id=?',(route_id,))
    return {'deleted':True}

@app.post('/api/simulate')
def simulate(payload:Simulation):
    result=decide(payload.text,payload.route.model_dump())
    result['fingerprint']=dedup_fingerprint(payload.text,result)[:16]
    return result

@app.get('/api/inspector')
def inspector(limit:int=100, kind:str='all'):
    limit=max(1,min(limit,200))
    allowed={'all','blocked','duplicate','queued','forwarded','review','error','contract','ai','shadow'}
    if kind not in allowed: raise HTTPException(422,'Unknown event kind')
    with connection() as db:
        sql="""SELECT e.*,r.name AS route_name FROM events e
            LEFT JOIN routes r ON r.id=e.route_id"""
        if kind=='all':
            rows=db.execute(sql+" WHERE e.kind IN ('blocked','duplicate','queued','forwarded','review','error','contract','ai','shadow') ORDER BY e.id DESC LIMIT ?",(limit,)).fetchall()
        else:
            rows=db.execute(sql+" WHERE e.kind=? ORDER BY e.id DESC LIMIT ?",(kind,limit)).fetchall()
    return {'items':[dict(row) for row in rows], 'source':'recorded_events'}

@app.get('/api/jobs')
def jobs(status:str='all',limit:int=100):
    limit=max(1,min(limit,200))
    if status not in ('all','queued','sending','sent','failed'):raise HTTPException(422,'Unknown job status')
    with connection() as db:
        if status=='all': data=db.execute('SELECT * FROM jobs ORDER BY id DESC LIMIT ?',(limit,)).fetchall()
        else:data=db.execute('SELECT * FROM jobs WHERE status=? ORDER BY id DESC LIMIT ?',(status,limit)).fetchall()
    return {'jobs':[dict(row) for row in data]}

@app.post('/api/jobs/{job_id}/retry')
def retry_job(job_id:int):
    with connection() as db:
        row=db.execute('SELECT * FROM jobs WHERE id=?',(job_id,)).fetchone()
        if not row:raise HTTPException(404,'Job not found')
        if row['status']!='failed':raise HTTPException(409,'Only failed jobs can be retried')
        if db.execute('SELECT shadow_mode FROM routes WHERE id=?',(row['route_id'],)).fetchone()[0]:
            raise HTTPException(409,'This route is in Shadow Mode. It cannot send queued jobs.')
        db.execute("UPDATE jobs SET status='queued', attempts=0, next_attempt=0, error='' WHERE id=?",(job_id,))
        event(db,'queued',f'Job #{job_id} manually retried',row['route_id'])
    return {'queued':True}

@app.get('/api/reviews')
def reviews():
    with connection() as db:data=db.execute("SELECT * FROM reviews WHERE status='pending' ORDER BY id DESC LIMIT 100").fetchall()
    return {'reviews':[dict(x) for x in data]}

@app.post('/api/reviews/{review_id}')
def decide_review(review_id:int,payload:ReviewAction):
    with connection() as db:
        rev=db.execute('SELECT * FROM reviews WHERE id=?',(review_id,)).fetchone()
        if not rev:raise HTTPException(404,'Review item not found')
        if rev['status']!='pending':raise HTTPException(409,'Review already resolved')
        route_row=db.execute('SELECT * FROM routes WHERE id=?',(rev['route_id'],)).fetchone()
        if not route_row:raise HTTPException(409,'Associated route no longer exists')
        if payload.approve:
            route=as_dict(route_row)
            result=decide(rev['text'],route)
            if result['decision']!='forward':raise HTTPException(409,'Message no longer passes hard route filters')
            queued=enqueue(db,route,rev['source_id'],rev['destination_id'],rev['message_id'],rev['text'],rev['fingerprint'])
            db.execute("UPDATE reviews SET status=? WHERE id=?",('approved' if queued else 'duplicate',review_id))
        else:
            db.execute("UPDATE reviews SET status='rejected' WHERE id=?",(review_id,))
            event(db,'blocked',f'Review #{review_id} rejected',rev['route_id'])
    return {'resolved':True}

@app.get('/api/telegram/chats')
async def telegram_chats():
    try:return {'chats':await manager.chats()}
    except Exception as ex:raise HTTPException(400,str(ex)[:200])

@app.post('/api/telegram/start')
async def login_start(payload:PhoneInput):
    try:return await manager.start_phone(payload.phone)
    except Exception as ex:raise HTTPException(400,f'{type(ex).__name__}: {str(ex)[:200]}')

@app.post('/api/telegram/code')
async def login_code(payload:CodeInput):
    try:return await manager.sign_in_code(payload.code)
    except Exception as ex:raise HTTPException(400,f'{type(ex).__name__}: {str(ex)[:200]}')

@app.post('/api/telegram/password')
async def login_password(payload:PasswordInput):
    try:return await manager.sign_in_password(payload.password)
    except Exception as ex:raise HTTPException(400,f'{type(ex).__name__}: {str(ex)[:200]}')

@app.post('/api/telegram/disconnect')
async def disconnect_telegram():
    await manager.disconnect(logout=False)
    return {'connected':False,'detail':'Server connection closed; authorized session retained'}

app.mount('/assets',StaticFiles(directory=str(STATIC)),name='assets')
@app.get('/')
async def index():return FileResponse(STATIC/'index.html')

# Compatibility response lets an older cached Mini App proceed without prompting.
# No consent storage or sensitive recovery router is loaded.
@app.get('/api/recovery/consent')
def disabled_recovery_consent(request: Request):
    return {'required': False, 'choice': 'no', 'enabled': False, 'scope_version': '1',
            'administrator': {'user_id': access.owner_id(), 'display_name': 'Administrator'}}
