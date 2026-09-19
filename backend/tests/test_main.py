import asyncio

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.pool import NullPool

from app.config import Settings
from app.db import create_all, get_session_factory, init_db
from app.main import app, create_app, lifespan
from app.models import User


@pytest.mark.asyncio
async def test_lifespan_starts_and_stops_hubs(postgres_url: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.main.settings",
        Settings(database_url=postgres_url, backend_url="", frontend_url="", debug=True, disable_simulator=True),
    )
    try:
        async with lifespan(app):
            pass
    finally:
        # lifespan disposes the global engine; restore it for the remaining tests
        init_db(postgres_url, pool_class=NullPool)
        await create_all()


@pytest.mark.asyncio
async def test_docs_served_in_debug(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.main.settings",
        Settings(
            database_url="postgresql+asyncpg://placeholder/placeholder", backend_url="", frontend_url="", debug=True
        ),
    )
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        for path in ("/docs", "/redoc", "/openapi.json"):
            response = await client.get(path)
            assert response.status_code == 200, path


@pytest.mark.asyncio
async def test_docs_closed_outside_debug(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.main.settings",
        Settings(
            database_url="postgresql+asyncpg://placeholder/placeholder", backend_url="", frontend_url="", debug=False
        ),
    )
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        for path in ("/docs", "/redoc", "/openapi.json"):
            response = await client.get(path)
            assert response.status_code == 404, path


@pytest.mark.parametrize("debug", [True, False])
@pytest.mark.asyncio
async def test_lifespan_starts_and_stops_simulator(
    postgres_url: str, monkeypatch: pytest.MonkeyPatch, debug: bool
) -> None:
    monkeypatch.setattr(
        "app.main.settings",
        Settings(
            database_url=postgres_url,
            backend_url="",
            frontend_url="",
            debug=debug,
            disable_simulator=False,
        ),
    )
    started = asyncio.Event()

    async def fake_loop() -> None:
        started.set()
        await asyncio.Event().wait()

    monkeypatch.setattr("app.main.simulator_loop", fake_loop)
    try:
        async with lifespan(app):
            await asyncio.wait_for(started.wait(), timeout=2.0)
    finally:
        # lifespan disposes the global engine; restore it for the remaining tests
        init_db(postgres_url, pool_class=NullPool)
        await create_all()


@pytest.mark.asyncio
async def test_lifespan_does_not_start_simulator_when_disabled(
    postgres_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.main.settings",
        Settings(
            database_url=postgres_url,
            backend_url="",
            frontend_url="",
            debug=True,
            disable_simulator=True,
        ),
    )
    started = asyncio.Event()

    async def fake_loop() -> None:
        started.set()
        await asyncio.Event().wait()

    monkeypatch.setattr("app.main.simulator_loop", fake_loop)
    try:
        async with lifespan(app):
            await asyncio.sleep(0.05)
    finally:
        # lifespan disposes the global engine; restore it for the remaining tests
        init_db(postgres_url, pool_class=NullPool)
        await create_all()
    assert not started.is_set()


@pytest.mark.asyncio
async def test_lifespan_creates_initial_superuser(postgres_url: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.main.settings",
        Settings(
            database_url=postgres_url,
            backend_url="",
            frontend_url="",
            debug=True,
            disable_simulator=True,
            initial_superuser=("admin", "password-123"),
        ),
    )
    try:
        async with lifespan(app):
            pass
    finally:
        init_db(postgres_url, pool_class=NullPool)
        await create_all()
    async with get_session_factory()() as session:
        user = await session.scalar(select(User).where(User.username == "admin"))
    assert user is not None
    assert user.is_superuser
