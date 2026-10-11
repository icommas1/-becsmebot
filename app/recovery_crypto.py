"""Versioned, bounded offline recovery encryption. No application/runtime imports."""
from __future__ import annotations

import base64
import binascii
import io
import json
import re
import stat
import struct
import zipfile
from datetime import datetime, timedelta

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.argon2 import Argon2id
import os

MAX_PLAINTEXT_BYTES = 6 * 1024 * 1024
MAX_ARCHIVE_BYTES = MAX_PLAINTEXT_BYTES + 16384
MAGIC = b'BECSREC1\x00'
PUBLIC_README = b'''Becs encrypted private recovery archive, version 1\n\nContains encrypted Telegram credentials, consenting user sessions and inert configuration.\nKeep this archive private and keep its password separately. Loss of the password is permanent.\nUse only scripts/recover_archive.py from a trusted compatible Becs checkout.\nBy default the offline tool validates and decrypts in memory without writing files.\nOptional --recover-to, after explicit terminal confirmation, writes inert sensitive JSON\ninto a new private directory on supported POSIX systems. It never applies credentials,\ngrants access, contacts Telegram, resumes forwarding or replays queues. Membership requires fresh approval.\nA recovered Telegram session remains a sensitive credential; consent at export is not a grant.\nUnencrypted ZIP metadata and this README contain no account inventory or credentials.\n'''
FIELDS = {'name', 'mode', 'enabled', 'sources', 'destinations', 'allowed', 'blocked', 'pattern',
          'match_mode', 'network', 'require_contract', 'dedup_minutes', 'delivery_style'}


class RecoveryError(ValueError):
    """Invalid, unsupported, unauthenticated or oversized recovery input."""


def _require(condition):
    if not condition:
        raise RecoveryError('Invalid or unsupported recovery format.')


def _keys(value, expected):
    _require(type(value) is dict and set(value) == set(expected))


def _text(value, minimum, maximum):
    _require(type(value) is str and minimum <= len(value) <= maximum and '\x00' not in value)


def _uid(value):
    _require(type(value) is str and re.fullmatch(r'[1-9][0-9]{0,18}', value) is not None)
    _require(int(value) < 2**63)
    return value


def _canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')


def _json(raw):
    def unique(pairs):
        out = {}
        for key, value in pairs:
            _require(key not in out)
            out[key] = value
        return out
    def invalid_constant(_):
        raise RecoveryError('Invalid JSON constant.')
    return json.loads(raw.decode('utf-8'), object_pairs_hook=unique, parse_constant=invalid_constant)


def _route(route):
    _keys(route, FIELDS)
    for key, lo, hi in [('name', 2, 100), ('allowed', 0, 500), ('blocked', 0, 500), ('pattern', 0, 250)]:
        _text(route[key], lo, hi)
    _require(route['mode'] in ('express', 'smart', 'hybrid', 'ai-gated'))
    _require(route['enabled'] is False)
    _require(route['match_mode'] in ('any', 'all'))
    _require(route['network'] in ('solana', 'evm', 'both'))
    _require(route['delivery_style'] in ('native', 'text'))
    _require(type(route['require_contract']) is bool)
    _require(type(route['dedup_minutes']) is int and 0 <= route['dedup_minutes'] <= 10080)
    for key in ('sources', 'destinations'):
        _require(type(route[key]) is list and len(route[key]) <= 30)
        for chat in route[key]:
            _text(chat, 1, 80)
            _require(chat == chat.strip())
        _require(len(set(route[key])) == len(route[key]))


def validate_recovery_payload(payload):
    """Validate inert data only; does not establish consent, identity or access grants."""
    try:
        _keys(payload, {'format', 'version', 'owner_telegram_id', 'created_at', 'sessions', 'credentials', 'configuration', 'application'})
        _require(payload['format'] == 'becs-private-recovery' and type(payload['version']) is int and payload['version'] == 1)
        _require(payload['application'] == {'name': 'Becs', 'version': '1.1.0', 'workspace_schema': 1, 'access_schema': 1})
        _require(type(payload['application']['workspace_schema']) is int and type(payload['application']['access_schema']) is int)
        owner = _uid(payload['owner_telegram_id'])
        _text(payload['created_at'], 20, 40)
        created = datetime.fromisoformat(payload['created_at'].replace('Z', '+00:00'))
        _require(created.tzinfo is not None and created.utcoffset() == timedelta(0))
        _keys(payload['credentials'], {'telegram_api_id', 'telegram_api_hash', 'telegram_bot_token'})
        credentials = payload['credentials']
        api_id = credentials['telegram_api_id']
        _require(api_id is None or (type(api_id) is int and 0 < api_id < 2**31))
        api_hash = credentials['telegram_api_hash']
        _require(api_hash is None or (type(api_hash) is str and re.fullmatch(r'[0-9a-fA-F]{32}', api_hash) is not None))
        _require((api_id is None) == (api_hash is None))
        if credentials['telegram_bot_token'] is not None:
            _text(credentials['telegram_bot_token'], 1, 256)
        _keys(payload['configuration'], {'workspaces'})
        workspaces = payload['configuration']['workspaces']
        _require(type(workspaces) is list and 1 <= len(workspaces) <= 3)
        workspace_ids = []
        for workspace in workspaces:
            _keys(workspace, {'user_id', 'routes', 'paused'})
            workspace_ids.append(_uid(workspace['user_id']))
            _require(workspace['paused'] is True)
            _require(type(workspace['routes']) is list and len(workspace['routes']) <= 1000)
            for route in workspace['routes']:
                _route(route)
            _require(len(_canonical(workspace)) <= 2 * 1024 * 1024)
        _require(len(set(workspace_ids)) == len(workspace_ids) and owner in workspace_ids)
        _require(type(payload['sessions']) is list and len(payload['sessions']) <= 3)
        session_ids = []
        for session in payload['sessions']:
            _keys(session, {'user_id', 'consent_version', 'telegram_session'})
            session_ids.append(_uid(session['user_id']))
            _require(session['consent_version'] == '1')
            _text(session['telegram_session'], 1, 65536)
            _require(session['user_id'] in workspace_ids)
        _require(len(set(session_ids)) == len(session_ids))
        _require(len(_canonical(payload)) <= MAX_PLAINTEXT_BYTES)
        return payload
    except (ValueError, TypeError, KeyError, OverflowError, RecursionError, UnicodeError) as exc:
        raise RecoveryError('Invalid recovery payload schema.') from exc


def _password(password):
    _text(password, 12, 1024)
    encoded = password.encode('utf-8')
    _require(len(encoded) <= 1024)
    return encoded


def _derive(password, salt):
    return Argon2id(salt=salt, length=32, iterations=3, lanes=4, memory_cost=65536).derive(_password(password))


def _b64(raw):
    return base64.b64encode(raw).decode('ascii')


def _unb64(value, length):
    _text(value, 1, 64)
    raw = base64.b64decode(value, validate=True)
    _require(len(raw) == length and _b64(raw) == value)
    return raw


def encrypt_recovery_archive(payload: dict, password: str) -> bytes:
    """Create a bytes-only ZIP; caller must verify current authorization and consent."""
    plaintext = _canonical(validate_recovery_payload(payload))
    salt, nonce = os.urandom(16), os.urandom(12)
    header = _canonical({'format': 'becs-private-recovery', 'version': 1, 'cipher': 'AES-256-GCM',
        'kdf': {'name': 'Argon2id', 'memory_kib': 65536, 'iterations': 3, 'parallelism': 4, 'key_bytes': 32},
        'salt': _b64(salt), 'nonce': _b64(nonce)})
    aad = MAGIC + struct.pack('>I', len(header)) + header
    encrypted = aad + AESGCM(_derive(password, salt)).encrypt(nonce, plaintext, aad)
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_STORED) as archive:
        for name, content in [('README.txt', PUBLIC_README), ('payload.enc', encrypted)]:
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.external_attr = (stat.S_IFREG | 0o600) << 16
            archive.writestr(info, content)
    raw = output.getvalue()
    _require(len(raw) <= MAX_ARCHIVE_BYTES)
    return raw


def _read_encrypted(raw):
    _require(type(raw) is bytes and 22 <= len(raw) <= MAX_ARCHIVE_BYTES)
    # Disallow trailing/concatenated data, comments, ZIP64, multi-disk and directory bombs.
    _require(raw[-22:-18] == b'PK\x05\x06')
    disk, directory_disk, disk_count, total_count, directory_size, directory_offset, comment_len = struct.unpack('<4H2IH', raw[-18:])
    _require(disk == directory_disk == comment_len == 0 and disk_count == total_count == 2)
    _require(directory_offset + directory_size == len(raw) - 22)
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        infos = archive.infolist()
        _require(len(infos) == 2 and [i.filename for i in infos] == ['README.txt', 'payload.enc'])
        offset = 0
        for info in infos:
            _require(info.orig_filename == info.filename and not info.extra and not info.comment)
            _require(info.compress_type == zipfile.ZIP_STORED and info.flag_bits == 0)
            _require(stat.S_IFMT(info.external_attr >> 16) in (0, stat.S_IFREG))
            _require(info.file_size == info.compress_size and 0 < info.file_size <= MAX_PLAINTEXT_BYTES + 4096)
            _require(info.header_offset == offset and raw[offset:offset+4] == b'PK\x03\x04')
            _require(len(raw[offset:offset+30]) == 30)
            local = struct.unpack('<4s5H3I2H', raw[offset:offset+30])
            _require(local[2] == local[3] == local[-1] == 0)
            _require(local[6] == info.CRC and local[7] == local[8] == info.file_size)
            name_len = local[-2]
            _require(raw[offset+30:offset+30+name_len] == info.filename.encode('ascii'))
            offset += 30 + name_len + info.file_size
        _require(offset == directory_offset)
        _require(archive.read('README.txt') == PUBLIC_README)
        return archive.read('payload.enc')


def decrypt_recovery_archive(archive: bytes, password: str) -> dict:
    """Authenticate, decrypt and validate into memory only. Never restores or grants."""
    try:
        blob = _read_encrypted(archive)
        _require(blob[:len(MAGIC)] == MAGIC and len(blob) >= len(MAGIC) + 4 + 16)
        header_size = struct.unpack('>I', blob[len(MAGIC):len(MAGIC)+4])[0]
        _require(0 < header_size <= 2048)
        boundary = len(MAGIC) + 4 + header_size
        _require(16 < len(blob) - boundary <= MAX_PLAINTEXT_BYTES + 16)
        header_raw = blob[len(MAGIC)+4:boundary]
        header = _json(header_raw)
        _keys(header, {'format', 'version', 'cipher', 'kdf', 'salt', 'nonce'})
        _require(header['format'] == 'becs-private-recovery' and type(header['version']) is int and header['version'] == 1)
        _require(header['cipher'] == 'AES-256-GCM')
        expected_kdf = {'name': 'Argon2id', 'memory_kib': 65536, 'iterations': 3, 'parallelism': 4, 'key_bytes': 32}
        _require(header['kdf'] == expected_kdf and all(type(header['kdf'][key]) is type(value) for key, value in expected_kdf.items()))
        _require(header_raw == _canonical(header))
        salt, nonce = _unb64(header['salt'], 16), _unb64(header['nonce'], 12)
        plaintext = AESGCM(_derive(password, salt)).decrypt(nonce, blob[boundary:], blob[:boundary])
        return validate_recovery_payload(_json(plaintext))
    except (InvalidTag, ValueError, TypeError, KeyError, AttributeError, OverflowError, RecursionError,
            UnicodeError, binascii.Error, zipfile.BadZipFile, RuntimeError, struct.error) as exc:
        raise RecoveryError('Unable to authenticate or validate recovery archive.') from exc
