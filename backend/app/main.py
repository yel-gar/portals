from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import create_all, dispose_db, init_db
from .notifications import portal_update_hub
from .routes import admin, auth, portals


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    init_db(settings.database_url)
    await create_all()
    await portal_update_hub.start(settings.database_url)
    yield
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
