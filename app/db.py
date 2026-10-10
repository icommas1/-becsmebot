"""Simple single-process SQLite state for personal V1."""
import json
import os
import sqlite3
import time
from pathlib import Path

DB_PATH = Path(os.getenv('BECS_DB_PATH', str(Path(__file__).resolve().parents[1] / 'data' / 'becs.sqlite')))
DB_PATH.parent.mkdir(parents=True, exist_ok=True)


def connection():
    db = sqlite3.connect(DB_PATH, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('PRAGMA busy_timeout=15000')
    db.execute('PRAGMA foreign_keys=ON')
    return db


def init_db():
    with connection() as db:
        db.executescript('''
        CREATE TABLE IF NOT EXISTS routes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'smart', enabled INTEGER NOT NULL DEFAULT 0,
            sources TEXT NOT NULL DEFAULT '[]', destinations TEXT NOT NULL DEFAULT '[]',
            allowed TEXT NOT NULL DEFAULT '', blocked TEXT NOT NULL DEFAULT '', pattern TEXT NOT NULL DEFAULT '',
            match_mode TEXT NOT NULL DEFAULT 'any', network TEXT NOT NULL DEFAULT 'both',
            require_contract INTEGER NOT NULL DEFAULT 0, dedup_minutes INTEGER NOT NULL DEFAULT 60,
            delivery_style TEXT NOT NULL DEFAULT 'native', created_at REAL NOT NULL, updated_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            route_id INTEGER NOT NULL, source_id TEXT NOT NULL, destination_id TEXT NOT NULL,
            message_id INTEGER NOT NULL, message_preview TEXT NOT NULL, fingerprint TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
            next_attempt REAL NOT NULL DEFAULT 0, created_at REAL NOT NULL,
            sent_at REAL, error TEXT NOT NULL DEFAULT '', FOREIGN KEY(route_id) REFERENCES routes(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS jobs_lookup ON jobs(status,next_attempt,created_at);
        CREATE INDEX IF NOT EXISTS jobs_dedupe ON jobs(destination_id,fingerprint,created_at);
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, detail TEXT NOT NULL,
            route_id INTEGER, source_id TEXT, destination_id TEXT, created_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT, route_id INTEGER NOT NULL, source_id TEXT NOT NULL,
            destination_id TEXT NOT NULL, message_id INTEGER NOT NULL, text TEXT NOT NULL,
            fingerprint TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
            created_at REAL NOT NULL, FOREIGN KEY(route_id) REFERENCES routes(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS contracts (
            network TEXT NOT NULL, address TEXT NOT NULL, first_seen REAL NOT NULL,
            last_seen REAL NOT NULL, mentions INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY(network,address)
        );
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        ''')
        db.execute("INSERT OR IGNORE INTO settings VALUES ('paused','false')")


def as_dict(row):
    if not row: return None
    result = dict(row)
    for field in ('sources', 'destinations'):
        if field in result: result[field] = json.loads(result[field])
    for field in ('enabled', 'require_contract'):
        if field in result: result[field] = bool(result[field])
    return result


def get_setting(key, default=''):
    with connection() as db:
        row = db.execute('SELECT value FROM settings WHERE key=?',(key,)).fetchone()
        return row['value'] if row else default


def set_setting(key, value):
    with connection() as db:
        db.execute('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)',(key,str(value)))


def event(db, kind, detail, route_id=None, source_id=None, destination_id=None):
    db.execute('INSERT INTO events(kind,detail,route_id,source_id,destination_id,created_at) VALUES (?,?,?,?,?,?)',
               (kind,detail[:350],route_id,source_id,destination_id,time.time()))
