from collections.abc import Awaitable, Callable
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.bootstrap import ensure_initial_superuser
from app.db import get_session_factory
from app.models import Action, ActionLogEntry, LoginSession, Portal, User, utc_now
from app.security import verify_password


@pytest.mark.asyncio
async def test_creates_initial_superuser() -> None:
    await ensure_initial_superuser(get_session_factory(), "admin", "password-123")
    async with get_session_factory()() as session:
        user = await session.scalar(select(User).where(User.username == "admin"))
    assert user is not None
    assert user.is_superuser
    assert verify_password("password-123", user.password_hash)


@pytest.mark.asyncio
async def test_deletes_superuser_with_different_name(
    create_user: Callable[..., Awaitable[User]],
    create_portal: Callable[..., Awaitable[Portal]],
) -> None:
    old_su = await create_user("legacy", "password-123", is_superuser=True)
    portal = await create_portal()
    async with get_session_factory()() as session:
        session.add(LoginSession(user_id=old_su.id, token="a" * 64, expires_at=utc_now() + timedelta(hours=1)))
        session.add(ActionLogEntry(user_id=old_su.id, portal_id=portal.id, action=Action.MARK))
        await session.commit()

    await ensure_initial_superuser(get_session_factory(), "admin", "password-123")

    async with get_session_factory()() as session:
        legacy = await session.get(User, old_su.id)
        sessions = (await session.scalars(select(LoginSession))).all()
        entries = (await session.scalars(select(ActionLogEntry))).all()
        admin = await session.scalar(select(User).where(User.username == "admin"))
    assert legacy is None
    assert sessions == []
    assert len(entries) == 1
    assert entries[0].user_id is None
    assert admin is not None
    assert admin.is_superuser


@pytest.mark.asyncio
async def test_keeps_same_name_superuser_when_password_unchanged(create_user: Callable[..., Awaitable[User]]) -> None:
    user = await create_user("admin", "password-123", is_superuser=True)
    original_hash = user.password_hash
    await ensure_initial_superuser(get_session_factory(), "admin", "password-123")
    async with get_session_factory()() as session:
        admin = await session.scalar(select(User).where(User.username == "admin"))
    assert admin is not None
    assert admin.id == user.id
    assert admin.is_superuser
    assert admin.password_hash == original_hash


@pytest.mark.asyncio
async def test_updates_same_name_superuser_password_when_changed(create_user: Callable[..., Awaitable[User]]) -> None:
    user = await create_user("admin", "old-password-1", is_superuser=True)
    await ensure_initial_superuser(get_session_factory(), "admin", "new-password-2")
    async with get_session_factory()() as session:
        admin = await session.scalar(select(User).where(User.username == "admin"))
    assert admin is not None
    assert admin.id == user.id
    assert admin.is_superuser
    assert verify_password("new-password-2", admin.password_hash)
    assert not verify_password("old-password-1", admin.password_hash)


@pytest.mark.asyncio
async def test_fails_when_regular_user_has_configured_name(create_user: Callable[..., Awaitable[User]]) -> None:
    await create_user("admin", "regular-password", is_superuser=False)
    with pytest.raises(RuntimeError, match="не является суперпользователем"):
        await ensure_initial_superuser(get_session_factory(), "admin", "password-123")
    async with get_session_factory()() as session:
        user = await session.scalar(select(User).where(User.username == "admin"))
    assert user is not None
    assert not user.is_superuser
