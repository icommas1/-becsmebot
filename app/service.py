import asyncio
import hashlib
import json
import logging
import time
from .db import connection, event, get_setting, set_setting, workspace, current_workspace
from .engine import decide,dedup_fingerprint
from .ai import evaluate_text

logger=logging.getLogger('becs.service')


def get_routes():
    from .db import as_dict
    with connection() as db:
        return [as_dict(r) for r in db.execute('SELECT * FROM routes ORDER BY updated_at DESC')]


def enqueue(db,route,src,dest,msg_id,text,fp):
    now=time.time()
    window=route['dedup_minutes']*60
    if window and fp:
        existing=db.execute('''SELECT id FROM jobs WHERE destination_id=? AND fingerprint=? AND
            status IN ('queued','sending','sent') AND created_at>=? LIMIT 1''',(dest,fp,now-window)).fetchone()
        if existing:
            event(db,'duplicate',f"Duplicate contract address suppressed → {dest}",route['id'],src,dest)
            return False
    db.execute('''INSERT INTO jobs(route_id,source_id,destination_id,message_id,message_preview,fingerprint,status,created_at,next_attempt)
        VALUES (?,?,?,?,?,?, 'queued',?,0)''',(route['id'],src,dest,msg_id,text,fp,now))
    event(db,'queued',f"Delivery queued → {dest}",route['id'],src,dest)
    return True


async def ingest_message(source_id: str, message_id: int, text: str, service):
    """Extract addresses in memory; queue only the contract address, never other text or media."""
    if service is not None and hasattr(service, 'check_access'):
        service.check_access()
    if get_setting('paused','false')=='true': return
    from .engine import extract_addresses
    addresses=extract_addresses(text)
    if not addresses: return
    for route in get_routes():
        if not route['enabled'] or source_id not in route['sources']:continue
        # Optional keyword controls affect eligibility, never the forwarded payload.
        lower=text.lower()
        from .engine import split_terms
        # Filters only inspect the incoming text in memory. No message body is saved.
        import regex as safe_regex
        def matches_rule(rule):
            rule=rule.strip()
            if not rule:return False
            if rule.startswith('re:'):
                pattern=rule[3:]
                if len(pattern)>250:return False
                try:return bool(safe_regex.search(pattern,text,flags=safe_regex.IGNORECASE,timeout=0.025))
                except (safe_regex.error,TimeoutError,ValueError):return False
            return rule.lower() in lower
        blocked=route.get('blocked','')
        if blocked.startswith('re:'):
            if matches_rule(blocked):continue
        elif any(matches_rule(word) for word in split_terms(blocked)):continue
        allowed=route.get('allowed','')
        if allowed.startswith('re:'):
            if not matches_rule(allowed):continue
        elif allowed:
            terms=split_terms(allowed)
            hits=[matches_rule(term) for term in terms]
            if not (all(hits) if route.get('match_mode')=='all' else any(hits)):continue
        pattern=route.get('pattern','').strip()
        if pattern and not matches_rule('re:'+pattern):continue
        for addr in addresses:
            address=addr['address']
            if route.get('network','both') not in ('both',addr['network']):continue
            fingerprint=hashlib.sha256((addr['network']+':'+address.lower()).encode()).hexdigest()
            # Store only the detected address and network in token events.
            # No original message text, media, or separate token-memory table.
            with connection() as db:
                event(db,'contract',f"{addr['network'].upper()} · {address}",route['id'],source_id)
            for dest in route['destinations']:
                if dest==source_id:continue
                with connection() as db:enqueue(db,route,source_id,dest,message_id,address,fingerprint)


async def background_ai(text, route_id,src,dest):
    result=await evaluate_text(text)
    if result.get('status')=='ok':
        with connection() as db:event(db,'ai',f"AI: {result.get('category','')} · {result.get('reason','')}",route_id,src,dest)


async def delivery_worker(manager, stop: asyncio.Event, user_id=None):
    """Bind this worker to its own workspace even when its caller has another scope."""
    from contextlib import nullcontext
    from .access import AccessError, owner_id
    manager_id = getattr(manager, 'user_id', None)
    if user_id is not None and manager_id is not None and str(user_id) != str(manager_id):
        raise ValueError('Worker account does not match its workspace')
    user_id = user_id or manager_id or current_workspace.get()
    if user_id is None:
        try:
            user_id = owner_id()
        except (AccessError, ValueError, RuntimeError):
            pass  # Offline legacy tests have no configured Telegram owner.
    with workspace(user_id) if user_id is not None else nullcontext():
        await _delivery_loop(manager, stop)


async def _delivery_loop(manager, stop: asyncio.Event):
    """Sequential send loop. One outbound send at a time, honoring Telegram flood waits."""
    while not stop.is_set():
        try:
            if hasattr(manager, 'check_access'):
                manager.check_access()
            if get_setting('paused','false')=='true':
                await asyncio.sleep(0.6);continue
            # Telegram FLOOD_WAIT is account-wide. Do not attempt other sends until it expires.
            try: cooldown=float(get_setting('account_cooldown_until','0'))
            except ValueError: cooldown=0
            if time.time()<cooldown:
                await asyncio.sleep(min(1.0,cooldown-time.time()));continue
            status=await manager.status()
            if hasattr(manager, 'check_access'):
                manager.check_access()
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
                if stop.is_set():
                    raise asyncio.CancelledError
                if hasattr(manager, 'check_access'):
                    manager.check_access()
                await manager.send(job,'text')
                with connection() as db:
                    db.execute("UPDATE jobs SET status='sent',sent_at=?,error='',message_preview='' WHERE id=?",(time.time(),job['id']))
                    event(db,'forwarded',f"Delivered → {job['destination_id']}",job['route_id'],job['source_id'],job['destination_id'])
            except asyncio.CancelledError:
                # Cancellation may race a remote acceptance. Never auto-retry an
                # uncertain delivery after access is restored.
                with connection() as db:
                    db.execute("UPDATE jobs SET status='failed',error=? WHERE id=?",
                               ('Delivery interrupted; verify destination before retrying', job['id']))
                raise
            except PermissionError:
                # The final permission recheck can fail after remote acceptance.
                # Keep that ambiguity visible instead of automatically resending.
                with connection() as db:
                    db.execute("UPDATE jobs SET status='failed',error=? WHERE id=?",
                               ('Workspace access stopped; verify destination before retrying', job['id']))
                return
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
        except PermissionError:
            break
        except Exception as ex:
            logger.warning('Delivery worker unexpected error (%s)', type(ex).__name__)
            await asyncio.sleep(2)
