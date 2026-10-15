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


def duplicate_job(db, route, destination, fingerprint, network='', address=''):
    window = route['dedup_minutes'] * 60
    if not window or not fingerprint:
        return False
    cutoff = time.time()-window
    # Legacy entries have no canonical key. Preserve their cooldown while they age out.
    legacy = hashlib.sha256((network+':'+address.lower()).encode()).hexdigest() if network else fingerprint
    return db.execute("""SELECT id FROM jobs WHERE destination_id=?
        AND status IN ('queued','sending','sent') AND created_at>=?
        AND (fingerprint=? OR (address_key='' AND fingerprint=?)) LIMIT 1""",
        (destination,cutoff,fingerprint,legacy)).fetchone() is not None


def enqueue(db,route,src,dest,msg_id,text,fp):
    from .engine import extract_addresses,address_key
    candidates = extract_addresses(text)
    candidate = candidates[0] if len(candidates)==1 and candidates[0]['address']==text else None
    network = candidate['network'] if candidate else ''
    if route.get('shadow_mode'):
        return False
    if duplicate_job(db,route,dest,fp,network,text):
        event(db,'duplicate',f"Duplicate contract address suppressed → {dest}",route['id'],src,dest)
        return False
    now = time.time()
    db.execute("""INSERT INTO jobs
        (route_id,source_id,destination_id,message_id,message_preview,fingerprint,
         status,created_at,next_attempt,address_network,address_key)
        VALUES (?,?,?,?,?,?,'queued',?,0,?,?)""",
        (route['id'],src,dest,msg_id,text,fp,now,network,address_key(network,text) if candidate else ''))
    event(db,'queued',f"Delivery queued → {dest}",route['id'],src,dest)
    return True


async def ingest_message(source_id, message_id, text, service):
    """Process in memory; persist only candidates, rule outcomes and routing IDs."""
    from .engine import extract_addresses
    from .upgrade_store import observe_source,record_decision
    if service is not None and hasattr(service,'check_access'):
        service.check_access()
    if get_setting('paused','false') == 'true':
        return
    routes = [route for route in get_routes() if route['enabled'] and source_id in route['sources']]
    if not routes:
        return
    addresses = extract_addresses(text)
    with connection() as db:
        observe_source(db,source_id,addresses)
    for route in routes:
        result = decide(text,route)
        if result['decision'] != 'forward':
            with connection() as db:
                record_decision(db,route,source_id,None,message_id,result['decision'],result['reason'])
                event(db,'blocked',result['reason'],route['id'],source_id)
            continue
        for candidate in result['addresses']:
            address,network = candidate['address'],candidate['network']
            fingerprint = dedup_fingerprint(address,{'addresses':[candidate]})
            with connection() as db:
                event(db,'contract',f"{network.upper()} · {address}",route['id'],source_id)
            for destination in route['destinations']:
                if destination == source_id:
                    continue
                with connection() as db:
                    if route.get('shadow_mode'):
                        duplicate = duplicate_job(db,route,destination,fingerprint,network,address)
                        if route['dedup_minutes']:
                            duplicate = duplicate or db.execute("""SELECT 1 FROM route_decisions
                                WHERE route_id=? AND destination_id=? AND fingerprint=? AND shadow=1
                                AND decision='would_forward' AND created_at>=? LIMIT 1""",
                                (route['id'],destination,fingerprint,time.time()-route['dedup_minutes']*60)).fetchone() is not None
                        decision = 'duplicate' if duplicate else 'would_forward'
                        reason = 'Shadow duplicate suppressed' if duplicate else 'Shadow Mode: would send this address; nothing was queued'
                        record_decision(db,route,source_id,destination,message_id,decision,reason,address,network,fingerprint)
                        event(db,'shadow',reason,route['id'],source_id,destination)
                    else:
                        queued = enqueue(db,route,source_id,destination,message_id,address,fingerprint)
                        record_decision(db,route,source_id,destination,message_id,
                                        'queued' if queued else 'duplicate',
                                        result['reason'] if queued else 'Destination cooldown matched',
                                        address,network,fingerprint)


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
    with connection() as db:
        db.execute("UPDATE jobs SET status='failed',error=? WHERE status='sending'",
                   ('Delivery outcome unknown after restart; verify destination before retrying',))
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
                  WHERE j.status='queued' AND r.shadow_mode=0 AND j.next_attempt<=? ORDER BY j.created_at, j.id LIMIT 1""",(time.time(),)).fetchone()
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
