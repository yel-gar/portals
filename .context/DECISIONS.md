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
- `STABILIZE` condition "stability below 0.5" is interpreted for the 0-100 int scale as `stability < 50`; stabilizing increases stability by a random value from `STABILITY_INCREASE_RAND_RANGE = (10, 30)`, capped at `100`.
- `DISMISS` (the UI's "leave open") is an acknowledgement: it only refreshes `last_update` and is rejected while the portal is closed.
- MARK/UNMARK are the only actions allowed on a closed/expired portal, per requirements.
- WARN_CREATURES warns the creatures through the observer and empties the portal (`creatures_count = 0`).

## Action validation
- Conditions are validated inside `Portal` model methods. They raise `BadAction` (Russian message). Routes map `BadAction` to HTTP 409 Conflict and are the only place that creates `ActionLogEntry` rows and commits.

## Real-time updates
- Live updates are delivered over `WS /portals/ws`; action log entries stream over `WS /portals/log/ws`. Both endpoints authenticate by session cookie, push an initial page snapshot, then re-push snapshots whenever their hub broadcasts a refresh event.
- Refresh events are broadcast through Postgres `LISTEN/NOTIFY` on two channels — `portal_changes` (portal page) and `action_log_changes` (action log page) — each consumed by a dedicated `asyncpg` connection using `add_listener` in `app/notifications.py` (`UpdateHub`, one instance per channel).
- Producers emit `pg_notify` for both channels from `POST /portals/{id}` inside the action transaction, so subscribers are only woken on a durable commit.
- Portal actions are commit-safe: the portal row is locked with `SELECT ... FOR UPDATE` (serializing concurrent actions on the same portal), validation and the `ActionLogEntry` row share the transaction, and a rejected/rolled-back action never sends notifications.

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

## Initial superuser bootstrap
- `INITIAL_SUPERUSER_USERNAME` + `INITIAL_SUPERUSER_PASSWORD` (both or neither; validated against the shared length constants at settings load) create/reconcile a single initial superuser in the app lifespan, right after `create_all()`.
- If a superuser with a **different** name exists, it is deleted (login sessions cascade via FK, action log rows get `user_id` SET NULL). An existing superuser with the exact configured name is kept as-is — its password is never reset.
- If a regular (non-superuser) user already holds the configured username, startup **fails fast** with a clear error instead of silently promoting or deleting the account (behavior chosen by user).
- Implementation lives in `app/bootstrap.py` (`ensure_initial_superuser`), wired into `app/main.py` lifespan.

## Future ideas (not yet implemented)
- Background tasks that update portal data should also produce `portal_changes` notifications (the trigger-based producer is a later alternative to in-route `pg_notify`).

## Frontend stack
- The frontend is a **React SPA scaffolded with Vite**, TypeScript in strict mode, with **no SSR/SSG** (no Next.js). Rationale: the app is an authenticated dashboard where everything interesting arrives live in the browser via WebSockets, so server-side rendering buys nothing and would only add machinery (RSC, cookie forwarding, "use client" everywhere) without payoff.
- The FastAPI backend stays the single source of truth. The frontend consumes JSON HTTP + the two snapshot WebSocket endpoints (`/portals/ws`, `/portals/log/ws`); each WS push is a complete page snapshot and replaces the previous server state atomically.
- Auth stays cookie-based in the browser: the backend's httpOnly session cookie is handled by the browser automatically (Secure unless `DEBUG`); the frontend never stores the token itself.
- Still pending user consultation (not committed as decisions): UI component library, state management, router, package manager, `frontend/` file layout, and the serving strategy (docker compose service vs static hosting; Vite dev proxy for backend + WS in development).
- Frontend work happens on branch `frontend/react-vite`; the API/WS endpoints are no longer "backend-only" — see the frontend decision above.
