"""Account ownership primitives for Becs multi-account migration.

This module does not enable multi-user access on its own. All API queries,
Telegram listeners, queue workers and session stores must use these scopes
before additional accounts may be authorized.
"""
import sqlite3

OWNER_SLOT = 1
MAX_ACCOUNTS = 3


def initialize_accounts(db: sqlite3.Connection) -> None:
    """Create the account registry without changing existing routing behavior."""
    db.execute("""
        CREATE TABLE IF NOT EXISTS account_slots (
            slot INTEGER PRIMARY KEY CHECK (slot BETWEEN 1 AND 3),
            telegram_user_id TEXT UNIQUE,
            enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
            created_at REAL NOT NULL DEFAULT (unixepoch())
        )
    """)
    db.execute(
        "INSERT OR IGNORE INTO account_slots(slot, enabled) VALUES (?, 1)",
        (OWNER_SLOT,),
    )


def bind_identity(db: sqlite3.Connection, slot: int, telegram_user_id: str) -> None:
    """Bind a Telegram-verified identity to an available slot.

    Caller MUST verify Telegram initData HMAC and ensure only the owner can
    assign secondary slots. Never accept a user-supplied ID as proof of login.
    """
    if not 1 <= slot <= MAX_ACCOUNTS:
        raise ValueError("Invalid account slot")
    if not telegram_user_id or not telegram_user_id.isdecimal():
        raise ValueError("Telegram user ID must be numeric")
    existing = db.execute(
        "SELECT telegram_user_id FROM account_slots WHERE slot=?", (slot,)
    ).fetchone()
    if existing and existing[0] and existing[0] != telegram_user_id:
        raise ValueError("Slot already assigned; explicit revocation required")
    db.execute(
        "INSERT INTO account_slots(slot, telegram_user_id) VALUES (?, ?) "
        "ON CONFLICT(slot) DO UPDATE SET telegram_user_id=excluded.telegram_user_id",
        (slot, telegram_user_id),
    )


def account_for_identity(db: sqlite3.Connection, telegram_user_id: str) -> int | None:
    row = db.execute(
        "SELECT slot FROM account_slots WHERE telegram_user_id=? AND enabled=1",
        (str(telegram_user_id),),
    ).fetchone()
    return int(row[0]) if row else None


def assert_account_owns_route(db: sqlite3.Connection, account_id: int, route_id: int) -> None:
    row = db.execute(
        "SELECT 1 FROM routes WHERE id=? AND account_id=?",
        (route_id, account_id),
    ).fetchone()
    if not row:
        raise PermissionError("Route not found")


def session_namespace(account_id: int) -> str:
    if not 1 <= account_id <= MAX_ACCOUNTS:
        raise ValueError("Invalid account slot")
    return f"telegram-account-{account_id}"
