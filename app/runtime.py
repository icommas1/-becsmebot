"""Single-process lifecycle registry for isolated approved-user Telegram workers."""
import asyncio
import logging
import os
from dataclasses import dataclass

from .telegram_client import PersonalTelegram, numeric_user_id, telegram_bot_poll

logger = logging.getLogger('becs.runtime')


@dataclass
class Worker:
    stop: asyncio.Event
    task: asyncio.Task


class RuntimeRegistry:
    def __init__(self):
        self.managers = {}
        self.workers = {}
        self._lifecycle_locks = {}
        self._stop = None
        self._bot_task = None
        self._started = False

    def _lock(self, user_id):
        return self._lifecycle_locks.setdefault(user_id, asyncio.Lock())

    def get(self, user_id):
        from .access import is_approved
        user_id = numeric_user_id(user_id)
        if not is_approved(user_id):
            raise PermissionError('Workspace access is not approved')
        if user_id not in self.managers:
            self.managers[user_id] = PersonalTelegram(user_id)
        manager = self.managers[user_id]
        manager.check_access()
        return manager

    def worker_for(self, user_id):
        worker = self.workers.get(numeric_user_id(user_id))
        return worker.task if worker else None

    async def activate(self, user_id):
        from .access import is_approved
        from .db import init_db, workspace
        from .service import delivery_worker
        user_id = numeric_user_id(user_id)
        async with self._lock(user_id):
            if not is_approved(user_id):
                raise PermissionError('Workspace access is not approved')
            manager = self.managers.get(user_id)
            if manager is None:
                manager = PersonalTelegram(user_id)
                self.managers[user_id] = manager
            manager.activate()
            with workspace(user_id):
                init_db()
                if os.getenv('TELEGRAM_API_ID') and os.getenv('TELEGRAM_API_HASH'):
                    try:
                        if manager.has_saved_session():
                            await manager.ensure_client()
                    except PermissionError:
                        raise
                    except Exception as ex:
                        logger.warning('Saved Telegram session unavailable (%s)', type(ex).__name__)
                manager.check_access()
                existing = self.workers.get(user_id)
                if existing is None or existing.task.done():
                    stop = asyncio.Event()
                    task = asyncio.create_task(delivery_worker(manager, stop, user_id=user_id))
                    self.workers[user_id] = Worker(stop, task)
            return manager

    async def start(self, stop=None):
        from .access import list_users, owner_id
        if self._started:
            return
        owner = owner_id()
        self._stop = stop if stop is not None else asyncio.Event()
        self._started = True
        for user in list_users(owner):
            if user['status'] == 'approved':
                await self.activate(user['user_id'])
        if os.getenv('TELEGRAM_BOT_TOKEN'):
            self._bot_task = asyncio.create_task(telegram_bot_poll(self, self._stop))

    async def revoke(self, user_id, pause=True):
        user_id = numeric_user_id(user_id)
        # Close the gate before waiting for lifecycle locks or network cleanup.
        manager = self.managers.get(user_id)
        if manager is not None:
            manager.close_gate()
        async with self._lock(user_id):
            if pause:
                from .db import set_setting, workspace, workspace_path
                # Preserve retained queues safely: reapproval requires an explicit
                # member Resume. Never create a database just to revoke a request.
                if workspace_path(user_id).exists():
                    with workspace(user_id):
                        set_setting('paused', 'true')
            worker = self.workers.pop(user_id, None)
            if worker:
                worker.stop.set()
                if not worker.task.cancelling():
                    worker.task.cancel()
            manager = self.managers.get(user_id)
            if manager is not None:
                await manager.halt()
            if worker:
                await asyncio.gather(worker.task, return_exceptions=True)

    async def shutdown(self):
        self._started = False
        if self._stop:
            self._stop.set()
        if self._bot_task:
            self._bot_task.cancel()
            await asyncio.gather(self._bot_task, return_exceptions=True)
            self._bot_task = None
        results = await asyncio.gather(*(self.revoke(user_id, pause=False)
            for user_id in set(self.managers) | set(self.workers)), return_exceptions=True)
        for result in results:
            if isinstance(result, BaseException):
                logger.warning('Telegram runtime shutdown issue (%s)', type(result).__name__)
        self._stop = None


runtime = RuntimeRegistry()
