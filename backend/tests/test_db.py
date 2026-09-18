import pytest
from sqlalchemy.pool import NullPool

from app import db
from app.db import get_session_factory


async def test_db_lifecycle_guards(postgres_url: str) -> None:
    await db.dispose_db()
    await db.dispose_db()  # no-op when the engine is already gone
    with pytest.raises(RuntimeError):
        get_session_factory()
    with pytest.raises(RuntimeError):
        await db.create_all()

    db.init_db(postgres_url)
    await db.create_all()

    await db.dispose_db()
    db.init_db(postgres_url, pool_class=NullPool)
    await db.create_all()
