from collections.abc import Awaitable, Callable
from datetime import timedelta

from httpx import AsyncClient

from app.config import settings
from app.db import get_session_factory
from app.models import LoginSession, User, utc_now


async def _register(client: AsyncClient, username: str, password: str) -> int:
    response = await client.post("/auth/register", json={"username": username, "password": password})
    assert response.status_code == 201, response.text
    return response.status_code


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


async def test_register_duplicate_username(client: AsyncClient) -> None:
    await _register(client, "bobby", "supersecret1")
    response = await client.post("/auth/register", json={"username": "bobby", "password": "othersecret2"})
    assert response.status_code == 409


async def test_login_invalid_credentials(client: AsyncClient) -> None:
    await _register(client, "carol", "supersecret1")
    wrong_password = await client.post("/auth/login", json={"username": "carol", "password": "wrongpass1"})
    assert wrong_password.status_code == 401
    unknown_user = await client.post("/auth/login", json={"username": "nobody", "password": "supersecret1"})
    assert unknown_user.status_code == 401


async def test_register_validation_errors(client: AsyncClient) -> None:
    short_username = await client.post("/auth/register", json={"username": "ab", "password": "supersecret1"})
    assert short_username.status_code == 422
    short_password = await client.post("/auth/register", json={"username": "validuser", "password": "short"})
    assert short_password.status_code == 422
    missing_fields = await client.post("/auth/register", json={"username": "validuser"})
    assert missing_fields.status_code == 422


async def test_logout_is_idempotent(client: AsyncClient) -> None:
    response = await client.post("/auth/logout")
    assert response.status_code == 204


async def test_expired_session_token_rejected(client: AsyncClient, create_user: Callable[..., Awaitable[User]]) -> None:
    user = await create_user("bob", "supersecret1")
    token = "e" * 64
    async with get_session_factory()() as session:
        session.add(LoginSession(user_id=user.id, token=token, expires_at=utc_now() - timedelta(seconds=1)))
        await session.commit()
    client.cookies.set(settings.session_cookie_name, token)

    me = await client.get("/auth/me")
    assert me.status_code == 401
