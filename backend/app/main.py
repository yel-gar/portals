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
    # The simulator runs in every mode, including debug, so development builds
    # get the same live portal activity as production. Automated environments
    # (tests/CI) opt out with DISABLE_SIMULATOR.
    simulator_task: asyncio.Task[None] | None = None
    if not settings.disable_simulator:
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


def create_app() -> FastAPI:
    _app = FastAPI(
        title="Portals API",
        description="Magic portals laboratory overseer dashboard",
        lifespan=lifespan,
        # Interactive docs and the OpenAPI schema are dev conveniences; close
        # them in production (DEBUG off) so the API surface is not publicly
        # discoverable. Controlled via the FastAPI constructor params.
        docs_url="/docs" if settings.debug else None,
        redoc_url="/redoc" if settings.debug else None,
        openapi_url="/openapi.json" if settings.debug else None,
    )
    _app.add_middleware(
        CORSMiddleware,
        allow_origins=[origin for origin in (settings.backend_url, settings.frontend_url) if origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    _app.include_router(auth.router)
    _app.include_router(portals.router)
    _app.include_router(admin.router)

    @_app.get(
        "/health",
        summary="Проверка работоспособности",
        description=(
            "Простой liveness-эндпоинт для внешних проб (мониторинг, health-checks). "
            "Не требует авторизации и не обращается к базе данных."
        ),
    )
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return _app


app = create_app()
