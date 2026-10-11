"""Isolated personal Telegram sessions and one shared private control-bot poller."""
import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import re
import time
from contextlib import asynccontextmanager, nullcontext
from functools import wraps
from pathlib import Path

import httpx

logger = logging.getLogger('becs.telegram')


def numeric_user_id(value):
    """Only canonical positive numeric Telegram IDs may enter paths or context."""
    if isinstance(value, bool):
        raise ValueError('Invalid Telegram user ID')
    value = str(value)
    if not re.fullmatch(r'[1-9][0-9]{0,18}', value) or int(value) > 2**63 - 1:
        raise ValueError('Invalid Telegram user ID')
    return value


def workspace_operation(method):
    @wraps(method)
    async def wrapped(self, *args, **kwargs):
        async with self.operation():
            return await method(self, *args, **kwargs)
    return wrapped


class PersonalTelegram:
    def __init__(self, user_id=None):
        # Unconfigured default construction remains useful for isolated legacy unit
        # tests. Opening a real client always requires a configured numeric owner.
        configured_owner = os.getenv('BECS_ALLOWED_TELEGRAM_ID', '').strip()
        self.user_id = numeric_user_id(user_id if user_id is not None else configured_owner) if (user_id is not None or configured_owner) else None
        self._owner = bool(self.user_id and self.user_id == configured_owner)
        self.client = None
        self.phone = None
        self.listener = None
        self.last_error = ''
        self.session_path = None
        self.cipher = None
        self._login_lock = asyncio.Lock()
        self._client_lock = asyncio.Lock()
        self._auth_cache = (0.0, False)
        self._identity_verified = False
        self._revoked = False
        self._operations = {}

    def check_access(self):
        if self._revoked:
            raise PermissionError('Workspace access is no longer approved')
        if self.user_id is not None:
            from .access import is_approved
            if not is_approved(self.user_id):
                raise PermissionError('Workspace access is no longer approved')

    @asynccontextmanager
    async def operation(self):
        from .db import workspace
        self.check_access()
        task = asyncio.current_task()
        self._operations[task] = self._operations.get(task, 0) + 1
        try:
            with workspace(self.user_id) if self.user_id is not None else nullcontext():
                yield
                self.check_access()
        finally:
            depth = self._operations.get(task, 1) - 1
            if depth:
                self._operations[task] = depth
            else:
                self._operations.pop(task, None)

    def session_storage(self):
        if self.user_id is None:
            raise RuntimeError('Configure the owner Telegram user ID before connecting Telegram.')
        from cryptography.fernet import Fernet
        secret = os.getenv('BECS_SESSION_SECRET', '')
        if len(secret) < 32:
            raise RuntimeError('Set a unique BECS_SESSION_SECRET (32+ random characters) in .env before connecting Telegram.')
        # Preserve the original owner's encrypted file and exact legacy key.
        key = hashlib.sha256(secret.encode()).digest() if self._owner else hmac.new(
            secret.encode(), b'becs:telegram-session:v1:' + self.user_id.encode(), hashlib.sha256).digest()
        directory = Path(os.getenv('BECS_SESSION_DIR', Path(__file__).resolve().parents[1] / 'data' / 'sessions'))
        name = 'personal.session.enc' if self._owner else f'user-{self.user_id}.session.enc'
        return directory / name, Fernet(base64.urlsafe_b64encode(key))

    def has_saved_session(self):
        path, _ = self.session_storage()
        return path.exists()

    async def _verify_identity(self, client):
        self.check_access()
        identity = await client.get_me()
        self.check_access()
        if (identity is None or bool(getattr(identity, 'bot', False))
                or str(getattr(identity, 'id', '')) != self.user_id):
            self._identity_verified = False
            self._auth_cache = (0.0, False)
            self.phone = None
            if self.listener is not None:
                client.remove_event_handler(self.listener)
                self.listener = None
            if self.client is client:
                self.client = None
            # Never log out or overwrite a saved session on an identity mismatch.
            await client.disconnect()
            raise ValueError('Sign in with the same Telegram account that opened this workspace.')
        self._identity_verified = True

    @workspace_operation
    async def ensure_client(self):
        async with self._client_lock:
            self.check_access()
            if self.client is not None:
                return self.client
            api_id = os.getenv('TELEGRAM_API_ID', '').strip()
            api_hash = os.getenv('TELEGRAM_API_HASH', '').strip()
            if not api_id or not api_hash:
                raise RuntimeError('Add TELEGRAM_API_ID and TELEGRAM_API_HASH to your server .env first.')
            from telethon import TelegramClient, events
            from telethon.sessions import StringSession
            session_path, cipher = self.session_storage()
            session_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            try:
                session_path.parent.chmod(0o700)
            except OSError:
                pass
            session_value = ''
            if session_path.exists():
                try:
                    session_value = cipher.decrypt(session_path.read_bytes()).decode()
                except Exception:
                    raise RuntimeError('Stored session cannot be decrypted. Check BECS_SESSION_SECRET; the session has not been deleted.') from None
            client = TelegramClient(StringSession(session_value), int(api_id), api_hash,
                                    sequential_updates=True, auto_reconnect=True)
            try:
                await client.connect()
                self.check_access()
                if await client.is_user_authorized():
                    await self._verify_identity(client)
                self.check_access()
            except BaseException:
                await client.disconnect()
                raise
            self.cipher, self.session_path = cipher, session_path
            self.client = client

            @client.on(events.NewMessage(incoming=True))
            async def on_message(event):
                try:
                    async with self.operation():
                        from .service import ingest_message
                        if event.chat_id is not None and self._identity_verified:
                            await ingest_message(str(event.chat_id), int(event.message.id), event.raw_text or '', service=self)
                except (PermissionError, asyncio.CancelledError):
                    return
                except Exception as ex:
                    # Telegram exceptions can include private text or credentials.
                    logger.warning('Incoming message processing failed (%s)', type(ex).__name__)
            self.listener = on_message
            return client

    @workspace_operation
    async def status(self):
        configured = bool(os.getenv('TELEGRAM_API_ID') and os.getenv('TELEGRAM_API_HASH'))
        if not configured:
            return {'configured': False, 'connected': False, 'authorized': False, 'detail': 'API credentials needed'}
        if not self.client:
            return {'configured': True, 'connected': False, 'authorized': False, 'detail': 'Not connected'}
        try:
            connected = self.client.is_connected()
            if connected and time.monotonic() < self._auth_cache[0]:
                authorized = self._auth_cache[1]
            else:
                authorized = await self.client.is_user_authorized() if connected else False
                self.check_access()
                if authorized and not self._identity_verified:
                    await self._verify_identity(self.client)
                self._auth_cache = (time.monotonic() + 15, authorized)
            return {'configured': True, 'connected': connected, 'authorized': authorized,
                    'detail': 'Authorized' if authorized else 'Sign in required'}
        except PermissionError:
            raise
        except Exception as ex:
            self.last_error = type(ex).__name__
            return {'configured': True, 'connected': False, 'authorized': False, 'detail': 'Connection unavailable'}

    def persist_session(self):
        self.check_access()
        if not self.client or not self.cipher or not self.session_path or not self._identity_verified:
            return
        token = self.client.session.save()
        if not token:
            return
        temp = self.session_path.with_suffix('.tmp')
        # Create with restrictive permissions before writing any encrypted bytes.
        descriptor = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, 'wb') as output:
            output.write(self.cipher.encrypt(token.encode()))
        temp.chmod(0o600)
        temp.replace(self.session_path)

    @workspace_operation
    async def start_phone(self, phone):
        async with self._login_lock:
            client = await self.ensure_client()
            self.check_access()
            self.phone = phone
            await client.send_code_request(phone)
            return {'status': 'code_sent', 'message': 'Enter the code received from Telegram in this secured Mini App.'}

    @workspace_operation
    async def sign_in_code(self, code):
        async with self._login_lock:
            if not self.phone:
                raise RuntimeError('Request a Telegram login code first.')
            client = await self.ensure_client()
            self.check_access()
            try:
                from telethon.errors import SessionPasswordNeededError
                await client.sign_in(phone=self.phone, code=code)
            except SessionPasswordNeededError:
                self.check_access()
                return {'status': 'password_required', 'message': 'Your account has two-step verification enabled.'}
            await self._verify_identity(client)
            self.persist_session()
            self._auth_cache = (time.monotonic() + 15, True)
            self.phone = None
            return {'status': 'authorized'}

    @workspace_operation
    async def sign_in_password(self, password):
        async with self._login_lock:
            client = await self.ensure_client()
            self.check_access()
            await client.sign_in(password=password)
            await self._verify_identity(client)
            self.persist_session()
            self._auth_cache = (time.monotonic() + 15, True)
            self.phone = None
            return {'status': 'authorized'}

    @workspace_operation
    async def chats(self):
        client = await self.ensure_client()
        if not await client.is_user_authorized():
            return []
        result = []
        async for dialog in client.iter_dialogs(limit=250):
            self.check_access()
            if dialog.is_group or dialog.is_channel or dialog.is_user:
                is_bot = bool(getattr(dialog.entity, 'bot', False))
                result.append({'id': str(dialog.id), 'title': dialog.name,
                               'kind': 'bot' if is_bot else 'channel' if dialog.is_channel else 'group' if dialog.is_group else 'private',
                               'is_bot': is_bot,
                               'username': '@' + dialog.entity.username if getattr(dialog.entity, 'username', None) else ''})
        return result

    @workspace_operation
    async def resolve_chat(self, reference, role='destination'):
        """Resolve a dialog or @username to a stable ID, checking account access."""
        from telethon import utils
        from telethon.tl.types import Channel, Chat, User
        client = await self.ensure_client()
        if not await client.is_user_authorized():
            raise ValueError('Sign in to your personal Telegram account first')
        ref = str(reference).strip()
        if not ref or len(ref) > 80:
            raise ValueError('Enter a Telegram @username or numeric chat ID')
        if ref.startswith('@'):
            import re
            if not re.fullmatch(r'@[A-Za-z][A-Za-z0-9_]{4,31}', ref):
                raise ValueError('Invalid public Telegram username')
        elif not (ref.lstrip('-').isdigit() and ref not in ('0', '-0')):
            raise ValueError('Use a public @username or a numeric chat ID')
        dialogs = [d async for d in client.iter_dialogs(limit=None)]
        entity = None
        if ref.startswith('@'):
            entity = await client.get_entity(ref)
        else:
            for dialog in dialogs:
                if str(dialog.id) == ref:
                    entity = dialog.entity
                    break
            if entity is None:
                raise ValueError('Chat ID not found in your accessible Telegram chats')
        peer_id = str(utils.get_peer_id(entity))
        is_bot = isinstance(entity, User) and bool(getattr(entity, 'bot', False))
        matching = next((d for d in dialogs if str(d.id) == peer_id), None)
        if matching is None:
            if is_bot:
                raise ValueError('Open this bot in your connected Telegram account, press Start, then refresh chats')
            raise ValueError('Join or open this chat in your Telegram account before selecting it')
        if role == 'source':
            # Updates from chats outside the authorized account's dialogs are not monitored.
            pass
        elif role == 'destination':
            if isinstance(entity, Channel) and entity.broadcast:
                rights = getattr(entity, 'admin_rights', None)
                if not (getattr(entity, 'creator', False) or (rights and rights.post_messages)):
                    raise ValueError('You need channel posting permission for this destination')
            if isinstance(entity, (Channel, Chat)):
                banned = getattr(entity, 'banned_rights', None)
                if banned and getattr(banned, 'send_messages', False):
                    raise ValueError('Sending messages is restricted in this destination')
                default_banned = getattr(entity, 'default_banned_rights', None)
                if default_banned and getattr(default_banned, 'send_messages', False):
                    rights = getattr(entity, 'admin_rights', None)
                    if not (getattr(entity, 'creator', False) or rights):
                        raise ValueError('Members cannot send messages to this destination')
            if isinstance(entity, User) and getattr(entity, 'deleted', False):
                raise ValueError('This deleted Telegram account is not an eligible forwarding destination')
            if is_bot:
                # This worker sends as the authorized personal account, not the control bot.
                if await client.is_bot():
                    raise ValueError('Bot destinations require a connected personal Telegram account, not a bot session')
                from telethon.tl.functions.users import GetFullUserRequest
                details = await client(GetFullUserRequest(entity))
                if getattr(details.full_user, 'blocked', False):
                    raise ValueError('Unblock this bot in Telegram, press Start, then refresh chats')
                # Validation is read-only: never auto-start, unblock or send a probe to a bot.
        else:
            raise ValueError('Invalid chat role')
        return {'id': peer_id, 'title': matching.name, 'kind':
                'bot' if is_bot else 'channel' if matching.is_channel else 'group' if matching.is_group else 'private',
                'is_bot': is_bot,
                'username': '@' + entity.username if getattr(entity, 'username', None) else '',
                'role': role, 'validated': True}

    @workspace_operation
    async def send(self, job, delivery_style):
        """Send exactly one extracted contract address, never original content or media."""
        from .engine import extract_addresses
        payload=(job.get('message_preview') or '').strip()
        matches=extract_addresses(payload)
        if len(matches)!=1 or matches[0]['address']!=payload:
            raise ValueError('Queued item is not a standalone contract address')
        client=await self.ensure_client()
        if not await client.is_user_authorized():
            raise RuntimeError('Telegram sign-in required')
        target=str(job['destination_id'])
        peer=None
        async for dialog in client.iter_dialogs(limit=None):
            if str(dialog.id)==target:
                peer=await client.get_input_entity(dialog.entity)
                break
        if peer is None:
            raise LookupError('Destination is not available in the connected Telegram chats')
        self.check_access()
        await client.send_message(peer,payload,link_preview=False,parse_mode=None)

    async def _disconnect(self, logout=False, persist=True):
        client, self.client = self.client, None
        self.phone = None
        self._auth_cache = (0.0, False)
        if client is None:
            return
        if self.listener is not None:
            client.remove_event_handler(self.listener)
            self.listener = None
        try:
            if logout:
                self.check_access()
                await client.log_out()
                if self.session_path and self.session_path.exists():
                    self.session_path.unlink()
            elif persist and not self._revoked and self._identity_verified:
                self.client = client
                try:
                    self.persist_session()
                finally:
                    self.client = None
        finally:
            self._identity_verified = False
            await client.disconnect()

    @workspace_operation
    async def disconnect(self, logout=False):
        async with self._login_lock, self._client_lock:
            await self._disconnect(logout=logout)

    def close_gate(self):
        """Synchronous gate closure also interrupts a client being initialized."""
        self._revoked = True
        current = asyncio.current_task()
        tasks = [task for task in self._operations if task is not current and not task.done()]
        for task in tasks:
            if not task.cancelling():
                task.cancel()
        return tasks

    async def halt(self):
        """Close the access gate before draining API operations and the listener."""
        tasks = self.close_gate()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        await self._disconnect(persist=False)

    def activate(self):
        from .access import is_approved
        if not self.user_id or not is_approved(self.user_id):
            raise PermissionError('Workspace access is not approved')
        self._revoked = False

    @staticmethod
    def peer(value):
        text = str(value).strip()
        return int(text) if text.lstrip('-').isdigit() else text


def _private_message(item):
    """Trust only direct private messages in authenticated Bot API updates."""
    if not isinstance(item, dict):
        return None
    message = item.get('message')
    if not isinstance(message, dict):
        return None
    sender, chat = message.get('from'), message.get('chat')
    if not isinstance(sender, dict) or not isinstance(chat, dict) or chat.get('type') != 'private':
        return None
    if sender.get('is_bot') or message.get('via_bot') or message.get('is_automatic_forward'):
        return None
    if any(key.startswith('forward_') for key in message):
        return None
    # Bot API IDs must be JSON integers, never usernames, chat titles or strings.
    if type(sender.get('id')) is not int or type(chat.get('id')) is not int or sender['id'] != chat['id']:
        return None
    try:
        user_id = numeric_user_id(sender['id'])
    except ValueError:
        return None
    text = message.get('text')
    if not isinstance(text, str) or not text.strip() or len(text) > 4096:
        return None
    return message, user_id, text.strip().split()


async def handle_bot_update(item, registry):
    """Return a private reply payload; all networking lives in the one poller."""
    parsed = _private_message(item)
    if parsed is None:
        return None
    message, user_id, words = parsed
    command = words[0].split('@', 1)[0].lower()
    if command not in ('/start', '/status', '/pause', '/resume', '/routes'):
        return None
    from .access import AccessError, get_user, is_approved, redeem_invite
    from .db import connection, get_setting, set_setting, workspace
    if command == '/start' and len(words) == 2 and words[1].startswith('invite_'):
        sender = message['from']
        display_name = ' '.join(str(sender.get(key) or '') for key in ('first_name', 'last_name')).strip()[:100]
        try:
            user = redeem_invite(words[1][7:], user_id, display_name)
            text = 'Your access request is pending owner approval.'
            if user.get('status') == 'approved':
                text = 'Your workspace is approved. Open the Mini App to continue.'
        except (AccessError, ValueError, PermissionError):
            text = 'This invite is unavailable. Ask the owner for a new private invite.'
    elif not is_approved(user_id):
        user = get_user(user_id)
        status = user.get('status') if user else None
        text = ('Your access request is pending owner approval.' if status == 'pending' else
                'Your workspace access has been revoked.' if status == 'revoked' else
                'This workspace is private. Ask the owner for an invite.')
    else:
        with workspace(user_id):
            manager = registry.get(user_id)
            manager.check_access()
            if command == '/pause':
                set_setting('paused', 'true')
            elif command == '/resume':
                set_setting('paused', 'false')
            status = await manager.status()
            manager.check_access()
            with connection() as db:
                count = db.execute('SELECT COUNT(*) FROM routes WHERE enabled=1').fetchone()[0]
                pending = db.execute("SELECT COUNT(*) FROM jobs WHERE status='queued'").fetchone()[0]
                names = [row[0] for row in db.execute('SELECT name FROM routes ORDER BY updated_at DESC LIMIT 10')]
            paused = get_setting('paused', 'false') == 'true'
            text = ('becs. · Crypto Forwarding\n\n'
                    f'State: {"Paused" if paused else "Enabled"}\nRoutes: {count}\nQueued: {pending}\n'
                    f'Personal account: {"Connected" if status["authorized"] else "Not connected"}')
            if command == '/routes' and names:
                text += '\n\n' + '\n'.join(name[:100] for name in names)
    payload = {'chat_id': int(user_id), 'text': text}
    url = os.getenv('BECS_MINI_APP_URL', '').strip()
    if url.startswith('https://'):
        payload['reply_markup'] = {'inline_keyboard': [[{'text': 'Open Becs Mini App', 'web_app': {'url': url}}]]}
    return payload


async def telegram_bot_poll(registry, stop: asyncio.Event):
    """One poller handles direct private commands for independently scoped users."""
    token = os.getenv('TELEGRAM_BOT_TOKEN', '').strip()
    from .access import owner_id
    from .db import get_setting, set_setting, workspace
    owner = owner_id()
    if not token or not owner:
        return
    base = f'https://api.telegram.org/bot{token}'
    with workspace(owner):
        try:
            offset = max(0, int(get_setting('telegram_bot_update_offset', '0')))
        except ValueError:
            offset = 0
    async with httpx.AsyncClient(timeout=httpx.Timeout(35, connect=10)) as client:
        while not stop.is_set():
            try:
                response = await client.get(base + '/getUpdates', params={
                    'offset': offset, 'timeout': 20, 'allowed_updates': json.dumps(['message'])})
                data = response.json()
                if not isinstance(data, dict) or not data.get('ok'):
                    raise RuntimeError('Telegram Bot API polling rejected request')
                for item in data.get('result', []):
                    if stop.is_set():
                        break
                    if not isinstance(item, dict) or type(item.get('update_id')) is not int:
                        continue
                    if item['update_id'] < offset:
                        continue
                    offset = item['update_id'] + 1
                    with workspace(owner):
                        set_setting('telegram_bot_update_offset', str(offset))
                    # A member operation may be cancelled on revocation. Keep
                    # its task distinct from this shared, all-user poller.
                    handling = asyncio.create_task(handle_bot_update(item, registry))
                    try:
                        payload = await handling
                        if payload is not None:
                            await client.post(base + '/sendMessage', json=payload)
                    except asyncio.CancelledError:
                        if asyncio.current_task().cancelling():
                            raise  # Actual poller shutdown propagates to its child.
                        continue  # Only this member's command was revoked.
                    except (PermissionError, ValueError):
                        continue
                    finally:
                        if not handling.done():
                            handling.cancel()
                            await asyncio.gather(handling, return_exceptions=True)
            except asyncio.CancelledError:
                break
            except Exception as ex:
                logger.warning('Telegram control bot polling failed (%s)', type(ex).__name__)
                try:
                    await asyncio.wait_for(stop.wait(), timeout=8)
                except asyncio.TimeoutError:
                    pass
