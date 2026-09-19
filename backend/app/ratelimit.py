from __future__ import annotations

import time
from collections import deque
from collections.abc import Callable

LOGIN_MAX_ATTEMPTS = 5
LOGIN_WINDOW_SECONDS = 60.0


class SlidingWindowRateLimiter:
    """In-memory sliding-window rate limiter keyed by an arbitrary string.

    Only meaningful for a single-process backend (state is not shared between
    workers). Suitable for a basic per-IP throttle on the login endpoint.
    """

    def __init__(
        self,
        max_attempts: int,
        window_seconds: float,
        *,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._max_attempts = max_attempts
        self._window_seconds = window_seconds
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}

    def allow(self, key: str) -> bool:
        now = self._clock()
        window = self._hits.setdefault(key, deque())
        while window and window[0] <= now - self._window_seconds:
            window.popleft()
        if len(window) >= self._max_attempts:
            return False
        window.append(now)
        return True


login_rate_limiter = SlidingWindowRateLimiter(max_attempts=LOGIN_MAX_ATTEMPTS, window_seconds=LOGIN_WINDOW_SECONDS)
