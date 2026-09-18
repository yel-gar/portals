import asyncio

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


async def test_hub_idempotent_stop(postgres_url: str) -> None:
    url = postgres_url.replace("postgresql+asyncpg", "postgresql")
    await portal_update_hub.start(url)
    await portal_update_hub.stop()
    await portal_update_hub.stop()


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
