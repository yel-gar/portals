import asyncio
from collections.abc import Awaitable, Callable
from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select

from app.db import get_session_factory
from app.models import Action, ActionLogEntry, Portal, utc_now
from app.notifications import action_log_hub, portal_update_hub


async def _login(client: AsyncClient) -> None:
    response = await client.post("/auth/register", json={"username": "alice", "password": "supersecret1"})
    assert response.status_code == 201, response.text
    login = await client.post("/auth/login", json={"username": "alice", "password": "supersecret1"})
    assert login.status_code == 200, login.text


async def test_list_portals_requires_auth(client: AsyncClient) -> None:
    response = await client.get("/portals")
    assert response.status_code == 401


async def test_list_portals_paginated(client: AsyncClient, create_portal: Callable[..., Awaitable[Portal]]) -> None:
    await _login(client)
    for i in range(3):
        await create_portal(name=f"Portal {i}")

    response = await client.get("/portals", params={"page": 1, "items_per_page": 2})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["total"] == 3
    assert len(data["items"]) == 2
    assert data["page"] == 1
    assert data["items_per_page"] == 2

    second_page = await client.get("/portals", params={"page": 2, "items_per_page": 2})
    assert len(second_page.json()["items"]) == 1


async def test_portal_payload_matches_schema(
    client: AsyncClient, create_portal: Callable[..., Awaitable[Portal]]
) -> None:
    await _login(client)
    await create_portal(name="Alpha", destination_world="Narnia", energy_level=50, stability=50)

    response = await client.get("/portals")
    item = response.json()["items"][0]
    assert item["name"] == "Alpha"
    assert item["closed"] is False
    assert isinstance(item["risk_factor"], float)
    assert item["danger_level"] in {"LOW", "MEDIUM", "HIGH", "CRITICAL"}
    assert set(item) == {
        "id",
        "name",
        "destination_world",
        "energy_level",
        "stability",
        "closed",
        "creatures_count",
        "is_marked",
        "has_observer",
        "last_update",
        "expires_at",
        "risk_factor",
        "danger_level",
    }


async def test_execute_action_flow(client: AsyncClient, create_portal: Callable[..., Awaitable[Portal]]) -> None:
    await _login(client)

    portal_a = await create_portal(name="A", creatures_count=2, has_observer=True, stability=30)
    response = await client.post(f"/portals/{portal_a.id}", params={"action": Action.MARK.value})
    assert response.status_code == 200, response.text
    assert response.json()["is_marked"] is True

    response = await client.post(f"/portals/{portal_a.id}", params={"action": Action.WARN_CREATURES.value})
    assert response.status_code == 200
    assert response.json()["has_observer"] is True
    assert response.json()["creatures_count"] == 0

    response = await client.post(f"/portals/{portal_a.id}", params={"action": Action.RECALL_OBSERVER.value})
    assert response.status_code == 200
    assert response.json()["has_observer"] is False

    response = await client.post(f"/portals/{portal_a.id}", params={"action": Action.STABILIZE.value})
    assert response.status_code == 200
    assert response.json()["stability"] == 100

    response = await client.post(f"/portals/{portal_a.id}", params={"action": Action.DISMISS.value})
    assert response.status_code == 200

    portal_b = await create_portal(name="B", creatures_count=0, has_observer=False)
    response = await client.post(f"/portals/{portal_b.id}", params={"action": Action.SEND_OBSERVER.value})
    assert response.status_code == 200
    assert response.json()["has_observer"] is True

    response = await client.post(f"/portals/{portal_b.id}", params={"action": Action.RECALL_OBSERVER.value})
    assert response.status_code == 200
    assert response.json()["has_observer"] is False

    response = await client.post(f"/portals/{portal_b.id}", params={"action": Action.CLOSE.value})
    assert response.status_code == 200
    assert response.json()["closed"] is True


async def test_execute_action_rejected(client: AsyncClient, create_portal: Callable[..., Awaitable[Portal]]) -> None:
    await _login(client)
    portal = await create_portal(creatures_count=1)

    response = await client.post(f"/portals/{portal.id}", params={"action": Action.CLOSE.value})
    assert response.status_code == 409
    assert response.json()["detail"] != ""

    response = await client.post(f"/portals/{portal.id}", params={"action": Action.RECALL_OBSERVER.value})
    assert response.status_code == 409


async def test_execute_action_unknown_portal(client: AsyncClient) -> None:
    await _login(client)
    response = await client.post("/portals/9999", params={"action": Action.DISMISS.value})
    assert response.status_code == 404


async def test_action_log(client: AsyncClient, create_portal: Callable[..., Awaitable[Portal]]) -> None:
    await _login(client)
    portal = await create_portal()
    await client.post(f"/portals/{portal.id}", params={"action": Action.MARK.value})
    await client.post(f"/portals/{portal.id}", params={"action": Action.UNMARK.value})

    response = await client.get("/portals/log")
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["total"] == 2
    actions = [entry["action"] for entry in data["items"]]
    assert actions == [Action.UNMARK.value, Action.MARK.value]
    assert data["items"][0]["user"]["username"] == "alice"


async def test_action_log_requires_auth(client: AsyncClient) -> None:
    response = await client.get("/portals/log")
    assert response.status_code == 401


async def test_stats(client: AsyncClient, create_portal: Callable[..., Awaitable[Portal]]) -> None:
    await _login(client)
    await create_portal(name="A", energy_level=10, stability=90, creatures_count=0)
    await create_portal(name="B", energy_level=90, stability=10, creatures_count=0)
    await create_portal(name="C", energy_level=50, stability=50, creatures_count=0, is_closed=True)
    await create_portal(name="D", energy_level=50, stability=50, creatures_count=0, is_marked=True)
    await create_portal(name="E", energy_level=50, stability=50, creatures_count=0, has_observer=True)
    await create_portal(
        name="F", energy_level=50, stability=50, creatures_count=0, expires_at=utc_now() - timedelta(minutes=1)
    )

    response = await client.get("/portals/stats")
    assert response.status_code == 200, response.text
    stats = response.json()
    assert stats["total"] == 6
    assert stats["open"] == 4
    assert stats["closed"] == 2
    assert stats["marked"] == 1
    assert stats["with_observer"] == 1
    assert stats["avg_risk"] > 0
    assert sum(stats["danger_levels"].values()) == stats["open"]


async def test_stats_requires_auth(client: AsyncClient) -> None:
    response = await client.get("/portals/stats")
    assert response.status_code == 401


async def test_committed_action_wakes_both_hubs(
    postgres_url: str, client: AsyncClient, create_portal: Callable[..., Awaitable[Portal]]
) -> None:
    url = postgres_url.replace("postgresql+asyncpg", "postgresql")
    for hub in (portal_update_hub, action_log_hub):
        await hub.start(url)
    try:
        portal_queue = await portal_update_hub.subscribe()
        log_queue = await action_log_hub.subscribe()
        try:
            await _login(client)
            portal = await create_portal()
            response = await client.post(f"/portals/{portal.id}", params={"action": Action.MARK.value})
            assert response.status_code == 200, response.text
            assert response.json()["is_marked"] is True
            await asyncio.wait_for(portal_queue.get(), timeout=5.0)
            await asyncio.wait_for(log_queue.get(), timeout=5.0)
        finally:
            portal_update_hub.unsubscribe(portal_queue)
            action_log_hub.unsubscribe(log_queue)
    finally:
        await action_log_hub.stop()
        await portal_update_hub.stop()


async def test_rejected_action_sends_no_notification(
    postgres_url: str, client: AsyncClient, create_portal: Callable[..., Awaitable[Portal]]
) -> None:
    url = postgres_url.replace("postgresql+asyncpg", "postgresql")
    for hub in (portal_update_hub, action_log_hub):
        await hub.start(url)
    try:
        portal_queue = await portal_update_hub.subscribe()
        log_queue = await action_log_hub.subscribe()
        try:
            await _login(client)
            portal = await create_portal(creatures_count=1)
            response = await client.post(f"/portals/{portal.id}", params={"action": Action.CLOSE.value})
            assert response.status_code == 409, response.text
            async with get_session_factory()() as session:
                stored = await session.get(Portal, portal.id)
                assert stored is not None
                assert stored.is_closed is False
                log_count = int((await session.scalar(select(func.count()).select_from(ActionLogEntry))) or 0)
                assert log_count == 0
            with pytest.raises(asyncio.TimeoutError):
                await asyncio.wait_for(portal_queue.get(), timeout=0.5)
            with pytest.raises(asyncio.TimeoutError):
                await asyncio.wait_for(log_queue.get(), timeout=0.5)
        finally:
            portal_update_hub.unsubscribe(portal_queue)
            action_log_hub.unsubscribe(log_queue)
    finally:
        await action_log_hub.stop()
        await portal_update_hub.stop()
