from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def init_db(database_url: str, *, echo: bool = False) -> async_sessionmaker[AsyncSession]:
    """Create the global engine/session factory bound to ``database_url``.

    Called by the app lifespan and by tests against their container database.
    """
    global _engine, _session_factory
    engine = create_async_engine(database_url, echo=echo, pool_pre_ping=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    _engine = engine
    _session_factory = factory
    return factory


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    if _session_factory is None:
        raise RuntimeError("Database is not initialized, call init_db() first")
    return _session_factory


async def create_all() -> None:
    if _engine is None:
        raise RuntimeError("Database is not initialized, call init_db() first")
    async with _engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)


async def dispose_db() -> None:
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _session_factory = None


async def get_db_session() -> AsyncGenerator[AsyncSession]:
    async with get_session_factory()() as session:
        yield session
