"""Deployment identity configuration without inherited service destinations."""
from __future__ import annotations

import os
import re
import ipaddress
from dataclasses import dataclass
from typing import Mapping
from urllib.parse import urlsplit, urlunsplit


def https_url(value: str, *, origin_only: bool = False) -> str:
    """Validate an explicit HTTPS destination without making a network request."""
    value = value.strip()
    if not value or re.search(r'[\s\\]', value) or '?' in value or '#' in value:
        raise ValueError('An HTTPS URL without whitespace, query or fragment is required.')
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as exc:
        raise ValueError('Invalid HTTPS URL.') from exc
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username is not None
            or parsed.password is not None or (port is not None and not 1 <= port <= 65535)):
        raise ValueError('An HTTPS URL without embedded credentials is required.')
    host = parsed.hostname
    if ':' in host:
        try:
            ipaddress.IPv6Address(host)
        except ValueError as exc:
            raise ValueError('Invalid HTTPS host.') from exc
    elif (len(host) > 253 or any(not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?', label)
                               for label in host.rstrip('.').split('.'))):
        raise ValueError('Invalid HTTPS host.')
    if origin_only and parsed.path not in ('', '/'):
        raise ValueError('Frontend origins must not include a path.')
    normalized_host = f'[{host.lower()}]' if ':' in host else host.lower()
    netloc = normalized_host + (f':{port}' if port is not None and port != 443 else '')
    return urlunsplit(('https', netloc, '' if origin_only else parsed.path.rstrip('/'), '', ''))


def validate_bot_username(value: str, *, required: bool = False) -> str:
    value = value.strip().removeprefix('@')
    if not value and not required:
        return ''
    if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{4,31}', value) or not value.lower().endswith('bot'):
        raise ValueError('BECS_TELEGRAM_BOT_USERNAME must be a valid Telegram bot username.')
    return value


def telegram_bot_username(*, required: bool = False) -> str:
    return validate_bot_username(os.getenv('BECS_TELEGRAM_BOT_USERNAME', ''), required=required)


@dataclass(frozen=True)
class ProjectConfig:
    project_name: str
    frontend_origins: tuple[str, ...]
    telegram_bot_username: str


def load_config(environment: Mapping[str, str] | None = None) -> ProjectConfig:
    environment = os.environ if environment is None else environment
    name = environment.get('BECS_PROJECT_NAME', 'BecsAutoForward').strip()
    if not name or len(name) > 80 or any(ord(char) < 32 for char in name):
        raise ValueError('BECS_PROJECT_NAME must contain 1 to 80 printable characters.')
    raw_origins = environment.get('BECS_FRONTEND_ORIGINS', '').strip()
    origins = tuple(dict.fromkeys(https_url(value, origin_only=True) for value in raw_origins.split(','))) if raw_origins else ()
    return ProjectConfig(name, origins, validate_bot_username(environment.get('BECS_TELEGRAM_BOT_USERNAME', '')))
