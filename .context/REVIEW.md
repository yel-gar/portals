# Code review — backend

Scope: branch `backend/backend`, commits `c2197eb` → `6ed37f0` (19 commits). Method: six parallel review agents (models/DB; auth/config/security/deps; portals routes; schemas/notifications/main/admin/bootstrap; tests/tooling/CI; security & compliance cross-cut), findings deduplicated and contested claims manually verified against source.

## Summary

| Severity | Count | Status |
| -------- | ----- | ------ |
| CRITICAL | 1 | Fixed |
| MAJOR    | 10 | All fixed |
| MINOR    | ~12 | Selected fixes; rest deferred (tracked below) |
| NIT      | several | Mostly left; `action` NIT dismissed by user |
| Compliance pass | many | Verified OK (list below) |

Fix commit summary is in `.context/PROJECT_STATE.md` → "Code review fixes (2026-09)". Checks after fixes: black, ruff, mypy strict — clean; `pytest`: 89 passed; coverage 99% (`fail_under=80`).

---

## CRITICAL

### C1 — WS endpoints pin a pooled DB session for the whole socket lifetime
`app/routes/portals.py` — `portal_updates` (`WS /portals/ws`) and `action_log_updates` (`WS /portals/log/ws`) opened the page session with `async with get_session_factory()() as session:` and kept it open around the infinite `_hub_snapshot_loop`, so every connected socket held a pooled connection indefinitely. With many concurrent clients the pool (default size) exhausts and all new requests stall/fail.

**Fix:** the session is used only for the auth lookup and closed before `accept()`; each snapshot is rendered in its own short-lived session inside `snapshot_factory()`. A socket's lifetime is now independent of the pool size.

## MAJOR

### M1 — `_hub_snapshot_loop` has no error handling
`app/routes/portals.py` — a failing `snapshot_factory()` (transient DB error) or `send_json` propagated out of the loop, killing the subscriber.

**Fix:** the loop logs both failures (`logger.exception`, Russian message) and keeps running; only a client disconnect or failed send terminates it. The initial render also catches generic errors and closes instead of crashing the app task.

### M2 — `LoginSchema` fields unbounded
`app/schemas.py` — `username`/`password` on login had no length validation, violating the project rule that length constants be shared by models and validators.

**Fix:** `Username`/`Password` Annotated aliases (`Annotated[str, Field(min_length=…, max_length=…)]`, built from the shared `app/constants.py` lengths) now back `UserRegisterSchema`, `LoginSchema` and `PasswordChangeSchema`.

### M3 — Login username-enumeration timing side channel
`app/routes/auth.py` — when the username did not exist, no argon2 verification ran, so a missing username responded measurably faster than a wrong password.

**Fix:** `security.burn_password_verify_time(password)` (lazy dummy argon2 hash) runs on the unknown-username path, equalizing timing; both failure paths return the same 401 message.

### M4 — No rate limit on login
The auth endpoints are unauthenticated and login accepts any credentials; no brute-force protection existed.

**Fix:** new `app/ratelimit.py` — dependency-free in-memory sliding-window limiter (5 attempts / 60 s per client IP) applied to `POST /auth/login` → `429`. Skipped when `DEBUG` is on (dev/test convenience; document in DECISIONS). Plus `DISABLE_REGISTRATION` env var: when truthy, `POST /auth/register` → 403. Both documented in `.env.example` + README envvars table.

### M5 — TOCTOU on duplicate usernames
`app/routes/auth.py` `register` / `app/routes/admin.py` `create_user` — the pre-check `SELECT` is not race-safe: two concurrent requests both pass it, the loser's `INSERT` raises a raw `IntegrityError` → 500.

**Fix:** commits are wrapped in `except IntegrityError → rollback → 409` with a `from exc` chain; concurrent-duplicate tests added for both routes.

### M6 — Password reset does not revoke sessions
`app/routes/admin.py` `set_password` only replaced `password_hash`; every existing `LoginSession` stayed valid. No user-facing password-change endpoint existed at all.

**Fix:**
- New `POST /auth/password` (authenticated): deletes **all** of the user's sessions **except** the current cookie's token — the user stays logged in, every other device is logged out.
- `POST /admin/users/{id}/set-password`: deletes **all** sessions of the target user (the admin's own sessions are untouched).

Tests verify both directions (current session survives / other tokens → 401 after change).

### M7 — `UpdateHub` fragile lifecycle
`app/notifications.py` — single connection with no supervision: a terminated connection silently stopped updates forever; `start()` was not idempotent; `stop()` was not robust to a dead connection and aborted on `remove_listener` errors.

**Fix:**
- `start()` is idempotent (stops the previous supervisor first), keeps await-initial-connect semantics.
- A background supervisor watches the listener connection via an asyncpg termination listener feeding an `asyncio.Event`; on termination it reconnects with exponential backoff (1 s → 30 s) and broadcasts a refresh event on recovery so stale WS subscribers re-query.
- `stop()` signals the supervisor, suppresses close/remove_listener errors, awaits the supervisor task, and is safe to call repeatedly.
- Real reconnect test: `connection.terminate()` → hub reconnects → subscriber wakes.

### M8 — Subscribe happens after the initial snapshot render
`app/routes/portals.py` — handlers rendered and sent the initial snapshot **before** `_hub_snapshot_loop` subscribed; a change committed between render and subscribe was lost until the next event (and the page was queried twice).

**Fix:** `_hub_snapshot_loop` now subscribes **first**, then renders the initial snapshot, and drains queued hub events before re-querying so a burst coalesces into one re-query. The loop now owns the initial snapshot (tests updated accordingly).

### M9 — Flaky portal filters test (time-dependent fixture)
`tests/test_portals.py` `test_list_portals_filters` — the CRITICAL portal used `expires_at=utc_now() + timedelta(seconds=5)`; if the test ran slower than 5 s the portal expired and the `closed`/`open` set assertions failed.

**Fix:** the CRITICAL portal is created already expired — the TTL clamps to 0, so its risk stays > 0.9 (CRITICAL) and its closed status are both time-invariant; the `closed`/`open`/combined assertions were adjusted to match (combined filter now uses `closed=true`). Note: an **open** CRITICAL portal is mathematically impossible to make time-invariant (with current weights, CRITICAL requires TTL ≲ 12 s) — recorded in LESSONS.md.

### M10 — Unknown-session-token branch uncovered
`app/deps.py:25` — the `login_session is None` branch was the only uncovered line.

**Fix:** `test_unknown_session_token_rejected` (HTTP: `/auth/me` + `/portals` → 401) and `test_portal_ws_rejects_unknown_token` / `test_log_ws_rejects_unknown_token` (WS → close 4401 before accept). Line now covered; coverage 99%.

---

## MINOR

| # | Finding | Status |
| - | ------- | ------ |
| m1 | WS endpoints do not verify the `Origin` header (CSWSH exposure). | Deferred — socket origin check is the right follow-up for a browser client; requires a decision on allowed origins. |
| m2 | Portal list/page query params lack an upper bound on the HTTP routes (`page`, `items_per_page` unbounded). | Deferred — safe (default cap `PAGE_SIZE_MAX` on queries), but pagination caps belong on the routes; tracked. |
| m3 | `search` wildcards `%`/`_` are passed through unescaped — a search of `%` matches everything. | Deferred — should escape with `ilike(…, escape="\\")`; tracked. |
| m4 | `logout` deletes the cookie without mirroring `secure`/`httponly`/`samesite` used at set time, and the route had no `responses` docs. | Fixed — `delete_cookie` now mirrors the set attributes. |
| m5 | `security.py:16` used `except InvalidHashError, VerifyMismatchError:` — valid only on Python 3.14 (PEP 758). | Fixed — parenthesized tuple; covered by `test_security.py`. (AI-WORKLOG/PROJECT_STATE previously *claimed* this was fixed — corrected in LESSONS.md.) |
| m6 | Risk formula scalars (`0.2/0.3` weights, buckets) duplicated between the model property, SQL expressions and docs. | Fixed — weights/thresholds in `app/constants.py`, Python helper `models.risk_factor_for()`, SQL mirrors via constants. |
| m7 | `.env.example` missing `POSTGRES_HOST`/`POSTGRES_PORT` although `config.py` reads them and README documents them. | Fixed — added. |
| m8 | `LoginSession` rows are never purged after expiry (stale sessions accumulate). | Deferred — add a periodic/best-effort purge or on-login cleanup; tracked. |
| m9 | `db.py` re-init after a restart is not idempotent (`dispose`/`init_db` order not guarded). | Deferred — production restarts are process-level; guard documented in tests already. |
| m10 | `/docs` (Swagger) exposed in production. | Deferred — worth gating behind `DEBUG`; tracked. |
| m11 | One-sided `back_populates` on `LoginSession.user`. | Deferred — cosmetic; SQLAlchemy warns only in some paths. |
| m12 | CI: coverage workflow duplicates the test run from the CI workflow. | Deferred — can dedupe or drop; no functional impact on gate (`fail_under=80`). |

## NITs (left as-is unless trivial)

- `action` as a query param on `POST /portals/{id}` — **dismissed by user; no change**.
- Route docs could include more explicit 422/409 listing on a couple of routes; gradually improved in this batch.
- `GET /portals/{id}` declared after `/log`/`/stats` — already handled (order verified).
- Coverage config includes `tests` in `source` and wraps the gate at 80 while real coverage is 99% — user did not ask to change; left as-is.

## Compliance pass (verified OK during review)

- All timestamps UTC, `DateTime(timezone=True)`/`timestamptz` everywhere; comparisons in UTC (`utc_now()`).
- Username/password length constants shared by models and validators (now fully, incl. login, via the aliases).
- Portal action conditions validated in `Portal` model methods, `BadAction` (Russian), route layer owns commit + `ActionLogEntry`.
- Route summaries/descriptions and error codes present on all main routes (auth/admin/portals).
- pyproject: strict mypy; black/ruff configure; coverage `fail_under=80`; pre-commit hooks wired (black, ruff-check, mypy, pytest via poetry).
- Tests run against real PostgreSQL via testcontainers (`postgres:18-alpine`), fully async, no SQLite.
- Password stored as argon2 hash (argon2-cffi), constant-time verify path, hex token 64 chars, httpOnly cookie, `Secure` unless DEBUG.
- `SELECT … FOR UPDATE` serializes concurrent actions on one portal; rollback never notifies.

## Resolution record

All CRITICAL/MAJOR findings fixed in this batch; select MINORs fixed inline; the remaining MINORs are tracked above as follow-ups. Decisions and state updated in `.context/DECISIONS.md` / `.context/PROJECT_STATE.md`; user corrections recorded in `.context/LESSONS.md`.
