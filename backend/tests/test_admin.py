from collections.abc import Awaitable, Callable

import pytest
from httpx import AsyncClient

from app.models import User


async def _login(client: AsyncClient, username: str = "alice", password: str = "supersecret1") -> None:
    login = await client.post("/auth/login", json={"username": username, "password": password})
    assert login.status_code == 200, login.text


@pytest.mark.asyncio
async def test_admin_requires_superuser(client: AsyncClient, create_user: Callable[..., Awaitable[User]]) -> None:
    await create_user("alice", "supersecret1")
    await _login(client)
    response = await client.get("/admin/users")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_admin_requires_auth(client: AsyncClient) -> None:
    response = await client.get("/admin/users")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_create_and_list_users(
    client: AsyncClient,
    create_user: Callable[..., Awaitable[User]],
) -> None:
    await create_user("root", "supersecret1", is_superuser=True)
    await _login(client, username="root")

    created = await client.post("/admin/users", json={"username": "bobby", "password": "supersecret1"})
    assert created.status_code == 201, created.text
    assert created.json()["username"] == "bobby"
    assert created.json()["is_superuser"] is False

    listing = await client.get("/admin/users")
    assert listing.status_code == 200
    usernames = {user["username"] for user in listing.json()}
    assert usernames == {"root", "bobby"}


@pytest.mark.asyncio
async def test_create_duplicate_user(client: AsyncClient, create_user: Callable[..., Awaitable[User]]) -> None:
    await create_user("root", "supersecret1", is_superuser=True)
    await create_user("bobby", "supersecret1")
    await _login(client, username="root")

    response = await client.post("/admin/users", json={"username": "bobby", "password": "othersecret1"})
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_set_password(client: AsyncClient, create_user: Callable[..., Awaitable[User]]) -> None:
    await create_user("root", "supersecret1", is_superuser=True)
    bob = await create_user("bobby", "supersecret1")
    await _login(client, username="root")

    response = await client.post(f"/admin/users/{bob.id}/set-password", json={"password": "newpassword9"})
    assert response.status_code == 204

    logout = await client.post("/auth/logout")
    assert logout.status_code == 204
    await _login(client, username="bobby", password="newpassword9")
    me = await client.get("/auth/me")
    assert me.status_code == 200
    assert me.json()["id"] == bob.id


@pytest.mark.asyncio
async def test_set_password_missing_user(client: AsyncClient, create_user: Callable[..., Awaitable[User]]) -> None:
    await create_user("root", "supersecret1", is_superuser=True)
    await _login(client, username="root")

    response = await client.post("/admin/users/9999/set-password", json={"password": "newpassword9"})
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_delete_user(client: AsyncClient, create_user: Callable[..., Awaitable[User]]) -> None:
    await create_user("root", "supersecret1", is_superuser=True)
    bob = await create_user("bobby", "supersecret1")
    await _login(client, username="root")

    response = await client.delete(f"/admin/users/{bob.id}")
    assert response.status_code == 204

    listing = await client.get("/admin/users")
    usernames = {user["username"] for user in listing.json()}
    assert usernames == {"root"}


@pytest.mark.asyncio
async def test_delete_superuser_forbidden(client: AsyncClient, create_user: Callable[..., Awaitable[User]]) -> None:
    superuser = await create_user("root", "supersecret1", is_superuser=True)
    await _login(client, username="root")

    response = await client.delete(f"/admin/users/{superuser.id}")
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_delete_missing_user(client: AsyncClient, create_user: Callable[..., Awaitable[User]]) -> None:
    await create_user("root", "supersecret1", is_superuser=True)
    await _login(client, username="root")

    response = await client.delete("/admin/users/9999")
    assert response.status_code == 404
