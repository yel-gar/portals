import pytest

from app.config import _as_bool, _build_database_url, _read_initial_superuser


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


def test_initial_superuser_both_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("INITIAL_SUPERUSER_USERNAME", raising=False)
    monkeypatch.delenv("INITIAL_SUPERUSER_PASSWORD", raising=False)
    assert _read_initial_superuser() is None


def test_initial_superuser_whitespace_treated_as_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INITIAL_SUPERUSER_USERNAME", "  ")
    monkeypatch.setenv("INITIAL_SUPERUSER_PASSWORD", "  ")
    assert _read_initial_superuser() is None


def test_initial_superuser_values_are_stripped(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INITIAL_SUPERUSER_USERNAME", " admin ")
    monkeypatch.setenv("INITIAL_SUPERUSER_PASSWORD", " secret-password ")
    assert _read_initial_superuser() == ("admin", "secret-password")


def test_initial_superuser_partial_config_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("INITIAL_SUPERUSER_USERNAME", raising=False)
    monkeypatch.setenv("INITIAL_SUPERUSER_PASSWORD", "secret-password")
    with pytest.raises(RuntimeError, match="обе"):
        _read_initial_superuser()


def test_initial_superuser_length_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INITIAL_SUPERUSER_USERNAME", "ab")
    monkeypatch.setenv("INITIAL_SUPERUSER_PASSWORD", "secret-password")
    with pytest.raises(RuntimeError, match="INITIAL_SUPERUSER_USERNAME"):
        _read_initial_superuser()
    monkeypatch.setenv("INITIAL_SUPERUSER_USERNAME", "admin")
    monkeypatch.setenv("INITIAL_SUPERUSER_PASSWORD", "short")
    with pytest.raises(RuntimeError, match="INITIAL_SUPERUSER_PASSWORD"):
        _read_initial_superuser()
