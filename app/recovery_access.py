"""Recovery consent and single-use export authority; no session/secret I/O.

All identity arguments MUST come from authenticated identities, never request body
IDs. ``authenticated_at`` MUST be the verified Telegram authentication time.
Only an independently authenticated owner bot callback may call confirmation.
Serializers run under the access-registry write lock: do not call registry APIs
inside them. They must serialize/encrypt synchronously, without network I/O, and
must not retain raw snapshots or schedule later reads outside the callback.
"""
from contextlib import contextmanager
import hashlib
import json
import math
import re
import secrets
import time

from . import access

SCOPE_VERSION = 1
CATEGORIES = ('reusable_telegram_session', 'recurring_admin_encrypted_backups_for_bot_updates_and_recovery')
CHALLENGE_TTL_SECONDS = 120
FRESH_AUTH_SECONDS = 300
MAX_CHALLENGES = 32
TITLE = 'Rollback Recovery'
WARNING = 'A saved session carries your account’s permissions, including reading and sending messages.'


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def _scope(owner):
    return {'version': SCOPE_VERSION, 'administrator_id': owner, 'categories': list(CATEGORIES)}


def _scope_key(owner):
    return hashlib.sha256(_canonical(_scope(owner))).hexdigest()


def _initialize(connection):
    connection.execute('''CREATE TABLE IF NOT EXISTS recovery_consents (
        user_id TEXT NOT NULL, scope_key TEXT NOT NULL, administrator_id TEXT NOT NULL,
        allowed INTEGER NOT NULL CHECK(allowed IN (0,1)), revision INTEGER NOT NULL,
        created_at REAL NOT NULL, updated_at REAL NOT NULL,
        PRIMARY KEY(user_id,scope_key))''')
    connection.execute('''CREATE TABLE IF NOT EXISTS recovery_challenges (
        id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, owner_id TEXT NOT NULL,
        scope_key TEXT NOT NULL, generation_digest TEXT NOT NULL, created_at REAL NOT NULL,
        expires_at REAL NOT NULL, confirmed_at REAL, consumed_at REAL)''')


@contextmanager
def _registry():
    with access._registry() as connection:
        _initialize(connection)
        yield connection


def _owner(connection):
    return connection.execute("SELECT value FROM registry_meta WHERE key='owner_telegram_id'").fetchone()['value']


def _approved(connection, user_id):
    row = access._find_user(connection, user_id)
    if row is None or row['status'] != 'approved':
        raise access.AccessError(403, 'Approved access is required.')
    return row


def _status(connection, user_id):
    _approved(connection, user_id)
    owner = _owner(connection)
    # Names/handles are not proof of ownership; the registry-bound numeric ID is.
    administrator = f'Telegram user {owner}'
    row = connection.execute('SELECT allowed FROM recovery_consents WHERE user_id=? AND scope_key=?',
                             (user_id, _scope_key(owner))).fetchone()
    return {'title': TITLE, 'administrator_id': owner, 'administrator_label': administrator,
            'scope': _scope(owner), 'scope_key': _scope_key(owner),
            'question': f'Allow {administrator} to securely back up your Telegram session for @becsmebot updates and recovery?',
            'warning': WARNING, 'buttons': ['Yes', 'No'],
            'decision': None if row is None else bool(row['allowed']), 'needs_decision': row is None,
            'required': row is None, 'choice': None if row is None else ('yes' if row['allowed'] else 'no'),
            'administrator': {'user_id': owner, 'display_name': administrator},
            'scope_version': str(SCOPE_VERSION)}


def consent_status(user_id):
    user_id = access._user_id(user_id)
    with _registry() as connection:
        return _status(connection, user_id)


def record_consent(user_id, allowed, *, expected_scope_version, expected_admin_id):
    """First decision per scope/admin is durable; retries are idempotent.

    Require the displayed scope version and administrator so an obsolete prompt
    cannot authorize a new scope. Changes require a separate authenticated explicit-rescission request.
    """
    user_id = access._user_id(user_id)
    if not isinstance(allowed, bool):
        raise access.AccessError(400, 'Choose Yes or No.')
    with _registry() as connection:
        _approved(connection, user_id)
        owner = _owner(connection)
        if (type(expected_scope_version) not in (int, str)
                or expected_scope_version not in (SCOPE_VERSION, str(SCOPE_VERSION))
                or expected_admin_id != owner):
            raise access.AccessError(409, 'Recovery consent scope changed. Review it again.')
        scope_key = _scope_key(owner)
        row = connection.execute('SELECT allowed FROM recovery_consents WHERE user_id=? AND scope_key=?',
                                 (user_id, scope_key)).fetchone()
        if row is not None and bool(row['allowed']) != allowed:
            raise access.AccessError(409, 'A recovery decision has already been recorded.')
        if row is None:
            now = time.time()
            connection.execute('INSERT INTO recovery_consents VALUES (?,?,?,?,1,?,?)',
                               (user_id, scope_key, owner, int(allowed), now, now))
        return _status(connection, user_id)


def rescind_consent(user_id):
    """Authenticated, explicit direct rescission only; no ordinary UI toggle.

    Revoked users may still rescind. This never changes normal application access.
    """
    user_id = access._user_id(user_id)
    with _registry() as connection:
        if access._find_user(connection, user_id) is None:
            raise access.AccessError(404, 'Account not found.')
        owner = _owner(connection)
        now = time.time()
        connection.execute('''INSERT INTO recovery_consents VALUES (?,?,?,0,1,?,?)
            ON CONFLICT(user_id,scope_key) DO UPDATE SET allowed=0,
            revision=recovery_consents.revision+1,updated_at=excluded.updated_at''',
                           (user_id, _scope_key(owner), owner, now, now))
        return {'decision': False, 'scope_key': _scope_key(owner)}


def _snapshot(connection):
    owner = _owner(connection)
    users = [dict(row) for row in connection.execute('SELECT user_id,status,approved_at,revoked_at,updated_at FROM users ORDER BY user_id')]
    consents = [dict(row) for row in connection.execute('SELECT user_id,allowed,revision FROM recovery_consents WHERE scope_key=? ORDER BY user_id', (_scope_key(owner),))]
    allowed = {row['user_id'] for row in consents if row['allowed']}
    ids = tuple(row['user_id'] for row in users if row['status'] == 'approved' and row['user_id'] in allowed)
    # Event sequence detects revoke/reapprove even under identical timestamps.
    event_id = connection.execute('SELECT COALESCE(MAX(id),0) FROM user_events').fetchone()[0]
    generation = hashlib.sha256(_canonical({'scope': _scope(owner), 'users': users,
                                           'consents': consents, 'event_id': event_id})).hexdigest()
    scope = _scope(owner)
    scope['approved_user_ids'] = [row['user_id'] for row in users if row['status'] == 'approved']
    return ids, scope, generation


def _fresh(authenticated_at):
    now = time.time()
    if (isinstance(authenticated_at, bool) or not isinstance(authenticated_at, (int, float))
            or not math.isfinite(authenticated_at) or not 0 <= now - authenticated_at <= FRESH_AUTH_SECONDS):
        raise access.AccessError(403, 'Fresh Telegram authentication is required.')


def _charge(actor, action, limit):
    # Failures must not roll back the attempt accounting.
    with _registry() as connection:
        access._consume_rate_limit(connection, 'recovery_' + action, actor, limit, 300, time.time())


def create_export_challenge(actor_id, *, authenticated_at):
    actor = access._require_owner(actor_id)
    _charge(actor, 'create', 5)
    _fresh(authenticated_at)
    with _registry() as connection:
        now = time.time()
        connection.execute('DELETE FROM recovery_challenges WHERE expires_at<=?', (now,))
        if connection.execute('SELECT COUNT(*) FROM recovery_challenges').fetchone()[0] >= MAX_CHALLENGES:
            raise access.AccessError(429, 'Too many recovery export requests. Try again later.')
        ids, scope, generation = _snapshot(connection)
        token = secrets.token_urlsafe(32)
        challenge_id = secrets.token_hex(12)
        connection.execute('INSERT INTO recovery_challenges VALUES (?,?,?,?,?,?,?,NULL,NULL)',
                           (challenge_id, hashlib.sha256(token.encode()).hexdigest(), actor,
                            _scope_key(actor), generation, now, now + CHALLENGE_TTL_SECONDS))
        return {'challenge_id': challenge_id, 'token': token, 'expires_at': now + CHALLENGE_TTL_SECONDS,
                'scope': scope, 'user_ids': list(ids)}


def _challenge(connection, actor, token=None, *, challenge_id=None):
    if challenge_id is not None:
        if not isinstance(challenge_id, str) or not re.fullmatch(r'[a-f0-9]{24}', challenge_id):
            raise access.AccessError(400, 'Recovery confirmation is invalid or expired.')
        row = connection.execute('SELECT * FROM recovery_challenges WHERE id=?', (challenge_id,)).fetchone()
    else:
        if not isinstance(token, str) or access._TOKEN_PATTERN.fullmatch(token) is None:
            raise access.AccessError(400, 'Recovery confirmation is invalid or expired.')
        row = connection.execute('SELECT * FROM recovery_challenges WHERE token_hash=?',
                                 (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
    if (row is None or row['owner_id'] != actor or row['expires_at'] <= time.time()
            or row['consumed_at'] is not None or row['scope_key'] != _scope_key(actor)):
        raise access.AccessError(400, 'Recovery confirmation is invalid or expired.')
    return row


def confirm_export_challenge(bot_actor_id, token):
    """Only from an independently verified, private Telegram owner bot callback."""
    actor = access._require_owner(bot_actor_id)
    _charge(actor, 'confirm', 15)
    with _registry() as connection:
        row = _challenge(connection, actor, token)
        _, _, generation = _snapshot(connection)
        if generation != row['generation_digest']:
            raise access.AccessError(409, 'Recovery permissions changed. Start a new export.')
        if row['confirmed_at'] is not None:
            raise access.AccessError(409, 'Recovery confirmation has already been used.')
        connection.execute('UPDATE recovery_challenges SET confirmed_at=? WHERE id=?', (time.time(), row['id']))
        return {'challenge_id': row['id'], 'confirmed': True}


def consume_export_challenge(actor_id, challenge_id, *, authenticated_at, serialize):
    """Serialize under the revocation lock; consume once even on callback failure.

    ``serialize(ids, scope)`` must complete all snapshot reads and encryption here.
    Bytes are returned only after consent/challenge state commits. Never stream a
    lazy response, return raw secrets, or perform network delivery in this callback.
    """
    actor = access._require_owner(actor_id)
    _charge(actor, 'consume', 10)
    _fresh(authenticated_at)
    failure = None
    result = None
    with _registry() as connection:
        row = _challenge(connection, actor, challenge_id=challenge_id)
        if row['confirmed_at'] is None:
            raise access.AccessError(403, 'Confirm this export in the owner Telegram bot first.')
        ids, scope, generation = _snapshot(connection)
        if generation != row['generation_digest']:
            raise access.AccessError(409, 'Recovery permissions changed. Start a new export.')
        connection.execute('UPDATE recovery_challenges SET consumed_at=? WHERE id=?', (time.time(), row['id']))
        try:
            result = serialize(ids, scope)
            if not isinstance(result, bytes):
                raise TypeError('Recovery serializer must return fully materialized encrypted bytes.')
        except Exception as exc:
            failure = exc
    if failure is not None:
        raise failure
    return result


def export_challenge_status(actor_id, challenge_id):
    actor = access._require_owner(actor_id)
    with _registry() as connection:
        row = _challenge(connection, actor, challenge_id=challenge_id)
        _, _, generation = _snapshot(connection)
        if generation != row['generation_digest']:
            raise access.AccessError(409, 'Recovery permissions changed. Start a new export.')
        return {'challenge_id': row['id'], 'confirmed': row['confirmed_at'] is not None,
                'expires_at': row['expires_at']}


def cancel_export_challenge(actor_id, challenge_id):
    """Invalidate an owner's challenge, whether pending, confirmed, or expired.

    Repeated cancellation and cancellation after consumption are safe no-ops.
    The caller must enforce fresh first-party authentication before calling.
    No token is accepted or returned. Cancellation cannot undo a prior export.
    """
    actor = access._require_owner(actor_id)
    if not isinstance(challenge_id, str) or not re.fullmatch(r'[a-f0-9]{24}', challenge_id):
        raise access.AccessError(400, 'Recovery confirmation is invalid or expired.')
    with _registry() as connection:
        row = connection.execute('SELECT id,consumed_at FROM recovery_challenges WHERE id=? AND owner_id=?',
                                 (challenge_id, actor)).fetchone()
        if row is None:
            raise access.AccessError(404, 'Recovery confirmation was not found.')
        if row['consumed_at'] is None:
            connection.execute('UPDATE recovery_challenges SET consumed_at=? WHERE id=?',
                               (time.time(), challenge_id))
        return {'challenge_id': challenge_id, 'invalidated': True}
