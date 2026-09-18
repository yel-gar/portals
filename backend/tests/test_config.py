import pytest

from app.config import _as_bool, _build_database_url


def test_as_bool_default() -> None:
    assert _as_bool(None) is False
    assert _as_bool(None, default=True) is True


def test_as_bool_truthy_and_falsy() -> None:
    for value in ("1", "true", "yes", "on", "y", "TRUE", " Yes "):
        assert _as_bool(value) is True
    for value in ("0", "false", "off", "n", "whatever"):
        assert _as_bool(value) is False


def test_build_database_url_prefers_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://override/db")
    assert _build_database_url() == "postgresql+asyncpg://override/db"
