# Project state

## Current status
Backend is scaffolded and fully configured for tooling, CI and docker deployment. Application code is being implemented: magic portals laboratory overseer dashboard API.

## Review fixes (post M6)
- `nullable` now set explicitly on every model column.
- Tests rewritten to be fully async (`pytest-asyncio` + `httpx.AsyncClient`/`ASGITransport`); `httpx2` dependency replaced with `httpx`.
- Built-in `logging` configured with `2026-03-02 15:00:18 [INFO] message` template.
- `deps.get_current_user` uses `Cookie` annotation instead of reading `request.cookies` (also in `auth.logout`).
- All route decorators document error codes via `responses`.
- Removed redundant `model_validate` on endpoints with `response_model` + `from_attributes`; switched to `session.scalars()`.
- `/portals/stats` rewritten to use DB aggregate queries (SQL-side risk/danger distribution and avg risk).
- Restored login requirement (`CurrentUser`) on all HTTP portal routes.
- Fixed `asyncpg` hub to use `add_listener` (removed `Connection.wait()` API).
- Fixed `security.py` Python-2 `except` syntax.
- Future ideas recorded: action log over WebSocket; commit-safety + NOTIFY producer for portal actions.

## Plan
Milestones (a git commit happens after each milestone; pre-commit runs on each commit; tests run via pre-push hook / CI):

1. **M1 Foundation** — deps (`argon2-cffi`, dev `aiosqlite`), `constants.py`, `exceptions.py`, `db.py`, `models.py` (Portal with risk_factor / danger_level / derived closed + all action methods, Action/DangerLevel enums, ActionLogEntry, User, LoginSession).
2. **M2 Schemas + deps** — `config.py`, `security.py`, `schemas.py`, `deps.py` (auth dependencies).
3. **M3 Auth routes** — register / login / logout / me, session cookie.
4. **M4 Portal routes** — HTTP GET list, WS live listener, action execution + action log, log listing, stats.
5. **M5 Admin routes** — user CRUD + set-password (superuser only).
6. **M6 Entrypoint + env** — `main.py` lifespan, CORS, envvars (`BACKEND_URL`, `FRONTEND_URL`, `DEBUG`).
7. **M7 Tests** — model unit tests, auth/portal/admin API tests, coverage gate >= 80.
8. **Final** — pre-commit --all-files, full pytest run, doc refresh.

## Completed milestones

### M1 Foundation
- Dependencies: `argon2-cffi`; dev `testcontainers[postgres]`, `pytest-asyncio`; restored `mypy`, `pre-commit`, `coverage` (referenced by CI but missing)
- `app/constants.py` - shared length constants (username/password/portal columns)
- `app/exceptions.py` - `BadAction`
- `app/db.py` - engine/session factory lifecycle (init_db/create_all/dispose), `Base`
- `app/models.py` - `Action`/`DangerLevel` enums, `Portal` (risk_factor, danger_level, derived `closed`, all action methods raising `BadAction`), `User`, `LoginSession`, `ActionLogEntry`
- `DISMISS` = refresh `last_update` only (from AI-WORKLOG: "simply update last update timestamp")

### M2 Schemas + deps
- `app/config.py` - env-based `Settings` (database URL parts/override, `BACKEND_URL`/`FRONTEND_URL` CORS origins, `DEBUG` → cookie secure flag)
- `app/security.py` - argon2 hash/verify helpers
- `app/schemas.py` - pydantic schemas set (`PortalSchema` with derived `closed`/`risk_factor`/`danger_level`, paginated lists, auth, log, stats)
- `app/deps.py` - `DbSession`/`CurrentUser`/`SuperUser` Annotated dependencies, token-based session auth

### M3 Auth routes
- `app/routes/auth.py` - register / login (session cookie, 14-day expiry) / logout / me; 409 duplicate username, 401 invalid credentials

### M4 Portal routes + notifications
- `app/notifications.py` - `PortalUpdateHub` (dedicated asyncpg connection listening on `portal_changes`, broadcast → WS subscribers)
- `app/routes/portals.py` - paginated `GET /portals`, `WS /portals/ws` (auth via session cookie, initial snapshot + refresh pushes), `POST /portals/{id}?action=` (409 BadAction, writes ActionLogEntry), `GET /portals/log`, `GET /portals/stats`. Router-level login dependency (HTTP routes only)

### M5 Admin routes
- `app/routes/admin.py` - superuser-only user CRUD: create (no superuser flag), list, delete (409 on superuser), set-password

### M6 Entrypoint + env
- `app/main.py` - lifespan (init_db → create_all → hub.start, hub.stop → dispose), CORS middleware (`BACKEND_URL`/`FRONTEND_URL` origins), router includes
- `.env.example` + README table: `BACKEND_URL`, `FRONTEND_URL`, `DEBUG`, `DATABASE_URL`

### Project scaffold
- Poetry-based backend in `backend/` (FastAPI, SQLAlchemy, asyncpg; python >=3.14)
- Dev tooling: black, ruff, mypy (strict), pytest, coverage, pre-commit hooks
- `.env.example` with POSTGRES user/password/db and BACKEND_PORT

### CI pipeline
- `.github/workflows/backend-ci.yml` - runs black, ruff, mypy, pytest on PR and push to master (backend/** only)
- `.github/workflows/backend-coverage.yml` - runs tests with coverage, prints report and uploads XML artifact (fail under 80)

### Docker setup
- `docker-compose.yml` - `postgres:18-alpine` (healthchecked, volume at `/var/lib/postgresql`, POSTGRES_* vars shared with backend via `${:-}` / `${:?}` interpolation) and `backend` service behind healthcheck
- `backend/Dockerfile` - 2-stage (build/deploy) on `python:3.14-alpine`, poetry pinned to 2.4.3, `poetry install --only main --no-root` into in-project venv copied to deploy stage, uvicorn `app.main:app`
- `docker-compose.override.yml.dev` (committed template) - copied to `docker-compose.override.yml` (gitignored, auto-loaded) to bind-mount `backend/app` and run uvicorn with `--reload`
- `BACKEND_PORT` envvar controls the host port for the backend container (default 8000)
