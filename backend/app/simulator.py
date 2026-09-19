from __future__ import annotations

import asyncio
import logging
import random
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .constants import (
    SIMULATOR_CREATURES_DELTA,
    SIMULATOR_MAX_CREATURES,
    SIMULATOR_PORTAL_TTL_MAX_SECONDS,
    SIMULATOR_PORTAL_TTL_MIN_SECONDS,
    SIMULATOR_STABILITY_DELTA,
    SIMULATOR_TICK_SECONDS,
    SIMULATOR_UPDATE_CHANCE,
)
from .db import get_session_factory
from .models import Portal, utc_now
from .notifications import notify_portal_changed

logger = logging.getLogger(__name__)

_WORLD_SYLLABLES: tuple[str, ...] = (
    "аль",
    "бел",
    "валь",
    "гор",
    "даль",
    "ерид",
    "жар",
    "зар",
    "иль",
    "йор",
    "кар",
    "лор",
    "мар",
    "нар",
    "ор",
    "пел",
    "рим",
    "сар",
    "тар",
    "ур",
    "фер",
    "хар",
    "чер",
    "эр",
)

_WORLD_ENDINGS: tuple[str, ...] = ("ия", "ар", "он", "ор", "ум", "ан", "иль", "ад")

# All adjectives are masculine so they agree with every noun below.
_PORTAL_ADJECTIVES: tuple[str, ...] = (
    "Алый",
    "Туманный",
    "Забытый",
    "Древний",
    "Пылающий",
    "Ледяной",
    "Звёздный",
    "Тёмный",
    "Сияющий",
    "Бездонный",
    "Шепчущий",
    "Молчаливый",
    "Вечный",
    "Проклятый",
)

_PORTAL_NOUNS: tuple[str, ...] = (
    "Перевал",
    "Портал",
    "Тоннель",
    "Проход",
    "Разлом",
    "Вихрь",
    "Коридор",
    "Мост",
    "Ход",
    "Провал",
)

_ROMAN_NUMERALS: tuple[str, ...] = ("II", "III", "IV", "V")

_NUMERAL_SUFFIX_CHANCE = 0.25
_THIRD_SYLLABLE_CHANCE = 0.4


def world_name() -> str:
    """Random fantasy world name (syllable composition)."""
    syllables = [random.choice(_WORLD_SYLLABLES), random.choice(_WORLD_SYLLABLES)]
    if random.random() < _THIRD_SYLLABLE_CHANCE:
        syllables.append(random.choice(_WORLD_SYLLABLES))
    return "".join(syllables).capitalize() + random.choice(_WORLD_ENDINGS)


def portal_name() -> str:
    """Random portal name, e.g. «Шепчущий Коридор IV»."""
    name = f"{random.choice(_PORTAL_ADJECTIVES)} {random.choice(_PORTAL_NOUNS)}"
    if random.random() < _NUMERAL_SUFFIX_CHANCE:
        name += f" {random.choice(_ROMAN_NUMERALS)}"
    return name


def make_new_portal(now: datetime) -> Portal:
    """A brand-new portal with fully random values (not yet persisted)."""
    ttl_seconds = random.randint(SIMULATOR_PORTAL_TTL_MIN_SECONDS, SIMULATOR_PORTAL_TTL_MAX_SECONDS)
    return Portal(
        name=portal_name(),
        destination_world=world_name(),
        energy_level=random.randint(0, 100),
        stability=random.randint(0, 100),
        expires_at=now + timedelta(seconds=ttl_seconds),
        creatures_count=random.randint(0, SIMULATOR_MAX_CREATURES),
        is_marked=False,
        has_observer=False,
        is_closed=False,
    )


def randomize_stability(portal: Portal) -> None:
    """Randomly nudge stability by ±``SIMULATOR_STABILITY_DELTA``, clamped to 0..100."""
    delta = random.randint(-SIMULATOR_STABILITY_DELTA, SIMULATOR_STABILITY_DELTA)
    portal.stability = min(max(portal.stability + delta, 0), 100)


def randomize_creatures(portal: Portal) -> None:
    """Randomly nudge creatures_count by ±``SIMULATOR_CREATURES_DELTA``, clamped to 0..max."""
    delta = random.randint(-SIMULATOR_CREATURES_DELTA, SIMULATOR_CREATURES_DELTA)
    portal.creatures_count = min(max(portal.creatures_count + delta, 0), SIMULATOR_MAX_CREATURES)


async def simulate_once(session: AsyncSession, *, open_chance: float | None = None) -> list[int]:
    """One simulation tick: randomly update some open portals, maybe open a new one.

    ``open_chance`` overrides ``settings.portal_open_chance`` for testability.
    ``pg_notify`` for each changed portal is enqueued inside the same transaction,
    so WS subscribers are only woken on a durable commit. Returns the ids of all
    changed (updated or spawned) portals in ascending order.
    """
    chance = settings.portal_open_chance if open_chance is None else open_chance
    changed_ids: set[int] = set()
    now = utc_now()

    # Lock the rows with SELECT ... FOR UPDATE SKIP LOCKED. The lock prevents a
    # concurrent portal action from being overwritten by this snapshot (the tick
    # only modifies rows it locked itself), while SKIP LOCKED means a portal that
    # is being acted on right now is simply skipped — the tick returns promptly
    # instead of blocking the action, and can update that portal on a later tick.
    stmt = select(Portal).where(Portal.is_closed.is_(False), Portal.expires_at > now).with_for_update(skip_locked=True)
    open_portals = (await session.scalars(stmt)).all()
    for portal in open_portals:
        if random.random() < SIMULATOR_UPDATE_CHANCE:
            randomize_stability(portal)
            randomize_creatures(portal)
            changed_ids.add(portal.id)

    if random.random() < chance:
        portal = make_new_portal(now)
        session.add(portal)
        await session.flush()
        changed_ids.add(portal.id)
        logger.info("Симулятор: открыт новый портал id=%d", portal.id)

    for portal_id in sorted(changed_ids):
        await notify_portal_changed(session, portal_id)
    await session.commit()
    return sorted(changed_ids)


async def simulator_loop() -> None:
    """Background simulation loop: one tick every ``SIMULATOR_TICK_SECONDS`` seconds.

    Any per-tick failure is logged and the loop continues, so a transient DB error
    never kills the simulator. The loop runs until cancelled (app shutdown).
    """
    while True:
        try:
            async with get_session_factory()() as session:
                changed_ids = await simulate_once(session)
            if changed_ids:
                logger.info("Симулятор: обновлено порталов: %s", ", ".join(map(str, changed_ids)))
        except Exception:
            logger.exception("Симулятор: ошибка тика")
        await asyncio.sleep(SIMULATOR_TICK_SECONDS)
