# Decisions

All architecture decisions are recorded here. Chronological, newest at the bottom.

## UTF
- All timestamps are stored and compared in UTC. DB datetime columns are timezone-aware (`DateTime(timezone=True)` / `timestamptz`). `last_update` uses `server_default=func.now()` only — it is touched **exclusively by committed actions** (the action route sets it), never by the simulator; `ActionLogEntry.timestamp` and `User.created_at` use `server_default=func.now()`.

## Portal semantics
- `closed` is a **derived** property: `expires_at <= now or is_closed`. It is exposed in `PortalSchema` as `closed`; the raw DB column stays `is_closed`.
- Risk factor is calculated as
  `(energy/100)*0.2 + (1 - stability/100)*0.2 + (0.1*c/(0.1*c+1))*0.3 + (1 - 0.04*TTL/(0.04*TTL+1))*0.3`,
  where `TTL = max((expires_at - now).total_seconds(), 0.0)` — clamped, expired portals never produce negative TTL.
- Danger levels: `<= 0.3` LOW, `<= 0.6` MEDIUM, `<= 0.85` HIGH, `> 0.85` CRITICAL.
- `STABILIZE` condition "stability below 0.5" is interpreted for the 0-100 int scale as `stability < 50`; stabilizing increases stability by a random value from `STABILITY_INCREASE_RAND_RANGE = (10, 30)`, capped at `100`.
- `DISMISS` (the UI's "leave open") **parks the portal at the bottom of every ordering** while a `dismissed_until` window (5 min) is active; it is rejected while the portal is closed and when the remaining TTL is ≤ 5 min («Нельзя отложить портал: до истечения менее 5 минут» — constant `DISMISS_MIN_TTL_SECONDS`). Re-dismissing simply extends the window. The parking is a pure ordering sink clause (`dismissed_until > now`), applied after the open-first clause in every `order_by` mode; closing/expiry ends it with no extra cleanup.
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
- Interactive docs (`/docs`, `/redoc`) and `openapi.json` are disabled when `DEBUG` is off (FastAPI constructor params `docs_url`/`redoc_url`/`openapi_url` set to `None`), so the API surface is not publicly discoverable in production.

## Testing
- Tests run against a real PostgreSQL in a `postgres:18-alpine` testcontainers container (per test session), not SQLite, to match the production dialect.
- Tests are fully async (`pytest-asyncio`, session-scoped event loop for tests and fixtures). HTTP is exercised through `httpx.AsyncClient` + `httpx.ASGITransport`; the app lifespan is not run, DB is initialized/disposed by session fixtures and truncated per test. The WebSocket auth-gate is covered by calling the endpoint directly with a mock websocket.

## Columns nullable
- `nullable` is set explicitly on every model column (`nullable=False` everywhere except `ActionLogEntry.user_id` which is `nullable=True`), even though SQLAlchemy 2.0 `Mapped[str]` annotations already imply non-nullable.

## Logging
- Project uses the built-in `logging` library. Format: `2026-03-02 15:00:18 [INFO] message` (`%(asctime)s [%(levelname)s] %(message)s`, `datefmt=%Y-%m-%d %H:%M:%S`), configured in `app/main.py`, level `DEBUG` when `DEBUG` is truthy.

## Initial superuser bootstrap
- `INITIAL_SUPERUSER_USERNAME` + `INITIAL_SUPERUSER_PASSWORD` (both or neither; validated against the shared length constants at settings load) create/reconcile a single initial superuser in the app lifespan, right after `create_all()`.
- If a superuser with a **different** name exists, it is deleted (login sessions cascade via FK, action log rows get `user_id` SET NULL). An existing superuser with the exact configured name is kept — only its password hash is replaced, and only when it no longer matches the configured `INITIAL_SUPERUSER_PASSWORD` (verified at startup).
- If a regular (non-superuser) user already holds the configured username, startup **fails fast** with a clear error instead of silently promoting or deleting the account (behavior chosen by user).
- Implementation lives in `app/bootstrap.py` (`ensure_initial_superuser`), wired into `app/main.py` lifespan.

## Portal list & action log: filters and ordering
- Portal list and log support server-side filtering and ordering; the same query params apply to the HTTP endpoints and their WebSocket mirror endpoints (both share `_portal_page` / `_action_log_page`).
- Portal list filters: `closed` (true/false), `danger_level` (LOW/MEDIUM/HIGH/CRITICAL), `has_observer`, `is_marked`, `search` (case-insensitive substring over name or destination world). Log filters: `action`, `portal_id`, `user_id`.
- `order_by` is a whitelist enum validated by FastAPI (`PortalOrder` / `LogOrder`): `risk` (default), `expires_at`, `creatures`, `name` for portals; `newest` (default) / `oldest` for the log. Unknown values return 422.
- Default portal ordering: open portals first (closed/expired sink below and keep their own relative order — risk and expiry estimates are meaningless for them, mirroring `/stats`), then **danger level DESC** (CRITICAL → LOW; ordered by a discrete rank, not the raw risk value), expires_at ASC, has_observer DESC, creatures_count DESC, `id ASC` as the final tiebreaker for stable pagination. Applies to every `order_by` mode (the `risk` mode's primary key is the danger level).
- Sorting/filtering by risk and danger level happens in SQL: the risk formula and the danger-level CASE are extracted into `_risk_expression(now)` / `_danger_bucket_expression(now)` (already used by `/stats`) plus `_danger_rank_expression(now)` for ordering, mirroring the Python `Portal.risk_factor` / `Portal.danger_level`.

## Portal info endpoint
- `GET /portals/{id}` returns a single portal (`PortalSchema`, same shape as list items) and 404s for unknown ids. The dynamic `/{id}` route is declared after the static `/log` and `/stats` routes so they are never captured by the int path param.

## Code review fixes (2026-09)
- **Username/Password field aliases**: `Username`/`Password` = `Annotated[str, Field(min/max_length ...)]` in `app/schemas.py` built from the shared length constants; used by `UserRegisterSchema`, `LoginSchema` and `PasswordChangeSchema` so the DB models and every schema validator can never drift apart.
- **Login timing equalization**: the login route runs an argon2 verification against a lazily-computed dummy hash when the username does not exist (`security.burn_password_verify_time`), so a missing username cannot be distinguished from a wrong password by response timing.
- **Login rate limit**: a dependency-free in-memory sliding-window limiter (`app/ratelimit.py`, `SlidingWindowRateLimiter`, 5 attempts / 60 s per client IP) throttles `POST /auth/login` (429). It is **disabled while `DEBUG` is on** — dev/test convenience, no state shared across workers in production (single-process backend assumption, at least one uvicorn worker).
- **`DISABLE_REGISTRATION`**: new env var; when truthy `POST /auth/register` returns 403. Documented in `.env.example` + README table.
- **Register / admin create-user race safety**: the pre-check SELECT is only a fast path; the INSERT → commit is wrapped in `IntegrityError` → rollback → 409, making concurrent duplicate registrations race-safe.
- **Password change revokes sessions**: new `POST /auth/password` (current user) deletes **all** the user's sessions except the current cookie's token (the user stays logged in); admin `POST /admin/users/{id}/set-password` deletes **all** of the target user's sessions.
- **WS connections no longer pin a pooled session**: the endpoint session is used only for the initial auth lookup and closed before `accept()`; each page snapshot opens its own short-lived session (`get_session_factory()()` context), so a long-lived socket cannot exhaust the connection pool.
- **Hub loop owns the initial snapshot**: `_hub_snapshot_loop` subscribes **before** rendering the initial page snapshot (an event landing in between cannot be missed), coalesces a burst of hub events into a single re-query, and keeps running through transient DB/send errors (logged) instead of dropping the subscriber. Client pings keep the socket alive; cancelled tasks are always awaited.
- **`UpdateHub` self-healing**: `start()` is idempotent (stops the previous supervisor first), `stop()` is robust (broadcasts a terminate signal, suppresses close/remove_listener errors, awaits the supervisor, safe to call repeatedly). A background supervisor watches the listener connection (asyncpg termination listener → `asyncio.Event`) and reconnects with exponential backoff (1 s → 30 s); on recovery it broadcasts a refresh event so stale WS clients re-query.
- **Risk formula single source of truth**: the formula weights/scales (`RISK_*`) and danger thresholds (`DANGER_*`) live in `app/constants.py`, referenced by the Python `models.risk_factor_for()` helper and by the SQL expressions in `routes/portals.py`, so the two cannot drift apart (the SQL must always mirror the Python formula).
- **`security.py` exception syntax**: `except (InvalidHashError, VerifyMismatchError)` (parenthesized) replaced the PEP-758-only 3.14 syntax so the module parses on all supported interpreters; covered by `test_security.py`.
- Login *NIT dismissed by user*: `POST /portals/{id}` keeps `action` as a query parameter — no change.

## Portal simulator (populator)
- A background task (`app/simulator.py::simulator_loop`) keeps the dashboard "alive": every `SIMULATOR_TICK_SECONDS` (10 s) it randomly tweaks the open portals and, with configurable probability, opens a new one so the table/WS feed keeps changing without manual seeding.
- Changeable values per tick (with `SIMULATOR_UPDATE_CHANCE = 0.5` per portal): `stability` ±`SIMULATOR_STABILITY_DELTA` (15) and `creatures_count` ±`SIMULATOR_CREATURES_DELTA` (5), both clamped to `0..100` (creatures also capped at `SIMULATOR_MAX_CREATURES = 100`). Closed/expired portals are never touched.
- A new portal opens each tick with `PORTAL_OPEN_CHANCE` (0..1, default `0.05`, parsed fail-fast at settings load); 0.05 per 10 s tick ≈ one portal per 3–4 minutes. New portals are fully random: name/world/energy/stability/creatures, `TTL` uniform in 30 s..30 min, unmarked, no observer, open.
- Names come from generators in the simulator: `world_name()` (syllables + ending) and `portal_name()` (adjective + noun, optional Roman-numeral suffix), validated to fit the shared `DESTINATION_WORLD_MAX_LENGTH` / `PORTAL_NAME_MAX_LENGTH`.
- Simulator updates/creations run in a single transaction and emit `pg_notify` on `portal_changes` **inside that transaction** — same rule as portal actions, so WS subscribers only refresh on a durable commit. (Implements the "Future ideas" note about background task producers.)
- The simulator is started/cancelled in the app lifespan **in every mode, including `DEBUG`**, so development builds get the same live portal activity as production. Tests/CI never see a background writer: they set the `DISABLE_SIMULATOR` envvar (default off, parsed like `DISABLE_REGISTRATION` with `_as_bool`) in `conftest.py`, and the dedicated lifespan tests construct `Settings` explicitly to verify startup with both `DEBUG` on and off.
- Review fixes (2026-09): the simulator picks its per-tick mutation candidates with a plain read, then locks only those ids with `SELECT ... FOR UPDATE SKIP LOCKED`. The lock keeps a concurrent portal action from being overwritten by the tick's stale flush (the tick only modifies rows it locked itself); `SKIP LOCKED` skips a candidate currently being acted on (returned to on a later tick). Contention is directional: actions on non-candidate portals never wait for the tick, while an action on a candidate the tick locked first waits only for that short transaction. Between the candidate-picking read and the locking read, SQLAlchemy would return identity-map-cached (stale) instances, so phase 1 selects candidate **ids only** and phase 2 uses `.execution_options(populate_existing=True)` to always mutate fresh locked values — a candidate action committed between the phases is never overwritten. Subscriber refresh queues are bounded (`maxsize=1`, broadcasts skipped while a refresh is pending) so a slow client cannot accumulate unbounded events. `UpdateHub.stop()` cancels the supervisor so a reconnect backoff sleep never delays shutdown. `DISABLE_REGISTRATION` is passed through `docker-compose.yml` like other settings.

## Future ideas (not yet implemented)
- Background tasks that update portal data should also produce `portal_changes` notifications (the trigger-based producer is a later alternative to in-route `pg_notify`).

## Frontend: lint/format pipeline — oxlint + Prettier (2026-09)
- **Linter: oxlint** (`^1.83.0`). ESLint was rejected earlier because TypeScript 7 ships no JS compiler API and typescript-eslint peers on TS <6.1.0. Config `.oxlintrc.json` (JSON auto-discovered; the experimental `oxlint.config.mjs` was not picked up by auto-discovery): plugins `react`, categories `correctness`+`suspicious` error and `perf` warn; the whole ESLint `style` category stays off — Prettier owns style.
- Per-project rule tuning: `react/react-in-jsx-scope` off (Vite automatic JSX runtime), `react/jsx-max-depth` off (default max 2 is unfit for antd forms), `react/no-unstable-nested-components` `["error", { allowAsProps: true }]` (antd render-props like `Progress format`).
- **Formatter: Prettier** (3.9.8, already a devDep). `.prettierrc.json` = `{ "printWidth": 100 }` (project already used double quotes + semicolons + trailing commas, Prettier defaults); `.prettierignore` = `node_modules`, `dist`, `coverage`, `mockups`, `package-lock.json`, `*.tsbuildinfo`.
- **Strictness**: `lint` runs `oxlint --deny-warnings .` (warnings fail), so the codebase is kept at 0 warnings 0 errors (117 rules). First pass fixed real findings: MSW callback `({ request })` shadowing the imported `request` helper (renamed to `req`), `await` in a test loop (switched to `Promise.all`), and the search-draft sync effect in `PortalFiltersBar` (rebuilt with React's recommended key-remount pattern instead of a `setState`-in-effect).
- **Coverage**: `@vitest/coverage-v8`, provider v8, reporters `text`+`lcov` (`coverage/lcov.info` uploads to CI), excludes `src/test/**`, `src/main.tsx`, `src/vite-env.d.ts`. Baseline: 76.55 % statements / 76.71 % lines across 52 tests. No hard `fail_under` gate (mirrors the backend coverage workflow).
- **Pre-commit**: two frontend hooks in the existing `local` repo — `prettier (frontend)` (`npm --prefix frontend run format`) and `oxlint (frontend)` (`npm --prefix frontend run lint:fix`), both `files: ^frontend/` + `pass_filenames: false`, exactly mirroring the backend hook pattern.
- **CI**: `.github/workflows/frontend-ci.yml` (matrix: `format:check`, `lint`, `typecheck`, `build` + a `tests (vitest)` job; `actions/setup-node@v4` with Node 24 — parity with `frontend/Dockerfile` — and npm cache) and `.github/workflows/frontend-coverage.yml` (test+coverage, uploads `frontend/coverage/lcov.info` artifact), both gated on `frontend/**` changes like the backend workflows.
- npm scripts added: `lint`, `lint:fix`, `format`, `format:check`, `coverage`.

## Frontend: marked portals — badge only (2026-09)
- Decided with the user: marked portals get **no ordering change** from the frontend. Neither a client-side "hide" nor "sink to end" (both would require presentation logic that must not exist client-side); the backend's `is_marked` filter/ordering params are already surfaceable if the user wants them later.
- The frontend shows a prominent «Отмечено» badge on marked portal rows (`components/MarkedTag.tsx`, orange Tag with the MARK action's `FlagFilled` icon + tooltip, «Отмечено» capitalized). Replaced the previous tiny lowercase "отмечен" tag; it remains the only client-side treatment of marked portals.

## Frontend stack
- The frontend is a **React SPA scaffolded with Vite**, TypeScript in strict mode, with **no SSR/SSG** (no Next.js). Rationale: the app is an authenticated dashboard where everything interesting arrives live in the browser via WebSockets, so server-side rendering buys nothing and would only add machinery (RSC, cookie forwarding, "use client" everywhere) without payoff.
- The FastAPI backend stays the single source of truth. The frontend consumes JSON HTTP + the two snapshot WebSocket endpoints (`/portals/ws`, `/portals/log/ws`); each WS push is a complete page snapshot and replaces the previous server state atomically.
- Auth stays cookie-based in the browser: the backend's httpOnly session cookie is handled by the browser automatically (Secure unless `DEBUG`); the frontend never stores the token itself. Across subdomains this works because the two subdomains share a site (SameSite=Lax cookies are sent same-site).
- `frontend/` file layout is still to be agreed with the user at scaffold time (structure changes are coordinated with the user).
- Frontend work happens on branch `frontend/react-vite`; the API/WS endpoints are no longer "backend-only" — see the frontend decision above.

## Frontend design choices (confirmed with user)
- UI components: **Ant Design** (Table, Tag, Modal, Form, message/notification).
- UI language: **Russian labels, English code** (identifiers, comments, types in English; all user-visible strings in Russian, consistent with the backend's Russian `BadAction` messages).
- Server state: **TanStack Query** for REST (portals list, log, stats, auth); live updates via a small custom WebSocket hook that replaces the page snapshot on every push — the backend sends complete snapshots, so state is swapped atomically, never merged.
- Routing: **React Router** (v7).
- Package manager: **npm**.
- Serving: the backend is hosted on a **separate subdomain** from the frontend. The frontend receives the backend origin via `BACKEND_URL`, passed through docker compose in **both development and production**, and baked into the build for all API/WS calls (compose maps it to a Vite-exposed env var, e.g. `VITE_BACKEND_URL`). CORS on the backend already allows the frontend origin via `FRONTEND_URL`.
- Local development runs the frontend with **auto-reload** through docker compose overrides (bind-mounted workdir + Vite dev server with HMR), mirroring the backend's `docker-compose.override.yml.dev` → `docker-compose.override.yml` pattern.

## Frontend theme: «Угли» (embers) — chosen design
- Chosen from six AntD mockups (`frontend/mockups/`). Dark sidebar theme, fiery orange accent:
  - AntD tokens: `darkAlgorithm`; seed `colorPrimary #ff6a00`, `colorBgLayout #0e0905`, `colorBgContainer #171008`, `colorBgElevated #1e1409`, `borderRadius 10`.
  - Chrome CSS variables: sidebar `linear-gradient(180deg, #150d05, #0a0603)`, header `#120b07`, 3px topline gradient `#ff4d00 → #ff8c00 → #ffc46b`, logo gradient `#ffad33 → #ff4d00` with ember glow, live dot `#5ee08a`.
  - Page background: `#0e0905` with two faint radial ember glows.
- **Translucent surfaces over the spark field (user-directed follow-up)**: the spark layer spans the **whole shell** (sidebar included), and the main UI surfaces are **transparent** (plain rgba, no blur): sidebar gradient `rgba(21,13,5,0.42)→rgba(10,6,3,0.42)`, header `rgba(18,11,7,0.4)`, cards/table/inputs via `colorBgContainer: rgba(23,16,8,0.45)`. Dialogue surfaces (`colorBgElevated` — modal, dropdowns, messages) are **fully opaque** (`#1e1409`): a matte-glass modal experiment (`backdrop-filter` blur over a darker mask) read as a solid panel anyway, so the user asked to drop it — dialogs stay solid/opaque for readability while the page behind them stays translucent.
- Portal detail opens in a centered AntD **Modal** (720px, actions 3 per row), not a drawer (user request).
- Stat-card icons are colored semantically: total = theme accent, open = green `#52c41a`, closed = gray `#8c8c8c`, marked = orange `#fa8c16`, observer = cyan `#13c2c2`, avg risk = live danger color.
- The mockup stays in `frontend/mockups/` (embers only) as the design reference; the real app re-implements the look with AntD tokens + CSS variables, not mockup code.

## Frontend file layout (agreed at scaffold time)
- `frontend/src/`:
  - `main.tsx` (entry, providers), `App.tsx` (router config + guards)
  - `theme.ts` — AntD dark theme from the embers palette
  - `api/` — `types.ts` (TS mirrors of backend schemas/enums), `client.ts` (fetch wrapper, `credentials: "include"`, base from `VITE_BACKEND_URL`), `auth.ts`, `portals.ts`, `ws.ts` (WebSocket URL builder)
  - `hooks/` — `useSnapshotWs.ts` (atomic snapshot replacement + reconnect), `useAuth.ts` (me/login/logout/register), TanStack query hooks for portals/log/stats
  - `components/` — `AppLayout.tsx` (sidebar + header + userbox + topline), `StatCards.tsx`, `PortalTable.tsx`, `PortalModal.tsx`, shared bits
  - `pages/` — `LoginPage.tsx`, `PortalListPage.tsx`, `LogPage.tsx`, `StatsPage.tsx`, `AdminPage.tsx`
- Dev server runs Vite on port 80 inside the container (host `FRONTEND_PORT`, default 3000) so the prod/dev host port never differs; `VITE_BACKEND_URL` is baked at build (prod) or injected at runtime (dev override).
- Frontend tests: Vitest + React Testing Library + MSW for API mocking (added at test milestone).

## Frontend: Ant Design v5 → v6 (migrated 2026-09)
- `antd ^6.6.4` + `@ant-design/icons ^6.3.4` installed; `@ant-design/v5-patch-for-react-19` removed — v6 supports React 19 natively (React >= 18 required; we are on React 19.3).
- Deprecated APIs migrated: `Alert.message` → `title` (4 call sites), `Table size="middle"` → `"medium"` (portal table, log, admin users), `Divider` title alignment `orientation="left"` → `titlePlacement="left"` (v6 `orientation` now means the divider's horizontal/vertical direction), and the no-longer-needed `marginInlineEnd: 0` override dropped from `DangerTag` (v6 removed the default trailing Tag margin).
- Embers theme tokens in `theme.ts` compile unchanged; `app.css` contains no internal `.ant-*` DOM selectors, so the v6 DOM reshuffle needed no style adjustments.
- Post-migration gates green: `npm run typecheck`, 43/43 Vitest tests, `npm run build` (antd bundle ~36 kB smaller).

## Frontend: filters & ordering (2026-09)
- Portal table and action log controls map 1:1 onto backend query params — portals: `closed`, `danger_level`, `has_observer`, `is_marked`, `search`, `order_by`; log: `action`, `order_by`. No client-side filtering/sorting; the backend stays the single source of truth.
- `portalListQuery` / `actionLogQuery` (`api/endpoints.ts`) are shared by the REST call and the snapshot WS URL, so both channels always request the identical filtered page; cache query keys carry the full params object, so two filter states never share a cache entry, and the snapshot WS replaces data under the key it was requested with.
- Filter changes re-point the snapshot WS (the hook reconnects on URL change) and reset pagination to page 1. The search box applies on submit (Enter/button) via a local draft — no request per keystroke. The log filter lists all 8 actions (`ALL_ACTIONS`); the modal-specific `ACTION_ORDER` is unchanged.

## Frontend: `DISABLE_REGISTRATION` gating (2026-09)
- Wired exactly like `BACKEND_URL`/`VITE_BACKEND_URL`: both Dockerfile stages (build + dev) map `DISABLE_REGISTRATION` → `VITE_DISABLE_REGISTRATION` (build arg baked in prod, runtime env in the dev override — both the `.dev` template and the local copy updated).
- `RegisterPage` reads it lazily (`env.ts` `isRegistrationDisabled`, truthy = not empty/`0`/`false`) and renders the backend's own 403 message «Регистрация отключена» instead of the form; the registration API is never attempted. Documented in the frontend README envvars table; the root README row now covers the frontend behaviour too.

## Backend: close auto-recalls the observer (2026-09)
- `Portal.close()` sets `has_observer = False` before closing: a closed portal can never keep an observer inside, so the operator does not need a separate RECALL first. The action log still records a single `CLOSE` entry. Model test `test_action_rules` rewritten to assert the auto-recall; `test_close_recalls_observer` covers the route.

## Backend: unauthenticated `GET /health` (2026-09)
- Liveness endpoint for external probes/health-checks: no auth, no DB access, always returns `{"status": "ok"}` (200) regardless of `DEBUG`. Declared inside the app factory after the router includes; documented in the route's `summary`/`description`. Nothing in the app calls it — it exists for the orchestrator.

## Backend: `last_update` = action-only (2026-09)
- `onupdate=func.now()` dropped from the `last_update` column; `POST /portals/{id}` sets `portal.last_update = utc_now()` after a successful action, inside the same commit as the `ActionLogEntry`. The simulator never touches `last_update` — «обновлено» now reflects operator activity only (previously every simulator tick bumped it via `onupdate`). `test_action_bumps_last_update_but_simulation_does_not` pins both sides.

## Frontend: per-metric deltas «изменение с прошлого снапшота» (2026-09)
- Decided with the user (explicit override of the "no client-side presentation logic" rule for this feature): the frontend renders **deltas between consecutive snapshots** of the same query scope, colored by what the change means for the lab. The backend stays the source of truth — the delta is pure presentation over snapshots it already sends.
- Metric polarities: stability/marked/with-observer → increase is good (green); energy/creatures/risk/avg-risk/HIGH+CRITICAL counts → increase is bad (red); total/open/closed/MEDIUM counts → neutral (embers amber). Arrows ▲/▼ via AntD icons; zero deltas render nothing.
- Baseline hook `useSnapshotBaseline(scope, current)` (new `hooks/useSnapshotBaseline.ts`): the first snapshot in a scope produces no delta; a newer snapshot replaces the baseline only once displayed (delta persists between refreshes, no one-render flash); scope change (page/filter) resets; `keepPreviousData` placeholders are excluded via `isPlaceholderData` at the call sites. Wired into the portal table (energy/stability/creatures/risk), the top stat cards (all six) and the stats page (danger distribution counts + avg-risk circle).

## Frontend: merged observer toggle in the modal (2026-09)
- The modal's observer entry is a single toggle resolved from `portal.has_observer` (send when empty, recall when present) — the same pattern as MARK/UNMARK. `RECALL_OBSERVER` was removed from `ACTION_ORDER` but stays in `ALL_ACTIONS` (log filter) and `ACTION_META` (log labels/tags). The label refreshes live from the snapshot, so a CLOSE (which auto-recalls the observer) flips the button back to «Отправить наблюдателя».

## Frontend: table action column + reset filters (2026-09)
- The row button was renamed «Открыть» → «Детали» (it opens the detail modal, it does not open a portal), and a thin fixed amber divider now separates the scrollable data columns from the fixed action column (`onCell`/`onHeaderCell` → `.portal-table-actions-sep`, header and body cells both carry the border).
- Root-cause fix for reset: `DEFAULT_PORTAL_FILTERS` / `DEFAULT_LOG_FILTERS` now list the optional keys **explicitly as `undefined`**, so `onReset` spreads the defaults over the previous state and truly clears `closed`/`danger_level`/`has_observer`/`is_marked`/`action` instead of silently keeping stale values. New reset tests assert the request params lose the filter after «Сбросить».

## Frontend: AI-WORKLOG tab (2026-09)
- New `/worklog` route + nav tab «Журнал разработки» (FileTextOutlined) rendering `AI-WORKLOG.md` with `react-markdown` (new dependency). The markdown is bundled via Vite's `?raw` import and styled for the dark embers theme (headings, code fences, blockquotes, tables).
- The worklog is committed **twice**: repo-root `AI-WORKLOG.md` (canonical) and `frontend/src/worklog/AI-WORKLOG.md` (bundled copy). The Vite build context is `frontend/` only, so the root file cannot be COPYed into the image; the copy must be kept in sync when the root file changes.

## Frontend: worklog served at runtime, not bundled (2026-09, supersedes the decision above)
- The `?raw`-bundled copy and `frontend/src/worklog/` are gone. `WorklogPage` fetches `/AI-WORKLOG.md` from its own origin; prod nginx (`/usr/share/nginx/html`) and the dev Vite server (`public/`) both bind-mount the repo-root `AI-WORKLOG.md` — no symlinks, works on every platform. MSW test handler `*/AI-WORKLOG.md` serves a deterministic fixture.
- Code fences render through `rehype-highlight` (`{ detect: true, ignoreMissing: true }`) + the `highlight.js` github-dark theme. Only labeled fences and auto-detectable snippets get token spans — short unlabeled fragments stay plain (highlight.js auto-detection is deliberately conservative; `dockerfile` is not in lowlight's common subset, a labeled ` ```Dockerfile ` fence is left as-is). The embers `pre` keeps its background/padding via a dedicated `.worklog-markdown pre code.hljs` rule.

## Frontend: risk-delta magnitude threshold (2026-09)
- `DeltaIndicator` gained a `minMagnitude` prop (default 0). The three `toFixed(2)`-formatted sites — portal-table risk, stat-card avg-risk, stats-page avg-risk — pass `minMagnitude={0.01}`, so float jitter below 1 % renders no badge. Pure presentation; the backend is untouched.

## Frontend: modal disables actions on closed portals (2026-09)
- All action buttons except MARK/UNMARK are disabled when `portal.closed` (a UX hint only: the backend remains the source of truth and would answer 409 anyway; its reason is still shown verbatim for other invalid actions). Modal caption and the "actions never disabled client-side" stance in the READMEs updated, with a closed-portal test.

## Docker: unprivileged runtime users (2026-09)
- Both Dockerfiles drop root at runtime: the backend runs uvicorn as the `app` user (alpine `addgroup -S app && adduser -S app -G app`); the frontend dev stage runs Vite as `node` (uid 1000 — matches the host user, so the bind-mounted `./frontend` stays fully owned, and `chown -R node:node /app` makes the `node_modules` named volume writable); the prod `serve` stage runs nginx as `nginx` (html chowned; pid + all temp paths moved from `/var` to `/tmp` so an unprivileged master can start).
- The dev Vite container binds low port 80 via `cap_add: NET_BIND_SERVICE` instead of root. Verified on the running stack: containers run as `app`/`node`/`nginx`, `/health` 200, index and `/AI-WORKLOG.md` 200 (sha-identical to the repo-root file), `populate.sh` works as `app`, logs free of permission errors; the prod `serve` stage was additionally built and smoke-tested standalone.

## Backend: demo-data seeding (2026-09)
- New `backend/populate.py` (image path `/app/populate.py`) builds **fresh** `Portal` instances per call (`_build_demo_portals()`) and is idempotent — when portals already exist it prints a note and skips. `populate.sh` / `populate.ps1` run `docker compose exec backend /app/.venv/bin/python populate.py`; per the user's explicit decision no poetry is installed in the container — the deploy venv ships python only. Covered by `backend/tests/test_populate.py`.

## Frontend E2E: Playwright against an isolated compose stack (2026-09)
- **Tool**: Playwright (TS-native, fits the strict-TS + Vite/React/WS stack) over Cypress. The suite lives at `frontend/e2e/` with `@playwright/test` as a frontend devDependency; `playwright.config.ts` in `frontend/`.
- **Target**: the **prod compose build** (nginx + baked `BACKEND_URL`), not the dev HMR stack — the suite is a released artifact test.
- **Stack isolation** (user-chosen): a **standalone `docker-compose.e2e.yml`** (repo root), own `name: portals-e2e` — own network, `e2e_postgres_data` volume, published ports `8010` (backend) / `3010` (frontend) that never collide with the dev stack on `8000/3000`. Every value is hardcoded (no `${...}`), so the repo `.env` cannot leak in; an explicit `-f` file means the dev `docker-compose.override.yml` is never auto-merged (verified: `docker compose config` with an alternate `-f` does not load the override).
- **Seeding/determinism**: `backend/populate.py` + `DISABLE_SIMULATOR=1` in the base e2e file. `resetPortals()` (truncate + populate + freeze open portals' `expires_at` ~2 h out) re-baselines before every spec file that asserts portal/stat/log state, so the short demo TTLs (3 min) never expire mid-run.
- **Live smoke (user-chosen: "one live-update smoke test with the sim on")**: `docker-compose.e2e.live.yml` flips only `DISABLE_SIMULATOR: "0"` for the backend via a compose `environment`-map merge (`-f base -f live up -d --no-build --force-recreate backend`) — the simulator's settings are read once at startup and are not runtime-toggleable. The suite's trailing `live` project asserts delta badges appear (impossible with the sim off: the 30 s REST poll only shifts risk by < 0.01, below the badge threshold).
- **Ordering**: single worker, `fullyParallel: false` (one shared DB). Progression designed file-by-file (admin, auth, log, portals, stats, worklog, `zz-actions`) so later files can safely mutate; `zz-actions` runs serial and last. No retries — portal actions (mark/unmark/close) are non-idempotent.

## Frontend: WebGPU fire panels + FLIP move animations (2026-09, branch `feature/webgpu-fire-and-move-anim`)
- Chosen with the user: side panels render with a **WebGPU wrapper library** (rather than hand-rolled raw WebGPU): **TypeGPU** (`typegpu@0.12.x`, "a thin layer between JS and WebGPU/WGSL that improves DX"), JS-first WGSL programs (typed-binary buffer layouts, tinyest-driven WGSL). Imported via dynamic `import("typegpu")` so browsers without WebGPU never download/execute the library and the main bundle stays lean (Vite code-split chunk). `@webgpu/types` is a devDependency used as a **scoped** `import type { ... }` — not added to the tsconfig `types` array, so the ambient `@types/*` auto-inclusion and DOM lib are untouched.
- **Fallback-first**: the shader runs only when `navigator.gpu` is present AND `requestAdapter()` resolves, wrapped in try/catch — any absence/failure drops to a 2D-canvas ember fallback, so the panels are never blank. Both paths are decorative (`aria-hidden`, `pointer-events: none`, behind content, zero layout shift).
- **Reduced motion**: under `prefers-reduced-motion: reduce` both paths collapse to a static gradient — no rAF loop, no WAAPI animations. Playwright's headless chromium exposes no usable WebGPU adapter by default, so the e2e suite always exercises the fallback; the shader path is smoke-tested manually in a real browser.
- **Move animations — FLIP on row key**: portal rows animate between old/new positions across a snapshot swap with First-Last-Invert-Play: a `useFlip` hook captures `getBoundingClientRect` per `portal.id` after each committed render (before paint), then plays `translateY(old − new)` → 0 via WAAPI when a row moved. Skipped on initial mount (no baseline) and under reduced motion. Scoped to `PortalTable` only — the action log reorders on nearly every event, so FLIP there would be noise, not signal.
- **Testing**: e2e stays deterministic — a smoke assertion checks the panels render in *whichever* path is active (fallback in headless); no pixel/RGB assertions. The FLIP delta math and the feature-detection gate are covered by vitest (fake `navigator.gpu`); the WGSL program itself is not unit-tested.
- **Follow-up (user-directed, post-merge)**: the effect was reworked from two side fire strips into a **full-background spark-particle field** — the shader covers the whole `.app-main` area (rarefied spark layers drifting up through shared turbulence noise, opaque base), the 2D-canvas fallback mirrors it with rising additive ember sparks, and reduced motion keeps the static gradient (now full-area). Modal UX: `PortalModal` stays mounted with a controlled `open` so antd plays the closing animation too (unmounting on close cut it short), and a successful action feeds the returned portal straight back into the modal's copy (`onPortalUpdated`) so a CLOSE greys out every action immediately without waiting on the next snapshot. FLIP eased to 400 ms.

## Frontend: page transitions — bouncy per-block entrance (2026-09)
- User request: animate the switch between pages so the page feels alive. Chosen mechanism: a **CSS-only entrance** replayed by remounting the routed subtree on route change — `AppLayout` wraps `<Outlet />` (and the header title/subtitle block) in a `key={location.pathname}` container, so every navigation (and the first load) replays the animation. No animation library, no route-level transition state, nothing to manage when a page updates in place.
- Per the request, each element pops up with its own **bouncy overshoot** and a **slight jitter offset**: every top-level block of the page animates `translateY`/`scale`/`rotate` from a per-`nth-child` `--rise`/`--jitter` trajectory to identity with `cubic-bezier(0.34, 1.56, 0.64, 1)` (0.42 s, `backwards` fill so a block stays hidden until its own delayed start), and the delays (0/45/90/135/180 ms) stagger the sequence so elements settle one after another.
- The `.page-enter` wrapper is `display: contents` — it only exists to remount and animate; `.app-content` keeps flex-gapping the page blocks directly, so page layout is byte-identical to before the feature.
- **Reduced motion**: under `prefers-reduced-motion: reduce` every rule is `animation: none` → pages appear instantly. The Playwright suite pins `reducedMotion: "reduce"`, so all 38 e2e specs stay deterministic (no animation ever overlaps an assertion); the animated path was verified separately in headless Chromium (computed styles: staggered `page-pop`, `backwards` fill, wrapper `display: contents`, `animation-name: none` under reduce).
