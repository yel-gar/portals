from __future__ import annotations

import asyncio
import logging
from contextlib import suppress

import asyncpg

logger = logging.getLogger(__name__)

PORTAL_NOTIFY_CHANNEL = "portal_changes"
ACTION_LOG_NOTIFY_CHANNEL = "action_log_changes"


class UpdateHub:
    """Postgres LISTEN/NOTIFY hub broadcasting refresh events to WS subscribers.

    A dedicated connection listens on a channel via ``asyncpg.Connection.add_listener``.
    Every received notification is broadcast to all subscribed WebSocket clients so
    they re-query the current page. Producers send ``pg_notify`` inside the same
    transaction that changes the data, so subscribers are only woken on durable
    commits.
    """

    def __init__(self, channel: str) -> None:
        self._channel = channel
        self._subscribers: set[asyncio.Queue[None]] = set()
        self._connection: asyncpg.Connection | None = None

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    async def start(self, database_url: str) -> None:
        url = database_url.replace("postgresql+asyncpg", "postgresql")
        self._connection = await asyncpg.connect(url)
        await self._connection.add_listener(self._channel, self._on_notify)
        logger.info("LISTEN запущен на канале %s", self._channel)

    async def stop(self) -> None:
        if self._connection is not None:
            with suppress(ValueError):
                await self._connection.remove_listener(self._channel, self._on_notify)
            await self._connection.close()
            self._connection = None
        logger.info("LISTEN остановлен на канале %s", self._channel)

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


portal_update_hub = UpdateHub(PORTAL_NOTIFY_CHANNEL)
action_log_hub = UpdateHub(ACTION_LOG_NOTIFY_CHANNEL)
