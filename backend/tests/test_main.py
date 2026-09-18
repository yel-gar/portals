import pytest
from sqlalchemy import select
from sqlalchemy.pool import NullPool

from app.config import Settings
from app.db import create_all, get_session_factory, init_db
from app.main import app, lifespan
from app.models import User


@pytest.mark.asyncio
async def test_lifespan_starts_and_stops_hubs(postgres_url: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.main.settings",
        Settings(database_url=postgres_url, backend_url="", frontend_url="", debug=True),
    )
    try:
        async with lifespan(app):
            pass
    finally:
        # lifespan disposes the global engine; restore it for the remaining tests
        init_db(postgres_url, pool_class=NullPool)
        await create_all()


@pytest.mark.asyncio
async def test_lifespan_creates_initial_superuser(postgres_url: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.main.settings",
        Settings(
            database_url=postgres_url,
            backend_url="",
            frontend_url="",
            debug=True,
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
