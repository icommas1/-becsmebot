import asyncio
import hashlib
import json
import logging
import time
from .db import connection, event, get_setting, set_setting
from .engine import decide,dedup_fingerprint
from .ai import evaluate_text

logger=logging.getLogger('becs.service')


def get_routes():
    from .db import as_dict
    with connection() as db:
        return [as_dict(r) for r in db.execute('SELECT * FROM routes ORDER BY updated_at DESC')]


def enqueue(db,route,src,dest,msg_id,text,fp):
    now=time.time()
    window=86400
    if window:
        existing=db.execute('''SELECT id FROM jobs WHERE destination_id=? AND fingerprint=? AND
            status IN ('queued','sending','sent') AND created_at>=? LIMIT 1''',(dest,fp,now-window)).fetchone()
        if existing:
            event(db,'duplicate',f"Duplicate Telegram message suppressed → {dest}",route['id'],src,dest)
            return False
    db.execute('''INSERT INTO jobs(route_id,source_id,destination_id,message_id,message_preview,fingerprint,status,created_at,next_attempt)
        VALUES (?,?,?,?,?,?, 'queued',?,0)''',(route['id'],src,dest,msg_id,'',fp,now))
    event(db,'queued',f"Delivery queued → {dest}",route['id'],src,dest)
    return True


async def ingest_message(source_id: str, message_id: int, text: str, service):
    """Forward selected Telegram messages without retaining or analyzing content.

    The message text is never written to SQLite or an AI service.
    Only route IDs, Telegram message IDs, and delivery status are queued.
    """
    if get_setting('paused','false')=='true': return
    routes=[r for r in get_routes() if r['enabled'] and source_id in r['sources']]
    for route in routes:
        for dest in route['destinations']:
            if dest==source_id: continue
            # Prevent the same Telegram message being queued twice for this route.
            # No content fingerprint or address extraction.
            fp=hashlib.sha256(f"{route['id']}:{source_id}:{message_id}:{dest}".encode()).hexdigest()
            with connection() as db:
                enqueue(db,route,source_id,dest,message_id,'',fp)


async def delivery_worker(manager, stop: asyncio.Event):
    """Sequential send loop. One outbound send at a time, honoring Telegram flood waits."""
    while not stop.is_set():
        try:
            if get_setting('paused','false')=='true':
                await asyncio.sleep(0.6);continue
            # Telegram FLOOD_WAIT is account-wide. Do not attempt other sends until it expires.
            try: cooldown=float(get_setting('account_cooldown_until','0'))
            except ValueError: cooldown=0
            if time.time()<cooldown:
                await asyncio.sleep(min(1.0,cooldown-time.time()));continue
            status=await manager.status()
            if not status['authorized']:
                await asyncio.sleep(1);continue
            with connection() as db:
                row=db.execute("""SELECT j.*,r.delivery_style FROM jobs j JOIN routes r ON r.id=j.route_id
                  WHERE j.status='queued' AND j.next_attempt<=? ORDER BY j.created_at, j.id LIMIT 1""",(time.time(),)).fetchone()
                if row:
                    job=dict(row)
                    db.execute("UPDATE jobs SET status='sending' WHERE id=?",(job['id'],))
                else:job=None
            if not job:
                await asyncio.sleep(0.25);continue
            try:
                await manager.send(job,'native')
                with connection() as db:
                    db.execute("UPDATE jobs SET status='sent',sent_at=?,error='' WHERE id=?",(time.time(),job['id']))
                    event(db,'forwarded',f"Delivered → {job['destination_id']}",job['route_id'],job['source_id'],job['destination_id'])
            except Exception as ex:
                attempts=job['attempts']+1
                seconds=getattr(ex,'seconds',None)
                if isinstance(seconds,int) and seconds>0:
                    delay=min(seconds+1,86400);label=f'Telegram cooldown: {seconds}s';status='queued'
                    if 'FloodWait' in type(ex).__name__:
                        set_setting('account_cooldown_until',str(time.time()+delay))
                elif attempts<=3:
                    delay=[3,15,60][attempts-1];label=type(ex).__name__+' (retry scheduled)';status='queued'
                else:
                    delay=0;label=type(ex).__name__+' (failed)';status='failed'
                with connection() as db:
                    db.execute("UPDATE jobs SET status=?,attempts=?,next_attempt=?,error=? WHERE id=?",
                               (status,attempts,time.time()+delay,label,job['id']))
                    event(db,'error',label,job['route_id'],job['source_id'],job['destination_id'])
                logger.warning('Delivery issue (%s) for job %s',type(ex).__name__,job['id'])
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception('Delivery worker unexpected error')
            await asyncio.sleep(2)
