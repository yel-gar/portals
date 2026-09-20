"""Заполнение базы демонстрационными порталами.

Запуск из контейнера бэкенда:

    docker compose exec backend poetry run python populate.py

Скрипт идемпотентен: если в таблице порталов уже есть строки, ничего не
создаётся (см. `seed_portals`).
"""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import settings
from app.constants import DISMISS_DURATION_SECONDS
from app.db import create_all, dispose_db, get_session_factory, init_db
from app.models import Portal, utc_now

logger = logging.getLogger(__name__)


def _portal(
    name: str,
    world: str,
    *,
    energy: int,
    stability: int,
    creatures: int = 0,
    ttl_minutes: int,
    marked: bool = False,
    observer: bool = False,
    dismissed: bool = False,
    closed: bool = False,
) -> Portal:
    """Build a demo portal; ``ttl_minutes`` may be negative for an expired one."""
    now = utc_now()
    return Portal(
        name=name,
        destination_world=world,
        energy_level=energy,
        stability=stability,
        creatures_count=creatures,
        expires_at=now + timedelta(minutes=ttl_minutes),
        is_marked=marked,
        has_observer=observer,
        is_closed=closed,
        dismissed_until=(now + timedelta(seconds=DISMISS_DURATION_SECONDS)) if dismissed else None,
    )


def _build_demo_portals() -> list[Portal]:
    """Build the demo set — fresh instances per call, never reused across runs."""
    return [
        _portal(
            "Портал Альфа",
            "Зеркальная пустошь",
            energy=82,
            stability=64,
            creatures=3,
            ttl_minutes=25,
            observer=True,
        ),
        _portal(
            "Портал Бета",
            "Долина туманов",
            energy=97,
            stability=12,
            creatures=9,
            ttl_minutes=8,
            marked=True,
        ),
        _portal("Портал Гамма", "Кровавые топи", energy=91, stability=5, creatures=5, ttl_minutes=3),
        _portal("Портал Дельта", "Выжженная степь", energy=15, stability=88, ttl_minutes=90),
        _portal(
            "Портал Эпсилон",
            "Забытый склеп",
            energy=0,
            stability=100,
            ttl_minutes=-5,
            closed=True,
        ),
        _portal(
            "Портал Зета",
            "Шёпот межмирья",
            energy=55,
            stability=60,
            creatures=2,
            ttl_minutes=40,
            dismissed=True,
        ),
        _portal(
            "Портал Эта",
            "Туманное побережье",
            energy=40,
            stability=70,
            creatures=1,
            ttl_minutes=60,
            marked=True,
            observer=True,
        ),
    ]


async def seed_portals(session_factory: async_sessionmaker[AsyncSession]) -> int:
    """Insert the demo set unless portals already exist; returns rows created."""
    rows: int = 0
    async with session_factory() as session:
        count = await session.scalar(select(func.count()).select_from(Portal))
        if count:
            logger.info("База уже содержит порталы — заполнение пропущено")
            return rows
        portals = _build_demo_portals()
        session.add_all(portals)
        await session.commit()
        rows = len(portals)
        logger.info("Создано порталов: %s", rows)
        return rows


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    init_db(settings.database_url)
    await create_all()
    try:
        await seed_portals(get_session_factory())
    finally:
        await dispose_db()


if __name__ == "__main__":
    asyncio.run(main())
