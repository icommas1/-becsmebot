"""Bounded workspace-local routing observations and ordered capabilities."""
import hashlib
import json
import time

from .db import connection

RELEASE_LEVEL = 1
RELEASES = ['Shadow Mode', 'Decision inspector', 'Route health', 'Custom presets',
            'Source comparison', 'Backup preview', 'Mobile polish']
MAX_DECISIONS = 5000
RETENTION_SECONDS = 7 * 86400


def migrate(db):
    columns = {row['name'] for row in db.execute('PRAGMA table_info(routes)')}
    if 'shadow_mode' not in columns:
        db.execute('ALTER TABLE routes ADD COLUMN shadow_mode INTEGER NOT NULL DEFAULT 0')
    for name in ('address_network', 'address_key'):
        if name not in {row['name'] for row in db.execute('PRAGMA table_info(jobs)')}:
            db.execute(f"ALTER TABLE jobs ADD COLUMN {name} TEXT NOT NULL DEFAULT ''")
    db.executescript('''
        CREATE TABLE IF NOT EXISTS route_decisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT, route_id INTEGER,
            source_id TEXT NOT NULL, destination_id TEXT,
            message_id INTEGER NOT NULL, network TEXT NOT NULL DEFAULT '',
            address TEXT NOT NULL DEFAULT '', fingerprint TEXT NOT NULL DEFAULT '',
            decision TEXT NOT NULL, reason TEXT NOT NULL,
            shadow INTEGER NOT NULL DEFAULT 0, created_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS decisions_lookup ON route_decisions(route_id,created_at);
        CREATE INDEX IF NOT EXISTS shadow_lookup ON route_decisions(route_id,destination_id,fingerprint,shadow,created_at);
        CREATE TABLE IF NOT EXISTS filter_presets (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
            filters TEXT NOT NULL, created_at REAL NOT NULL, updated_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS source_observations (
            source_id TEXT NOT NULL, network TEXT NOT NULL, address_key TEXT NOT NULL,
            address TEXT NOT NULL, first_seen REAL NOT NULL, last_seen REAL NOT NULL,
            mentions INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY(source_id,network,address_key)
        );
        CREATE INDEX IF NOT EXISTS observations_recent ON source_observations(last_seen);
    ''')


def record_decision(db, route, source, destination, message_id, decision, reason,
                    address='', network='', fingerprint=''):
    now = time.time()
    db.execute('''INSERT INTO route_decisions
        (route_id,source_id,destination_id,message_id,network,address,fingerprint,
         decision,reason,shadow,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)''',
        (route['id'], source, destination, message_id, network, address,
         fingerprint, decision, reason[:220], int(route.get('shadow_mode', False)), now))
    db.execute('DELETE FROM route_decisions WHERE created_at<?', (now-RETENTION_SECONDS,))
    db.execute('''DELETE FROM route_decisions WHERE id IN
        (SELECT id FROM route_decisions ORDER BY id DESC LIMIT -1 OFFSET ?)''', (MAX_DECISIONS,))


def observe_source(db, source, addresses):
    from .engine import address_key
    now = time.time()
    for candidate in addresses:
        network, address = candidate['network'], candidate['address']
        db.execute('''INSERT INTO source_observations
            (source_id,network,address_key,address,first_seen,last_seen,mentions)
            VALUES (?,?,?,?,?,?,1) ON CONFLICT(source_id,network,address_key)
            DO UPDATE SET last_seen=excluded.last_seen,mentions=mentions+1''',
            (source,network,address_key(network,address),address,now,now))
    db.execute('DELETE FROM source_observations WHERE last_seen<?', (now-RETENTION_SECONDS,))
    db.execute('''DELETE FROM source_observations WHERE rowid IN
        (SELECT rowid FROM source_observations ORDER BY last_seen DESC LIMIT -1 OFFSET 10000)''')


def route_checksum(db):
    rows = [dict(row) for row in db.execute('SELECT * FROM routes ORDER BY id')]
    return hashlib.sha256(json.dumps(rows,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def overview_fields():
    result = {'upgrade_level': RELEASE_LEVEL, 'upgrade_release': RELEASES[RELEASE_LEVEL-1]}
    if RELEASE_LEVEL < 3:
        return result
    with connection() as db:
        routes = db.execute('SELECT id,name,enabled,shadow_mode FROM routes ORDER BY id').fetchall()
        now = time.time()
        health = []
        for route in routes:
            counts = dict(db.execute('SELECT status,COUNT(*) FROM jobs WHERE route_id=? GROUP BY status', (route['id'],)).fetchall())
            oldest = db.execute("SELECT MIN(created_at) FROM jobs WHERE route_id=? AND status='queued'", (route['id'],)).fetchone()[0]
            latest = db.execute('SELECT MAX(created_at) FROM route_decisions WHERE route_id=?', (route['id'],)).fetchone()[0]
            delivered = db.execute("SELECT MAX(sent_at) FROM jobs WHERE route_id=? AND status='sent'", (route['id'],)).fetchone()[0]
            health.append({**dict(route), 'queued':counts.get('queued',0), 'failed':counts.get('failed',0),
                           'delivered':counts.get('sent',0), 'oldest_queued_seconds':max(0,int(now-oldest)) if oldest else 0,
                           'last_seen':latest, 'last_delivered':delivered})
        result['route_health'] = health
    return result
