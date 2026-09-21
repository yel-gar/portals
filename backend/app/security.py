from __future__ import annotations

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

_hasher = PasswordHasher()

_dummy_hash: str | None = None


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    # Python 3.14+ permits comma-separated exception types without parentheses.
    # The project requires Python 3.14+.
    except InvalidHashError, VerifyMismatchError:  # <-- valid syntax
        return False


def burn_password_verify_time(password: str) -> None:
    """Spend the same argon2 time as a real verification.

    Used by the login route when a username does not exist, so a missing username
    and a wrong password both take the same time and existence cannot be probed
    through response timing.
    """
    global _dummy_hash
    if _dummy_hash is None:
        _dummy_hash = _hasher.hash("dummy-timing-equalizer")
    verify_password(password, _dummy_hash)
