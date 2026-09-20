# Project state

## Current status
Backend is complete (M1–M7 + follow-ups): magic portals laboratory overseer dashboard API — auth, portal routes with commit-safe actions, two snapshot WebSockets (action log + portal list), stats, admin, plus the merged backend PR: `websockets` dependency (WS endpoints actually serve now), portal simulator with SKIP LOCKED concurrency guard, filters + ordering for portal list and action log, `GET /portals/{id}`, `DISABLE_REGISTRATION`, prompt hub shutdown / bounded subscriber queues, docs closed outside DEBUG. 113 tests, coverage 99 %, mypy/ruff/black clean. Backend runs in docker with seeded dev data. Latest change: default portal ordering now sorts by the discrete **danger level** (CRITICAL first) instead of the raw risk value — within a level the earlier expiry wins; documented in DECISIONS.md.

Frontend on branch `frontend/react-vite` (merged with master): real React SPA implemented — auth (cookie only), live portal table + 720px action modal, action log, stats, admin users — embers theme, 52 Vitest tests, `frontend/README.md`. Full lint/format/coverage pipeline now active (oxlint + Prettier, pre-commit hooks, CI workflows). Live-WS verification against the real backend is still pending a dev-container rebuild with the merged backend image.

Latest batch (9 tasks, committed on master): backend — CLOSE auto-recalls the observer, unauthenticated `GET /health`, DISMISS parks the portal (5 min window, rejected when TTL ≤ 5 min), `last_update` only on actions; frontend — reset-filters root-cause fix, per-metric snapshot deltas (table, stat cards, stats page), table rename «Открыть»→«Детали» + fixed divider column, merged observer toggle, AI-WORKLOG tab (`react-markdown` bundling). Backend 126 tests / 99 %; frontend 100 Vitest tests, tsc/oxlint/prettier/build green.

## Roadmap (frontend, branch `frontend/react-vite`)
1. **AntD v5 → v6** — done: `antd ^6.6.4` + icons `^6.3.4`, React-19 patch dropped, deprecated APIs migrated (Alert `title`, Table `medium`, Divider `titlePlacement`), embers tokens intact. ✅ (see DECISIONS.md)
2. **Linter/formatter/coverage/pre-commit** — done: oxlint (react plugin, correctness/suspicious error + perf warn, 0 warnings 0 errors) + Prettier (printWidth 100), `--deny-warnings` strictness, coverage v8 (text + lcov, 76.7 % lines, no hard gate — mirrors backend), pre-commit hooks (format + lint:fix, `^frontend/`), CI workflows `frontend-ci.yml` + `frontend-coverage.yml` (Node 24 parity). ✅ (see DECISIONS.md)
3. **Filters/ordering UI** — done: server-driven controls on both pages (portals: search/closed/danger-level/observer/mark + sort; log: action + sort). REST and snapshot-WS share one query builder so both fetch the identical filtered page; query keys carry the full params (distinct filter states never share a cache entry); filter changes reset to page 1; search applies on submit. ✅ (see DECISIONS.md)
4. **`DISABLE_REGISTRATION` frontend part** — done: `VITE_DISABLE_REGISTRATION` wired like `BACKEND_URL` (Dockerfile build/dev stages, compose build args, dev override runtime env both template and local copy); the Register page shows the backend's «Регистрация отключена» instead of the form and never attempts the API call. ✅ (see DECISIONS.md)
5. **Marked-portal behavior** — done: **badge only** (prominent «Отмечено» tag with flag icon in the portal table, shown for `is_marked` portals; no client-side hiding/reordering). ✅ (see DECISIONS.md)

## Current plan (frontend implementation, branch `frontend/react-vite`)
1. **Prepare** — mockup server shut down; `frontend/mockups/` trimmed to embers theme only. ✅
2. **Dockerfile** — multi-stage `frontend/Dockerfile`: deps → build (VITE_BACKEND_URL baked) → dev (Vite HMR) → serve (nginx, single worker, SPA fallback). ✅
3. **Compose** — `frontend` service (build arg `BACKEND_URL`, `${FRONTEND_PORT:-3000}:80`); `BACKEND_URL`/`FRONTEND_URL`/`DEBUG` now forwarded to the `backend` service (CORS + dev cookies). ✅
4. **Dev overrides** — `frontend` dev service in `docker-compose.override.yml.dev` (target `dev`, bind-mount `./frontend`, named `node_modules` volume, runtime `VITE_BACKEND_URL`), copied to `docker-compose.override.yml`. ✅
5. **Copy template** — done. ✅
6. **Backend up + OpenAPI** — compose up, `/openapi.json` exported, HTTP routes smoke-tested, dev DB seeded with 11 portals. ✅
7. **Frontend implementation** — SPA committed (`aa6ae30`): api layer, snapshot-WS hook, auth, portals table + 720px action modal, log, stats, admin users, RequireAuth/RequireSuperuser, embers theme. ✅
8. **Tests + docs** — Vitest + Testing Library + MSW (43 tests: format, ApiError/request, useSnapshotWs incl. backoff/4401/pre-accept-1006, PortalModal, PortalsPage live-snapshot atomic replace, Login/Register, AdminUsers), `frontend/README.md`, envvars table refresh. ✅ (live-WS browser check against the rebuilt backend — pending container rebuild with the merged image)

## Current plan (frontend, branch `feature/webgpu-fire-and-move-anim`)
Decision recorded in DECISIONS.md (chosen with the user): TypeGPU wrapper over raw WebGPU for the fiery side panels, FLIP move animations on the portal table, all fallback-first so headless/e2e stays deterministic.
1. **Decision commit** — record the approach in DECISIONS.md + this plan. ✅
2. **Deps** — `typegpu@0.12.5` (runtime, dynamic-imported) + `@webgpu/types@0.1.74` + `unplugin-typegpu@0.12.3` (dev, vite plugin; manualChunks carve-out keeps TypeGPU out of the vendor chunk — it ships in the lazy `wgpuFire` chunk only). ✅
3. **Fire panels** — `src/components/fire/`: `FirePanels` strips inside `.app-main` (`z-index: -1`, `pointer-events: none`, `aria-hidden`, `data-fire-backend` probe); WebGPU path via TypeGPU `fullScreenTriangle` fragment (value-noise fBm flame, per-frame `time` uniform, `premultiplied` alpha, dpr-aware ResizeObserver, shared adapter/root with `rootUsers` refcount) — a resolution failure at draw rolls the panel back to the ember canvas; reduced-motion → static gradient (no rAF at all). ✅
4. **FLIP** — `src/hooks/useFlip.ts`: pure `computeFlipSteps` (per-key delta of old−new top) + WAAPI `translateY(delta)→0` in one `useLayoutEffect` scoped to `PortalTable` (`data-flip-key` = `portal.id`), skipped on first render + reduced motion. ✅
5. **Gates + e2e** — tsc/oxlint/prettier/vitest (116)/build green; full 38-test Playwright suite green with `use.reducedMotion: "reduce"` emulated; `portals.spec.ts` asserts `.fire-panels` visible. Manual headless smoke with SwiftShader flags: WebGPU path active with zero console/page errors and warm flame pixels read back from a screenshot (static + ember fallbacks also re-verified clean). ✅
6. **Review + merge** — merged to master after green. ✅

### Fire side panels + FLIP move animations (branch `feature/webgpu-fire-and-move-anim`, 2026-09)
Decision `0969403` in DECISIONS.md. All gates green (tsc/oxlint/prettier, 116 Vitest, build; 38-test Playwright suite in 1.3m).
- **Fire panels** (`src/components/fire/`, new): decorative side strips in `.app-main` (absolute, `z-index: -1`, `pointer-events: none`, `aria-hidden`, widths `clamp(96px, 11vw, 176px)`). Backend chain: reduced-motion users get a **static gradient** with no animation loop at all; otherwise **WebGPU** via TypeGPU (`typegpu@0.12.5`, `unplugin-typegpu` compiles TS-first WGSL at build; lazy `wgpuFire` chunk is excluded from the eager vendor chunk via `manualChunks`); init failure (or adapter-less headless) rolls each panel back to a **2D-canvas ember layer**. `data-fire-backend` attr drives the probe. Pure gates extracted (`chooseFireBackend`, `flicker`, `tongueHeight`) + unit tested.
- **Shader**: `fullScreenTriangle` vertex; fragment = 4-octave value-noise fBm shaped into flame tongues (`smoothstep` silhouettes, orange→hot core, border/top edge fades, premultiplied alpha); `time` f32 uniform written per rAF; one adapter/device root shared by both panels with a `rootUsers` refcount (destroy at 0). Shader fns use `std.add/mul/sub` for vector math (TypeGPU's infix-operator symbols aren't part of tsc's view of the types) — and `let pos = vec2f(seed)` copying, because WGSL references can't seed a `let` binding (caught by the headless smoke, fixed).
- **FLIP** (`src/hooks/useFlip.ts`, new): `computeFlipSteps(before, after)` → per-key `oldTop − newTop` deltas (pure, unit-tested); `useFlip` measures positions in a single `useLayoutEffect` after commit and plays WAAPI `translateY(delta)→0` (240 ms cubic-bezier) on moved rows; skipped on first render and under reduced motion; scoped to `PortalTable` (`data-flip-key` from `onRow`), the log page explicitly excluded.
- **E2E determinism**: `playwright.config.ts` emulates `reducedMotion: "reduce"` → the suite always takes the static-gradient path (no GPU, no rAF); `portals.spec.ts` asserts `.fire-panels` is visible. Manual headless smoke (separate scripts, not committed): with SwiftShader GPU flags both panels resolve to `data-fire-backend="webgpu"`, run ~no console/page errors, and a screenshot pixel-probe reads back warm flame pixels; without flags, `navigator.gpu` exists but the adapter is null → clean ember rollback.

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

### Playwright E2E suite (master, 2026-09)
Full cross-stack test suite at `frontend/e2e/` (decision + full rationale in DECISIONS.md):
- **Isolated stack** `docker-compose.e2e.yml` (project `portals-e2e`): own network/volume/ports (8010/3010), hardcoded env (no `.env` interpolation, no dev-override auto-merge), prod-like build (baked `http://localhost:8010`). `docker-compose.e2e.live.yml` flips only `DISABLE_SIMULATOR: "0"` for the backend via compose `environment`-merge.
- **Infra**: `frontend/playwright.config.ts` (workers 1, `chromium` + trailing `live` projects), `tsconfig.e2e.json` referenced from the root tsconfig so e2e is typechecked by `tsc -b`; global-setup (up --build → health → seed) + global-teardown (`down -v`, `E2E_KEEP_STACK=1` opt-out); `resetPortals()` truncate + `populate.py` + 2 h freeze of open portals' `expires_at` (demo TTLs are 3 min — nothing expires mid-run).
- **Specs** (7 deterministic + 1 live): auth (register auto-login, logout/relogin, wrong password, 403 admin, redirect), admin (superuser CRUD via INITIAL_SUPERUSER bootstrap), log (mark/unmark roundtrip → filter → reset), portals (7 rows + statuses, search, closed/danger/observer/marked filters, reset, name sort), stats (7/6/1 cards), worklog (AI-WORKLOG.md rendered with hljs), `zz-actions` (serial: mark/unmark, close + disabled actions, observer toggle, closed portal, log entry), `live` (sim on → WS delta badges appear; impossible with sim off).
- vitest excludes `e2e/**`; `.gitignore`/`.prettierignore` cover playwright artifacts; new `E2E_KEEP_STACK` in `.env.example` + README envvars table; root + frontend README get an E2E section; CI workflow `.github/workflows/e2e-ci.yml` (npm ci → playwright install --with-deps chromium → full suite, report/test-results artifacts).

### E2E coverage: full 14-scenario checklist (master, 2026-09)
The user's 14-scenario checklist closed the remaining gaps (all 14 now handled, suite 23 → **38 tests** — 37 chromium + 1 live — green in ~1.5 m):
- **auth.spec.ts** +4: login with a non-existent username (same 401 message as wrong password), login with 200-char username+password (backend 422 pydantic message shown verbatim), register with empty fields («Введите имя пользователя»/«Введите пароль», no request), register with 200-char fields (client-side length rules block submit).
- **new `bulk.spec.ts`** +5 (volume/empty states, file order-safe — every other spec re-seeds in its own beforeAll): empty dashboard («Всего: 0», antd Empty), empty stats (zeros + avg risk `0.00`, backend `avg(...) or 0.0`), 10000 portals («Всего: 10000», «1–20 из 10000», 20 rows — bulk `INSERT…generate_series`), empty log, 100000 log rows (render + filter «Снять отметку» → exactly 12500 → reset). New helpers: `wipePortals()`, `seedBulkPortals(n)`, `seedBulkLogs(n)` (rows cycle all 8 actions so a filter count is deterministic).
- **zz-actions.spec.ts** +6: warn creatures with observer (Альфа), warn without observer → 409 «Нет наблюдателя…» (Бета), «оставить открытым» (Зета), stabilize success (Бета «12%» disappears), close with creatures → 409 (Гамма), stabilize a stable portal → 409 (Альфа).
- Empty-state assertions target `.ant-empty-description` (antd's Empty image carries a duplicate «Нет данных» `<title>` → strict-mode clash).

### Nine UX/data tasks (master, 2026-09)
Backend (all gates green: black/ruff/mypy clean, 126 tests, coverage 99 %):
- **CLOSE auto-recalls the observer**: `Portal.close()` sets `has_observer = False` before closing (a closed portal can never keep an observer inside); the log still records one `CLOSE` entry. New model test + `test_close_recalls_observer`.
- **`GET /health`**: unauthenticated liveness endpoint (no DB access, `{"status": "ok"}` regardless of `DEBUG`), declared in the app factory; `test_health_endpoint` parametrized over debug on/off.
- **DISMISS parks the portal**: new `dismissed_until` timestamptz column; `dismiss()` sets it to now + `DISMISS_DURATION_SECONDS` (5 min) and rejects when TTL ≤ `DISMISS_MIN_TTL_SECONDS` (5 min) with «Нельзя отложить портал: до истечения менее 5 минут» (409). Ordering has a `dismissed_sinks` clause after open-first in **every** `order_by` mode; `dismissed_until` added to `PortalSchema` and to the exact field-set assertion. Tests: model dismiss semantics, API park, urgent 409, sink in all four orderings + window expiry.
- **`last_update` action-only**: `onupdate` dropped; `execute_action` sets it after a successful action; the simulator never bumps it. `test_action_bumps_last_update_but_simulation_does_not` pins both sides.

Frontend (gates green: 100 Vitest tests, tsc/oxlint/prettier/build):
- **Reset-filters root cause**: `DEFAULT_PORTAL_FILTERS`/`DEFAULT_LOG_FILTERS` now list optional keys explicitly as `undefined`, so «Сбросить» truly clears `closed`/`danger_level`/`has_observer`/`is_marked`/`action`. New reset tests assert the request params lose the filter.
- **Per-metric deltas**: `useSnapshotBaseline` hook (per-scope baseline, placeholder-safe) + `DeltaIndicator` (▲/▼, green/red/embers polarity) wired into the portal table (energy/stability/creatures/risk), the six stat cards and the stats page (danger distribution + avg-risk circle). Tests: hook semantics, table deltas over a WS frame, StatCards deltas.
- **Table action column**: «Открыть» → «Детали», plus a fixed 1px amber divider between the scrollable data columns and the action column (header + body cells).
- **Merged observer toggle**: modal resolves SEND/RECALL from `portal.has_observer` (like MARK/UNMARK); `RECALL_OBSERVER` removed from `ACTION_ORDER` but kept in the log filter. Tests: label flip per state, live flip when the portal closes over the socket.
- **AI-WORKLOG tab**: `react-markdown` dependency; worklog bundled copy at `frontend/src/worklog/AI-WORKLOG.md` (`?raw` import — Vite build context is `frontend/` only, keep in sync with the root file); new `/worklog` route, nav tab «Журнал разработки» (FileTextOutlined), PAGE_META entry, dark-theme markdown CSS. WorklogPage tests render real headings and code blocks. All decisions recorded in DECISIONS.md.

### Seven dev-mode/UX tasks + Docker hardening (master, 2026-09)
Backend (gates green; 128 tests, coverage 99 %):
- **Demo-data seeding**: idempotent `backend/populate.py` (fresh instances per call, skips when portals exist) + `populate.sh`/`populate.ps1` wrappers running `/app/.venv/bin/python populate.py` in the container — no poetry installed (user decision) — with `backend/tests/test_populate.py` (idempotency proven on the live stack: 7 rows seeded, «пропущено» on rerun).
- **Docker hardening**: backend image drops root — uvicorn runs as the `app` user; frontend dev runs Vite as `node` (uid 1000 == host uid, `chown -R node:node /app` + `cap_add: NET_BIND_SERVICE` for port 80), prod runs nginx as `nginx` (pid/temp paths → `/tmp`). Verified end-to-end on the dev stack (non-root `id`, `/health` 200, index + `/AI-WORKLOG.md` 200, `./populate.sh` OK, no permission errors in logs) and the prod `serve` stage built and smoke-tested standalone.

Frontend (gates green: 105 Vitest tests, tsc/oxlint/prettier/build):
- **Worklog at runtime, not bundled**: `WorklogPage` fetches `/AI-WORKLOG.md` (loading skeleton + retryable error Alert); prod nginx and dev Vite bind-mount the repo-root `AI-WORKLOG.md` (sha-identical in dev); the `?raw` copy and `frontend/src/worklog/` deleted. Fences render with `rehype-highlight` (`detect + ignoreMissing`) + github-dark; unit tests assert real `<h1>`s, `.hljs` token spans and the error state.
- **Risk-delta threshold**: `DeltaIndicator.minMagnitude` (default 0) hides |delta| < 0.01 at the table-risk / stat-card-avg-risk / stats-page-avg-risk sites. Tests: +0.004 hidden, +0.01 shown (table + cards).
- **Closed-portal modal**: every action except MARK/UNMARK is disabled on `portal.closed` (UX hint; backend 409s stay verbatim); caption + README stance updated, closed-portal test added.

### Frontend SPA implementation (branch `frontend/react-vite`)
- Real React SPA committed (`aa6ae30`): React 19 + Vite 8 + TS strict, AntD v5 embers theme, TanStack Query, React Router v7; Russian UI / English code.
- API layer: `types.ts` mirrors backend pydantic schemas; `client.ts` fetch wrapper (`credentials: "include"`, `ApiError` with FastAPI `detail` extraction incl. 422 arrays, `websocketUrl` helper); `endpoints.ts` typed auth/portals/admin calls.
- Live updates: `useSnapshotWs` → `useLiveSnapshot` writes each WS frame into the same query key as REST (atomic replacement); REST refetch fallback (30 s portals/log, 20 s stats); reconnect with exponential backoff capped at 15 s; 4401 (post-accept) and close-before-open (pre-accept HTTP-403 → 1006) both trigger a `me` re-check so an expired session routes to login; malformed frames ignored.
- Pages/components: AuthShell (login/register), AppLayout (sidebar + header live badge + refresh), PortalTable (server pagination, click row → modal), PortalModal (720px, 7 actions 3/row, never disabled client-side, 409/422 shown verbatim, MARK/UNMARK toggle), LogPage, StatsPage (danger distribution as share of `open`), AdminUsersPage (+ create/delete/set-password), RequireAuth/RequireSuperuser, NotFound; live status context provider.
- Auth via httpOnly cookie only; no token storage; `useMe` treats 401 as logged-out (null), login/register seed the `me` cache, logout clears all caches.
- Previously recorded decisions respected: no client-side action availability, no client-side search/sort (backend pagination only), embers palette, centered 720px modal.
- Known frontend bug fixed during testing: `formatTimeLeft` compared hours against a millisecond constant and never reached its days branch.
- Tests + docs: Vitest + Testing Library + MSW, 43 tests across 8 files (format, ApiError/request, useSnapshotWs, PortalModal, PortalsPage live WS atomic replace, Login/Register, AdminUsers); `frontend/README.md`; absolute MSW handler URLs and FakeWebSocket (jsdom lacks WebSocket/matchMedia) documented. `npm run typecheck` and `npm run build` green.

### Frontend pipeline: oxlint + Prettier + coverage + hooks + CI (branch `frontend/react-vite`)
- Linter choice confirmed with user: **oxlint** (ESLint blocked by TypeScript 7 — no JS compiler API, typescript-eslint peers <6.1.0). Config `.oxlintrc.json`: react plugin; correctness/suspicious error, perf warn; ESLint `style` off (Prettier owns style); rules tuned: `react-in-jsx-scope` off (automatic JSX runtime), `jsx-max-depth` off, `no-unstable-nested-components` with `allowAsProps` (antd render-props). `--deny-warnings` → 0 findings across 117 rules.
- First pass fixed real findings: MSW `({ request })` → `({ request: req })` (shadowed the imported `request` helper), test-loop `await` → `Promise.all`, and `PortalFiltersBar` search draft rebuilt with the key-remount pattern (no `setState`-in-effect).
- Prettier `.prettierrc.json` `printWidth: 100` (double quotes/semis/trailing commas = defaults); `.prettierignore` excludes `node_modules`, `dist`, `coverage`, `mockups`, `package-lock.json`, `*.tsbuildinfo`; whole codebase formatted once.
- Coverage: v8 provider, `text` + `lcov` reporters, `src/test/**`/`main.tsx`/`vite-env.d.ts` excluded; baseline 76.55 % statements / 76.71 % lines, 52 tests; no hard gate (mirrors backend coverage workflow).
- Pre-commit: `prettier (frontend)` (`npm --prefix frontend run format`) + `oxlint (frontend)` (`lint:fix`), `files: ^frontend/`, `pass_filenames: false` — identical pattern to the backend hooks.
- CI: `frontend-ci.yml` (matrix format/lint/typecheck/build + tests job) and `frontend-coverage.yml` (lcov artifact upload), Node 24 via `setup-node@v4` with npm cache (Dockerfile parity), both gated on `frontend/**`.

### Frontend: marked-portal badge (branch `frontend/react-vite`)
- Per the "badge only" decision: new `components/MarkedTag.tsx` — orange antd Tag with the MARK action's `FlagFilled` icon, «Отмечено» capitalized, tooltip. Replaced the old tiny lowercase «отмечен» tag (v5-era, fontSize 11) in the portal table name cell; no client-side hiding/reordering (backend stays single source of truth).
- Test: `PortalsPage` — the badge renders inside the marked portal's row («Портал Бета», `is_marked: true`) and is absent from an unmarked row («Портал Альфа»). 53/53 tests, lint/typecheck/prettier green.

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
  - `simulator_loop()` ticks every `SIMULATOR_TICK_SECONDS` (10 s), started/cancelled in the app lifespan **in every mode, including `DEBUG`** (dev builds get the same live activity as production). Automated environments opt out with `DISABLE_SIMULATOR` (default off; tests set it in `conftest.py` so they never have a background writer). Per-tick failures are logged and the loop keeps running; shutdown cancels the task and awaits it.
  - Each tick picks every open (non-closed, not-expired) portal and with `SIMULATOR_UPDATE_CHANCE` (0.5) nudges `stability` by ±`SIMULATOR_STABILITY_DELTA` (15) and `creatures_count` by ±`SIMULATOR_CREATURES_DELTA` (5), both clamped (`0..100`, creatures also capped at `SIMULATOR_MAX_CREATURES`).
  - With `settings.portal_open_chance` (`PORTAL_OPEN_CHANCE` env var, default `SIMULATOR_OPEN_CHANCE_DEFAULT = 0.05` ≈ one portal per 3–4 min) a brand-new portal appears: fully random name/world/energy/stability/creatures, `TTL` uniform in `SIMULATOR_PORTAL_TTL_MIN_SECONDS..MAX` (30 s..30 min), unmarked, no observer, open.
  - Name generators: `world_name()` (syllable composition + ending, e.g. «Альбарион») and `portal_name()` (adjective + noun, 25 % chance of a Roman numeral suffix, e.g. «Шепчущий Коридор IV»), both within the shared `DESTINATION_WORLD_MAX_LENGTH` / `PORTAL_NAME_MAX_LENGTH`.
  - `simulate_once()` emits `pg_notify` for every changed/spawned portal **inside the same transaction** (new `notify_portal_changed` helper extracted to `app/notifications.py`), so WS subscribers are only woken on a durable commit — the same rule as portal actions.
- `PORTAL_OPEN_CHANCE` added to `app/config.py` (`_as_float` parser: unset→default, non-numeric or out-of-`0..1` at settings load → fail fast), `docker-compose.yml`, `.env.example` and the README envvars table.
- `routes/portals.py` reordered: `POST /{portal_id}` and `GET /{portal_id}` are now adjacent, declared **after** the static `/log` and `/stats` routes so the int path param never shadows them (this was verified by the previously-passing /log, /stats tests which caught the intermediate wrong order).
- Tests: `tests/test_simulator.py` (name shapes, new-portal values, delta/clamping, update+spawn, spawn-skip, closed-portal skip, loop ticks, loop survives tick errors, loop logs changed ids), `tests/test_config.py` (+`_as_float` cases), `tests/test_main.py` (lifespan starts/stops the simulator in both `DEBUG` modes and never starts it when `DISABLE_SIMULATOR` is set). 113 pass, coverage 99%.

### Portal list & action log: filters + ordering (latest batch)
- `PortalOrder` / `LogOrder` enums in `app/models.py` drive the `order_by` whitelist: `risk` (default), `expires_at`, `creatures`, `name` for portals; `newest` (default) / `oldest` for the log. Unknown values → 422.
- Portal filters: `closed`, `danger_level`, `has_observer`, `is_marked`, `search` (case-insensitive name/world substring). Log filters: `action`, `portal_id`, `user_id`.
- Risk/danger SQL expressions extracted from `/stats` into `_risk_expression(now)` / `_danger_bucket_expression(now)` (shared with `/stats`);
- Default portal ordering: open portals first (closed/expired sink below and keep their own relative order — risk/expiry estimates are meaningless for a closed portal), then risk DESC, expires_at ASC, has_observer DESC, creatures_count DESC, `id ASC` tiebreaker. Open-first prepends every `order_by` mode.
- All query params mirrored on the WS endpoints (`WS /portals/ws`, `WS /portals/log/ws`) via the shared `_portal_page` / `_action_log_page`.
- `GET /portals/{id}` — individual portal info (`PortalSchema`), 404 for unknown id; declared after `/log` and `/stats` so the int path param never shadows them.
- Tests: 17 new (default ordering, order_by variants, tie-breakers, open-before-closed, each portal filter, combined filters, 422 invalid order_by, log filters/ordering, WS-with-filter, portal info incl. 404/422/401). Coverage 99%; mypy/ruff/black clean.

### Initial superuser bootstrap + STABILIZE rework
- `INITIAL_SUPERUSER_USERNAME` / `INITIAL_SUPERUSER_PASSWORD` env pair (both or none, lengths validated via shared constants): `app/config.py` `_read_initial_superuser` → `Settings.initial_superuser: tuple[str, str] | None`.
- New `app/bootstrap.py::ensure_initial_superuser` — runs in the lifespan right after `create_all()`; deletes superusers with a different name (sessions CASCADE, log rows SET NULL), keeps a same-name superuser and updates its password hash when it no longer matches the configured password, fails fast if a regular user holds the configured name.
- `docker-compose.yml` passes both vars to the backend service; `.env.example` + README envvars table updated.
- `Portal.stabilize` now adds a random 10-30 to stability (`STABILITY_INCREASE_RAND_RANGE`, new constant) capped at 100, instead of jumping straight to 100; model test updated.
- Tests: `tests/test_bootstrap.py` (create, delete-different-name incl. cascade/FK-NULL checks, keep-same-name with unchanged hash, update hash on password change, fail-fast), `tests/test_config.py` (+5 env parsing cases), `tests/test_main.py` (lifespan creates superuser).

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
