import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session_factory
from app.models import Portal
from populate import _build_demo_portals, seed_portals


async def _count(session: AsyncSession) -> int:
    return int(await session.scalar(select(func.count()).select_from(Portal)))


@pytest.mark.asyncio
async def test_seed_creates_demo_portals() -> None:
    created = await seed_portals(get_session_factory())
    assert created == len(_build_demo_portals())

    demo_names = {portal.name for portal in _build_demo_portals()}
    async with get_session_factory()() as session:
        portals = list((await session.scalars(select(Portal))).all())
        assert len(portals) == created
        assert {portal.name for portal in portals} == demo_names

        by_name = {portal.name: portal for portal in portals}
        assert by_name["Портал Альфа"].has_observer is True
        assert by_name["Портал Альфа"].is_closed is False
        assert by_name["Портал Бета"].is_marked is True
        assert by_name["Портал Эпсилон"].is_closed is True
        assert by_name["Портал Эпсилон"].closed is True
        assert by_name["Портал Зета"].dismissed_until is not None
        assert by_name["Портал Эта"].dismissed_until is None


@pytest.mark.asyncio
async def test_seed_is_idempotent() -> None:
    first = await seed_portals(get_session_factory())
    second = await seed_portals(get_session_factory())
    assert first == len(_build_demo_portals())
    assert second == 0

    async with get_session_factory()() as session:
        assert await _count(session) == len(_build_demo_portals())
