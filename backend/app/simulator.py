from __future__ import annotations

import asyncio
import logging
import random
from datetime import datetime, timedelta

from sqlalchemy import and_, select
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


def randomize_creatures(portal: Portal, *, allow_increase: bool = True) -> None:
    """Randomly nudge creatures_count by ±``SIMULATOR_CREATURES_DELTA``, clamped to 0..max.

    With an observer inside no new creatures may appear, so the delta is never
    positive (the count can only stay or drop).
    """
    upper = SIMULATOR_CREATURES_DELTA if allow_increase else 0
    delta = random.randint(-SIMULATOR_CREATURES_DELTA, upper)
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
    is_open = and_(Portal.is_closed.is_(False), Portal.expires_at > now)

    # Phase 1 — pick ids with a plain read (no locks, and no ORM instances cached
    # in this session). Each open portal becomes a candidate with
    # SIMULATOR_UPDATE_CHANCE probability.
    open_portal_ids = (await session.scalars(select(Portal.id).where(is_open).order_by(Portal.id))).all()
    candidate_ids = [portal_id for portal_id in open_portal_ids if random.random() < SIMULATOR_UPDATE_CHANCE]

    # Phase 2 — lock only the candidates (FOR UPDATE SKIP LOCKED), so an action on
    # a non-candidate portal never waits behind this tick. The open predicates are
    # reapplied so a portal closed/expired in between is excluded, and a candidate
    # already being acted on is skipped (it can be updated on a later tick). The
    # lock still prevents a concurrent action from being overwritten: the tick only
    # ever modifies rows it locked itself.
    if candidate_ids:
        stmt = (
            select(Portal)
            .where(and_(is_open, Portal.id.in_(candidate_ids)))
            .order_by(Portal.id)
            .with_for_update(skip_locked=True)
            .execution_options(populate_existing=True)
        )
        for portal in (await session.scalars(stmt)).all():
            randomize_stability(portal)
            randomize_creatures(portal, allow_increase=not portal.has_observer)
            changed_ids.add(portal.id)

    # Expiry is derived (`expires_at <= now`), so no write ever marks the
    # moment a portal closes by itself — without an explicit notification the
    # subscribers would only learn about it from the 30 s REST poll. Portals
    # that expired within the trailing window (two tick intervals cover tick
    # jitter) are reported so the live table flips them to closed promptly.
    expiry_cutoff = now - timedelta(seconds=SIMULATOR_TICK_SECONDS * 2)
    expired_ids = (
        await session.scalars(
            select(Portal.id).where(
                Portal.is_closed.is_(False), Portal.expires_at <= now, Portal.expires_at > expiry_cutoff
            )
        )
    ).all()
    changed_ids.update(expired_ids)

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
                logger.info("Симулятор: обновлены порталы: %s", ", ".join(map(str, changed_ids)))
        except Exception:
            logger.exception("Симулятор: ошибка тика")
        await asyncio.sleep(SIMULATOR_TICK_SECONDS)
