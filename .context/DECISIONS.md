# Decisions

All architecture decisions are recorded here. Chronological, newest at the bottom.

## UTF
- All timestamps are stored and compared in UTC. DB datetime columns are timezone-aware (`DateTime(timezone=True)` / `timestamptz`). `last_update` uses `server_default=func.now()` + `onupdate=func.now()`; `ActionLogEntry.timestamp` and `User.created_at` use `server_default=func.now()`.

## Portal semantics
- `closed` is a **derived** property: `expires_at <= now or is_closed`. It is exposed in `PortalSchema` as `closed`; the raw DB column stays `is_closed`.
- Risk factor is calculated as
  `(energy/100)*0.2 + (1 - stability/100)*0.2 + (0.1*c/(0.1*c+1))*0.3 + (1 - 0.04*TTL/(0.04*TTL+1))*0.3`,
  where `TTL = max((expires_at - now).total_seconds(), 0.0)` — clamped, expired portals never produce negative TTL.
- Danger levels: `<= 0.3` LOW, `<= 0.6` MEDIUM, `<= 0.9` HIGH, `> 0.9` CRITICAL.
- `STABILIZE` condition "stability below 0.5" is interpreted for the 0-100 int scale as `stability < 50`; stabilizing sets stability to `100`.
- `DISMISS` (the UI's "leave open") is an acknowledgement: it only refreshes `last_update` and is rejected while the portal is closed.
- MARK/UNMARK are the only actions allowed on a closed/expired portal, per requirements.

## Action validation
- Conditions are validated inside `Portal` model methods. They raise `BadAction` (Russian message). Routes map `BadAction` to HTTP 409 Conflict and are the only place that creates `ActionLogEntry` rows and commits.

## Real-time updates
- Live updates are delivered over `WS /portals/ws`. Refresh events are broadcast through Postgres `LISTEN/NOTIFY` on channel `portal_changes`, consumed by a dedicated `asyncpg` connection using `add_listener` in `app/notifications.py`.
- Currently only the listener side runs; producers (background tasks updating portal data, plus a trigger) are planned but not implemented yet.

## Auth
- Auth is cookie-based: a random 64-hex-char login token is stored in `LoginSession` and set as an httpOnly session cookie. `LoginSession.expires_at` defaults to now + 14 days.
- The session cookie is `Secure` unless `DEBUG` is truthy.
- Username 4-64 chars, password 8-128 chars (stored as argon2 hash, 255 chars); constants in `app/constants.py` shared by models and validators.
- Auth errors: missing/invalid credentials -> 401, non-superuser on admin routes -> 403, duplicate username -> 409.

## Transport / config
- CORS allows origins from `BACKEND_URL` and `FRONTEND_URL` env vars, `allow_credentials=True`.
- `DATABASE_URL` env var overrides the URL assembled from `POSTGRES_*` parts.

## Testing
- Tests run against a real PostgreSQL in a `postgres:18-alpine` testcontainers container (per test session), not SQLite, to match the production dialect.
- Tests are fully async (`pytest-asyncio`, session-scoped event loop for tests and fixtures). HTTP is exercised through `httpx.AsyncClient` + `httpx.ASGITransport`; the app lifespan is not run, DB is initialized/disposed by session fixtures and truncated per test. The WebSocket auth-gate is covered by calling the endpoint directly with a mock websocket.

## Columns nullable
- `nullable` is set explicitly on every model column (`nullable=False` everywhere except `ActionLogEntry.user_id` which is `nullable=True`), even though SQLAlchemy 2.0 `Mapped[str]` annotations already imply non-nullable.

## Logging
- Project uses the built-in `logging` library. Format: `2026-03-02 15:00:18 [INFO] message` (`%(asctime)s [%(levelname)s] %(message)s`, `datefmt=%Y-%m-%d %H:%M:%S`), configured in `app/main.py`, level `DEBUG` when `DEBUG` is truthy.

## Future ideas (not yet implemented)
- Migrate the action log (`GET /portals/log`) to WebSocket so new entries stream to clients in real time, like portal updates.
- Guarantee commit safety for portal actions against race conditions; after committing an action the portal should `NOTIFY` the `portal_changes` channel so the LISTEN/NOTIFY hub wakes WS subscribers (producers are still absent).
