import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select

import app.simulator as simulator
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
        "dismissed_until",
        "risk_factor",
        "danger_level",
        "recommended_action",
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
    # The default order is driven by the discrete danger level, not the risk value.
    assert [item["danger_level"] for item in items] == ["HIGH", "LOW"]


@pytest.mark.asyncio
async def test_list_portals_default_sorts_by_danger_level_not_risk_value(
    client: AsyncClient, create_portal: Callable[..., Awaitable[Portal]]
) -> None:
    """Within a danger level the earlier expiry wins over a higher raw risk."""
    await _login(client)
    # Both are HIGH; HighFar has the higher raw risk (~0.70) but expires much
    # later than HighSoon (~0.62), so danger-level ordering puts HighSoon first.
    await create_portal(
        name="HighFar",
        energy_level=100,
        stability=0,
        creatures_count=100_000,
        expires_at=utc_now() + timedelta(hours=3),
    )
    await create_portal(
        name="HighSoon",
        energy_level=100,
        stability=0,
        creatures_count=8,
        expires_at=utc_now() + timedelta(minutes=1),
    )

    response = await client.get("/portals")
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert [item["name"] for item in items] == ["HighSoon", "HighFar"]
    assert [item["danger_level"] for item in items] == ["HIGH", "HIGH"]


@pytest.mark.asyncio
async def test_list_portals_order_by_risk_value(
    client: AsyncClient, create_portal: Callable[..., Awaitable[Portal]]
) -> None:
    """`risk_value` sorts by raw risk, ignoring the danger-level bucket."""
    await _login(client)
    # Same danger level (MEDIUM): the later-expiring portal carries the higher
    # raw risk (~0.52 vs ~0.35), so the default (expiry ASC within a level)
    # puts SoonerLower first while `risk_value` reverses the pair.
    await create_portal(
        name="SoonerLower",
        energy_level=40,
        stability=60,
        creatures_count=2,
        expires_at=utc_now() + timedelta(minutes=2),
    )
    await create_portal(
        name="LaterHigher",
        energy_level=90,
        stability=30,
        creatures_count=20,
        expires_at=utc_now() + timedelta(hours=10),
    )

    default = await client.get("/portals")
    assert default.status_code == 200, default.text
    default_items = default.json()["items"]
    assert [item["name"] for item in default_items] == ["SoonerLower", "LaterHigher"]
    assert [item["danger_level"] for item in default_items] == ["MEDIUM", "MEDIUM"]

    by_risk = await client.get("/portals", params={"order_by": "risk_value"})
    assert by_risk.status_code == 200, by_risk.text
    items = by_risk.json()["items"]
    assert [item["name"] for item in items] == ["LaterHigher", "SoonerLower"]
    assert items[0]["risk_factor"] > items[1]["risk_factor"]


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
    # equal risk (both expired, TTL clamped to zero): open-first sinks expired
    # portals below open ones, then earlier expiry wins within the group
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
    assert names == ["WithObserver", "WithoutObserver", "Older", "Newer"]


@pytest.mark.asyncio
async def test_list_portals_open_before_closed(
    client: AsyncClient, create_portal: Callable[..., Awaitable[Portal]]
) -> None:
    await _login(client)
    # A closed portal computes a high risk (its TTL clamps to zero inside the
    # formula) but must still sink below any open portal — risk is only
    # meaningful while a portal is open, mirroring /stats.
    await create_portal(name="ClosedRisky", energy_level=100, stability=0, creatures_count=10, is_closed=True)
    await create_portal(name="OpenSafe", energy_level=0, stability=100, creatures_count=0)

    for order_by in ("risk", "risk_value", "expires_at"):
        response = await client.get("/portals", params={"order_by": order_by})
        assert response.status_code == 200, response.text
        names = [item["name"] for item in response.json()["items"]]
        assert names == ["OpenSafe", "ClosedRisky"]


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
    # Critical is expired at creation: the TTL clamps to zero, so its risk stays
    # above 0.9 for the whole test and the closed/CRITICAL buckets are stable.
    await create_portal(
        name="Critical",
        energy_level=100,
        stability=0,
        creatures_count=100,
        has_observer=True,
        destination_world="Xanadu",
        expires_at=utc_now() - timedelta(minutes=1),
    )
    await create_portal(name="Expired", destination_world="Narnia", expires_at=utc_now() - timedelta(minutes=1))
    await create_portal(name="Closed", destination_world="Zion", is_closed=True, energy_level=80, stability=20)

    closed_only = await client.get("/portals", params={"closed": "true"})
    assert {item["name"] for item in closed_only.json()["items"]} == {"Expired", "Closed", "Critical"}
    open_only = await client.get("/portals", params={"closed": "false"})
    assert {item["name"] for item in open_only.json()["items"]} == {"Low"}

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

    combined = await client.get("/portals", params={"closed": "true", "danger_level": "CRITICAL", "search": "xan"})
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
async def test_close_recalls_observer(client: AsyncClient, create_portal: Callable[..., Awaitable[Portal]]) -> None:
    await _login(client)
    portal = await create_portal(has_observer=True)

    response = await client.post(f"/portals/{portal.id}", params={"action": Action.CLOSE.value})
    assert response.status_code == 200, response.text
    assert response.json()["closed"] is True
    assert response.json()["has_observer"] is False


@pytest.mark.asyncio
async def test_dismiss_parks_portal(client: AsyncClient, create_portal: Callable[..., Awaitable[Portal]]) -> None:
    await _login(client)
    portal = await create_portal(expires_at=utc_now() + timedelta(hours=1))

    response = await client.post(f"/portals/{portal.id}", params={"action": Action.DISMISS.value})
    assert response.status_code == 200, response.text
    dismissed_until = response.json()["dismissed_until"]
    assert dismissed_until is not None
    assert utc_now() + timedelta(minutes=4) < datetime.fromisoformat(dismissed_until.replace("Z", "+00:00"))


@pytest.mark.asyncio
async def test_dismiss_urgent_portal_rejected(
    client: AsyncClient, create_portal: Callable[..., Awaitable[Portal]]
) -> None:
    await _login(client)
    portal = await create_portal(expires_at=utc_now() + timedelta(minutes=1))

    response = await client.post(f"/portals/{portal.id}", params={"action": Action.DISMISS.value})
    assert response.status_code == 409
    assert "5 минут" in response.json()["detail"]


@pytest.mark.asyncio
async def test_dismissed_portals_sink_in_every_order(
    client: AsyncClient, create_portal: Callable[..., Awaitable[Portal]]
) -> None:
    await _login(client)
    # B is far more dangerous by raw risk, but its parking window is active, so
    # it must still sink below the calm, non-dismissed portal A.
    await create_portal(
        name="B_Dismissed", energy_level=100, stability=0, creatures_count=50, expires_at=utc_now() + timedelta(hours=1)
    )
    await create_portal(
        name="A_Calm", energy_level=0, stability=100, creatures_count=0, expires_at=utc_now() + timedelta(hours=5)
    )
    async with get_session_factory()() as session:
        portal_b = await session.scalar(select(Portal).where(Portal.name == "B_Dismissed"))
        assert portal_b is not None
        portal_b.dismiss()
        await session.commit()

    for order_by in ("risk", "risk_value", "expires_at", "name", "creatures"):
        response = await client.get("/portals", params={"order_by": order_by})
        assert response.status_code == 200, response.text
        names = [item["name"] for item in response.json()["items"]]
        assert names == ["A_Calm", "B_Dismissed"], order_by

    # Once the parking window passes the portal returns to its natural position
    # (high danger puts it first in the default risk order).
    async with get_session_factory()() as session:
        portal_b = await session.scalar(select(Portal).where(Portal.name == "B_Dismissed"))
        assert portal_b is not None
        portal_b.dismissed_until = utc_now() - timedelta(seconds=1)
        await session.commit()

    response = await client.get("/portals", params={"order_by": "risk"})
    names = [item["name"] for item in response.json()["items"]]
    assert names == ["B_Dismissed", "A_Calm"]


@pytest.mark.asyncio
async def test_action_bumps_last_update_but_simulation_does_not(
    client: AsyncClient, create_portal: Callable[..., Awaitable[Portal]]
) -> None:
    await _login(client)
    portal = await create_portal(stability=30)

    response = await client.post(f"/portals/{portal.id}", params={"action": Action.STABILIZE.value})
    assert response.status_code == 200, response.text
    updated = datetime.fromisoformat(response.json()["last_update"].replace("Z", "+00:00"))
    assert updated > portal.last_update.astimezone(UTC)

    async with get_session_factory()() as session:
        fresh = await session.get(Portal, portal.id)
        assert fresh is not None
        before = fresh.last_update
        await simulator.simulate_once(session)
        await session.commit()
        await session.refresh(fresh)
        assert fresh.last_update == before


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
async def test_portal_payload_includes_recommended_action(
    client: AsyncClient, create_portal: Callable[..., Awaitable[Portal]]
) -> None:
    await _login(client)
    # No observer, stable, creatures present, long TTL -> no points -> DISMISS.
    portal = await create_portal(stability=80, creatures_count=3, has_observer=False)

    response = await client.get(f"/portals/{portal.id}")
    assert response.status_code == 200, response.text
    assert response.json()["recommended_action"] == Action.DISMISS.value

    listed = await client.get("/portals")
    assert listed.status_code == 200, listed.text
    assert listed.json()["items"][0]["recommended_action"] == Action.DISMISS.value


@pytest.mark.asyncio
async def test_recommended_action_updates_after_action(
    client: AsyncClient, create_portal: Callable[..., Awaitable[Portal]]
) -> None:
    await _login(client)
    # 45 + [10..30] always lands at >= 55, so one STABILIZE deterministically
    # clears the only scored condition (no observer, creatures present, long TTL).
    portal = await create_portal(stability=45, creatures_count=3, has_observer=False)

    before = await client.get(f"/portals/{portal.id}")
    assert before.json()["recommended_action"] == Action.STABILIZE.value

    stabilized = await client.post(f"/portals/{portal.id}", params={"action": Action.STABILIZE.value})
    assert stabilized.status_code == 200, stabilized.text
    assert stabilized.json()["recommended_action"] == Action.DISMISS.value


@pytest.mark.asyncio
async def test_force_close_critical_portal_with_creatures(
    client: AsyncClient, create_portal: Callable[..., Awaitable[Portal]]
) -> None:
    await _login(client)
    critical = await create_portal(
        energy_level=100,
        stability=0,
        creatures_count=1000,
        expires_at=utc_now() + timedelta(seconds=1),
    )
    normal = await client.post(f"/portals/{critical.id}", params={"action": Action.CLOSE.value})
    assert normal.status_code == 409

    forced = await client.post(f"/portals/{critical.id}", params={"action": Action.CLOSE.value, "force": "true"})
    assert forced.status_code == 200, forced.text
    assert forced.json()["closed"] is True

    log = await client.get("/portals/log", params={"portal_id": critical.id})
    assert log.json()["total"] == 1
    assert log.json()["items"][0]["action"] == Action.CLOSE.value


@pytest.mark.asyncio
async def test_force_close_rejected_for_non_critical(
    client: AsyncClient, create_portal: Callable[..., Awaitable[Portal]]
) -> None:
    await _login(client)
    portal = await create_portal(creatures_count=2, energy_level=10, stability=90)
    assert portal.danger_level != "CRITICAL"

    forced = await client.post(f"/portals/{portal.id}", params={"action": Action.CLOSE.value, "force": "true"})
    assert forced.status_code == 409
    assert "критическ" in forced.json()["detail"]


@pytest.mark.asyncio
async def test_dismissed_urgent_portal_ignores_parking(
    client: AsyncClient, create_portal: Callable[..., Awaitable[Portal]]
) -> None:
    await _login(client)
    await create_portal(
        name="A_Calm", energy_level=0, stability=100, creatures_count=0, expires_at=utc_now() + timedelta(hours=5)
    )
    urgent = await create_portal(
        name="B_Urgent",
        energy_level=100,
        stability=0,
        creatures_count=50,
        expires_at=utc_now() + timedelta(minutes=4),
    )
    async with get_session_factory()() as session:
        stored = await session.get(Portal, urgent.id)
        assert stored is not None
        stored.dismissed_until = utc_now() + timedelta(minutes=5)
        await session.commit()

    response = await client.get("/portals", params={"order_by": "risk"})
    assert response.status_code == 200, response.text
    names = [item["name"] for item in response.json()["items"]]
    assert names == ["B_Urgent", "A_Calm"]


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
