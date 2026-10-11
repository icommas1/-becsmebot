"""Private Telegram invitations and the application-wide access registry.

This database deliberately lives beside, rather than inside, the tenant database.
Callers must authenticate Telegram identities before passing them to this module;
an invite is permission to request access, never proof of identity or approval.
Only invitation hashes are persisted. Raw tokens are returned once to the owner.
"""
from contextlib import contextmanager
import hashlib
import os
from pathlib import Path
import re
import secrets
import sqlite3
import time

from . import db

MAX_APPROVED_USERS = 3  # Includes the owner.
MAX_INVITE_TTL_SECONDS = 7 * 24 * 60 * 60
MAX_ACTIVE_INVITES = 10
INVITE_CREATE_LIMIT = 10
INVITE_CREATE_WINDOW_SECONDS = 60 * 60
REDEEM_ATTEMPT_LIMIT = 10
REDEEM_GLOBAL_LIMIT = 100
REDEEM_WINDOW_SECONDS = 15 * 60
MAX_RATE_BUCKETS = 256
MAX_TELEGRAM_ID = 2**63 - 1
_TOKEN_PATTERN = re.compile(r'[A-Za-z0-9_-]{43}\Z')
_INVALID_INVITE = 'Invitation is invalid, expired, revoked, or already used.'


class AccessError(Exception):
    """An expected registry failure suitable for a sanitized API response."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _user_id(value) -> str:
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise AccessError(400, 'A numeric Telegram user ID is required.')
    text = str(value)
    if not re.fullmatch(r'[1-9][0-9]{0,18}', text) or int(text) > MAX_TELEGRAM_ID:
        raise AccessError(400, 'A numeric Telegram user ID is required.')
    return text


def _configured_owner() -> str:
    try:
        return _user_id(os.getenv('BECS_ALLOWED_TELEGRAM_ID', '').strip())
    except AccessError:
        raise AccessError(503, 'Access control is not configured.') from None


def _require_owner(actor_id) -> str:
    owner = _configured_owner()
    try:
        actor = _user_id(actor_id)
    except AccessError:
        raise AccessError(403, 'Owner access is required.') from None
    if not secrets.compare_digest(actor, owner):
        raise AccessError(403, 'Owner access is required.')
    return actor


def _registry_path() -> Path:
    # db.DB_PATH remains the legacy owner database, even in tenant contexts.
    return Path(db.DB_PATH).parent / 'access.sqlite'


def _initialize(connection, owner: str, now: float):
    # Execute individually: executescript would implicitly commit our transaction.
    statements = (
        'CREATE TABLE IF NOT EXISTS registry_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
        '''CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,
            display_name TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL CHECK(status IN ('pending','approved','revoked')),
            is_owner INTEGER NOT NULL DEFAULT 0 CHECK(is_owner IN (0,1)),
            created_at REAL NOT NULL, updated_at REAL NOT NULL,
            invited_at REAL, approved_at REAL, revoked_at REAL
        )''',
        'CREATE UNIQUE INDEX IF NOT EXISTS singleton_owner ON users(is_owner) WHERE is_owner=1',
        '''CREATE TABLE IF NOT EXISTS invites (
            id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
            created_by TEXT NOT NULL, created_at REAL NOT NULL, expires_at REAL NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('active','redeemed','revoked')),
            target_user_id TEXT, allow_reinvite INTEGER NOT NULL DEFAULT 0,
            redeemed_by TEXT, redeemed_at REAL, revoked_at REAL
        )''',
        'CREATE INDEX IF NOT EXISTS invite_status_expiry ON invites(status,expires_at)',
        '''CREATE TABLE IF NOT EXISTS rate_limits (
            action TEXT NOT NULL, subject TEXT NOT NULL, window_start REAL NOT NULL,
            expires_at REAL NOT NULL, attempts INTEGER NOT NULL,
            PRIMARY KEY(action,subject)
        )''',
        '''CREATE TABLE IF NOT EXISTS user_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
            action TEXT NOT NULL, actor_id TEXT NOT NULL, created_at REAL NOT NULL,
            invite_id TEXT
        )''',
    )
    for statement in statements:
        connection.execute(statement)
    stored = connection.execute(
        "SELECT value FROM registry_meta WHERE key='owner_telegram_id'"
    ).fetchone()
    if stored is None:
        # An existing unbound user table is not permission to take it over.
        if connection.execute('SELECT 1 FROM users LIMIT 1').fetchone():
            raise AccessError(503, 'Access registry owner must be verified before use.')
        connection.execute(
            "INSERT INTO registry_meta(key,value) VALUES ('owner_telegram_id',?)", (owner,)
        )
        connection.execute(
            "INSERT INTO registry_meta(key,value) VALUES ('schema_version','1')"
        )
        connection.execute(
            '''INSERT INTO users(user_id,status,is_owner,created_at,updated_at,approved_at)
               VALUES (?,'approved',1,?,?,?)''', (owner, now, now, now)
        )
        _event(connection, owner, 'owner_registered', owner, now)
    elif not secrets.compare_digest(stored['value'], owner):
        raise AccessError(503, 'Configured owner does not match the access registry.')
    owner_row = connection.execute(
        'SELECT user_id,status FROM users WHERE is_owner=1'
    ).fetchone()
    if owner_row is None or owner_row['user_id'] != owner or owner_row['status'] != 'approved':
        raise AccessError(503, 'Access registry owner must be verified before use.')


@contextmanager
def _registry():
    owner = _configured_owner()  # Fail before creating files for bad configuration.
    path = _registry_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=15)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute('PRAGMA busy_timeout=15000')
        connection.execute('PRAGMA journal_mode=WAL')
        connection.execute('BEGIN IMMEDIATE')
        _initialize(connection, owner, time.time())
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _event(connection, user_id, action, actor_id, now, invite_id=None):
    connection.execute(
        'INSERT INTO user_events(user_id,action,actor_id,created_at,invite_id) VALUES (?,?,?,?,?)',
        (user_id, action, actor_id, now, invite_id),
    )


def _as_user(row):
    if row is None:
        return None
    result = dict(row)
    result['telegram_id'] = result['user_id']
    result['role'] = 'admin' if result['is_owner'] else 'member'
    result['is_owner'] = bool(result['is_owner'])
    return result


def _find_user(connection, user_id):
    return connection.execute('SELECT * FROM users WHERE user_id=?', (user_id,)).fetchone()


def init_access():
    """Idempotently bind this registry to its owner without touching legacy data."""
    with _registry():
        pass


def owner_id() -> str:
    # Verify the stored binding too: changing an environment variable must not
    # grant a different user access to the original owner's tenant or registry.
    with _registry() as connection:
        return connection.execute(
            "SELECT value FROM registry_meta WHERE key='owner_telegram_id'"
        ).fetchone()['value']


def get_user(user_id):
    user_id = _user_id(user_id)
    with _registry() as connection:
        return _as_user(_find_user(connection, user_id))


def is_approved(user_id) -> bool:
    user = get_user(user_id)
    return user is not None and user['status'] == 'approved'


def list_users(actor_id):
    _require_owner(actor_id)
    with _registry() as connection:
        return [_as_user(row) for row in connection.execute(
            'SELECT * FROM users ORDER BY is_owner DESC,created_at,user_id'
        ).fetchall()]


def _consume_rate_limit(connection, action, subject, limit, window_seconds, now):
    # Fixed windows retain at most one row per subject. Stale subjects are removed
    # before allocating a row; an identity flood cannot grow the table unbounded.
    connection.execute('DELETE FROM rate_limits WHERE expires_at<=?', (now,))
    row = connection.execute(
        'SELECT attempts FROM rate_limits WHERE action=? AND subject=?', (action, subject)
    ).fetchone()
    if row is not None:
        if row['attempts'] >= limit:
            raise AccessError(429, 'Too many access requests. Try again later.')
        connection.execute(
            'UPDATE rate_limits SET attempts=attempts+1 WHERE action=? AND subject=?',
            (action, subject),
        )
        return
    if connection.execute('SELECT COUNT(*) FROM rate_limits').fetchone()[0] >= MAX_RATE_BUCKETS:
        raise AccessError(429, 'Too many access requests. Try again later.')
    start = (now // window_seconds) * window_seconds
    connection.execute(
        'INSERT INTO rate_limits(action,subject,window_start,expires_at,attempts) VALUES (?,?,?,?,1)',
        (action, subject, start, start + window_seconds),
    )


def _charge_attempt(action, subject):
    # Commit attempts independently from the operation. Invalid/replayed tokens
    # and business-rule failures must not roll back their rate-limit accounting.
    with _registry() as connection:
        now = time.time()
        if action == 'redeem':
            _consume_rate_limit(connection, 'redeem_global', '*', REDEEM_GLOBAL_LIMIT,
                                REDEEM_WINDOW_SECONDS, now)
            _consume_rate_limit(connection, 'redeem', subject, REDEEM_ATTEMPT_LIMIT,
                                REDEEM_WINDOW_SECONDS, now)
        else:
            _consume_rate_limit(connection, 'create_invite', subject, INVITE_CREATE_LIMIT,
                                INVITE_CREATE_WINDOW_SECONDS, now)


def _validate_ttl(ttl_seconds):
    if isinstance(ttl_seconds, bool) or not isinstance(ttl_seconds, int):
        raise AccessError(400, 'Invitation lifetime must be a whole number of seconds.')
    if not 1 <= ttl_seconds <= MAX_INVITE_TTL_SECONDS:
        raise AccessError(400, 'Invitation lifetime must be between 1 second and 7 days.')
    return ttl_seconds


def _make_invite(connection, actor, ttl_seconds, target_user_id=None):
    approved = connection.execute(
        "SELECT COUNT(*) FROM users WHERE status='approved'"
    ).fetchone()[0]
    if approved >= MAX_APPROVED_USERS:
        raise AccessError(409, 'The three-account limit, including the owner, has been reached.')
    now = time.time()
    count = connection.execute(
        "SELECT COUNT(*) FROM invites WHERE status='active' AND expires_at>?", (now,)
    ).fetchone()[0]
    if count >= MAX_ACTIVE_INVITES:
        raise AccessError(429, 'Too many active invitations. Revoke one before creating another.')
    token = secrets.token_urlsafe(32)
    invite_id = secrets.token_hex(12)
    expires_at = now + ttl_seconds
    connection.execute(
        '''INSERT INTO invites(id,token_hash,created_by,created_at,expires_at,status,
                               target_user_id,allow_reinvite)
           VALUES (?,?,?,?,?,'active',?,?)''',
        (invite_id, hashlib.sha256(token.encode('ascii')).hexdigest(), actor, now,
         expires_at, target_user_id, int(target_user_id is not None)),
    )
    return {'id': invite_id, 'token': token, 'expires_at': expires_at}


def create_invite(actor_id, ttl_seconds=86400):
    actor = _require_owner(actor_id)
    _charge_attempt('create_invite', actor)
    ttl_seconds = _validate_ttl(ttl_seconds)
    with _registry() as connection:
        return _make_invite(connection, actor, ttl_seconds)


def reinvite_user(actor_id, user_id, ttl_seconds=86400):
    """Explicitly invite a revoked identity back; redemption still needs approval."""
    actor = _require_owner(actor_id)
    user_id = _user_id(user_id)
    _charge_attempt('create_invite', actor)
    ttl_seconds = _validate_ttl(ttl_seconds)
    with _registry() as connection:
        user = _find_user(connection, user_id)
        if user is None:
            raise AccessError(404, 'Account not found.')
        if user['is_owner'] or user['status'] != 'revoked':
            raise AccessError(409, 'Only a revoked guest can be invited again.')
        invite = _make_invite(connection, actor, ttl_seconds, target_user_id=user_id)
        _event(connection, user_id, 'reinvited', actor, time.time(), invite['id'])
        return invite


def _display_name(value):
    if not isinstance(value, str):
        raise AccessError(400, 'Display name must be text.')
    return ''.join(c for c in value if ord(c) >= 32 and ord(c) != 127).strip()[:160]


def redeem_invite(token, user_id, display_name=''):
    """Redeem for an already-authenticated Telegram identity, creating pending access."""
    user_id = _user_id(user_id)
    _charge_attempt('redeem', user_id)
    if not isinstance(token, str) or _TOKEN_PATTERN.fullmatch(token) is None:
        raise AccessError(400, _INVALID_INVITE)
    display_name = _display_name(display_name)
    digest = hashlib.sha256(token.encode('ascii')).hexdigest()
    with _registry() as connection:
        now = time.time()
        invite = connection.execute('SELECT * FROM invites WHERE token_hash=?', (digest,)).fetchone()
        if invite is None or invite['status'] != 'active' or invite['expires_at'] <= now:
            raise AccessError(400, _INVALID_INVITE)
        if invite['target_user_id'] is not None and invite['target_user_id'] != user_id:
            raise AccessError(403, 'This invitation belongs to a different Telegram account.')
        existing = _find_user(connection, user_id)
        if existing is not None:
            if existing['status'] != 'revoked':
                raise AccessError(409, 'This account is already registered.')
            if not invite['allow_reinvite'] or invite['target_user_id'] != user_id:
                raise AccessError(403, 'A revoked account requires an explicit owner re-invitation.')
            connection.execute(
                '''UPDATE users SET display_name=?,status='pending',updated_at=?,invited_at=?
                   WHERE user_id=?''', (display_name, now, now, user_id),
            )
        else:
            connection.execute(
                '''INSERT INTO users(user_id,display_name,status,created_at,updated_at,invited_at)
                   VALUES (?,?,'pending',?,?,?)''', (user_id, display_name, now, now, now),
            )
        connection.execute(
            "UPDATE invites SET status='redeemed',redeemed_by=?,redeemed_at=? WHERE id=?",
            (user_id, now, invite['id']),
        )
        _event(connection, user_id, 'invite_redeemed', user_id, now, invite['id'])
        return _as_user(_find_user(connection, user_id))


def approve_user(actor_id, user_id):
    actor = _require_owner(actor_id)
    user_id = _user_id(user_id)
    with _registry() as connection:
        user = _find_user(connection, user_id)
        if user is None:
            raise AccessError(404, 'Account not found.')
        if user['status'] == 'approved':
            return _as_user(user)
        if user['status'] != 'pending':
            raise AccessError(409, 'A revoked account must redeem an explicit re-invitation first.')
        # BEGIN IMMEDIATE serializes the count and update across processes too.
        approved = connection.execute(
            "SELECT COUNT(*) FROM users WHERE status='approved'"
        ).fetchone()[0]
        if approved >= MAX_APPROVED_USERS:
            raise AccessError(409, 'The three-account limit, including the owner, has been reached.')
        now = time.time()
        connection.execute(
            "UPDATE users SET status='approved',approved_at=?,updated_at=? WHERE user_id=?",
            (now, now, user_id),
        )
        _event(connection, user_id, 'approved', actor, now)
        return _as_user(_find_user(connection, user_id))


def revoke_user(actor_id, user_id):
    actor = _require_owner(actor_id)
    user_id = _user_id(user_id)
    with _registry() as connection:
        user = _find_user(connection, user_id)
        if user is None:
            raise AccessError(404, 'Account not found.')
        if user['is_owner']:
            raise AccessError(409, 'The owner cannot be revoked.')
        now = time.time()
        # Also invalidate outstanding re-invitations on repeated revoke calls.
        connection.execute(
            "UPDATE invites SET status='revoked',revoked_at=? WHERE target_user_id=? AND status='active'",
            (now, user_id),
        )
        if user['status'] != 'revoked':
            connection.execute(
                "UPDATE users SET status='revoked',revoked_at=?,updated_at=? WHERE user_id=?",
                (now, now, user_id),
            )
            _event(connection, user_id, 'revoked', actor, now)
        return _as_user(_find_user(connection, user_id))


def reject_user(actor_id, user_id):
    """Reject a pending request without ever revoking an approved runtime."""
    actor = _require_owner(actor_id)
    user_id = _user_id(user_id)
    with _registry() as connection:
        user = _find_user(connection, user_id)
        if user is None:
            raise AccessError(404, 'Account not found.')
        if user['status'] == 'approved':
            raise AccessError(409, 'Approved accounts must be revoked, not rejected.')
        if user['status'] == 'revoked':
            return _as_user(user)
        now = time.time()
        connection.execute(
            "UPDATE users SET status='revoked',revoked_at=?,updated_at=? WHERE user_id=?",
            (now, now, user_id),
        )
        connection.execute(
            "UPDATE invites SET status='revoked',revoked_at=? WHERE target_user_id=? AND status='active'",
            (now, user_id),
        )
        _event(connection, user_id, 'rejected', actor, now)
        return _as_user(_find_user(connection, user_id))


def _as_invite(row, now):
    result = dict(row)
    # Select only public metadata below, so hashes never leave this module.
    result['allow_reinvite'] = bool(result['allow_reinvite'])
    result['used_at'] = result['redeemed_at']
    if result['status'] == 'active' and result['expires_at'] <= now:
        result['status'] = 'expired'
    return result


_INVITE_METADATA = ('id,created_by,created_at,expires_at,status,target_user_id,'
                    'allow_reinvite,redeemed_by,redeemed_at,revoked_at')


def list_invites(actor_id):
    _require_owner(actor_id)
    with _registry() as connection:
        now = time.time()
        rows = connection.execute(
            f'SELECT {_INVITE_METADATA} FROM invites ORDER BY created_at DESC,id'
        ).fetchall()
        return [_as_invite(row, now) for row in rows]


def revoke_invite(actor_id, invite_id):
    _require_owner(actor_id)
    if not isinstance(invite_id, str) or not re.fullmatch(r'[a-f0-9]{24}', invite_id):
        raise AccessError(404, 'Invitation not found.')
    with _registry() as connection:
        now = time.time()
        row = connection.execute(
            f'SELECT {_INVITE_METADATA} FROM invites WHERE id=?', (invite_id,)
        ).fetchone()
        if row is None:
            raise AccessError(404, 'Invitation not found.')
        if row['status'] == 'redeemed':
            raise AccessError(409, 'This invitation has already been redeemed. Revoke the account instead.')
        if row['status'] == 'active':
            connection.execute(
                "UPDATE invites SET status='revoked',revoked_at=? WHERE id=?", (now, invite_id)
            )
        row = connection.execute(
            f'SELECT {_INVITE_METADATA} FROM invites WHERE id=?', (invite_id,)
        ).fetchone()
        return _as_invite(row, now)
