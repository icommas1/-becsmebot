#!/usr/bin/env python3
"""Offline archive validation and optional disabled-first plan; never restores."""
import argparse
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.backup import MAX_BYTES, validate_backup


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('backup')
    parser.add_argument('--plan', help='Create a private local JSON dry-run plan (no live changes)')
    args = parser.parse_args()
    try:
        with open(args.backup, 'rb') as source:
            result = validate_backup(source.read(MAX_BYTES + 1), include_plan=bool(args.plan))
        if args.plan:
            # Refuse overwrite, and restrict personal configuration to this OS user.
            import os
            with os.fdopen(os.open(args.plan, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as target:
                json.dump(result, target, indent=2)
            del result['workspaces']
        print(json.dumps(result, indent=2))
    except (OSError, ValueError) as exc:
        print('Backup validation failed. Check file access, format, size, checksum and route schema. An existing plan file is never overwritten.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
