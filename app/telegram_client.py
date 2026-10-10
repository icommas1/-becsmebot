"""Optional authorized personal-account connection and background Telegram control bot."""
import asyncio
import base64
import hashlib
import json
import logging
import os
import time
from pathlib import Path
import httpx

from .accounts import ACCOUNT_IDS, account_scope, account_env, validate_account

logger = logging.getLogger('becs.telegram')
_identity_lock = asyncio.Lock()


class DeliveryReceiptError(RuntimeError):
    """The send may have happened; do not retry automatically."""

class PersonalTelegram:
    def __init__(self, account_id='primary'):
        self.account_id = validate_account(account_id)
        self._client_lock = asyncio.Lock()
        self._identity_verified = False
        self._password_pending = False
        self.client = None
        self.phone = None
        self.listener = None
        self.last_error = ''
        self.session_path = None
        self.cipher = None
        self._login_lock = asyncio.Lock()
        self._auth_cache = (0.0, False)

    async def ensure_client(self):
        async with self._client_lock:
            return await self._ensure_client()

    async def _ensure_client(self):
        if self.client is not None:
            return self.client
        api_id = os.getenv('TELEGRAM_API_ID', '').strip()
        api_hash = os.getenv('TELEGRAM_API_HASH', '').strip()
        if not api_id or not api_hash:
            raise RuntimeError('Add TELEGRAM_API_ID and TELEGRAM_API_HASH to your server .env first.')
        try:
            from telethon import TelegramClient, events
        except ImportError:
            raise RuntimeError('Telethon is not installed. Install requirements.txt on the server.')
        from .service import ingest_message
        from telethon.sessions import StringSession
        from cryptography.fernet import Fernet
        secret = os.getenv('BECS_SESSION_SECRET','')
        if len(secret)<32:
            raise RuntimeError('Set a unique BECS_SESSION_SECRET (32+ random characters) in .env before connecting Telegram.')
        material = secret if self.account_id == 'primary' else secret + ':becs.session.v1:' + self.account_id
        cipher=Fernet(base64.urlsafe_b64encode(hashlib.sha256(material.encode()).digest()))
        session_dir = Path(os.getenv('BECS_SESSION_DIR', Path(__file__).resolve().parents[1] / 'data' / 'sessions'))
        if self.account_id != 'primary': session_dir = session_dir / self.account_id
        session_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        try: session_dir.chmod(0o700)
        except OSError: pass
        session_path=session_dir/'personal.session.enc'
        session_value=''
        if session_path.exists():
            try:
                session_value=cipher.decrypt(session_path.read_bytes()).decode()
            except Exception:
                raise RuntimeError('Stored session cannot be decrypted. Check BECS_SESSION_SECRET; the session has not been deleted.')
        client = TelegramClient(StringSession(session_value),int(api_id),api_hash,
                                sequential_updates=True,auto_reconnect=True)
        self.cipher=cipher
        self.session_path=session_path
        try:
            await client.connect()
            if await client.is_user_authorized():
                await self.verify_identity(client)
        except BaseException:
            await client.disconnect()
            raise
        @client.on(events.NewMessage(incoming=True))
        async def on_message(event):
            try:
                if self._identity_verified and event.chat_id is not None:
                    with account_scope(self.account_id):
                        await ingest_message(str(event.chat_id), int(event.message.id),event.raw_text or '', service=self)
            except Exception:
                logger.exception('Incoming message processing failed')
        self.client = client
        return client

    async def status(self):
        configured = bool(os.getenv('TELEGRAM_API_ID') and os.getenv('TELEGRAM_API_HASH'))
        if not configured:
            return {'configured':False,'connected':False,'authorized':False,'detail':'API credentials needed'}
        if not self.client:
            return {'configured':True,'connected':False,'authorized':False,'detail':'Not connected'}
        try:
            connected = self.client.is_connected()
            if connected and time.monotonic()<self._auth_cache[0]:
                authorized=self._auth_cache[1]
            else:
                authorized = await self.client.is_user_authorized() if connected else False
                self._auth_cache=(time.monotonic()+15,authorized)
            authorized = bool(authorized and self._identity_verified)
            return {'configured':True,'connected':connected,'authorized':authorized,'detail':'Authorized' if authorized else 'Sign in required'}
        except Exception as ex:
            self.last_error=str(ex)[:150]
            return {'configured':True,'connected':False,'authorized':False,'detail':'Connection unavailable'}

    def persist_session(self):
        if not self.client or not self.cipher or not self.session_path:return
        token=self.client.session.save()
        if not token:return
        # Atomic write protects the encrypted session against interrupted writes.
        temp=self.session_path.with_suffix('.tmp')
        temp.write_bytes(self.cipher.encrypt(token.encode()))
        temp.chmod(0o600)
        temp.replace(self.session_path)

    async def start_phone(self,phone):
        async with self._login_lock:
            client=await self.ensure_client()
            if await client.is_user_authorized():
                raise RuntimeError('This slot is already connected; use its existing Telegram account.')
            self._password_pending=False
            self.phone=phone
            await client.send_code_request(phone)
            return {'status':'code_sent','message':'Enter the code received from Telegram in this secured Mini App.'}

    async def verify_identity(self, client):
        from .db import get_setting, set_setting
        me = await client.get_me()
        if not me or getattr(me, 'bot', False):
            raise RuntimeError('A personal Telegram user account is required')
        identity = str(me.id)
        expected = account_env('BECS_ALLOWED_TELEGRAM_ID', self.account_id)
        if expected and expected != identity:
            raise RuntimeError('This Telegram user does not belong to this account slot')
        async with _identity_lock:
            for account_id in ACCOUNT_IDS:
                with account_scope(account_id):
                    bound = get_setting('telegram_user_id')
                if account_id == self.account_id and bound and bound != identity:
                    raise RuntimeError('This slot is bound to a different Telegram user')
                if account_id != self.account_id and bound == identity:
                    raise RuntimeError('This Telegram user is already connected to another slot')
            with account_scope(self.account_id):
                set_setting('telegram_user_id', identity)
        self._identity_verified = True

    async def finish_login(self, client):
        try:
            await self.verify_identity(client)
        except Exception:
            # Revoke only the newly created session; never touch other accounts.
            await self.disconnect(logout=True)
            raise
        self.persist_session()
        self.phone = None
        self._password_pending = False
        self._auth_cache=(time.monotonic()+15,True)
        return {'status':'authorized'}

    async def sign_in_code(self, code):
        async with self._login_lock:
            if not self.phone: raise RuntimeError('Request a Telegram login code first.')
            client=await self.ensure_client()
            try:
                from telethon.errors import SessionPasswordNeededError
                await client.sign_in(phone=self.phone,code=code)
            except SessionPasswordNeededError:
                self._password_pending = True
                return {'status':'password_required','message':'Your account has two-step verification enabled.'}
            return await self.finish_login(client)

    async def sign_in_password(self,password):
        async with self._login_lock:
            if not self._password_pending:
                raise RuntimeError('Complete the Telegram code challenge first.')
            client=await self.ensure_client()
            await client.sign_in(password=password)
            return await self.finish_login(client)

    async def chats(self):
        client=await self.ensure_client()
        if not self._identity_verified or not await client.is_user_authorized(): return []
        result=[]
        async for d in client.iter_dialogs(limit=250):
            if d.is_group or d.is_channel or d.is_user:
                is_bot = bool(getattr(d.entity, 'bot', False))
                result.append({'id':str(d.id),'title':d.name,
                               'kind':'bot' if is_bot else 'channel' if d.is_channel else 'group' if d.is_group else 'private',
                               'is_bot':is_bot,
                               'username':'@'+d.entity.username if getattr(d.entity,'username',None) else ''})
        return result


    async def resolve_chat(self, reference, role='destination'):
        """Resolve a dialog or @username to a stable ID, checking account access."""
        from telethon import utils
        from telethon.tl.types import Channel, Chat, User
        client = await self.ensure_client()
        if not self._identity_verified or not await client.is_user_authorized():
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

    async def send(self, job, delivery_style):
        client=await self.ensure_client()
        if not self._identity_verified or not await client.is_user_authorized(): raise RuntimeError('Telegram sign-in required')
        source=self.peer(job['source_id']); destination=self.peer(job['destination_id'])
        if delivery_style=='text':
            # Preserve literal text, including underscores and command arguments.
            receipt = await client.send_message(destination, job['message_preview'], link_preview=False, parse_mode=None)
        else:
            receipt = await client.forward_messages(destination, int(job['message_id']), from_peer=source)
        if isinstance(receipt, (list, tuple)): receipt = receipt[0] if receipt else None
        message_id = getattr(receipt, 'id', None)
        if not isinstance(message_id, int) or isinstance(message_id, bool) or message_id <= 0:
            raise DeliveryReceiptError('Telegram did not return a delivery receipt')
        return message_id

    async def disconnect(self, logout=False):
        if self.client:
            if logout:
                await self.client.log_out()
                if self.session_path and self.session_path.exists(): self.session_path.unlink()
            else:
                self.persist_session()
                await self.client.disconnect()
        self.client=None
        self.phone=None
        self._identity_verified=False
        self._password_pending=False
        self._auth_cache=(0.0,False)

    @staticmethod
    def peer(value):
        text=str(value).strip()
        return int(text) if text.lstrip('-').isdigit() else text


async def telegram_bot_poll(managers, stop: asyncio.Event):
    """One poller routes commands by a uniquely configured Telegram sender."""
    token=os.getenv('TELEGRAM_BOT_TOKEN','').strip()
    identities = {}
    for account_id in ACCOUNT_IDS:
        identity = account_env('BECS_ALLOWED_TELEGRAM_ID', account_id)
        if identity: identities.setdefault(identity, []).append(account_id)
    if not token or not identities: return
    base=f'https://api.telegram.org/bot{token}'
    offset=0
    async with httpx.AsyncClient(timeout=httpx.Timeout(35, connect=10)) as client:
        while not stop.is_set():
            try:
                resp=await client.get(base+'/getUpdates',params={'offset':offset,'timeout':20,'allowed_updates':json.dumps(['message'])})
                data=resp.json()
                if not data.get('ok'): raise RuntimeError('Telegram Bot API polling rejected request')
                for item in data.get('result',[]):
                    offset=max(offset,int(item['update_id'])+1)
                    msg=item.get('message') or {}
                    user=msg.get('from') or {}
                    matches=identities.get(str(user.get('id','')), [])
                    if len(matches)!=1 or msg.get('chat',{}).get('type')!='private':continue
                    words=(msg.get('text') or '').split()
                    if not words:continue
                    cmd=words[0].split('@')[0].lower()
                    if cmd not in ('/start','/status','/pause','/resume','/routes'):continue
                    with account_scope(matches[0]):
                        manager=managers[matches[0]]
                        from .db import connection,set_setting,get_setting,event
                        if cmd=='/pause':set_setting('paused','true')
                        if cmd=='/resume':set_setting('paused','false')
                        with connection() as db:
                            count=db.execute('SELECT COUNT(*) FROM routes WHERE enabled=1').fetchone()[0]
                            pending=db.execute("SELECT COUNT(*) FROM jobs WHERE status='queued'").fetchone()[0]
                        paused=get_setting('paused')=='true'
                        text=f'becs. · Crypto Forwarding\n\nState: {"Paused" if paused else "Enabled"}\nRoutes: {count}\nQueued: {pending}\nPersonal account: {"Connected" if (await manager.status())["authorized"] else "Not connected"}'
                        buttons=[]
                        url=os.getenv('BECS_MINI_APP_URL','').strip()
                        if url.startswith('https://'):
                            from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
                            parts=urlsplit(url)
                            query=dict(parse_qsl(parts.query)); query['account']=matches[0]
                            url=urlunsplit((parts.scheme,parts.netloc,parts.path,urlencode(query),parts.fragment))
                        if url.startswith('https://'):
                            buttons.append([{'text':'Open Becs Mini App','web_app':{'url':url}}])
                        buttons.append([{'text':'/pause'},{'text':'/resume'}])
                        payload={'chat_id':msg['chat']['id'],'text':text}
                        if buttons:payload['reply_markup']={'inline_keyboard':buttons[:1]} if url.startswith('https://') else None
                        if payload.get('reply_markup') is None:payload.pop('reply_markup',None)
                        await client.post(base+'/sendMessage',json=payload)
            except asyncio.CancelledError:break
            except Exception:
                logger.exception('Telegram control bot polling failed')
                try: await asyncio.wait_for(stop.wait(),timeout=8)
                except asyncio.TimeoutError:pass

