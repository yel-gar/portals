from app.ratelimit import SlidingWindowRateLimiter


def test_limiter_blocks_after_max_attempts() -> None:
    limiter = SlidingWindowRateLimiter(max_attempts=3, window_seconds=60)
    assert [limiter.allow("ip") for _ in range(3)] == [True, True, True]
    assert limiter.allow("ip") is False


def test_limiter_keys_are_independent() -> None:
    limiter = SlidingWindowRateLimiter(max_attempts=1, window_seconds=60)
    assert limiter.allow("a") is True
    assert limiter.allow("a") is False
    assert limiter.allow("b") is True


def test_limiter_window_slides_with_clock() -> None:
    now = [0.0]
    limiter = SlidingWindowRateLimiter(max_attempts=1, window_seconds=60, clock=lambda: now[0])
    assert limiter.allow("ip") is True
    assert limiter.allow("ip") is False
    now[0] = 61.0
    assert limiter.allow("ip") is True
