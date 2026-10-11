#!/usr/bin/env python3
"""Offline recovery: dry-run by default; optional confirmed private inert files. Never apply a live restore."""
import argparse
import getpass
import json
import os
import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.recovery_crypto import MAX_ARCHIVE_BYTES, RecoveryError, decrypt_recovery_archive


class SafeArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        # Never echo unknown arguments: they may contain a mistakenly supplied password.
        self.exit(2, 'Invalid arguments. Use --help for supported arguments; passwords are prompted interactively.\n')


def write_recovery_files(payload, destination):
    """Write one private inert JSON file to a NEW directory; never apply it."""
    if os.name != 'posix' or not all(hasattr(os, name) for name in ('O_DIRECTORY', 'O_NOFOLLOW', 'fchmod')) or os.open not in os.supports_dir_fd or os.unlink not in os.supports_dir_fd:
        raise RecoveryError('Private file recovery requires a supported POSIX system.')
    encoded = json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False).encode('utf-8')
    # Existing directories are rejected, including symlinks. Parent directories are
    # operator-selected, but no directory is implicitly created along the path.
    os.mkdir(destination, mode=0o700)
    directory_fd = os.open(destination, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fchmod(directory_fd, 0o700)
        fd = os.open('recovery-sensitive.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=directory_fd)
        try:
            with os.fdopen(fd, 'wb') as target:
                target.write(encoded)
                target.flush()
                os.fsync(target.fileno())
        except BaseException:
            os.unlink('recovery-sensitive.json', dir_fd=directory_fd)
            raise
    finally:
        os.close(directory_fd)


def main(argv=None):
    parser = SafeArgumentParser(description=__doc__)
    parser.add_argument('archive', help='Encrypted recovery ZIP to validate locally')
    parser.add_argument('--recover-to', metavar='NEW_DIRECTORY', help='After interactive confirmation, write sensitive inert JSON into a new private directory; never apply it')
    args = parser.parse_args(argv)
    try:
        # Never accept passwords through argv, stdin pipes, environment or files.
        if not sys.stdin.isatty():
            raise RecoveryError('An interactive terminal is required.')
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            password = getpass.getpass('Recovery password (not displayed): ')
        with open(args.archive, 'rb') as source:
            raw = source.read(MAX_ARCHIVE_BYTES + 1)
        payload = decrypt_recovery_archive(raw, password)
        del password
        if args.recover_to:
            print('WARNING: This creates unencrypted Telegram credentials and session data on this machine.', file=sys.stderr)
            print('Destination: ' + str(Path(args.recover_to).absolute()), file=sys.stderr)
            print('Protect this directory. This does not restore access, connect Telegram or resume forwarding.', file=sys.stderr)
            if input('Type WRITE SENSITIVE RECOVERY FILES to continue: ') != 'WRITE SENSITIVE RECOVERY FILES':
                raise RecoveryError('Recovery file writing was not confirmed.')
            write_recovery_files(payload, args.recover_to)
        print(json.dumps({'valid': True, 'mode': 'sensitive-files-written-inert' if args.recover_to else 'dry-run-memory-only', 'version': payload['version'],
            'workspace_count': len(payload['configuration']['workspaces']),
            'session_count': len(payload['sessions']),
            'route_count': sum(len(w['routes']) for w in payload['configuration']['workspaces']),
            'restored': False, 'membership_requires_fresh_approval': True}, indent=2))
    except (OSError, RecoveryError, EOFError, KeyboardInterrupt, getpass.GetPassWarning):
        print('Recovery validation failed. Check archive, password and interactive terminal. No live restore was performed. If file writing failed, inspect the requested destination.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
