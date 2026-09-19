import os
from collections.abc import AsyncGenerator, Awaitable, Callable, Generator
from datetime import timedelta
from typing import Any

os.environ.setdefault("POSTGRES_USER", "test")
os.environ.setdefault("POSTGRES_PASSWORD", "test")
os.environ.setdefault("POSTGRES_DB", "test")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("BACKEND_URL", "")
os.environ.setdefault("FRONTEND_URL", "")
os.environ.setdefault("DEBUG", "1")
os.environ.setdefault("DISABLE_SIMULATOR", "1")

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.pool import NullPool
from testcontainers.community.postgres import PostgresContainer

from app.db import Base, create_all, dispose_db, get_session_factory, init_db
from app.models import Portal, User, utc_now
from app.security import hash_password


@pytest.fixture(scope="session")
def postgres_url() -> Generator[str]:
    with PostgresContainer("postgres:18-alpine") as container:
        yield container.get_connection_url(driver="asyncpg")


@pytest.fixture(scope="session", autouse=True)
async def setup_db(postgres_url: str) -> AsyncGenerator[None]:
    init_db(postgres_url, pool_class=NullPool)
    await create_all()
    yield
    await dispose_db()


@pytest.fixture(autouse=True)
async def reset_db() -> AsyncGenerator[None]:
    yield
    tables = ", ".join(table.name for table in Base.metadata.sorted_tables)
    async with get_session_factory()() as session:
        await session.execute(text(f"TRUNCATE TABLE {tables} RESTART IDENTITY CASCADE"))
        await session.commit()


@pytest.fixture
async def client() -> AsyncGenerator[AsyncClient]:
    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def create_user() -> Callable[..., Awaitable[User]]:
    async def _create(username: str, password: str, *, is_superuser: bool = False) -> User:
        async with get_session_factory()() as session:
            user = User(
                username=username,
                password_hash=hash_password(password),
                is_superuser=is_superuser,
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)
            return user

    return _create


@pytest.fixture
async def create_portal() -> Callable[..., Awaitable[Portal]]:
    async def _create(**overrides: Any) -> Portal:
        defaults: dict[str, Any] = {
            "name": "Portal 1",
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
        async with get_session_factory()() as session:
            portal = Portal(**defaults)
            session.add(portal)
            await session.commit()
            await session.refresh(portal)
            return portal

    return _create
