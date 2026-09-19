from __future__ import annotations

import logging

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .models import User
from .security import hash_password, verify_password

logger = logging.getLogger(__name__)


async def ensure_initial_superuser(
    session_factory: async_sessionmaker[AsyncSession],
    username: str,
    password: str,
) -> None:
    """Create or reconcile the initial superuser right after ``create_all``.

    Superusers whose name differs from ``username`` are deleted (their login
    sessions cascade via FK, action log rows get ``user_id`` SET NULL). An
    existing superuser with the exact name is kept; if its stored hash no
    longer matches ``password`` (the env var changed), the hash is replaced
    with the new one. A regular user holding the configured name aborts
    startup.
    """
    async with session_factory() as session:
        existing = await session.scalar(select(User).where(User.username == username))
        if existing is not None and not existing.is_superuser:
            raise RuntimeError(
                f"Пользователь с именем {username!r} уже существует и не является суперпользователем. "
                "Разрешите конфликт вручную и перезапустите приложение"
            )
        await session.execute(delete(User).where(User.is_superuser, User.username != username))
        if existing is None:
            session.add(User(username=username, password_hash=hash_password(password), is_superuser=True))
            logger.info("Создан начальный суперпользователь username=%s", username)
        elif verify_password(password, existing.password_hash):
            logger.info("Начальный суперпользователь username=%s уже существует", username)
        else:
            existing.password_hash = hash_password(password)
            logger.info("Пароль начального суперпользователя username=%s обновлён", username)
        await session.commit()
