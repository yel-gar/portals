from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .bootstrap import ensure_initial_superuser
from .config import settings
from .db import create_all, dispose_db, get_session_factory, init_db
from .notifications import action_log_hub, portal_update_hub
from .routes import admin, auth, portals
from .simulator import simulator_loop

logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    logger.info("Инициализация базы данных")
    init_db(settings.database_url)
    await create_all()
    if settings.initial_superuser is not None:
        username, password = settings.initial_superuser
        logger.info("Проверка начального суперпользователя")
        await ensure_initial_superuser(get_session_factory(), username, password)
    logger.info("Запуск каналов оповещений Postgres LISTEN/NOTIFY")
    await portal_update_hub.start(settings.database_url)
    await action_log_hub.start(settings.database_url)
    # The simulator is skipped in debug mode (unit-test convenience, mirrors the
    # login rate limiter) so tests never have a background writer mutating tables.
    simulator_task: asyncio.Task[None] | None = None
    if not settings.debug:
        simulator_task = asyncio.create_task(simulator_loop())
        logger.info("Запуск симулятора порталов")
    logger.info("Приложение запущено")
    yield
    logger.info("Остановка приложения")
    if simulator_task is not None:
        simulator_task.cancel()
        with suppress(asyncio.CancelledError):
            await simulator_task
    await action_log_hub.stop()
    await portal_update_hub.stop()
    await dispose_db()


app = FastAPI(
    title="Portals API",
    description="Magic portals laboratory overseer dashboard",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin for origin in (settings.backend_url, settings.frontend_url) if origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(portals.router)
app.include_router(admin.router)
