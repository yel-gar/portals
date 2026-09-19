# Project state

## Current status
Backend is complete (M1-M7: foundation, schemas/deps, auth, portal routes + two snapshot WebSockets + commit-safe actions, admin, entrypoint/env, tests at 99% coverage) and running in docker with seeded dev data. Frontend work on branch `frontend/react-vite`: the mockups were narrowed to the chosen **«Угли» (embers)** theme, the real React SPA is implemented (auth, live portal table + action modal, action log, stats, admin users), and its test suite + docs are in place. Live verification pending the backend WebSocket dependency fix (see notice below) — REST flows are verified against the live backend.

> ⚠️ **Backend WS notice (not fixable from this worktree):** the runtime backend image lacks a WebSocket protocol library — `backend/pyproject.toml` declares no `websockets`/`wsproto`, so uvicorn's `AutoWebSocketsProtocol` is `None` and `/portals/ws`, `/portals/log/ws` answer `405 Method Not Allowed` on upgrade. The backend owner is fixing it. The frontend is already resilient: `useSnapshotWs` treats a close before the handshake completes as a possible session expiry (backend rejects a dead cookie with HTTP 403 → browser close 1006, not 4401) and re-checks auth, while reconnecting with capped backoff.

## Current plan (frontend implementation, branch `frontend/react-vite`)
1. **Prepare** — mockup server shut down; `frontend/mockups/` trimmed to embers theme only. ✅
2. **Dockerfile** — multi-stage `frontend/Dockerfile`: deps → build (VITE_BACKEND_URL baked) → dev (Vite HMR) → serve (nginx, single worker, SPA fallback). ✅
3. **Compose** — `frontend` service (build arg `BACKEND_URL`, `${FRONTEND_PORT:-3000}:80`); `BACKEND_URL`/`FRONTEND_URL`/`DEBUG` now forwarded to the `backend` service (CORS + dev cookies). ✅
4. **Dev overrides** — `frontend` dev service in `docker-compose.override.yml.dev` (target `dev`, bind-mount `./frontend`, named `node_modules` volume, runtime `VITE_BACKEND_URL`), copied to `docker-compose.override.yml`. ✅
5. **Copy template** — done. ✅
6. **Backend up + OpenAPI** — compose up, `/openapi.json` exported, HTTP routes smoke-tested, dev DB seeded with 11 portals. ✅
7. **Frontend implementation** — SPA committed (`aa6ae30`): api layer, snapshot-WS hook, auth, portals table + 720px action modal, log, stats, admin users, RequireAuth/RequireSuperuser, embers theme. ✅
8. **Tests + docs** — Vitest + Testing Library + MSW (43 tests: format, ApiError/request, useSnapshotWs incl. backoff/4401/pre-accept-1006, PortalModal, PortalsPage live-snapshot atomic replace, Login/Register, AdminUsers), `frontend/README.md`, envvars table refresh. ✅ (backend WS dep + live-WS browser check pending upstream fix)

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
8. **M8 Frontend stack + scaffold** — stack chosen (React + Vite), documented in AGENTS.md/DECISIONS.md; design consultation (UI kit, state, router, layout, serving); `frontend/` scaffolded. Backend milestones 1-7 are complete.
9. **Final** — pre-commit --all-files, full pytest run, doc refresh.

## Completed milestones

### Frontend SPA implementation (branch `frontend/react-vite`)
- Real React SPA committed (`aa6ae30`): React 19 + Vite 8 + TS strict, AntD v5 embers theme, TanStack Query, React Router v7; Russian UI / English code.
- API layer: `types.ts` mirrors backend pydantic schemas; `client.ts` fetch wrapper (`credentials: "include"`, `ApiError` with FastAPI `detail` extraction incl. 422 arrays, `websocketUrl` helper); `endpoints.ts` typed auth/portals/admin calls.
- Live updates: `useSnapshotWs` → `useLiveSnapshot` writes each WS frame into the same query key as REST (atomic replacement); REST refetch fallback (30 s portals/log, 20 s stats); reconnect with exponential backoff capped at 15 s; 4401 (post-accept) and close-before-open (pre-accept HTTP-403 → 1006) both trigger a `me` re-check so an expired session routes to login; malformed frames ignored.
- Pages/components: AuthShell (login/register), AppLayout (sidebar + header live badge + refresh), PortalTable (server pagination, click row → modal), PortalModal (720px, 7 actions 3/row, never disabled client-side, 409/422 shown verbatim, MARK/UNMARK toggle), LogPage, StatsPage (danger distribution as share of `open`), AdminUsersPage (+ create/delete/set-password), RequireAuth/RequireSuperuser, NotFound; live status context provider.
- Auth via httpOnly cookie only; no token storage; `useMe` treats 401 as logged-out (null), login/register seed the `me` cache, logout clears all caches.
- Previously recorded decisions respected: no client-side action availability, no client-side search/sort (backend pagination only), embers palette, centered 720px modal.
- Known frontend bug fixed during testing: `formatTimeLeft` compared hours against a millisecond constant and never reached its days branch.
- Tests + docs: Vitest + Testing Library + MSW, 43 tests across 8 files (format, ApiError/request, useSnapshotWs, PortalModal, PortalsPage live WS atomic replace, Login/Register, AdminUsers); `frontend/README.md`; absolute MSW handler URLs and FakeWebSocket (jsdom lacks WebSocket/matchMedia) documented. `npm run typecheck` and `npm run build` green.
- Backend WS dependency gap recorded (see Current status notice): needs `websockets` in backend deps; live-WS browser check pending that fix.

### Frontend kickoff (branch `frontend/react-vite`)
- Stack confirmed with user: React + Vite + TypeScript (strict), SPA without SSR. Recorded in `DECISIONS.md` and a new "Frontend info" section in `AGENTS.md`.
- Working-layout decision: frontend branch lives in a git worktree at `../portals-fe` so backend (`master`, main directory) and frontend work proceed in parallel without checkout conflicts.
- Worktree gotcha: git worktrees do **not** share poetry virtualenvs (`.venv` is gitignored and poetry keys the cache venv to the checkout path). Each new worktree needs its own `poetry -C backend install --no-root` before black/ruff/mypy/pytest work; plain `poetry install` fails because the backend is not an installable root package.
- Rebasing the frontend branch onto `master` picked up `4078735` (`black`/`ruff` now run only on `^backend/.*\.py$`) — doc-only commits no longer invoke the backend hooks.
- Design choices confirmed with user and recorded: **Ant Design**, **TanStack Query + snapshot WS hook**, **React Router**, **npm**, **Russian UI / English code**; backend on a separate subdomain with `BACKEND_URL` from compose baked into the frontend build; docker overrides with auto-reload (Vite HMR) for local dev.
- Next: scaffold `frontend/` (layout to be agreed with user first), then add the compose service and dev override.

### Initial superuser bootstrap + STABILIZE rework (latest batch)
- `INITIAL_SUPERUSER_USERNAME` / `INITIAL_SUPERUSER_PASSWORD` env pair (both or none, lengths validated via shared constants): `app/config.py` `_read_initial_superuser` → `Settings.initial_superuser: tuple[str, str] | None`.
- New `app/bootstrap.py::ensure_initial_superuser` — runs in the lifespan right after `create_all()`; deletes superusers with a different name (sessions CASCADE, log rows SET NULL), keeps a same-name superuser without resetting its password, fails fast if a regular user holds the configured name.
- `docker-compose.yml` passes both vars to the backend service; `.env.example` + README envvars table updated.
- `Portal.stabilize` now adds a random 10-30 to stability (`STABILITY_INCREASE_RAND_RANGE`, new constant) capped at 100, instead of jumping straight to 100; model test updated.
- Tests: `tests/test_bootstrap.py` (create, delete-different-name incl. cascade/FK-NULL checks, keep-same-name+password, fail-fast), `tests/test_config.py` (+5 env parsing cases), `tests/test_main.py` (lifespan creates superuser).

### Action log WebSocket + commit safety (latest batch)
- `Portal.warn_creatures` now sets `creatures_count` to `0` after validating the warning can be issued.
- `app/notifications.py` generalized: `PortalUpdateHub` → `UpdateHub(channel)`, two module-level instances — `portal_update_hub` (`portal_changes`) and `action_log_hub` (`action_log_changes`); `subscriber_count` property; added `test_hub_idempotent_stop`, broadcast/subscribe tests, NOTIFY tests for both channels.
- `app/routes/portals.py`:
  - `WS /portals/log/ws` — `action_log_updates` streams live log page snapshots (same auth + hub pattern as `WS /portals/ws`).
  - Shared `_hub_snapshot_loop` helper (subscribe → requery snapshot on event → disconnect cleanup) reused by both WS endpoints.
  - `POST /portals/{id}` is commit-safe: portal row locked with `SELECT ... FOR UPDATE` (serializes concurrent actions on one portal), and `_notify_action_committed` runs `pg_notify` for both channels inside the action transaction — notifications are delivered only on durable commit, never for rejected/rolled-back actions.
  - `GET /portals/log` and the log WS share `_action_log_page`.
- `app/main.py` lifespan starts/stops both hubs.
- Tests: 18 new/updated tests (WS loop + endpoints, hub producers, commit-safety rollback check, config/db guards, lifespan, expired session, admin 404, model branches). Coverage 93% → 99% (`app/deps.py:25` — broken-FK branch — intentionally not covered).

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
