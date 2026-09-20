import asyncio
import logging
from collections.abc import Awaitable, Callable, Sequence
from datetime import timedelta
from typing import Any

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

import app.simulator as simulator
from app.constants import (
    DESTINATION_WORLD_MAX_LENGTH,
    PORTAL_NAME_MAX_LENGTH,
    SIMULATOR_CREATURES_DELTA,
    SIMULATOR_MAX_CREATURES,
    SIMULATOR_PORTAL_TTL_MAX_SECONDS,
    SIMULATOR_PORTAL_TTL_MIN_SECONDS,
    SIMULATOR_STABILITY_DELTA,
)
from app.db import get_session_factory
from app.models import Portal, utc_now


class _FakeRandom:
    """Forces spawn + updates (random() = 0.0), max deltas, first name choices."""

    def random(self) -> float:
        return 0.0

    def randint(self, _a: int, b: int) -> int:
        return b

    def choice(self, seq: Sequence[str]) -> str:
        return seq[0]


class _SequencedRandom:
    """Yields the given ``random()`` values in order (cycling); other calls are deterministic."""

    def __init__(self, values: list[float]) -> None:
        self._values = values
        self._index = 0

    def random(self) -> float:
        value = self._values[self._index % len(self._values)]
        self._index += 1
        return value

    def randint(self, _a: int, b: int) -> int:
        return b

    def choice(self, seq: Sequence[str]) -> str:
        return seq[0]


class _PhaseGatedSession:
    """Pause the simulator after its first ``scalars`` call for race tests."""

    def __init__(self, session: AsyncSession, phase_one_done: asyncio.Event, continue_to_lock: asyncio.Event) -> None:
        self._session = session
        self._phase_one_done = phase_one_done
        self._continue_to_lock = continue_to_lock
        self._first_scalars_call = True

    async def scalars(self, *args: Any, **kwargs: Any) -> Any:
        result = await self._session.scalars(*args, **kwargs)
        if self._first_scalars_call:
            self._first_scalars_call = False
            self._phase_one_done.set()
            await self._continue_to_lock.wait()
        return result

    def __getattr__(self, name: str) -> Any:
        return getattr(self._session, name)


def _portal(**overrides: Any) -> Portal:
    defaults: dict[str, Any] = {
        "name": "Test portal",
        "destination_world": "Narnia",
        "energy_level": 50,
        "stability": 50,
        "expires_at": utc_now() + timedelta(hours=1),
        "creatures_count": 0,
        "is_marked": False,
        "has_observer": False,
        "is_closed": False,
    }
    defaults.update(overrides)
    return Portal(**defaults)


def test_world_name_shape() -> None:
    for _ in range(100):
        name = simulator.world_name()
        assert name
        assert len(name) <= DESTINATION_WORLD_MAX_LENGTH
        assert " " not in name
        assert name[0].isupper()
        assert all(ch.isalpha() for ch in name)


def test_portal_name_shape() -> None:
    for _ in range(100):
        name = simulator.portal_name()
        assert name
        assert len(name) <= PORTAL_NAME_MAX_LENGTH
        assert " " in name
        assert all(ch.isalpha() or ch == " " for ch in name)


def test_make_new_portal_values() -> None:
    now = utc_now()
    portal = simulator.make_new_portal(now)
    assert 0 <= portal.energy_level <= 100
    assert 0 <= portal.stability <= 100
    assert 0 <= portal.creatures_count <= SIMULATOR_MAX_CREATURES
    ttl = (portal.expires_at - now).total_seconds()
    assert SIMULATOR_PORTAL_TTL_MIN_SECONDS <= ttl <= SIMULATOR_PORTAL_TTL_MAX_SECONDS
    assert portal.is_marked is False
    assert portal.has_observer is False
    assert portal.is_closed is False
    assert portal.name
    assert portal.destination_world


def test_randomize_applies_max_delta(monkeypatch: pytest.MonkeyPatch) -> None:
    portal = _portal(stability=50, creatures_count=50)
    monkeypatch.setattr("random.randint", lambda _a, b: b)
    simulator.randomize_stability(portal)
    simulator.randomize_creatures(portal)
    assert portal.stability == 50 + SIMULATOR_STABILITY_DELTA
    assert portal.creatures_count == 50 + SIMULATOR_CREATURES_DELTA


def test_randomize_clamps_upper_bound(monkeypatch: pytest.MonkeyPatch) -> None:
    portal = _portal(stability=99, creatures_count=SIMULATOR_MAX_CREATURES - 2)
    monkeypatch.setattr("random.randint", lambda _a, b: b)
    simulator.randomize_stability(portal)
    simulator.randomize_creatures(portal)
    assert portal.stability == 100
    assert portal.creatures_count == SIMULATOR_MAX_CREATURES


def test_randomize_clamps_lower_bound(monkeypatch: pytest.MonkeyPatch) -> None:
    portal = _portal(stability=1, creatures_count=1)
    monkeypatch.setattr("random.randint", lambda a, _b: a)
    simulator.randomize_stability(portal)
    simulator.randomize_creatures(portal)
    assert portal.stability == 0
    assert portal.creatures_count == 0


@pytest.mark.asyncio
async def test_simulate_once_updates_and_spawns(
    create_portal: Callable[..., Awaitable[Portal]], monkeypatch: pytest.MonkeyPatch
) -> None:
    for i in range(3):
        await create_portal(name=f"Portal {i}", stability=50, creatures_count=0)
    monkeypatch.setattr(simulator, "random", _FakeRandom())

    async with get_session_factory()() as session:
        changed = await simulator.simulate_once(session, open_chance=1.0)

    assert len(changed) == 4  # 3 updated + 1 spawned

    async with get_session_factory()() as session:
        portals = (await session.scalars(select(Portal).order_by(Portal.id))).all()
    assert len(portals) == 4
    for portal in portals[:3]:
        assert portal.stability == 50 + SIMULATOR_STABILITY_DELTA
        assert portal.creatures_count == SIMULATOR_CREATURES_DELTA
    spawned = portals[3]
    assert spawned.energy_level == 100
    assert spawned.stability == 100
    assert spawned.creatures_count == SIMULATOR_MAX_CREATURES
    assert spawned.is_marked is False
    assert spawned.has_observer is False


@pytest.mark.asyncio
async def test_simulate_once_skips_spawn_when_chance_zero(
    create_portal: Callable[..., Awaitable[Portal]], monkeypatch: pytest.MonkeyPatch
) -> None:
    await create_portal()
    monkeypatch.setattr(simulator, "random", _FakeRandom())

    async with get_session_factory()() as session:
        changed = await simulator.simulate_once(session, open_chance=0.0)

    async with get_session_factory()() as session:
        count = int((await session.scalar(select(func.count()).select_from(Portal))) or 0)
    assert count == 1
    assert len(changed) == 1


@pytest.mark.asyncio
async def test_simulate_once_ignores_closed_portals(
    create_portal: Callable[..., Awaitable[Portal]], monkeypatch: pytest.MonkeyPatch
) -> None:
    await create_portal()
    await create_portal(is_closed=True, stability=50)
    monkeypatch.setattr(simulator, "random", _FakeRandom())

    async with get_session_factory()() as session:
        changed = await simulator.simulate_once(session, open_chance=0.0)

    assert len(changed) == 1
    async with get_session_factory()() as session:
        portals = (await session.scalars(select(Portal).order_by(Portal.id))).all()
    assert portals[0].stability == 50 + SIMULATOR_STABILITY_DELTA
    assert portals[1].stability == 50


@pytest.mark.asyncio
async def test_simulate_once_skips_action_locked_portal(
    create_portal: Callable[..., Awaitable[Portal]], monkeypatch: pytest.MonkeyPatch
) -> None:
    """A portal being acted on is skipped, not waited on or modified.

    The tick reads open portals with SELECT ... FOR UPDATE SKIP LOCKED, so it
    returns promptly instead of blocking behind an in-flight action's row lock,
    and leaves that portal untouched (it can be updated on a later tick).
    Stale-write protection is preserved because the tick only ever modifies rows
    it locked itself: without SKIP LOCKED this test would hang for the whole
    lock wait instead of returning changed == [].
    """
    portal = await create_portal(stability=50, creatures_count=0)
    monkeypatch.setattr(simulator, "random", _FakeRandom())

    async def run_sim() -> list[int]:
        async with get_session_factory()() as sim_session:
            return await simulator.simulate_once(sim_session, open_chance=0.0)

    async with get_session_factory()() as action_session:
        locked = await action_session.get(Portal, portal.id, with_for_update=True)
        assert locked is not None
        # The action holds the row lock; the tick must skip it and finish fast.
        sim_task = asyncio.create_task(run_sim())
        changed = await asyncio.wait_for(sim_task, timeout=2.0)
        assert changed == []
        await action_session.commit()

    async with get_session_factory()() as session:
        fresh = await session.get(Portal, portal.id)
    assert fresh is not None
    assert fresh.stability == 50
    assert fresh.creatures_count == 0


@pytest.mark.asyncio
async def test_simulate_once_refreshes_candidate_changed_between_phases(
    create_portal: Callable[..., Awaitable[Portal]], monkeypatch: pytest.MonkeyPatch
) -> None:
    """A candidate action committed after id selection is not overwritten."""
    portal = await create_portal(stability=30, creatures_count=0)
    monkeypatch.setattr(simulator, "random", _FakeRandom())
    monkeypatch.setattr("app.models.random.randint", lambda _a, b: b)

    phase_one_done = asyncio.Event()
    continue_to_lock = asyncio.Event()

    async def run_sim() -> list[int]:
        async with get_session_factory()() as raw_session:
            session = _PhaseGatedSession(raw_session, phase_one_done, continue_to_lock)
            return await simulator.simulate_once(session, open_chance=0.0)  # type: ignore[arg-type]

    sim_task = asyncio.create_task(run_sim())
    await asyncio.wait_for(phase_one_done.wait(), timeout=2.0)

    async with get_session_factory()() as action_session:
        action_portal = await action_session.get(Portal, portal.id, with_for_update=True)
        assert action_portal is not None
        action_portal.stabilize()
        await action_session.commit()

    continue_to_lock.set()
    assert await sim_task == [portal.id]

    async with get_session_factory()() as session:
        fresh = await session.get(Portal, portal.id)
    assert fresh is not None
    assert fresh.stability == 30 + SIMULATOR_STABILITY_DELTA + 30


@pytest.mark.asyncio
async def test_simulate_once_locks_only_candidate_portals(
    create_portal: Callable[..., Awaitable[Portal]], monkeypatch: pytest.MonkeyPatch
) -> None:
    """An action on a non-candidate portal completes while the tick holds locks.

    The tick picks its mutation candidates with a plain read and locks only their
    ids (FOR UPDATE SKIP LOCKED), so a portal the tick decided not to update is
    never locked: an action on it cannot be blocked behind the tick's transaction,
    even while the tick holds locks on its selected candidates pre-commit.
    """
    portal_a = await create_portal(name="A", stability=50, creatures_count=0)
    portal_b = await create_portal(name="B", stability=50, creatures_count=0)
    # A is drawn as non-candidate (0.9 >= SIMULATOR_UPDATE_CHANCE), B as candidate (0.0).
    monkeypatch.setattr(simulator, "random", _SequencedRandom([0.9, 0.0]))

    locked_event = asyncio.Event()
    release_event = asyncio.Event()

    async def blocking_notify(_session: AsyncSession, _portal_id: int) -> None:
        # The tick has already locked its candidate (B) and is pre-commit here.
        locked_event.set()
        await release_event.wait()

    monkeypatch.setattr(simulator, "notify_portal_changed", blocking_notify)

    async def run_sim() -> list[int]:
        async with get_session_factory()() as sim_session:
            return await simulator.simulate_once(sim_session, open_chance=0.0)

    sim_task = asyncio.create_task(run_sim())
    await asyncio.wait_for(locked_event.wait(), timeout=2.0)

    # The tick now holds B's row lock and is waiting before commit. A concurrent
    # action on A — which the tick decided not to update — must not wait on it.
    async def run_action() -> None:
        async with get_session_factory()() as action_session:
            action_portal = await action_session.get(Portal, portal_a.id, with_for_update=True)
            assert action_portal is not None
            action_portal.mark()
            await action_session.commit()

    await asyncio.wait_for(run_action(), timeout=2.0)
    release_event.set()
    changed = await sim_task
    assert changed == [portal_b.id]

    async with get_session_factory()() as session:
        portal_a_fresh = await session.get(Portal, portal_a.id)
        portal_b_fresh = await session.get(Portal, portal_b.id)
    assert portal_a_fresh is not None and portal_b_fresh is not None
    assert portal_a_fresh.is_marked is True
    assert portal_a_fresh.stability == 50 and portal_a_fresh.creatures_count == 0
    assert portal_b_fresh.stability == 50 + SIMULATOR_STABILITY_DELTA
    assert portal_b_fresh.creatures_count == SIMULATOR_CREATURES_DELTA


@pytest.mark.asyncio
async def test_simulator_loop_runs_ticks(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []

    async def fake_tick(_session: AsyncSession) -> list[int]:
        calls.append(1)
        return []

    monkeypatch.setattr(simulator, "simulate_once", fake_tick)
    task = asyncio.create_task(simulator.simulator_loop())
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert calls


@pytest.mark.asyncio
async def test_simulator_loop_survives_tick_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []

    async def flaky_tick(_session: AsyncSession) -> list[int]:
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("boom")
        return []

    real_sleep = asyncio.sleep

    async def fake_sleep(_seconds: float) -> None:
        await real_sleep(0)

    monkeypatch.setattr(simulator, "simulate_once", flaky_tick)
    monkeypatch.setattr("asyncio.sleep", fake_sleep)
    task = asyncio.create_task(simulator.simulator_loop())
    await real_sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert len(calls) >= 2


@pytest.mark.asyncio
async def test_simulator_loop_logs_changed_portals(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    async def fake_tick(_session: AsyncSession) -> list[int]:
        return [1, 2]

    real_sleep = asyncio.sleep

    async def fake_sleep(_seconds: float) -> None:
        await real_sleep(0)

    monkeypatch.setattr(simulator, "simulate_once", fake_tick)
    monkeypatch.setattr("asyncio.sleep", fake_sleep)
    with caplog.at_level(logging.INFO, logger="app.simulator"):
        task = asyncio.create_task(simulator.simulator_loop())
        await real_sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    assert "Симулятор: обновлены порталы: 1, 2" in caplog.text
