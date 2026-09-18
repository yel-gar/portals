from __future__ import annotations

import asyncio
from contextlib import suppress

import asyncpg

PORTAL_NOTIFY_CHANNEL = "portal_changes"


class PortalUpdateHub:
    """Postgres LISTEN/NOTIFY hub broadcasting refresh events to WS subscribers.

    A dedicated connection listens on the ``portal_changes`` channel. Every
    received notification triggers ``broadcast()``, waking all subscribed
    WebSocket clients so they re-query the current portal page. Producers
    (background tasks and a DB trigger) are planned but not implemented yet.
    """

    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[None]] = set()
        self._connection: asyncpg.Connection | None = None
        self._listener_task: asyncio.Task[None] | None = None

    async def start(self, database_url: str) -> None:
        url = database_url.replace("postgresql+asyncpg", "postgresql")
        self._connection = await asyncpg.connect(url)
        await self._connection.execute(f"LISTEN {PORTAL_NOTIFY_CHANNEL}")
        self._listener_task = asyncio.create_task(self._listen_loop())

    async def stop(self) -> None:
        if self._listener_task is not None:
            self._listener_task.cancel()
            with suppress(asyncio.CancelledError):
                await self._listener_task
            self._listener_task = None
        if self._connection is not None:
            await self._connection.close()
            self._connection = None

    async def _listen_loop(self) -> None:
        assert self._connection is not None
        while True:
            await self._connection.wait()
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
