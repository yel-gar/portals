import asyncio
import time

import asyncpg
import pytest

from app.notifications import (
    ACTION_LOG_NOTIFY_CHANNEL,
    PORTAL_NOTIFY_CHANNEL,
    UpdateHub,
    action_log_hub,
    portal_update_hub,
)


@pytest.mark.parametrize(
    ("hub", "channel"),
    [(portal_update_hub, PORTAL_NOTIFY_CHANNEL), (action_log_hub, ACTION_LOG_NOTIFY_CHANNEL)],
)
@pytest.mark.asyncio
async def test_hub_receives_postgres_notify(postgres_url: str, hub: UpdateHub, channel: str) -> None:
    url = postgres_url.replace("postgresql+asyncpg", "postgresql")
    await hub.start(url)
    try:
        queue = await hub.subscribe()
        try:
            connection = await asyncpg.connect(url)
            try:
                await connection.execute(f"NOTIFY {channel}")
            finally:
                await connection.close()
            await asyncio.wait_for(queue.get(), timeout=10.0)
        finally:
            hub.unsubscribe(queue)
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_hub_idempotent_stop(postgres_url: str) -> None:
    url = postgres_url.replace("postgresql+asyncpg", "postgresql")
    await portal_update_hub.start(url)
    await portal_update_hub.stop()
    await portal_update_hub.stop()


@pytest.mark.asyncio
async def test_hub_start_is_idempotent(postgres_url: str) -> None:
    url = postgres_url.replace("postgresql+asyncpg", "postgresql")
    await portal_update_hub.start(url)
    await portal_update_hub.start(url)
    try:
        queue = await portal_update_hub.subscribe()
        try:
            connection = await asyncpg.connect(url)
            try:
                await connection.execute(f"NOTIFY {PORTAL_NOTIFY_CHANNEL}")
            finally:
                await connection.close()
            await asyncio.wait_for(queue.get(), timeout=10.0)
        finally:
            portal_update_hub.unsubscribe(queue)
    finally:
        await portal_update_hub.stop()


@pytest.mark.asyncio
async def test_hub_reconnects_after_termination(postgres_url: str) -> None:
    url = postgres_url.replace("postgresql+asyncpg", "postgresql")
    await portal_update_hub.start(url)
    try:
        queue = await portal_update_hub.subscribe()
        try:
            connection = portal_update_hub._connection
            assert connection is not None
            connection.terminate()  # kill the listener connection; the supervisor must reconnect
            # on recovery the hub broadcasts and wakes subscribers
            await asyncio.wait_for(queue.get(), timeout=10.0)
        finally:
            portal_update_hub.unsubscribe(queue)
    finally:
        await portal_update_hub.stop()


@pytest.mark.asyncio
async def test_hub_broadcast_wakes_all_subscribers() -> None:
    queue_a = await portal_update_hub.subscribe()
    queue_b = await portal_update_hub.subscribe()
    try:
        assert portal_update_hub.subscriber_count == 2
        await portal_update_hub.broadcast()
        await asyncio.wait_for(queue_a.get(), timeout=1.0)
        await asyncio.wait_for(queue_b.get(), timeout=1.0)
    finally:
        portal_update_hub.unsubscribe(queue_a)
        portal_update_hub.unsubscribe(queue_b)
    assert portal_update_hub.subscriber_count == 0


@pytest.mark.asyncio
async def test_hub_broadcast_coalesces_pending_refresh() -> None:
    """While a refresh is pending, extra broadcasts are skipped, not queued."""
    queue = await portal_update_hub.subscribe()
    try:
        for _ in range(5):
            await portal_update_hub.broadcast()
        assert queue.qsize() == 1
        await asyncio.wait_for(queue.get(), timeout=1.0)
        assert queue.qsize() == 0
        # once the pending refresh is consumed, the next broadcast enqueues again
        await portal_update_hub.broadcast()
        assert queue.qsize() == 1
    finally:
        portal_update_hub.unsubscribe(queue)


@pytest.mark.asyncio
async def test_hub_stop_interrupts_reconnect_backoff(postgres_url: str, monkeypatch: pytest.MonkeyPatch) -> None:
    """stop() must not wait out a pending reconnect backoff sleep."""
    url = postgres_url.replace("postgresql+asyncpg", "postgresql")
    # Long base delay: without prompt cancellation, stop() would wait up to
    # _RECONNECT_MAX_DELAY_SECONDS and stall application shutdown.
    monkeypatch.setattr("app.notifications._RECONNECT_BASE_DELAY_SECONDS", 60.0)
    await portal_update_hub.start(url)
    try:
        connection = portal_update_hub._connection
        assert connection is not None
        connection.terminate()
        await asyncio.sleep(0.1)  # the supervisor notices the loss and starts backing off
        started = time.monotonic()
        await portal_update_hub.stop()
        assert time.monotonic() - started < 5.0
    finally:
        await portal_update_hub.stop()
