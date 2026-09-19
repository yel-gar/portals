from __future__ import annotations

import os
from dataclasses import dataclass

from .constants import (
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    SESSION_TTL_DAYS,
    SIMULATOR_OPEN_CHANCE_DEFAULT,
    USERNAME_MAX_LENGTH,
    USERNAME_MIN_LENGTH,
)


def _as_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on", "y"}


def _as_float(value: str | None, default: float, *, name: str) -> float:
    """Parse a float env var, or return ``default`` when unset/blank.

    Invalid values fail fast at settings load (like ``_read_initial_superuser``).
    """
    if value is None or not value.strip():
        return default
    try:
        parsed = float(value)
    except ValueError:
        raise RuntimeError(f"{name}: ожидалось число, получено {value!r}") from None
    if not 0.0 <= parsed <= 1.0:
        raise RuntimeError(f"{name}: ожидается значение от 0 до 1, получено {parsed!r}")
    return parsed


def _read_initial_superuser() -> tuple[str, str] | None:
    """Read and validate the initial-superuser env pair, or return ``None``.

    Both variables must be set together (or neither). Lengths are enforced with
    the same constants the DB models and Pydantic validators use.
    """
    username = (os.getenv("INITIAL_SUPERUSER_USERNAME") or "").strip()
    password = (os.getenv("INITIAL_SUPERUSER_PASSWORD") or "").strip()
    if not username and not password:
        return None
    if not username or not password:
        raise RuntimeError(
            "Задайте обе переменные окружения INITIAL_SUPERUSER_USERNAME и "
            "INITIAL_SUPERUSER_PASSWORD, либо не задавайте ни одну из них"
        )
    if not USERNAME_MIN_LENGTH <= len(username) <= USERNAME_MAX_LENGTH:
        raise RuntimeError(
            f"INITIAL_SUPERUSER_USERNAME: длина должна быть от {USERNAME_MIN_LENGTH} до {USERNAME_MAX_LENGTH} символов"
        )
    if not PASSWORD_MIN_LENGTH <= len(password) <= PASSWORD_MAX_LENGTH:
        raise RuntimeError(
            f"INITIAL_SUPERUSER_PASSWORD: длина должна быть от {PASSWORD_MIN_LENGTH} до {PASSWORD_MAX_LENGTH} символов"
        )
    return username, password


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
    initial_superuser: tuple[str, str] | None = None
    disable_registration: bool = False
    disable_simulator: bool = False
    portal_open_chance: float = SIMULATOR_OPEN_CHANCE_DEFAULT

    @property
    def cookie_secure(self) -> bool:
        return not self.debug


def load_settings() -> Settings:
    return Settings(
        database_url=_build_database_url(),
        backend_url=os.getenv("BACKEND_URL", ""),
        frontend_url=os.getenv("FRONTEND_URL", ""),
        debug=_as_bool(os.getenv("DEBUG")),
        initial_superuser=_read_initial_superuser(),
        disable_registration=_as_bool(os.getenv("DISABLE_REGISTRATION")),
        disable_simulator=_as_bool(os.getenv("DISABLE_SIMULATOR")),
        portal_open_chance=_as_float(
            os.getenv("PORTAL_OPEN_CHANCE"), SIMULATOR_OPEN_CHANCE_DEFAULT, name="PORTAL_OPEN_CHANCE"
        ),
    )


settings = load_settings()
