# Portals

Веб-приложение для смотрителя лаборатории магических порталов. Часть порталов стабильна, часть опасна, часть скоро схлопнётся - приложение считает риск по явной формуле, показывает статус каждого портала и позволяет принимать решение: оставить открытым, стабилизировать, закрыть или отправить наблюдателя. Запрещённые переходы (закрыть портал с существами внутри, отправить наблюдателя в критический портал и т.п.) блокируются с понятным объяснением. Все действия попадают в журнал событий, доступна сводная статистика.

В интерфейсе приложения есть отдельная вкладка **AI Worklog** - рендерит `AI-WORKLOG.md` прямо из корня репозитория, без отдельной копии для поддержки в актуальном состоянии.

## Быстрый старт

```bash
git clone https://github.com/yel-gar/portals.git && cd portals
cp .env.example .env # укажите непустой POSTGRES_PASSWORD, также INITIAL_SUPERUSER_USERNAME и INITIAL_SUPERUSER_PASSWORD если нужно
docker compose up --build -d
./populate.sh # заполняет БД демо-порталами, безопасно перезапускать
```

Приложение поднимется на `http://localhost:3000` (фронтенд) и `http://localhost:8000` (бэкенд, `/docs` при `DEBUG=1`). Если нужен суперпользователь сразу после старта - задайте `INITIAL_SUPERUSER_USERNAME`/`INITIAL_SUPERUSER_PASSWORD` в `.env` до первого запуска (иначе можно зарегистрироваться обычным пользователем через `/register`, если регистрация не отключена через `DISABLE_REGISTRATION`).

Подробности деплоя, dev-режима с live reload и полный список переменных окружения - ниже.

## Deployment

The stack runs through docker compose and picks up env vars from `.env` at the repo root (see the table below); nothing needs to be exported manually.

- **Production** - `docker compose up --build -d`. The backend image runs uvicorn as the unprivileged `app` user; the frontend image serves the built SPA from a single-worker nginx running as the `nginx` user (both Dockerfiles drop root at runtime).
- **Development (live reload)** - ensure `docker-compose.override.yml` exists; if missing, copy `docker-compose.override.yml.dev` to `docker-compose.override.yml`. If a copy predates a compose-template change (the `NET_BIND_SERVICE` capability and the worklog mount), re-copy it. Then run the project as usual (`docker compose up --build -d`). The Vite dev server runs as the `node` user (uid 1000, matching the host user, so the bind-mounted `./frontend` stays fully owned) and binds port 80 through the `NET_BIND_SERVICE` capability instead of root.

When upgrading a dev stack from the earlier root-user images: the `frontend_node_modules` named volume keeps root ownership, which the `node` user cannot write into - drop it once so it re-initializes from the image (`docker compose down && docker volume rm portals_frontend_node_modules && docker compose up -d --build`).

### Demo data

`populate.sh` (Linux/macOS) and `populate.ps1` (PowerShell 7+) seed the database with demo portals. They run the idempotent `backend/populate.py` inside the backend container via `/app/.venv/bin/python populate.py` - the venv python ships in the image, no poetry inside - and are safe to re-run: when portals already exist, the script prints a note and skips.

```bash
./populate.sh   # requires the stack to be running
```

### Worklog

The development journal is served by the frontend at `/AI-WORKLOG.md` straight from the repo-root `AI-WORKLOG.md`: production nginx and the dev Vite server both bind-mount it (see `docker-compose.yml` / `docker-compose.override.yml.dev`). There is no bundled copy to keep in sync - edit the root file and the page picks it up on the next reload.

## Environment variables

`POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB` are shared between the `postgres` and `backend` services and are interpolated from the project `.env` file (see `.env.example`). `POSTGRES_PASSWORD` must be non-empty; otherwise `docker compose` refuses to start.

`POSTGRES_HOST` and `POSTGRES_PORT` are set by `docker-compose.yml` for the backend service only.

| Name                         | Description                                                                                                                                                                                               | Default                                  | Required |
|------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------|----------|
| `POSTGRES_USER`              | PostgreSQL user, used by both `postgres` and `backend`                                                                                                                                                    | `postgres`                               | ❌       |
| `POSTGRES_PASSWORD`          | PostgreSQL password, used by both `postgres` and `backend`                                                                                                                                                | -                                        | ✅       |
| `POSTGRES_DB`                | PostgreSQL database name, used by both `postgres` and `backend`                                                                                                                                           | `postgres`                               | ❌       |
| `POSTGRES_HOST`              | Backend-only: hostname of the `postgres` service                                                                                                                                                          | `postgres` (set in `docker-compose.yml`) | ❌       |
| `POSTGRES_PORT`              | Backend-only: port the `postgres` service listens on                                                                                                                                                      | `5432` (set in `docker-compose.yml`)     | ❌       |
| `BACKEND_PORT`               | Host port the `backend` container is published on, mapped to the container port `8000`                                                                                                                    | `8000`                                   | ❌       |
| `FRONTEND_PORT`              | Host port the `frontend` container is published on, mapped to the container port `80`                                                                                                                     | `3000`                                   | ❌       |
| `DATABASE_URL`               | Backend-only: overrides the URL assembled from `POSTGRES_*` (e.g. for local runs)                                                                                                                         | assembled from `POSTGRES_*`              | ❌       |
| `BACKEND_URL`                | Backend origin, added to the CORS allow-list                                                                                                                                                              | ``                                       | ❌       |
| `FRONTEND_URL`               | Frontend origin, added to the CORS allow-list                                                                                                                                                             | ``                                       | ❌       |
| `DEBUG`                      | When truthy, session cookies are sent without the `Secure` flag                                                                                                                                           | `0`                                      | ❌       |
| `DISABLE_REGISTRATION`       | When truthy, `POST /auth/register` returns `403` and public registration is disabled                                                                                                                      | `0`                                      | ❌       |
| `DISABLE_SIMULATOR`          | Backend-only: when truthy, the portal simulator background loop is not started. It runs in every mode (including `DEBUG`) by default; tests/CI set it to keep the DB free of a background writer          | `0`                                      | ❌       |
| `INITIAL_SUPERUSER_USERNAME` | Backend-only: username of the initial superuser created/reconciled on startup; must be set together with `INITIAL_SUPERUSER_PASSWORD`                                                                     | -                                        | ❌       |
| `INITIAL_SUPERUSER_PASSWORD` | Backend-only: password of the initial superuser; when it changes, the stored hash is updated on the next startup (verified in `app/bootstrap.py`); must be set together with `INITIAL_SUPERUSER_USERNAME` | -                                        | ❌       |
| `PORTAL_OPEN_CHANCE`         | Backend-only: chance (0..1) of the portal simulator opening a new portal on each 10-second tick (0.05 ≈ one portal per 3–4 minutes)                                                                       | `0.05`                                   | ❌       |
| `E2E_KEEP_STACK`             | Playwright E2E only: when truthy, the global teardown leaves the `portals-e2e` docker compose stack running instead of `down -v` (local debugging; CI always tears down)                                  | `0`                                      | ❌       |

> **Login over plain HTTP:** session cookies carry the `Secure` flag unless `DEBUG=1`. Browsers only accept `Secure` cookies from `https://` origins or `localhost`, so with `DEBUG=0` and a plain-`http://` URL (a LAN IP, a custom hostname, or any pre-TLS deployment) the login call appears to succeed but the cookie is silently rejected - every subsequent request 401s and the app bounces back to the login page. Keep `DEBUG=1` while the frontend is served over plain HTTP, or serve it over HTTPS.

When **both** `INITIAL_SUPERUSER_USERNAME` and `INITIAL_SUPERUSER_PASSWORD` are set, the app creates (or reconciles) a single superuser on startup: any superuser with a different name is deleted, while an existing superuser with the exact name is kept - and if its stored hash no longer matches the configured password, the hash is updated. Startup fails if a regular user already holds the configured username, or if only one of the two variables is set.

## E2E tests (Playwright)

The end-to-end suite lives in `frontend/e2e/` and runs against a **dedicated, isolated docker compose stack** (`docker-compose.e2e.yml`, project `portals-e2e`) - not against the dev/prod stack. The file is deliberately standalone:

- own project name, network and `e2e_postgres_data` volume - nothing collides with the running `portals` stack;
- own published ports `8010` (backend) and `3010` (frontend) so the dev stack on `8000/3000` keeps running;
- every value is hardcoded - no `${...}` interpolation, so the repo-root `.env` cannot leak into the test stack, and an explicit `-f` flag means the dev `docker-compose.override.yml` is never auto-merged;
- prod-like setup: the frontend nginx image is built with `BACKEND_URL=http://localhost:8010` baked in, matching the real deployment.

Before running, ensure dependencies and the chromium browser are installed and the stack is free to build:

```bash
cd frontend
npm install
npx playwright install chromium
```

Then run the suite (builds the two images on the first run - allow a few minutes):

```bash
npm run test:e2e            # both projects: deterministic suite + the live smoke test
npm run test:e2e:chromium   # deterministic specs only (DISABLE_SIMULATOR=1)
npm run test:e2e:live       # the one live-updates smoke test (simulator enabled)
npm run test:e2e:ui         # Playwright UI mode for debugging
```

How it works:

- `global-setup.ts` brings the `portals-e2e` stack up (`up -d --build`), waits for backend/frontend health and seeds the demo portals via `backend/populate.py`, with open portals' `expires_at` frozen ~2 h out so nothing expires mid-run.
- Spec files that assert portal/stat/log state re-seed the demo data themselves in `beforeAll` (`resetPortals()` in `frontend/e2e/helpers.ts`), guaranteeing deterministic counts regardless of earlier files.
- The deterministic `chromium` project runs with `DISABLE_SIMULATOR=1`; the trailing `live` project re-creates **only the backend container** with the simulator enabled (`docker-compose.e2e.live.yml` merged over the base) and checks that the open page keeps receiving WebSocket snapshot frames (delta badges appear - something that never happens with the simulator off).
- `global-teardown.ts` tears the stack down with `-v` so every run starts fresh; set `E2E_KEEP_STACK=1` to leave it running for local debugging.
- CI runs the full suite in `.github/workflows/e2e-ci.yml` and uploads `playwright-report` / `test-results` artifacts on failure.

## Обработанные граничные случаи и чеклист ручной проверки

Автотестов в проекте достаточно много (backend ~250 тестов/~99% покрытия через testcontainers с реальным Postgres, frontend >90% покрытия + 9 e2e-спеков - детали в `AI-WORKLOG.md`, разделы "Auth" и "Portals"), поэтому здесь - не их пересказ, а список конкретных сценариев и граничных случаев, пройденных вручную как пользователем перед сдачей:

1. **Пустой список порталов** - свежая БД без `populate.sh`: дашборд и журнал корректно показывают пустое состояние, статистика - нулевые значения без ошибок.
2. **Портал с критическим риском** - попытка отправить наблюдателя в портал с критическим уровнем риска отклоняется с понятным сообщением; закрыть такой портал с существами внутри без предупреждения тоже нельзя.
3. **Запрещённое действие на закрытом портале** - после закрытия все действия, кроме mark/unmark, блокируются в интерфейсе и возвращают `409` с объяснением при прямом обращении к API.
4. **Изменение риска после стабилизации** - стабилизация портала пересчитывает риск и danger level сразу, дельта отображается в таблице (включая проверку, что дельты меньше 0.01 не показываются как ложные `+0.00`/`-0.00`).
5. **Журнал после нескольких операций** - выполнил подряд несколько действий над разными порталами, проверил, что все записи появляются в журнале в правильном порядке (новые сверху), с привязкой к пользователю.
6. **Конкурентный доступ** - открыл приложение в двух вкладках под одним и разными пользователями, выполнил действия над одним порталом почти одновременно - гонки не произошло, действие сериализуется на уровне БД (`SELECT ... FOR UPDATE`).
7. **Live-обновления без ручного обновления страницы** - с включённым симулятором (`DISABLE_SIMULATOR=0`) проверил, что таблица и список порталов обновляются сами по WebSocket без перезагрузки страницы; отдельно проверил, что открытая карточка конкретного портала обновляется поллингом, если портал истекает, пока модалка открыта.
8. **Доступ без прав** - под обычным пользователем `/admin`-раздел недоступен (`403`), под анонимной сессией все защищённые маршруты возвращают `401`/закрывают WebSocket с `4401`.
9. **Фильтры и пагинация** - установка и сброс фильтров на дашборде и в журнале, поведение на больших объёмах данных (populate с большим количеством записей, до 10000 порталов / 100000 записей журнала).
10. **Экстремальные значения ввода** - логин/пароль экстремальной длины при регистрации и входе; пустые поля.
11. **Все действия во всех состояниях портала** - mark/unmark, stabilize, close, send/recall observer, warn creatures, dismiss - прогнаны как в допустимых, так и в запрещённых сочетаниях состояний (портал открыт/закрыт/с наблюдателем/с существами внутри).
12. **README "с нуля"** - прогнал `git clone` -> `.env` -> `docker compose up` -> `populate.sh` на чистом окружении, чтобы убедиться, что инструкция реально работает без недостающих шагов.
