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


@pytest.mark.asyncio
async def test_list_portals_requires_auth(client: AsyncClient) -> None:
    response = await client.get("/portals")
    assert response.status_code == 401


@pytest.mark.asyncio
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


@pytest.mark.asyncio
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


@pytest.mark.asyncio
async def test_portal_info(client: AsyncClient, create_portal: Callable[..., Awaitable[Portal]]) -> None:
    await _login(client)
    portal = await create_portal(
        name="Alpha",
        destination_world="Xanadu",
        energy_level=80,
        stability=20,
        creatures_count=5,
        has_observer=True,
    )

    response = await client.get(f"/portals/{portal.id}")
    assert response.status_code == 200, response.text
    item = response.json()
    assert item["id"] == portal.id
    assert item["name"] == "Alpha"
    assert item["destination_world"] == "Xanadu"
    assert item["energy_level"] == 80
    assert item["stability"] == 20
    assert item["creatures_count"] == 5
    assert item["has_observer"] is True
    assert item["closed"] is False
    assert isinstance(item["risk_factor"], float)
    assert item["danger_level"] in {"LOW", "MEDIUM", "HIGH", "CRITICAL"}


@pytest.mark.asyncio
async def test_portal_info_not_found(client: AsyncClient) -> None:
    await _login(client)
    response = await client.get("/portals/9999")
    assert response.status_code == 404
    assert response.json()["detail"] != ""


@pytest.mark.asyncio
async def test_portal_info_invalid_id(client: AsyncClient) -> None:
    await _login(client)
    response = await client.get("/portals/abc")
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_portal_info_requires_auth(client: AsyncClient, create_portal: Callable[..., Awaitable[Portal]]) -> None:
    portal = await create_portal()
    response = await client.get(f"/portals/{portal.id}")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_list_portals_default_ordering(
    client: AsyncClient, create_portal: Callable[..., Awaitable[Portal]]
) -> None:
    await _login(client)
    await create_portal(
        name="Safe", energy_level=10, stability=90, creatures_count=0, expires_at=utc_now() + timedelta(hours=2)
    )
    await create_portal(
        name="Critical",
        energy_level=100,
        stability=0,
        creatures_count=10,
        has_observer=True,
        expires_at=utc_now() + timedelta(minutes=1),
    )

    response = await client.get("/portals")
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert [item["name"] for item in items] == ["Critical", "Safe"]
    risks = [item["risk_factor"] for item in items]
    assert risks == sorted(risks, reverse=True)


@pytest.mark.asyncio
async def test_list_portals_order_by_variants(
    client: AsyncClient, create_portal: Callable[..., Awaitable[Portal]]
) -> None:
    await _login(client)
    await create_portal(name="Zeta", creatures_count=9, expires_at=utc_now() + timedelta(hours=1))
    await create_portal(name="Alpha", creatures_count=1, expires_at=utc_now() + timedelta(hours=3))
    await create_portal(name="Beta", creatures_count=5, expires_at=utc_now() + timedelta(hours=2))

    by_name = await client.get("/portals", params={"order_by": "name"})
    assert by_name.status_code == 200, by_name.text
    assert [item["name"] for item in by_name.json()["items"]] == ["Alpha", "Beta", "Zeta"]

    by_expiry = await client.get("/portals", params={"order_by": "expires_at"})
    assert [item["name"] for item in by_expiry.json()["items"]] == ["Zeta", "Beta", "Alpha"]

    by_creatures = await client.get("/portals", params={"order_by": "creatures"})
    assert [item["name"] for item in by_creatures.json()["items"]] == ["Zeta", "Beta", "Alpha"]


@pytest.mark.asyncio
async def test_list_portals_default_tiebreakers(
    client: AsyncClient, create_portal: Callable[..., Awaitable[Portal]]
) -> None:
    await _login(client)
    # equal risk (both expired, TTL clamped to zero): earlier expiry wins
    await create_portal(name="Older", energy_level=50, stability=50, expires_at=utc_now() - timedelta(hours=3))
    await create_portal(name="Newer", energy_level=50, stability=50, expires_at=utc_now() - timedelta(hours=1))
    # equal risk (same TTL): portal with observer inside wins
    same_expiry = utc_now() + timedelta(hours=1)
    await create_portal(
        name="WithObserver", energy_level=30, stability=70, creatures_count=0, has_observer=True, expires_at=same_expiry
    )
    await create_portal(
        name="WithoutObserver",
        energy_level=30,
        stability=70,
        creatures_count=0,
        has_observer=False,
        expires_at=same_expiry,
    )

    response = await client.get("/portals")
    assert response.status_code == 200, response.text
    names = [item["name"] for item in response.json()["items"]]
    assert names == ["Older", "Newer", "WithObserver", "WithoutObserver"]


@pytest.mark.asyncio
async def test_list_portals_filters(client: AsyncClient, create_portal: Callable[..., Awaitable[Portal]]) -> None:
    await _login(client)
    low = await create_portal(
        name="Low",
        energy_level=0,
        stability=100,
        creatures_count=0,
        destination_world="Narnia",
        expires_at=utc_now() + timedelta(hours=5),
    )
    await create_portal(
        name="Critical",
        energy_level=100,
        stability=0,
        creatures_count=100,
        has_observer=True,
        destination_world="Xanadu",
        expires_at=utc_now() + timedelta(seconds=5),
    )
    await create_portal(name="Expired", destination_world="Narnia", expires_at=utc_now() - timedelta(minutes=1))
    await create_portal(name="Closed", destination_world="Zion", is_closed=True, energy_level=80, stability=20)

    closed_only = await client.get("/portals", params={"closed": "true"})
    assert {item["name"] for item in closed_only.json()["items"]} == {"Expired", "Closed"}
    open_only = await client.get("/portals", params={"closed": "false"})
    assert {item["name"] for item in open_only.json()["items"]} == {"Low", "Critical"}

    critical_only = await client.get("/portals", params={"danger_level": "CRITICAL"})
    assert [item["name"] for item in critical_only.json()["items"]] == ["Critical"]
    low_only = await client.get("/portals", params={"danger_level": "LOW"})
    assert [item["name"] for item in low_only.json()["items"]] == ["Low"]

    with_observer = await client.get("/portals", params={"has_observer": "true"})
    assert [item["name"] for item in with_observer.json()["items"]] == ["Critical"]

    unmarked = await client.get("/portals", params={"is_marked": "true"})
    assert unmarked.json()["total"] == 0
    response = await client.post(f"/portals/{low.id}", params={"action": Action.MARK.value})
    assert response.status_code == 200
    marked = await client.get("/portals", params={"is_marked": "true"})
    assert [item["name"] for item in marked.json()["items"]] == ["Low"]

    by_name = await client.get("/portals", params={"search": "crit"})
    assert [item["name"] for item in by_name.json()["items"]] == ["Critical"]
    by_world = await client.get("/portals", params={"search": "xan"})
    assert [item["name"] for item in by_world.json()["items"]] == ["Critical"]
    by_common_world = await client.get("/portals", params={"search": "narnia"})
    assert {item["name"] for item in by_common_world.json()["items"]} == {"Low", "Expired"}

    combined = await client.get("/portals", params={"closed": "false", "danger_level": "CRITICAL", "search": "xan"})
    assert [item["name"] for item in combined.json()["items"]] == ["Critical"]


@pytest.mark.asyncio
async def test_list_portals_unknown_order_by(client: AsyncClient) -> None:
    await _login(client)
    response = await client.get("/portals", params={"order_by": "bogus"})
    assert response.status_code == 422


@pytest.mark.asyncio
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
    assert 40 <= response.json()["stability"] <= 60

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


@pytest.mark.asyncio
async def test_execute_action_rejected(client: AsyncClient, create_portal: Callable[..., Awaitable[Portal]]) -> None:
    await _login(client)
    portal = await create_portal(creatures_count=1)

    response = await client.post(f"/portals/{portal.id}", params={"action": Action.CLOSE.value})
    assert response.status_code == 409
    assert response.json()["detail"] != ""

    response = await client.post(f"/portals/{portal.id}", params={"action": Action.RECALL_OBSERVER.value})
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_execute_action_unknown_portal(client: AsyncClient) -> None:
    await _login(client)
    response = await client.post("/portals/9999", params={"action": Action.DISMISS.value})
    assert response.status_code == 404


@pytest.mark.asyncio
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


@pytest.mark.asyncio
async def test_action_log_requires_auth(client: AsyncClient) -> None:
    response = await client.get("/portals/log")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_action_log_filters_and_ordering(
    client: AsyncClient, create_portal: Callable[..., Awaitable[Portal]]
) -> None:
    await _login(client)
    me = await client.get("/auth/me")
    assert me.status_code == 200
    me_id = me.json()["id"]
    portal_a = await create_portal(name="A")
    portal_b = await create_portal(name="B")
    await client.post(f"/portals/{portal_a.id}", params={"action": Action.MARK.value})
    await client.post(f"/portals/{portal_a.id}", params={"action": Action.UNMARK.value})
    await client.post(f"/portals/{portal_b.id}", params={"action": Action.MARK.value})

    by_action = await client.get("/portals/log", params={"action": Action.MARK.value})
    assert by_action.status_code == 200, by_action.text
    assert by_action.json()["total"] == 2
    assert [entry["portal_id"] for entry in by_action.json()["items"]] == [portal_b.id, portal_a.id]

    by_portal = await client.get("/portals/log", params={"portal_id": portal_a.id})
    assert by_portal.json()["total"] == 2
    assert [entry["action"] for entry in by_portal.json()["items"]] == [Action.UNMARK.value, Action.MARK.value]

    by_user = await client.get("/portals/log", params={"user_id": me_id})
    assert by_user.json()["total"] == 3
    missing_user = await client.get("/portals/log", params={"user_id": 999999})
    assert missing_user.json()["total"] == 0

    by_action_and_portal = await client.get(
        "/portals/log", params={"action": Action.MARK.value, "portal_id": portal_a.id}
    )
    assert by_action_and_portal.json()["total"] == 1
    assert by_action_and_portal.json()["items"][0]["portal_id"] == portal_a.id

    oldest = await client.get("/portals/log", params={"order_by": "oldest"})
    assert [entry["portal_id"] for entry in oldest.json()["items"]] == [portal_a.id, portal_a.id, portal_b.id]
    newest = await client.get("/portals/log", params={"order_by": "newest"})
    assert [entry["portal_id"] for entry in newest.json()["items"]] == [portal_b.id, portal_a.id, portal_a.id]


@pytest.mark.asyncio
async def test_action_log_unknown_order_by(client: AsyncClient) -> None:
    await _login(client)
    response = await client.get("/portals/log", params={"order_by": "bogus"})
    assert response.status_code == 422


@pytest.mark.asyncio
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


@pytest.mark.asyncio
async def test_stats_requires_auth(client: AsyncClient) -> None:
    response = await client.get("/portals/stats")
    assert response.status_code == 401


@pytest.mark.asyncio
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


@pytest.mark.asyncio
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
