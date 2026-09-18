from __future__ import annotations

import asyncio
import logging
from contextlib import suppress

import asyncpg
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

PORTAL_NOTIFY_CHANNEL = "portal_changes"
ACTION_LOG_NOTIFY_CHANNEL = "action_log_changes"

_RECONNECT_BASE_DELAY_SECONDS = 1.0
_RECONNECT_MAX_DELAY_SECONDS = 30.0


class UpdateHub:
    """Postgres LISTEN/NOTIFY hub broadcasting refresh events to WS subscribers.

    A dedicated connection listens on a channel via ``asyncpg.Connection.add_listener``.
    Every received notification is broadcast to all subscribed WebSocket clients so
    they re-query the current page. Producers send ``pg_notify`` inside the same
    transaction that changes the data, so subscribers are only woken on durable
    commits.

    The listener connection is supervised: a background task watches for termination
    and reconnects with exponential backoff, then broadcasts a refresh event on
    recovery so stale subscribers re-query. ``start`` is idempotent and ``stop`` is
    safe to call repeatedly or on a dead connection.
    """

    def __init__(self, channel: str) -> None:
        self._channel = channel
        self._subscribers: set[asyncio.Queue[None]] = set()
        self._connection: asyncpg.Connection | None = None
        self._url: str | None = None
        self._stopped = False
        self._terminated = asyncio.Event()
        self._supervisor: asyncio.Task[None] | None = None

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    async def start(self, database_url: str) -> None:
        if self._supervisor is not None:
            await self.stop()
        self._url = database_url.replace("postgresql+asyncpg", "postgresql")
        self._stopped = False
        await self._connect()
        self._supervisor = asyncio.create_task(self._supervise())

    async def _connect(self) -> None:
        assert self._url is not None
        connection = await asyncpg.connect(self._url)
        await connection.add_listener(self._channel, self._on_notify)
        self._terminated = asyncio.Event()
        connection.add_termination_listener(lambda _conn: self._terminated.set())
        self._connection = connection
        logger.info("LISTEN запущен на канале %s", self._channel)

    async def _supervise(self) -> None:
        delay = _RECONNECT_BASE_DELAY_SECONDS
        while not self._stopped:
            await self._terminated.wait()
            if self._stopped:
                return
            logger.error("LISTEN-соединение на канале %s потеряно, переподключение", self._channel)
            self._connection = None
            await asyncio.sleep(delay)
            if self._stopped:
                return
            try:
                await self._connect()
            except Exception:
                logger.error("LISTEN-переподключение на канале %s не удалось", self._channel)
                delay = min(delay * 2, _RECONNECT_MAX_DELAY_SECONDS)
                continue
            delay = _RECONNECT_BASE_DELAY_SECONDS
            logger.info("LISTEN переподключён на канале %s, будим подписчиков", self._channel)
            await self.broadcast()

    async def stop(self) -> None:
        if self._supervisor is None:
            return
        self._stopped = True
        self._terminated.set()
        connection = self._connection
        self._connection = None
        if connection is not None:
            with suppress(ValueError, Exception):
                await connection.remove_listener(self._channel, self._on_notify)
            with suppress(Exception):
                await connection.close()
        with suppress(asyncio.CancelledError, Exception):
            await self._supervisor
        self._supervisor = None
        self._subscribers.clear()
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


async def notify_portal_changed(session: AsyncSession, portal_id: int) -> None:
    """Produce a ``portal_changes`` notification inside the caller's transaction."""
    await session.execute(
        text("SELECT pg_notify(:channel, :payload)"),
        {"channel": PORTAL_NOTIFY_CHANNEL, "payload": f"portal:{portal_id}"},
    )


async def notify_action_log_changed(session: AsyncSession, portal_id: int) -> None:
    """Produce an ``action_log_changes`` notification inside the caller's transaction."""
    await session.execute(
        text("SELECT pg_notify(:channel, :payload)"),
        {"channel": ACTION_LOG_NOTIFY_CHANNEL, "payload": f"log:{portal_id}"},
    )


portal_update_hub = UpdateHub(PORTAL_NOTIFY_CHANNEL)
action_log_hub = UpdateHub(ACTION_LOG_NOTIFY_CHANNEL)
