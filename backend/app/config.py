from __future__ import annotations

import os
from dataclasses import dataclass

from .constants import SESSION_TTL_DAYS


def _as_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on", "y"}


def _build_database_url() -> str:
    url = os.getenv("DATABASE_URL")
    if url:
        return url
    user = os.environ["POSTGRES_USER"]
    password = os.environ["POSTGRES_PASSWORD"]
    host = os.getenv("POSTGRES_HOST", "localhost")
    port = os.getenv("POSTGRES_PORT", "5432")
    db = os.environ["POSTGRES_DB"]
    return f"postgresql+asyncpg://{user}:{password}@{host}:{port}/{db}"


@dataclass(frozen=True)
class Settings:
    database_url: str
    backend_url: str
    frontend_url: str
    debug: bool
    session_cookie_name: str = "session_token"
    session_ttl_days: int = SESSION_TTL_DAYS

    @property
    def cookie_secure(self) -> bool:
        return not self.debug


def load_settings() -> Settings:
    return Settings(
        database_url=_build_database_url(),
        backend_url=os.getenv("BACKEND_URL", ""),
        frontend_url=os.getenv("FRONTEND_URL", ""),
        debug=_as_bool(os.getenv("DEBUG")),
    )


settings = load_settings()
