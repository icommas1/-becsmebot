"""Fixed account boundaries shared by HTTP, Telegram listeners and workers."""
import hashlib
import hmac
import os
from contextlib import contextmanager
from contextvars import ContextVar

ACCOUNT_IDS = ('primary', 'account-2', 'account-3')
current_account = ContextVar('becs_account', default='primary')


def validate_account(account_id):
    if account_id not in ACCOUNT_IDS:
        raise ValueError('Unknown account')
    return account_id


@contextmanager
def account_scope(account_id):
    token = current_account.set(validate_account(account_id))
    try:
        yield
    finally:
        current_account.reset(token)


def account_env(name, account_id=None):
    account_id = validate_account(account_id or current_account.get())
    if account_id == 'primary':
        return os.getenv(name, '').strip()
    suffix = account_id[-1]
    return os.getenv(f'BECS_ACCOUNT_{suffix}_{name.removeprefix("BECS_")}', '').strip()


def access_key(account_id=None):
    account_id = validate_account(account_id or current_account.get())
    configured = account_env('BECS_ADMIN_TOKEN', account_id)
    if configured or account_id == 'primary':
        return configured
    # Deterministic, independent invitation keys; never expose the signing secret.
    secret = os.getenv('BECS_SESSION_SECRET', '')
    if len(secret) < 32:
        return ''
    return hmac.new(secret.encode(), f'becs.invite.v1:{account_id}'.encode(), hashlib.sha256).hexdigest()


def browser_token(account_id=None):
    account_id = validate_account(account_id or current_account.get())
    key = access_key(account_id)
    if not key:
        return ''
    identity = account_env('BECS_ALLOWED_TELEGRAM_ID', account_id)
    return hmac.new(key.encode(), f'becs.browser.v1:{account_id}:{identity}'.encode(), hashlib.sha256).hexdigest()


def accepts_key(candidate):
    return bool(candidate) and any(value and hmac.compare_digest(candidate, value)
                                   for value in (access_key(), browser_token()))


class AccountManager:
    """Resolve the request's client without any mutable global selection."""
    def __init__(self, managers):
        self.managers = managers

    def __getattr__(self, name):
        return getattr(self.managers[current_account.get()], name)
