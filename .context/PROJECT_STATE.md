# Project state

## Current status
Backend is scaffolded and fully configured for tooling, CI and docker deployment. Application code is being implemented: magic portals laboratory overseer dashboard API.

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
