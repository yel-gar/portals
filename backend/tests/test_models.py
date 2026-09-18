from datetime import timedelta
from typing import Any

import pytest

from app.exceptions import BadAction
from app.models import DangerLevel, Portal, utc_now


def _portal(**overrides: Any) -> Portal:
    defaults: dict[str, Any] = {
        "name": "Portal",
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


@pytest.mark.asyncio
async def test_risk_factor_and_danger_level() -> None:
    safe = _portal(energy_level=0, stability=100, creatures_count=0, expires_at=utc_now() + timedelta(hours=24))
    assert safe.danger_level == DangerLevel.LOW
    assert 0.0 <= safe.risk_factor <= 1.0

    medium = _portal(
        energy_level=100,
        stability=100,
        creatures_count=0,
        expires_at=utc_now() + timedelta(seconds=30),
    )
    assert medium.danger_level == DangerLevel.MEDIUM

    high = _portal(
        energy_level=100,
        stability=0,
        creatures_count=2,
        expires_at=utc_now() + timedelta(seconds=1),
    )
    assert high.danger_level == DangerLevel.HIGH

    critical = _portal(
        energy_level=100,
        stability=0,
        creatures_count=1000,
        expires_at=utc_now() + timedelta(seconds=1),
    )
    assert critical.danger_level == DangerLevel.CRITICAL

    expired = _portal(expires_at=utc_now() - timedelta(seconds=1))
    assert expired.closed is True
    assert expired.risk_factor <= 1.0


@pytest.mark.asyncio
async def test_closed_flag_makes_portal_unactionable() -> None:
    closed = _portal(is_closed=True, expires_at=utc_now() + timedelta(hours=1))
    assert closed.closed is True
    with pytest.raises(BadAction):
        closed.dismiss()
    with pytest.raises(BadAction):
        closed.warn_creatures()


@pytest.mark.asyncio
async def test_mark_unmark_allowed_on_closed_portal() -> None:
    closed = _portal(is_closed=True)
    closed.mark()
    assert closed.is_marked is True
    closed.unmark()
    assert closed.is_marked is False

    unmarked = _portal()
    with pytest.raises(BadAction):
        unmarked.unmark()


@pytest.mark.asyncio
async def test_action_rules() -> None:
    portal = _portal(creatures_count=1, has_observer=True)
    with pytest.raises(BadAction):
        portal.close()
    portal.creatures_count = 0
    with pytest.raises(BadAction):
        portal.close()
    portal.has_observer = False
    portal.close()
    assert portal.is_closed is True

    stable = _portal(stability=80)
    with pytest.raises(BadAction):
        stable.stabilize()
    unstable = _portal(stability=30)
    unstable.stabilize()
    assert 40 <= unstable.stability <= 60

    critical = _portal(
        energy_level=100,
        stability=0,
        creatures_count=1000,
        expires_at=utc_now() + timedelta(seconds=1),
    )
    assert critical.danger_level == DangerLevel.CRITICAL
    with pytest.raises(BadAction):
        critical.send_observer()
    safe = _portal()
    safe.send_observer()
    assert safe.has_observer is True
    with pytest.raises(BadAction):
        safe.send_observer()

    marked = _portal()
    marked.mark()
    assert marked.is_marked is True
    with pytest.raises(BadAction):
        marked.mark()

    warned = _portal(has_observer=True, creatures_count=1)
    warned.warn_creatures()
    assert warned.creatures_count == 0
    no_observer = _portal(creatures_count=1)
    with pytest.raises(BadAction):
        no_observer.warn_creatures()
    no_creatures = _portal(has_observer=True, creatures_count=0)
    with pytest.raises(BadAction):
        no_creatures.warn_creatures()
