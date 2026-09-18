import asyncio

import asyncpg

from app.notifications import PORTAL_NOTIFY_CHANNEL, portal_update_hub


async def test_hub_receives_postgres_notify(postgres_url: str) -> None:
    url = postgres_url.replace("postgresql+asyncpg", "postgresql")
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
