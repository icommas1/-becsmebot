"""Synthetic credentials only; no application database, network, or runtime imports."""
import copy
import io
import json
import struct
import zipfile

import pytest
from app import recovery_crypto as rc

PASSWORD = 'synthetic testing password'


def payload():
    return {'format': 'becs-private-recovery', 'version': 1, 'owner_telegram_id': '123',
        'created_at': '2026-10-11T12:00:00+00:00',
        'application': {'name': 'Becs', 'version': '1.1.0', 'workspace_schema': 1, 'access_schema': 1},
        'sessions': [{'user_id': '123', 'consent_version': '1', 'telegram_session': 'SYNTHETIC-NOT-A-SESSION'}],
        'credentials': {'telegram_api_id': 12345, 'telegram_api_hash': '0' * 32, 'telegram_bot_token': 'SYNTHETIC-NOT-A-TOKEN'},
        'configuration': {'workspaces': [{'user_id': '123', 'routes': [], 'paused': True}]}}


def rewrite(raw, transform):
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        entries = [(name, z.read(name)) for name in z.namelist()]
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_STORED) as z:
        for name, data in transform(entries):
            z.writestr(name, data)
    return out.getvalue()


@pytest.fixture(scope='module')
def encrypted():
    return rc.encrypt_recovery_archive(payload(), PASSWORD)


def test_roundtrip_and_no_cleartext(encrypted):
    assert rc.decrypt_recovery_archive(encrypted, PASSWORD) == payload()
    assert b'SYNTHETIC' not in encrypted
    with zipfile.ZipFile(io.BytesIO(encrypted)) as z:
        assert z.namelist() == ['README.txt', 'payload.enc']
    assert rc.encrypt_recovery_archive(payload(), PASSWORD) != encrypted


def test_wrong_password(encrypted):
    with pytest.raises(rc.RecoveryError):
        rc.decrypt_recovery_archive(encrypted, 'different synthetic password')


@pytest.mark.parametrize('cut', [1, 22, 100, 700])
def test_truncation(encrypted, cut):
    with pytest.raises(rc.RecoveryError):
        rc.decrypt_recovery_archive(encrypted[:-cut], PASSWORD)


def test_authenticated_ciphertext_tamper(encrypted):
    def tamper(entries):
        name, blob = entries[1]
        entries[1] = name, blob[:-1] + bytes([blob[-1] ^ 1])
        return entries
    with pytest.raises(rc.RecoveryError):
        rc.decrypt_recovery_archive(rewrite(encrypted, tamper), PASSWORD)


def test_authenticated_metadata_tamper(encrypted):
    def tamper(entries):
        name, blob = entries[1]
        start = len(rc.MAGIC) + 4
        length = struct.unpack('>I', blob[len(rc.MAGIC):start])[0]
        header = json.loads(blob[start:start+length])
        header['nonce'] = rc._b64(b'x' * 12)
        new = rc._canonical(header)
        entries[1] = name, rc.MAGIC + struct.pack('>I', len(new)) + new + blob[start+length:]
        return entries
    with pytest.raises(rc.RecoveryError):
        rc.decrypt_recovery_archive(rewrite(encrypted, tamper), PASSWORD)


@pytest.mark.parametrize('operation', [
    lambda es: es + [('../outside', b'bad')],
    lambda es: es + [es[1]],
    lambda es: [('../README.txt', es[0][1]), es[1]],
    lambda es: [('README.txt', b'changed instructions'), es[1]],
    lambda es: list(reversed(es)),
])
def test_zip_inventory_attacks(encrypted, operation):
    with pytest.raises(rc.RecoveryError):
        rc.decrypt_recovery_archive(rewrite(encrypted, operation), PASSWORD)


def test_compression_and_symlink_rejected(encrypted):
    with zipfile.ZipFile(io.BytesIO(encrypted)) as z:
        data = [(i.filename, z.read(i)) for i in z.infolist()]
    for mode in ('deflate', 'symlink'):
        out = io.BytesIO()
        with zipfile.ZipFile(out, 'w') as z:
            for name, content in data:
                info = zipfile.ZipInfo(name)
                if mode == 'deflate':
                    info.compress_type = zipfile.ZIP_DEFLATED
                else:
                    info.external_attr = 0o120777 << 16
                z.writestr(info, content)
        with pytest.raises(rc.RecoveryError):
            rc.decrypt_recovery_archive(out.getvalue(), PASSWORD)


@pytest.mark.parametrize('mutation', [
    lambda p: p.update(version=True),
    lambda p: p.update(version=2),
    lambda p: p.update(owner_telegram_id='shared'),
    lambda p: p.update(owner_telegram_id='000123'),
    lambda p: p.update(source_root_id='server-a'),
    lambda p: p.update(access_grants=['123']),
    lambda p: p.update(created_at='2026-10-11T12:00:00'),
    lambda p: p['credentials'].update(secret_key='forbidden'),
    lambda p: p['credentials'].update(telegram_api_id=True),
    lambda p: p['sessions'][0].update(user_id='456'),
    lambda p: p['sessions'][0].update(consent_version='2'),
    lambda p: p['sessions'].append(copy.deepcopy(p['sessions'][0])),
    lambda p: p['configuration']['workspaces'][0].update(paused=False),
    lambda p: p['configuration'].update(queues=[]),
])
def test_payload_schema_rejections(mutation):
    p = payload()
    mutation(p)
    with pytest.raises(rc.RecoveryError):
        rc.validate_recovery_payload(p)


def test_strict_route_allowlist():
    p = payload()
    route = {'name': 'synthetic route', 'mode': 'smart', 'enabled': False, 'sources': [],
             'destinations': [], 'allowed': '', 'blocked': '', 'pattern': '', 'match_mode': 'any',
             'network': 'both', 'require_contract': False, 'dedup_minutes': 60, 'delivery_style': 'native'}
    p['configuration']['workspaces'][0]['routes'] = [route]
    assert rc.validate_recovery_payload(p) == p
    for key, value in [('enabled', True), ('script', 'ignored?'), ('dedup_minutes', True)]:
        bad = copy.deepcopy(p)
        bad['configuration']['workspaces'][0]['routes'][0][key] = value
        with pytest.raises(rc.RecoveryError):
            rc.validate_recovery_payload(bad)


def test_fixed_kdf_rejects_before_derivation(encrypted, monkeypatch):
    def tamper(entries):
        name, blob = entries[1]
        entries[1] = name, blob.replace(b'65536', b'65535', 1)
        return entries
    monkeypatch.setattr(rc, '_derive', lambda *args: pytest.fail('Untrusted KDF ran'))
    with pytest.raises(rc.RecoveryError):
        rc.decrypt_recovery_archive(rewrite(encrypted, tamper), PASSWORD)


def test_shared_root_and_cross_root_no_restore_semantics(encrypted):
    result = rc.decrypt_recovery_archive(encrypted, PASSWORD)
    assert 'source_root_id' not in result
    assert 'access_grants' not in result
    assert all(w['paused'] is True for w in result['configuration']['workspaces'])
    # Archive carries user identity only, never an ability to authorize any destination root.
    bad = payload()
    bad['configuration']['workspaces'][0]['user_id'] = 'shared'
    with pytest.raises(rc.RecoveryError):
        rc.validate_recovery_payload(bad)


def test_trailing_prepended_and_oversize(encrypted):
    for raw in (encrypted + b'extra', b'prefix' + encrypted, b'x' * (rc.MAX_ARCHIVE_BYTES + 1)):
        with pytest.raises(rc.RecoveryError):
            rc.decrypt_recovery_archive(raw, PASSWORD)


def test_no_password_cli_argument_or_noninteractive(capsys, monkeypatch):
    from scripts import recover_archive
    with pytest.raises(SystemExit):
        recover_archive.main(['nonexistent.zip', '--password', PASSWORD])
    monkeypatch.setattr('sys.stdin.isatty', lambda: False)
    assert recover_archive.main(['nonexistent.zip']) == 1
    captured = capsys.readouterr()
    assert PASSWORD not in captured.out + captured.err


def test_duplicate_json_rejected():
    with pytest.raises(rc.RecoveryError):
        rc._json(b'{"version":1,"version":1}')


def test_bad_password_constraints():
    for password in ('short', 'x' * 1025, None):
        with pytest.raises(rc.RecoveryError):
            rc.encrypt_recovery_archive(payload(), password)


def test_explicit_sensitive_files_private_and_no_overwrite(tmp_path):
    from scripts.recover_archive import write_recovery_files
    import stat
    destination = tmp_path / 'private-recovery'
    write_recovery_files(payload(), destination)
    target = destination / 'recovery-sensitive.json'
    assert json.loads(target.read_text()) == payload()
    assert stat.S_IMODE(destination.stat().st_mode) == 0o700
    assert stat.S_IMODE(target.stat().st_mode) == 0o600
    with pytest.raises(FileExistsError):
        write_recovery_files(payload(), destination)
    symlink = tmp_path / 'link'
    symlink.symlink_to(destination, target_is_directory=True)
    with pytest.raises(FileExistsError):
        write_recovery_files(payload(), symlink)


def test_cli_default_dryrun_and_explicit_confirm(tmp_path, monkeypatch, capsys, encrypted):
    from scripts import recover_archive
    source = tmp_path / 'archive.zip'
    source.write_bytes(encrypted)
    monkeypatch.setattr('sys.stdin.isatty', lambda: True)
    monkeypatch.setattr('getpass.getpass', lambda _: PASSWORD)
    monkeypatch.setattr('builtins.input', lambda _: pytest.fail('Default dry-run asked to write'))
    assert recover_archive.main([str(source)]) == 0
    assert sorted(p.name for p in tmp_path.iterdir()) == ['archive.zip']
    destination = tmp_path / 'recovered'
    monkeypatch.setattr('builtins.input', lambda _: 'no')
    assert recover_archive.main([str(source), '--recover-to', str(destination)]) == 1
    assert not destination.exists()
    monkeypatch.setattr('builtins.input', lambda _: 'WRITE SENSITIVE RECOVERY FILES')
    assert recover_archive.main([str(source), '--recover-to', str(destination)]) == 0
    assert (destination / 'recovery-sensitive.json').exists()
    result = capsys.readouterr()
    assert PASSWORD not in result.out + result.err
    assert 'SYNTHETIC' not in result.out + result.err


def test_getpass_echo_fallback_fails_closed(tmp_path, monkeypatch, capsys, encrypted):
    from scripts import recover_archive
    import getpass
    import warnings
    source = tmp_path / 'archive.zip'
    source.write_bytes(encrypted)
    monkeypatch.setattr('sys.stdin.isatty', lambda: True)
    def unsafe_prompt(_):
        warnings.warn('Cannot control echo on the terminal.', getpass.GetPassWarning)
        pytest.fail('Echo fallback must never run')
    monkeypatch.setattr('getpass.getpass', unsafe_prompt)
    assert recover_archive.main([str(source)]) == 1
    assert sorted(p.name for p in tmp_path.iterdir()) == ['archive.zip']
    assert 'Traceback' not in capsys.readouterr().err


def test_private_file_recovery_unsupported_platform_no_mutation(tmp_path, monkeypatch):
    from scripts import recover_archive
    destination = tmp_path / 'must-not-exist'
    monkeypatch.setattr(recover_archive.os, 'supports_dir_fd', set())
    with pytest.raises(rc.RecoveryError):
        recover_archive.write_recovery_files(payload(), destination)
    assert not destination.exists()
