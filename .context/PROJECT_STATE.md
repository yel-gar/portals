# Project state

## Current status
Backend is complete (M1–M7 + follow-ups): magic portals laboratory overseer dashboard API — auth, portal routes with commit-safe actions, two snapshot WebSockets (action log + portal list), stats, admin, plus the merged backend PR: `websockets` dependency (WS endpoints actually serve now), portal simulator with SKIP LOCKED concurrency guard, filters + ordering for portal list and action log, `GET /portals/{id}`, `DISABLE_REGISTRATION`, prompt hub shutdown / bounded subscriber queues, docs closed outside DEBUG. 113 tests, coverage 99 %, mypy/ruff/black clean. Backend runs in docker with seeded dev data.

Frontend on branch `frontend/react-vite` (merged with master): real React SPA implemented — auth (cookie only), live portal table + 720px action modal, action log, stats, admin users — embers theme, 43 Vitest tests, `frontend/README.md`. Live-WS verification against the real backend is now possible (the dependency fix landed); dev containers need a rebuild to pick up the new backend image.

## Roadmap (frontend, branch `frontend/react-vite`)
1. **AntD v5 → v6** — done: `antd ^6.6.4` + icons `^6.3.4`, React-19 patch dropped, deprecated APIs migrated (Alert `title`, Table `medium`, Divider `titlePlacement`), embers tokens intact. ✅ (see DECISIONS.md)
2. **Linter/formatter/coverage/pre-commit** — prettier + coverage provider installed (`c284243`); ESLint blocked by TypeScript 7 → linter choice pending (see DECISIONS.md).
3. **Filters/ordering UI** — done: server-driven controls on both pages (portals: search/closed/danger-level/observer/mark + sort; log: action + sort). REST and snapshot-WS share one query builder so both fetch the identical filtered page; query keys carry the full params (distinct filter states never share a cache entry); filter changes reset to page 1; search applies on submit. ✅ (see DECISIONS.md)
4. **`DISABLE_REGISTRATION` frontend part** — done: `VITE_DISABLE_REGISTRATION` wired like `BACKEND_URL` (Dockerfile build/dev stages, compose build args, dev override runtime env both template and local copy); the Register page shows the backend's «Регистрация отключена» instead of the form and never attempts the API call. ✅ (see DECISIONS.md)
5. **Marked-portal behavior** — dismissed portals temporarily hide or sink to the end of the list; spec TBD.

## Current plan (frontend implementation, branch `frontend/react-vite`)
1. **Prepare** — mockup server shut down; `frontend/mockups/` trimmed to embers theme only. ✅
2. **Dockerfile** — multi-stage `frontend/Dockerfile`: deps → build (VITE_BACKEND_URL baked) → dev (Vite HMR) → serve (nginx, single worker, SPA fallback). ✅
3. **Compose** — `frontend` service (build arg `BACKEND_URL`, `${FRONTEND_PORT:-3000}:80`); `BACKEND_URL`/`FRONTEND_URL`/`DEBUG` now forwarded to the `backend` service (CORS + dev cookies). ✅
4. **Dev overrides** — `frontend` dev service in `docker-compose.override.yml.dev` (target `dev`, bind-mount `./frontend`, named `node_modules` volume, runtime `VITE_BACKEND_URL`), copied to `docker-compose.override.yml`. ✅
5. **Copy template** — done. ✅
6. **Backend up + OpenAPI** — compose up, `/openapi.json` exported, HTTP routes smoke-tested, dev DB seeded with 11 portals. ✅
7. **Frontend implementation** — SPA committed (`aa6ae30`): api layer, snapshot-WS hook, auth, portals table + 720px action modal, log, stats, admin users, RequireAuth/RequireSuperuser, embers theme. ✅
8. **Tests + docs** — Vitest + Testing Library + MSW (43 tests: format, ApiError/request, useSnapshotWs incl. backoff/4401/pre-accept-1006, PortalModal, PortalsPage live-snapshot atomic replace, Login/Register, AdminUsers), `frontend/README.md`, envvars table refresh. ✅ (live-WS browser check against the rebuilt backend — pending container rebuild with the merged image)

## Concurrency & ops review fixes (latest batch, backend)
- **Simulator ↔ action race (P1)**: `simulate_once()` picks the portals it may update with a plain read, then locks **only those candidate ids** with `SELECT ... FOR UPDATE SKIP LOCKED`. The locks keep the tick's flush from overwriting a concurrently committed action (it only modifies rows it locked itself); `SKIP LOCKED` skips a candidate being acted on right now (it can be updated on a later tick). The guarantee is directional: an action on a **non-candidate** portal never contends with the tick (its row is never locked, even while the tick holds candidate locks pre-commit), while an action on a candidate the tick locked first waits only for that short transaction. To close the gap *between* the phases (reviewer `9a99419`), phase 1 reads candidate **ids only** (no ORM instances cached in the session's identity map) and phase 2 re-fetches with `.execution_options(populate_existing=True)` — otherwise a candidate action committed between the reads would still be overwritten by the tick's stale cached instance. `test_simulate_once_skips_action_locked_portal` proves the tick returns promptly when its only candidate is action-locked and leaves it untouched; `test_simulate_once_locks_only_candidate_portals` synchronously proves an action on a non-candidate completes while the tick holds its candidate lock; `test_simulate_once_refreshes_candidate_changed_between_phases` proves a candidate action committed between the phases is read fresh (75, not a stale 45).
- **DISABLE_REGISTRATION not deployed (P1)**: `docker-compose.yml` now passes `DISABLE_REGISTRATION: ${DISABLE_REGISTRATION:-0}` to the backend service (verified via `docker compose config`); previously the setting only worked outside docker.
- **Hub shutdown can stall 30 s (P2)**: `UpdateHub.stop()` now cancels the supervisor task, so a pending reconnect backoff sleep never delays app shutdown; `test_hub_stop_interrupts_reconnect_backoff` stops the hub mid-backoff (base delay patched to 60 s) and asserts stop returns in < 5 s.
- **Unbounded subscriber queues (P2)**: subscriber queues are `asyncio.Queue(maxsize=1)`; `broadcast()` skips enqueueing when a refresh is already pending — a slow client or slow snapshot query can no longer accumulate arbitrarily many refresh events. `test_hub_broadcast_coalesces_pending_refresh` covers the coalesce-then-refill cycle.

## Code review fixes (2026-09, backend)
Full review is persisted in `.context/REVIEW.md` (CRITICAL/MAJOR/MINOR/NIT findings, commits `c2197eb..6ed37f0`). All CRITICAL + MAJOR findings fixed:
- **C1/M1/M8 — WS fixes**: `_hub_snapshot_loop` subscribes before the initial snapshot, coalesces bursts, handles send/query errors (logs, keeps running), cleans up cancelled tasks; handlers authenticate with a short-lived session and open a fresh session per snapshot (no pool pinning).
- **M2** — `Username`/`Password` Annotated aliases (shared length constants) used in all auth schemas.
- **M3** — login timing equalizer (`burn_password_verify_time` on unknown username); `security.py` exception syntax fixed and covered by `test_security.py`.
- **M4** — `app/ratelimit.py` (in-memory sliding window, 5/60 s per IP, disabled in DEBUG) throttles login → 429; `DISABLE_REGISTRATION` disables `/auth/register` → 403; both documented in `.env.example` + README.
- **M5** — `register`/`create_user` commits wrapped in `IntegrityError` → 409 (race-safe; concurrent-duplicate tests added).
- **M6** — new `POST /auth/password` revokes all-but-current session; admin set-password revokes all of the target user's sessions.
- **M7** — `UpdateHub`: idempotent `start()`, robust `stop()`, supervised reconnection with exponential backoff + subscriber wake-up on recovery (real reconnect test via `connection.terminate()`).
- **M9** — flaky `test_list_portals_filters` de-flaked: Critical portal is expired at creation (TTL clamps to 0 → risk stays >0.9, closed/CRITICAL buckets time-invariant).
- **M10** — unknown-token tests: HTTP `/auth/me` 401 and WS 4401 for both endpoints (covers `deps.py` unknown-session branch).
- Risk formula weights/thresholds extracted to `app/constants.py` and referenced by both the Python helper and the SQL expressions.
- `POST /portals/{id}` `action` query param kept (NIT dismissed by user).

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

### Frontend kickoff (branch `frontend/react-vite`)
- Stack confirmed with user: React + Vite + TypeScript (strict), SPA without SSR. Recorded in `DECISIONS.md` and a new "Frontend info" section in `AGENTS.md`.
- Working-layout decision: frontend branch lives in a git worktree at `../portals-fe` so backend (`master`, main directory) and frontend work proceed in parallel without checkout conflicts.
- Worktree gotcha: git worktrees do **not** share poetry virtualenvs (`.venv` is gitignored and poetry keys the cache venv to the checkout path). Each new worktree needs its own `poetry -C backend install --no-root` before black/ruff/mypy/pytest work; plain `poetry install` fails because the backend is not an installable root package.
- Rebasing the frontend branch onto `master` picked up `4078735` (`black`/`ruff` now run only on `^backend/.*\.py$`) — doc-only commits no longer invoke the backend hooks.
- Design choices confirmed with user and recorded: **Ant Design**, **TanStack Query + snapshot WS hook**, **React Router**, **npm**, **Russian UI / English code**; backend on a separate subdomain with `BACKEND_URL` from compose baked into the frontend build; docker overrides with auto-reload (Vite HMR) for local dev.
- Next: scaffold `frontend/` (layout to be agreed with user first), then add the compose service and dev override.

### Portal list & action log: filters + ordering (merged backend PR)
- `PortalOrder` / `LogOrder` enums in `app/models.py` drive the `order_by` whitelist: `risk` (default), `expires_at`, `creatures`, `name` for portals; `newest` (default) / `oldest` for the log. Unknown values → 422.
- Portal filters: `closed`, `danger_level`, `has_observer`, `is_marked`, `search` (case-insensitive name/world substring). Log filters: `action`, `portal_id`, `user_id`.
- Risk/danger SQL expressions extracted from `/stats` into `_risk_expression(now)` / `_danger_bucket_expression(now)` (shared with `/stats`);
- Default portal ordering: risk DESC, expires_at ASC, has_observer DESC, creatures_count DESC, `id ASC` tiebreaker.
- All query params mirrored on the WS endpoints (`WS /portals/ws`, `WS /portals/log/ws`) via the shared `_portal_page` / `_action_log_page`.
- `GET /portals/{id}` — individual portal info (`PortalSchema`), 404 for unknown id; declared after `/log` and `/stats` so the int path param never shadows them.
- Tests: 16 new (default ordering, order_by variants, tie-breakers, each portal filter, combined filters, 422 invalid order_by, log filters/ordering, WS-with-filter, portal info incl. 404/422/401). Coverage 99%; mypy/ruff/black clean.

### Portal simulator + route reorder (backend)
- New `app/simulator.py` — background portal populator:
  - `simulator_loop()` ticks every `SIMULATOR_TICK_SECONDS` (10 s), started/cancelled in the app lifespan; skipped while `DEBUG` is truthy (mirrors the login rate limiter so tests never have a background writer). Per-tick failures are logged and the loop keeps running; shutdown cancels the task and awaits it.
  - Each tick picks every open (non-closed, not-expired) portal and with `SIMULATOR_UPDATE_CHANCE` (0.5) nudges `stability` by ±`SIMULATOR_STABILITY_DELTA` (15) and `creatures_count` by ±`SIMULATOR_CREATURES_DELTA` (5), both clamped (`0..100`, creatures also capped at `SIMULATOR_MAX_CREATURES`).
  - With `settings.portal_open_chance` (`PORTAL_OPEN_CHANCE` env var, default `SIMULATOR_OPEN_CHANCE_DEFAULT = 0.05` ≈ one portal per 3–4 min) a brand-new portal appears: fully random name/world/energy/stability/creatures, `TTL` uniform in `SIMULATOR_PORTAL_TTL_MIN_SECONDS..MAX` (30 s..30 min), unmarked, no observer, open.
  - Name generators: `world_name()` (syllable composition + ending, e.g. «Альбарион») and `portal_name()` (adjective + noun, 25 % chance of a Roman numeral suffix, e.g. «Шепчущий Коридор IV»), both within the shared `DESTINATION_WORLD_MAX_LENGTH` / `PORTAL_NAME_MAX_LENGTH`.
  - `simulate_once()` emits `pg_notify` for every changed/spawned portal **inside the same transaction** (new `notify_portal_changed` helper extracted to `app/notifications.py`), so WS subscribers are only woken on a durable commit — the same rule as portal actions.
- `PORTAL_OPEN_CHANCE` added to `app/config.py` (`_as_float` parser: unset→default, non-numeric or out-of-`0..1` at settings load → fail fast), `docker-compose.yml`, `.env.example` and the README envvars table.
- `routes/portals.py` reordered: `POST /{portal_id}` and `GET /{portal_id}` are now adjacent, declared **after** the static `/log` and `/stats` routes so the int path param never shadows them (this was verified by the previously-passing /log, /stats tests which caught the intermediate wrong order).
- Tests: `tests/test_simulator.py` (name shapes, new-portal values, delta/clamping, update+spawn, spawn-skip, closed-portal skip, loop ticks, loop survives tick errors, loop logs changed ids), `tests/test_config.py` (+`_as_float` cases), `tests/test_main.py` (lifespan starts/stops the simulator with `DEBUG` off). 106 pass, coverage 99%.

### Docs closed outside DEBUG (backend)
- `app/main.py` construction moved into a `create_app()` factory (matches the documented "FastAPI app factory" structure): interactive docs and the OpenAPI schema are switched off in production via the constructor params — `docs_url`/`redoc_url`/`openapi_url` are `None` when `settings.debug` is falsy, `/docs`/`/redoc`/`/openapi.json` otherwise.
- Tests: `test_docs_served_in_debug` (all three return 200) and `test_docs_closed_outside_debug` (all three return 404) build a fresh app per mode via `create_app()` with monkeypatched settings. 108 pass, coverage 99%.

### Initial superuser bootstrap + STABILIZE rework
- `INITIAL_SUPERUSER_USERNAME` / `INITIAL_SUPERUSER_PASSWORD` env pair (both or none, lengths validated via shared constants): `app/config.py` `_read_initial_superuser` → `Settings.initial_superuser: tuple[str, str] | None`.
- New `app/bootstrap.py::ensure_initial_superuser` — runs in the lifespan right after `create_all()`; deletes superusers with a different name (sessions CASCADE, log rows SET NULL), keeps a same-name superuser without resetting its password, fails fast if a regular user holds the configured name.
- `docker-compose.yml` passes both vars to the backend service; `.env.example` + README envvars table updated.
- `Portal.stabilize` now adds a random 10-30 to stability (`STABILITY_INCREASE_RAND_RANGE`, new constant) capped at 100, instead of jumping straight to 100; model test updated.
- Tests: `tests/test_bootstrap.py` (create, delete-different-name incl. cascade/FK-NULL checks, keep-same-name+password, fail-fast), `tests/test_config.py` (+5 env parsing cases), `tests/test_main.py` (lifespan creates superuser).

### Action log WebSocket + commit safety
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
