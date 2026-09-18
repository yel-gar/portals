from __future__ import annotations

import asyncio
import logging
from contextlib import suppress

import asyncpg

logger = logging.getLogger(__name__)

PORTAL_NOTIFY_CHANNEL = "portal_changes"


class PortalUpdateHub:
    """Postgres LISTEN/NOTIFY hub broadcasting refresh events to WS subscribers.

    A dedicated connection listens on the ``portal_changes`` channel via
    ``asyncpg.Connection.add_listener``. Every received notification is
    broadcast to all subscribed WebSocket clients so they re-query the current
    portal page. Producers (background tasks and a DB trigger) are planned but
    not implemented yet.
    """

    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[None]] = set()
        self._connection: asyncpg.Connection | None = None

    async def start(self, database_url: str) -> None:
        url = database_url.replace("postgresql+asyncpg", "postgresql")
        self._connection = await asyncpg.connect(url)
        await self._connection.add_listener(PORTAL_NOTIFY_CHANNEL, self._on_notify)
        logger.info("LISTEN запущен на канале %s", PORTAL_NOTIFY_CHANNEL)

    async def stop(self) -> None:
        if self._connection is not None:
            with suppress(ValueError):
                await self._connection.remove_listener(PORTAL_NOTIFY_CHANNEL, self._on_notify)
            await self._connection.close()
            self._connection = None
        logger.info("LISTEN остановлен на канале %s", PORTAL_NOTIFY_CHANNEL)

    async def _on_notify(self, _connection: asyncpg.Connection, _pid: int, _channel: str, _payload: str) -> None:
        await self.broadcast()

    async def subscribe(self) -> asyncio.Queue[None]:
        queue: asyncio.Queue[None] = asyncio.Queue()
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[None]) -> None:
        self._subscribers.discard(queue)

    async def broadcast(self) -> None:
        for queue in tuple(self._subscribers):
            queue.put_nowait(None)


portal_update_hub = PortalUpdateHub()
