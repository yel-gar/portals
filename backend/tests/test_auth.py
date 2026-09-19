import asyncio
import dataclasses
from collections.abc import Awaitable, Callable
from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.config import settings
from app.db import get_session_factory
from app.models import LoginSession, User, utc_now
from app.ratelimit import SlidingWindowRateLimiter


async def _register(client: AsyncClient, username: str, password: str) -> int:
    response = await client.post("/auth/register", json={"username": username, "password": password})
    assert response.status_code == 201, response.text
    return response.status_code


@pytest.mark.asyncio
async def test_register_login_me_logout(client: AsyncClient) -> None:
    response = await client.post("/auth/register", json={"username": "alice", "password": "supersecret1"})
    assert response.status_code == 201, response.text
    assert response.json()["username"] == "alice"

    me = await client.get("/auth/me")
    assert me.status_code == 401

    login = await client.post("/auth/login", json={"username": "alice", "password": "supersecret1"})
    assert login.status_code == 200, login.text
    assert login.json()["username"] == "alice"

    me = await client.get("/auth/me")
    assert me.status_code == 200
    assert me.json()["username"] == "alice"

    logout = await client.post("/auth/logout")
    assert logout.status_code == 204

    me = await client.get("/auth/me")
    assert me.status_code == 401


@pytest.mark.asyncio
async def test_register_duplicate_username(client: AsyncClient) -> None:
    await _register(client, "bobby", "supersecret1")
    response = await client.post("/auth/register", json={"username": "bobby", "password": "othersecret2"})
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_login_invalid_credentials(client: AsyncClient) -> None:
    await _register(client, "carol", "supersecret1")
    wrong_password = await client.post("/auth/login", json={"username": "carol", "password": "wrongpass1"})
    assert wrong_password.status_code == 401
    unknown_user = await client.post("/auth/login", json={"username": "nobody", "password": "supersecret1"})
    assert unknown_user.status_code == 401


@pytest.mark.asyncio
async def test_register_validation_errors(client: AsyncClient) -> None:
    short_username = await client.post("/auth/register", json={"username": "ab", "password": "supersecret1"})
    assert short_username.status_code == 422
    short_password = await client.post("/auth/register", json={"username": "validuser", "password": "short"})
    assert short_password.status_code == 422
    missing_fields = await client.post("/auth/register", json={"username": "validuser"})
    assert missing_fields.status_code == 422


@pytest.mark.asyncio
async def test_logout_is_idempotent(client: AsyncClient) -> None:
    response = await client.post("/auth/logout")
    assert response.status_code == 204


@pytest.mark.asyncio
async def test_expired_session_token_rejected(client: AsyncClient, create_user: Callable[..., Awaitable[User]]) -> None:
    user = await create_user("bob", "supersecret1")
    token = "e" * 64
    async with get_session_factory()() as session:
        session.add(LoginSession(user_id=user.id, token=token, expires_at=utc_now() - timedelta(seconds=1)))
        await session.commit()
    client.cookies.set(settings.session_cookie_name, token)

    me = await client.get("/auth/me")
    assert me.status_code == 401


@pytest.mark.asyncio
async def test_unknown_session_token_rejected(client: AsyncClient) -> None:
    client.cookies.set(settings.session_cookie_name, "f" * 64)
    me = await client.get("/auth/me")
    assert me.status_code == 401
    portals = await client.get("/portals")
    assert portals.status_code == 401


@pytest.mark.asyncio
async def test_login_validation_errors(client: AsyncClient) -> None:
    short_password = await client.post("/auth/login", json={"username": "alice", "password": "short"})
    assert short_password.status_code == 422
    short_username = await client.post("/auth/login", json={"username": "ab", "password": "supersecret1"})
    assert short_username.status_code == 422


@pytest.mark.asyncio
async def test_register_disabled_by_settings(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.routes.auth.settings",
        dataclasses.replace(settings, disable_registration=True),
    )
    response = await client.post("/auth/register", json={"username": "alice", "password": "supersecret1"})
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_login_rate_limited(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    await _register(client, "dave", "supersecret1")
    monkeypatch.setattr(
        "app.routes.auth.settings",
        dataclasses.replace(settings, debug=False),
    )
    monkeypatch.setattr(
        "app.routes.auth.login_rate_limiter",
        SlidingWindowRateLimiter(max_attempts=2, window_seconds=60),
    )
    first = await client.post("/auth/login", json={"username": "dave", "password": "supersecret1"})
    second = await client.post("/auth/login", json={"username": "dave", "password": "supersecret1"})
    third = await client.post("/auth/login", json={"username": "dave", "password": "supersecret1"})
    assert first.status_code == 200
    assert second.status_code == 200
    assert third.status_code == 429


@pytest.mark.asyncio
async def test_register_concurrent_duplicate(client: AsyncClient) -> None:
    first, second = await asyncio.gather(
        client.post("/auth/register", json={"username": "dupe", "password": "supersecret1"}),
        client.post("/auth/register", json={"username": "dupe", "password": "supersecret1"}),
    )
    assert {first.status_code, second.status_code} == {201, 409}


@pytest.mark.asyncio
async def test_change_password_keeps_current_session_and_revokes_others(client: AsyncClient) -> None:
    await _register(client, "alice", "supersecret1")
    login = await client.post("/auth/login", json={"username": "alice", "password": "supersecret1"})
    assert login.status_code == 200
    current_token = client.cookies.get(settings.session_cookie_name)
    assert current_token is not None

    other_token = "o" * 64
    async with get_session_factory()() as session:
        stored = await session.scalar(select(User).where(User.username == "alice"))
        assert stored is not None
        session.add(LoginSession(user_id=stored.id, token=other_token, expires_at=utc_now() + timedelta(hours=1)))
        await session.commit()

    response = await client.post("/auth/password", json={"password": "newpassword9"})
    assert response.status_code == 204
    # current session survives
    me = await client.get("/auth/me")
    assert me.status_code == 200
    # old password is rejected, the new one works
    await client.post("/auth/logout")
    old_login = await client.post("/auth/login", json={"username": "alice", "password": "supersecret1"})
    assert old_login.status_code == 401
    new_login = await client.post("/auth/login", json={"username": "alice", "password": "newpassword9"})
    assert new_login.status_code == 200
    # the other session was revoked
    client.cookies.set(settings.session_cookie_name, other_token)
    me_other = await client.get("/auth/me")
    assert me_other.status_code == 401


@pytest.mark.asyncio
async def test_change_password_requires_auth(client: AsyncClient) -> None:
    response = await client.post("/auth/password", json={"password": "newpassword9"})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_change_password_rejects_short_password(client: AsyncClient) -> None:
    await _register(client, "alice", "supersecret1")
    login = await client.post("/auth/login", json={"username": "alice", "password": "supersecret1"})
    assert login.status_code == 200
    response = await client.post("/auth/password", json={"password": "short"})
    assert response.status_code == 422
