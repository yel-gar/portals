from app.security import burn_password_verify_time, hash_password, verify_password


def test_password_hash_roundtrip() -> None:
    password_hash = hash_password("secret-password")
    assert password_hash != "secret-password"
    assert verify_password("secret-password", password_hash) is True
    assert verify_password("wrong-password", password_hash) is False


def test_verify_password_invalid_hash_returns_false() -> None:
    assert verify_password("whatever", "not-a-valid-hash") is False


def test_burn_password_verify_time_does_not_raise() -> None:
    # Used on the login path when a username does not exist; must swallow the
    # argon2 mismatch like a real verification would.
    burn_password_verify_time("whatever")
