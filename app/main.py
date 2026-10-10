"""Becs: personal Telegram crypto forwarding bot and Mini App API."""
import asyncio
import hashlib
import hmac
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import parse_qsl

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / '.env')

import regex as safe_regex
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import dashboard_session
from .models import RouteInput, Simulation, PhoneInput, CodeInput, PasswordInput, ReviewAction
from pydantic import BaseModel, Field
from typing import Literal
from .db import connection, init_db, as_dict, get_setting, set_setting, event
from .engine import decide, dedup_fingerprint
from .service import get_routes, enqueue, delivery_worker
from .telegram_client import PersonalTelegram, telegram_bot_poll

logging.basicConfig(level=os.getenv('BECS_LOG_LEVEL','INFO'))
ROOT=Path(__file__).resolve().parents[1]
STATIC=ROOT / 'static'
manager=PersonalTelegram()


def is_valid_init_data(raw: str) -> bool:
    token=os.getenv('TELEGRAM_BOT_TOKEN','')
    allowed=os.getenv('BECS_ALLOWED_TELEGRAM_ID','')
    if not raw or not token or not allowed or len(raw)>8192:return False
    try:
        data=dict(parse_qsl(raw,keep_blank_values=True,strict_parsing=True))
        given=data.pop('hash')
        # Ed25519 signature is not included in Bot API HMAC validation.
        data.pop('signature',None)
        timestamp=int(data['auth_date'])
        if not 0<=time.time()-timestamp<=86400:return False
        text='\n'.join(f'{k}={v}' for k,v in sorted(data.items()))
        secret=hmac.new(b'WebAppData',token.encode(),hashlib.sha256).digest()
        expected=hmac.new(secret,text.encode(),hashlib.sha256).hexdigest()
        if not hmac.compare_digest(given,expected):return False
        return str(json.loads(data['user'])['id'])==allowed
    except (ValueError,KeyError,TypeError,OverflowError):
        return False


def is_authorized(request: Request)->bool:
    # Login credentials are exchanged once; protected APIs require a timed session.
    return dashboard_session.authorize(request)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    dashboard_session.init_sessions()
    stop=asyncio.Event()
    try:
        if os.getenv('TELEGRAM_API_ID') and os.getenv('TELEGRAM_API_HASH'):
            await manager.ensure_client()
    except Exception:
        logging.exception('Telegram account not connected; use Settings to authorize')
    tasks=[asyncio.create_task(delivery_worker(manager,stop)),asyncio.create_task(telegram_bot_poll(manager,stop))]
    yield
    stop.set()
    for task in tasks: task.cancel()
    await asyncio.gather(*tasks,return_exceptions=True)
    await manager.disconnect()


app=FastAPI(title='Becs Crypto Forwarding',version='1.0.0',lifespan=lifespan,docs_url=None,redoc_url=None)
dashboard_session.install(app, is_valid_init_data)

@app.middleware('http')
async def protect_api(request:Request,call_next):
    if request.url.path.startswith('/api/') and request.url.path not in dashboard_session.PUBLIC_PATHS and not is_authorized(request):
        return dashboard_session.denial(request)
    response=await call_next(request)
    if request.url.path.startswith('/api/'):
        response.headers['Cache-Control']='no-store'
    response.headers['X-Content-Type-Options']='nosniff'
    return response

@app.get('/api/health')
def health():return {'ok':True,'service':'becs','version':'1.0.0','dashboard_session_seconds':300}

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
            'bot_configured':bool(os.getenv('TELEGRAM_BOT_TOKEN'))}

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
          route.dedup_minutes,route.delivery_style,now]
    if route_id:
        db.execute('''UPDATE routes SET name=?,mode=?,enabled=?,sources=?,destinations=?,allowed=?,blocked=?,pattern=?,
            match_mode=?,network=?,require_contract=?,dedup_minutes=?,delivery_style=?,updated_at=? WHERE id=?''',
            [*vals,route_id])
        return route_id
    cur=db.execute('''INSERT INTO routes(name,mode,enabled,sources,destinations,allowed,blocked,pattern,match_mode,
        network,require_contract,dedup_minutes,delivery_style,updated_at,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',[ *vals,now])
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
    try: route = await canonicalize_route(route)
    except HTTPException: raise
    except Exception as ex: raise HTTPException(422, str(ex)[:180])
    with connection() as db:
        if not db.execute('SELECT 1 FROM routes WHERE id=?',(route_id,)).fetchone():raise HTTPException(404,'Route not found')
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
    allowed={'all','blocked','duplicate','queued','forwarded','review','error','contract','ai'}
    if kind not in allowed: raise HTTPException(422,'Unknown event kind')
    with connection() as db:
        sql="""SELECT e.*,r.name AS route_name FROM events e
            LEFT JOIN routes r ON r.id=e.route_id"""
        if kind=='all':
            rows=db.execute(sql+" WHERE e.kind IN ('blocked','duplicate','queued','forwarded','review','error','contract','ai') ORDER BY e.id DESC LIMIT ?",(limit,)).fetchall()
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
