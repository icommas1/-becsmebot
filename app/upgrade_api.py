"""Authenticated upgrade endpoints; all storage uses the server workspace context."""
import base64
import binascii
import json
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import access, upgrade_store as store
from .db import connection, as_dict, current_workspace
from .models import RouteInput

router = APIRouter(prefix='/api')


def require_level(level):
    if store.RELEASE_LEVEL < level:
        raise HTTPException(404,'This upgrade has not been enabled yet.')


@router.get('/upgrades')
def capabilities():
    return {'level':store.RELEASE_LEVEL,'releases':store.RELEASES[:store.RELEASE_LEVEL]}


def decisions_for(shadow=False, route_id=None, limit=100):
    clauses, values = ['1=1'], []
    if shadow:
        clauses.append('d.shadow=1')
    if route_id is not None:
        clauses.append('d.route_id=?')
        values.append(route_id)
    values.append(max(1,min(limit,200)))
    with connection() as db:
        rows = db.execute('''SELECT d.*,r.name AS route_name FROM route_decisions d
            LEFT JOIN routes r ON r.id=d.route_id WHERE '''+' AND '.join(clauses)+
            ' ORDER BY d.id DESC LIMIT ?',values).fetchall()
    return {'items':[dict(row) for row in rows], 'retention_days':7,'maximum_records':store.MAX_DECISIONS,
            'scope':'Observed after upgrade; no original message text is stored.'}


@router.get('/shadow')
def shadow_results(route_id:int|None=None,limit:int=100):
    require_level(1)
    return decisions_for(True,route_id,limit)


@router.get('/decisions')
def decisions(route_id:int|None=None,limit:int=100):
    require_level(2)
    return decisions_for(False,route_id,limit)


PRESET_FIELDS = ('allowed','blocked','pattern','match_mode','network','dedup_minutes','require_contract')


class PresetInput(BaseModel):
    name:str = Field(min_length=2,max_length=80)
    filters:dict


def preset_values(payload):
    if set(payload.filters)-set(PRESET_FIELDS):
        raise HTTPException(422,'Presets contain filter rules only, without chats or delivery controls.')
    try:
        route = RouteInput.model_validate({'name':'Filter preset',**payload.filters})
        from .main import validate_route
        validate_route(route)
    except (ValueError,TypeError):
        raise HTTPException(422,'Invalid filter preset.') from None
    return {key:getattr(route,key) for key in PRESET_FIELDS}


@router.get('/presets')
def presets():
    require_level(4)
    with connection() as db:
        rows = db.execute('SELECT * FROM filter_presets ORDER BY updated_at DESC').fetchall()
    return {'presets':[{**dict(row),'filters':json.loads(row['filters'])} for row in rows]}


@router.post('/presets',status_code=201)
def save_preset(payload:PresetInput):
    require_level(4)
    values = preset_values(payload)
    with connection() as db:
        if db.execute('SELECT COUNT(*) FROM filter_presets').fetchone()[0]>=50:
            raise HTTPException(409,'This workspace already has 50 presets. Remove one first.')
        now = time.time()
        cur = db.execute('INSERT INTO filter_presets(name,filters,created_at,updated_at) VALUES(?,?,?,?)',
                         (payload.name.strip(),json.dumps(values),now,now))
    return {'id':cur.lastrowid}


@router.delete('/presets/{preset_id}')
def delete_preset(preset_id:int):
    require_level(4)
    with connection() as db:
        if not db.execute('DELETE FROM filter_presets WHERE id=?',(preset_id,)).rowcount:
            raise HTTPException(404,'Preset not found.')
    return {'deleted':True}


@router.get('/sources/comparison')
def source_comparison():
    require_level(5)
    cutoff = time.time()-store.RETENTION_SECONDS
    with connection() as db:
        rows = db.execute('SELECT * FROM source_observations WHERE last_seen>=? ORDER BY first_seen,source_id', (cutoff,)).fetchall()
    first, totals = {}, {}
    for row in rows:
        key = (row['network'],row['address_key'])
        first[key] = min(first.get(key,float('inf')),row['first_seen'])
    for row in rows:
        source = totals.setdefault(row['source_id'],{'source_id':row['source_id'],'unique_addresses':0,
            'mentions':0,'first_observations':0,'last_seen':0})
        source['unique_addresses']+=1
        source['mentions']+=row['mentions']
        source['first_observations']+=int(row['first_seen']==first[(row['network'],row['address_key'])])
        source['last_seen']=max(source['last_seen'],row['last_seen'])
    for source in totals.values():
        source['repeat_percent']=round(100*(source['mentions']-source['unique_addresses'])/source['mentions'],1)
    return {'sources':sorted(totals.values(),key=lambda row:(-row['first_observations'],row['source_id'])),
            'scope':'Address candidates observed since installation; up to seven days, 10,000 source/address pairs. First means first observed by this app, not first published.'}


class BackupInput(BaseModel):
    content_base64:str = Field(max_length=8*1024*1024+32)


class BackupImportInput(BackupInput):
    route_indices:list[int] = Field(min_length=1,max_length=100)
    expected_checksum:str = Field(min_length=64,max_length=64)


def backup_plan(payload):
    require_level(6)
    from .backup import validate_backup
    try:
        raw=base64.b64decode(payload.content_base64,validate=True)
        return validate_backup(raw,include_plan=True)
    except (ValueError,binascii.Error):
        raise HTTPException(422,'This is not a valid supported configuration backup.') from None


def own_backup_routes(plan):
    owner=access.owner_id()
    if current_workspace.get()!=owner:
        raise HTTPException(403,'Owner workspace required.')
    return plan['workspaces'].get(owner,{}).get('routes',[])


@router.post('/admin/backups/preview')
def preview_backup(payload:BackupInput):
    plan=backup_plan(payload)
    routes=own_backup_routes(plan)
    with connection() as db:
        checksum=store.route_checksum(db)
        current=[dict(row) for row in db.execute('SELECT id,name FROM routes ORDER BY id')]
    return {'valid':True,'route_count':len(routes),'workspace_count':plan['workspace_count'],
            'routes':[{'index':index,'name':route['name'],'sources':route['sources'],
                       'destinations':route['destinations'],'filters':{key:route[key] for key in PRESET_FIELDS}}
                      for index,route in enumerate(routes)],'current_routes':current,'current_checksum':checksum,
            'notice':'Import adds selected routes to your own workspace, disabled and in Shadow Mode. Existing routes, access, sessions and credentials are retained. Checksums do not prove authenticity.'}


@router.post('/admin/backups/import')
def import_backup(payload:BackupImportInput):
    routes=own_backup_routes(backup_plan(payload))
    indices=sorted(set(payload.route_indices))
    if any(index<0 or index>=len(routes) for index in indices):
        raise HTTPException(422,'Select valid routes from this backup.')
    from .main import save_route,validate_route
    imports=[]
    for index in indices:
        route=RouteInput.model_validate({**routes[index],'enabled':False,'shadow_mode':True})
        validate_route(route)
        imports.append(route)
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        if store.route_checksum(db)!=payload.expected_checksum:
            raise HTTPException(409,'Your routes changed. Preview the backup again before importing.')
        if db.execute('SELECT COUNT(*) FROM routes').fetchone()[0]+len(imports)>1000:
            raise HTTPException(409,'Import would exceed the 1,000 route limit.')
        ids=[save_route(db,route) for route in imports]
    return {'imported':len(ids),'route_ids':ids,'enabled':False,'shadow_mode':True}
