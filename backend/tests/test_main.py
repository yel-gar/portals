import pytest
from sqlalchemy.pool import NullPool

from app.config import Settings
from app.db import create_all, init_db
from app.main import app, lifespan


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
