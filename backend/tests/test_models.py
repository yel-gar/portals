from datetime import timedelta
from typing import Any

import pytest

from app.exceptions import BadAction
from app.models import Action, DangerLevel, Portal, utc_now


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
async def test_dismiss_parks_portal_and_rejects_urgent() -> None:
    calm = _portal(expires_at=utc_now() + timedelta(hours=1))
    calm.dismiss()
    assert calm.dismissed_until is not None
    assert calm.dismissed_until > utc_now() + timedelta(minutes=4)

    urgent = _portal(expires_at=utc_now() + timedelta(minutes=1))
    with pytest.raises(BadAction):
        urgent.dismiss()
    assert urgent.dismissed_until is None

    # Re-dismissing simply extends the parking window.
    again = _portal(expires_at=utc_now() + timedelta(hours=2))
    again.dismiss()
    first = again.dismissed_until
    assert first is not None
    again.dismiss()
    assert again.dismissed_until is not None
    assert again.dismissed_until >= first


@pytest.mark.asyncio
async def test_recommended_action_no_observer_branches() -> None:
    calm_open = _portal(stability=80, creatures_count=3, has_observer=False, expires_at=utc_now() + timedelta(hours=2))
    assert calm_open.recommended_action == Action.DISMISS

    unstable = _portal(stability=30, creatures_count=3, has_observer=False, expires_at=utc_now() + timedelta(hours=2))
    assert unstable.recommended_action == Action.STABILIZE

    empty = _portal(stability=80, creatures_count=0, has_observer=False, expires_at=utc_now() + timedelta(hours=2))
    assert empty.recommended_action == Action.CLOSE

    urgent = _portal(stability=80, creatures_count=3, has_observer=False, expires_at=utc_now() + timedelta(minutes=4))
    assert urgent.recommended_action == Action.SEND_OBSERVER

    # CLOSE (10) dominates STABILIZE (1) + SEND_OBSERVER (1).
    urgent_empty_unstable = _portal(
        stability=30, creatures_count=0, has_observer=False, expires_at=utc_now() + timedelta(minutes=4)
    )
    assert urgent_empty_unstable.recommended_action == Action.CLOSE

    # Tie STABILIZE (1) vs SEND_OBSERVER (1) resolves to SEND_OBSERVER by priority.
    tie = _portal(stability=30, creatures_count=3, has_observer=False, expires_at=utc_now() + timedelta(minutes=4))
    assert tie.recommended_action == Action.SEND_OBSERVER


@pytest.mark.asyncio
async def test_recommended_action_observer_branches() -> None:
    calm_watched = _portal(
        stability=80, creatures_count=3, has_observer=True, expires_at=utc_now() + timedelta(hours=2)
    )
    assert calm_watched.recommended_action == Action.DISMISS

    unstable_watched = _portal(
        stability=30, creatures_count=3, has_observer=True, expires_at=utc_now() + timedelta(hours=2)
    )
    assert unstable_watched.recommended_action == Action.STABILIZE

    warn = _portal(stability=80, creatures_count=3, has_observer=True, expires_at=utc_now() + timedelta(minutes=4))
    assert warn.recommended_action == Action.WARN_CREATURES

    # TTL < 30 s scores both RECALL (1) and WARN (1): WARN wins by priority.
    recall_vs_warn = _portal(
        stability=80, creatures_count=3, has_observer=True, expires_at=utc_now() + timedelta(seconds=20)
    )
    assert recall_vs_warn.recommended_action == Action.WARN_CREATURES

    empty_watched = _portal(
        stability=80, creatures_count=0, has_observer=True, expires_at=utc_now() + timedelta(hours=2)
    )
    assert empty_watched.recommended_action == Action.RECALL_OBSERVER

    closed = _portal(is_closed=True, has_observer=False)
    assert closed.recommended_action == Action.DISMISS
    expired = _portal(expires_at=utc_now() - timedelta(seconds=1))
    assert expired.recommended_action == Action.DISMISS


@pytest.mark.asyncio
async def test_recommended_action_critical_table(monkeypatch: pytest.MonkeyPatch) -> None:
    """CRITICAL portals use a fixed observer/creature table that dominates scoring."""
    # Production CRITICALs always carry creatures (the risk formula cannot pass
    # 0.85 without the creature term), so force the level to hit the empty row.
    with monkeypatch.context() as patch:
        patch.setattr(Portal, "danger_level", property(lambda _self: DangerLevel.CRITICAL))
        empty = _portal(stability=80, creatures_count=0, has_observer=True, expires_at=utc_now() + timedelta(hours=2))
        assert empty.recommended_action == Action.RECALL_OBSERVER

    watched = _portal(
        energy_level=100,
        stability=0,
        creatures_count=1000,
        has_observer=True,
        expires_at=utc_now() + timedelta(seconds=20),
    )
    assert watched.danger_level == DangerLevel.CRITICAL
    assert watched.recommended_action == Action.WARN_CREATURES

    # No observer: the general scoring would pick SEND_OBSERVER here, but the
    # table forces CLOSE, which the API accepts with force=true for CRITICALs.
    unwatched = _portal(
        energy_level=100,
        stability=0,
        creatures_count=1000,
        has_observer=False,
        expires_at=utc_now() + timedelta(seconds=20),
    )
    assert unwatched.danger_level == DangerLevel.CRITICAL
    assert unwatched.recommended_action == Action.CLOSE


@pytest.mark.asyncio
async def test_force_close_only_critical() -> None:
    critical = _portal(
        energy_level=100,
        stability=0,
        creatures_count=1000,
        expires_at=utc_now() + timedelta(seconds=1),
    )
    assert critical.danger_level == DangerLevel.CRITICAL
    critical.close(force=True)
    assert critical.is_closed is True

    non_critical = _portal(creatures_count=2, expires_at=utc_now() + timedelta(hours=1))
    assert non_critical.danger_level != DangerLevel.CRITICAL
    with pytest.raises(BadAction):
        non_critical.close(force=True)
    assert non_critical.is_closed is False
    with pytest.raises(BadAction):
        non_critical.close()
    with pytest.raises(BadAction):
        _portal(is_closed=True).close(force=True)


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
    # Closing a portal with an observer inside auto-recalls the observer.
    portal.close()
    assert portal.is_closed is True
    assert portal.has_observer is False

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
