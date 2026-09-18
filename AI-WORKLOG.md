# Этап 1: конфигурация проекта и CI pipeline
## Что сделал я
- Написал `README.md` с инструкциями для агента и приблизительной финальной структурой для агента
- Включил правила написания и проверки кода, добавил необходимые зависимости и настроил pre-commit
- Установил используемый стек: FastAPI async, SQLAlchemy. ruff (linter), black (formatter), mypy (type checker), pytest (tests) и coverage.py (test coverage)
### Обоснование выбора бэкенда
Выбор стоял в основном между Django и FastAPI, был сделан в пользу FastAPI засчет:
- Более простого кода (легче для агента и для проверяющего)
- Лучшей поддержки асинхронности
- Фронтенд будет писаться на реакте, поэтому использование Django излишне, т.к. это фуллстек фреймворк. Можно было бы использовать **django rest framework**, но это скорее инструмент для интеграции с django, чем самостоятельная библиотека, в отличие от **FastAPI**

## Что сделал агент
- Дописал правила для mypy и coverage в `pyproject.toml`
- Сделал github workflows для CI пайплайна бэка и проверки покрытия тестов
- Настроил `docker-compose.yml` для бекэнда и базы данных postgres

### Ошибки агента
1. При конфигурации GitHub Actions агент ошибочно установил флаг для `poetry install` `--only dev`, при этом не поставив флаг `--no-root`. Это несущественная ошибка, но пайплайн бы провалился.
2. При генерации `Dockerfile` изначально был получен следующий результат для ступени `build`
```Dockerfile
FROM python:3.14-alpine AS build

ENV POETRY_VERSION=2.4.3 \
    POETRY_NO_INTERACTION=1 \
    POETRY_VIRTUALENVS_IN_PROJECT=true \
    POETRY_CACHE_DIR=/tmp/poetry-cache \
    PIP_NO_CACHE_DIR=1

RUN apk add --no-cache gcc musl-dev python3-dev libffi-dev

WORKDIR /app

COPY pyproject.toml poetry.lock ./

RUN pip install --no-cache-dir "poetry==${POETRY_VERSION}"

RUN poetry install --only main --no-root
```
Здесь агент зачем-то устанавливает ненужные библиотеки через apk, а также вопреки промпту устанавливает `poetry` после копирования манифеста зависимостей, из-за чего докер будет каждый раз переустанавливать poetry при изменении зависимостей, хотя это можно кэшировать.

### Ключевые промпты
**docker-compose**
```
Getting to basic docker setup now. Project itself will be running ultimately through docker now, while tests are to be ran through poetry. Now please
1. Create docker-compose.yml with backend service and postgres 18-alpine with proper healthcheck. Postgres password variable must be non-empty, so interpolate it via ${:?}, you can set default values to user and db name via ${:-}.
2. Create Dockerfile in backend using python 3.14-alpine base image. Should pin poetry version to 2.4.3, set appropriate environment variables for build optimization. 2 stages: build and deploy. Make sure to properly order steps to use docker cache (copy dependency files - install - copy the rest).
3. Create .env.example and add postgres configuration variables there. Also make a table with environment variables in README.md including following columns: Name, Description, Default, Required.
4. Postgres env vars must be shared with postgres and backend containers
```


# Этап 2. Написание бэкенда
Бэкенд писался несколькими крупными промптами с планированием, поэтапным контролем и системой суб-агентов для оптимизации времени написания.

## Что сделал я
- полностью сформулировал необходимое ТЗ для агента: модели БД, эндпоинты, модель авторизации, формулу для вычисления риска, запрещенные состояния
- проверил план агента и внес корректировки
- провел ревью кода

## Ошибки агента
- использовал mock sqlite для тестов, хотя лучше использовать testcontainers, я внес корректировку
- `nullable` задана почти нигде в моделях БД. По умолчанию колонки nullable, а по ТЗ почти все поля обязательны.
- тесты должны быть полностью асинхронными на `pytest-asyncio` (и conftest тоже)
- не хватало логирования. Использовать встроенный `logging`.
- в `deps.py` кука извлекалась из `request` вручную, хотя FastAPI умеет это делать через аннотацию `Cookie`.
- коды ошибок не документированы ни для одного эндпоинта, нужно указывать `responses` в декораторе.
- лишние вызовы `model_validate`: если у схемы `ConfigDict(from_attributes=True)`, можно возвращать ORM-объект напрямую, FastAPI сам сериализует через `response_model`. Также злоупотребление `(await session.execute(...)).scalars()` — достаточно `session.scalars()`. Эти проблемы были в `list_users`, `register`, `login`, `me`, `_portal_page`, `action_log`, `execute_action`.
- эндпоинт `/stats` грузит все порталы в память и считает агрегаты в Python, нужно считать через SQL-агрегаты на стороне БД.
- выполнение действий над порталами не являлось потокобезопасным, использование сайта 2мя пользователями одновременно могло привести к гонке состояний

Дополнительно найдено в ходе исправлений:
- `httpx2` — непонятный пакет в dev-зависимостях, заменён на `httpx`.
- в `app/security.py` был синтаксический ошибочный `except InvalidHashError, VerifyMismatchError:` (Python 2), из-за чего модуль не импортировался.
- Исправление выше оказалось преждевременным: на момент код-ревью (2026-09) в `app/security.py` всё ещё стоял `except InvalidHashError, VerifyMismatchError:` (работает только на Python 3.14, PEP 758). По-настоящему исправлено на `except (InvalidHashError, VerifyMismatchError)` в рамках batch-иcправлений код-ревью, покрыто тестом в `tests/test_security.py`.

### Ключевые промпты
**начальный промпт**
```
From my description, ask followup questions, make up a plan. During the execution of the plan, PROJECT_STATE must be constantly updated. If required, changes to AGENTS.md must be made., for example general project description may be put there. You are only writing backend now. For different stages of plan, subagents may be deployed.

# General project description
Magic portals laboratory overseer dashboard. Main page is a table of portals displaying data. User can click on portal and open expanded description with ability to act: leave open, stabilize, close, send observer. There's also actions log where all actions are recorded.

# Models
Portal: id int PK, name varchar 128, destination world varchar 128, energy level int from 0 to 100 inclusive, stability from 0 to 100 inclusive, expires at timestamp, creatures count int >= 0, last_update timestamp autoupdate auto default, is_marked bool, has_observer bool, is_closed bool, all fields non-nullable.
Action (str enum): CLOSE, STABILIZE, DISMISS, SEND_OBSERVER, RECALL_OBSERVER, MARK, UNMARK, WARN_CREATURES
DangerLevel: LOW, MEDIUM, HIGH, CRITICAL
ActionLogEntry: id int PK, user_id FK on User nullable on delete set null, portal_id FK on Portal on delete cascade, action (via enum), timestamp timestamp, all fields non-nullable unless stated otherwise.
User: id int PK, username varchar 64 unique, password_hash varchar 255, created_at timestamp auto default, is_superuser bool, all fields non-nullable.
LoginSession: id int PK, user_id FK on User on delete cascade, token varchar 64, all fields non-nullable

The portal should additionally have a property or function that calculates risk factor via the formula: energy_level / 100 * 0.2 + (1.0 - stability / 100) * 0.2 + 0.1 * creatures_inside / (0.1 * creatures_inside + 1) * 0.3 + (1.0 - 0.04 * TTL / (0.04 * TTL + 1)) * 0.3. Where TTL is (expires_at - now) in seconds.

# IMPORTANT
Use UTC timestamps everywhere. Add this explicitly to AGENTS.md and to DECISIONS.

## Risk mapping:
0.0 - 0.3 - low
0.3 - 0.6 - medium
0.6 - 0.9 - high
> 0.9 - critical

## All actions must be defined as methods on portal model. Conditions for action must be checked inside methods and raise BadAction exception with the description of problem in russian.

## Conditions for actions
If portal is closed, no actions can be committed
DISMISS - simply update last update timestamp
CLOSE - no creatures inside, no observer inside
STABILIZE - stablity below 0.5
SEND_OBSERVER - risk factor is not critical, no observer inside
RECALL_OBSERVER - observer is inside
MARK - not marked, can be executed even if closed
UNMARK - marked, can be executed even if closed
WARN_CREATURES - observer is inside, creatures > 0

# Authentication flow
User provides login and password -> login and password checked -> on success secret token is added to database -> secure cookie with token is sent to user. If DEBUG envvar is positive, cookie is insecure.

# CORS
Add CORS middleware including `BACKEND_URL` and `FRONTEND_URL` envvars as origins. Add envvars to project according to instruction.

# Endpoints
/portals - require login for all routes
GET /portals?page=&items_per_page= - WS endpoint, listens for updates in channel and sends updated data every time it's updated. Additional filters will be added in the future
POST /portals/{portal_id}?action= - execute specified action, check if the action is valid
GET /portals/log?page=&items_per_page= - actions log, additional filters will be added in the future
GET /portals/stats - general stats about current open portals, already closed portals etc. Suggest possible stats on plan stage.

POST /auth/login - supply username and password, hand out cookie
POST /auth/register - supply username and password, check if username exists
POST /auth/logout - unset cookie, drop token from database
GET /auth/me - information about current user (username and id)

/admin - require login and is_superuser = True
POST /admin/users - create new user with specified username and password. Superuser can't be set.
DELETE /admin/users/{id} - delete user, must check that it's not superuser
GET /admin/users - get users list
POST /admin/users/{id}/set-password - update password for user. Password must satisfy length requirements.

# Schemas
Some schemas are defined explicitly, the rest can be derived. When constructing schemas from db models, use `from_attributes` where possible.

PortalSchema
id: int
name: str
destination_world: str
energy_level: int
stability: int
closed: bool
creatures_count: int
is_marked: bool
has_observer: bool
last_update: datetime
expires_at: datetime
risk_factor: float (the calculated value)
danger_level: DangerLevel (map float value to string)

UserRegisterSchema
username: length >= 4, <= 64, bring out min length and max length as constant and use it both in db and schema validator
password: length >= 8, <= 128, bring out as constant as well, but keep in mind you will be storing HASH in database. Hash to be calculated and verified via argon2.

```

# Обработанные и покрытые тестами граничные случаи: Auth и Portals

## Auth (регистрация / вход / выход / me / сессии, включая администрирование пользователей)

### Обработанные граничные случаи
- Границы длины username/password задаются константами, общими для моделей БД и валидаторов Pydantic (`USERNAME` 4–64, `PASSWORD` 8–128) → `422` при слишком коротком / слишком длинном / отсутствующем поле.
- Дубликат username при регистрации или создании администратором → `409` (проверка до вставки + уникальный индекс).
- Вход с неверным паролем или неизвестным username → одинаковый `401`, без перечисления пользователей.
- Проверка пароля fail-closed: `verify_password` ловит `InvalidHashError` и `VerifyMismatchError` и возвращает `False` вместо исключения.
- Сессионная cookie: httpOnly, `samesite=lax`, `Secure` кроме случая `DEBUG`; токен хранится в `LoginSession` со сроком жизни 14 дней.
- Истёкший токен сессии → `401` (срок проверяется при каждом аутентифицированном запросе).
- Выход: удаляет строку `LoginSession` и чистит cookie; идемпотентен → `204` даже без токена.
- Все защищённые маршруты (`/auth/me`, `/admin/*`, `/portals*`, WebSocket) → `401` без валидной cookie.
- Администрирование: обычный пользователь → `403`; созданному пользователю нельзя установить флаг суперпользователя; удаление суперпользователя → `409`; несуществующий пользователь при удалении / смене пароля → `404`; длина пароля → `422`.
- Сессия, у которой удалён пользователь (`login_session.user is None`), считается неаутентифицированной (обрабатывается в `deps.authenticate_session_token`; напрямую не тестируется — целостность FK, без теста).

### Тесты
- `tests/test_auth.py`
  - `test_register_login_me_logout` — полный сценарий: регистрация → `401` до входа → вход выдаёт cookie → me → выход → снова `401`
  - `test_register_duplicate_username` — `409` при повторной регистрации
  - `test_login_invalid_credentials` — неверный пароль и неизвестный пользователь → `401`
  - `test_register_validation_errors` — `422` для короткого username / короткого пароля / отсутствующего поля
  - `test_logout_is_idempotent` — выход без сессии → `204`
  - `test_expired_session_token_rejected` — истёкший токен в БД → `/auth/me` `401`
- `tests/test_admin.py`
  - `test_admin_requires_superuser` — обычный пользователь → `403`
  - `test_admin_requires_auth` — аноним → `401`
  - `test_create_and_list_users` — создание возвращает не суперпользователя; список содержит обоих
  - `test_create_duplicate_user` — `409`
  - `test_set_password` — смена пароля работает (старая cookie инвалидируется выходом, новый пароль входит)
  - `test_set_password_missing_user` — `404`
  - `test_delete_user` — пользователь удалён, список сократился
  - `test_delete_superuser_forbidden` — `409`
  - `test_delete_missing_user` — `404`

## Portals (список / действия / журнал / статистика / WebSocket / уведомления)

### Обработанные граничные случаи
- Все HTTP-маршруты и оба WebSocket-эндпоинта требуют аутентификации → `401` (HTTP) / закрытие `4401` (WS, `accept()` не вызывается).
- Пагинация: `page >= 1`, `items_per_page` в пределах 1..100, `total` сохраняется; постраничная выборка со смещением.
- Производные поля портала: `closed = expires_at <= now OR is_closed`; `risk_factor` ограничивает TTL на нуле (никогда не отрицателен для истёкших порталов); `danger_level` — уровни LOW/MEDIUM/HIGH/CRITICAL.
- Правила действий валидируются в методах модели `Portal` (кидают `BadAction` с описанием на русском; маршрут преобразует в `409`):
  - любое действие, кроме mark/unmark, на закрытом/истёкшем портале → `409`
  - `close` — отклоняется, пока внутри есть существа или наблюдатель
  - `stabilize` — отклоняется, если стабильность уже `>= 50`
  - `send_observer` — отклоняется при критическом уровне опасности или если наблюдатель уже внутри
  - `recall_observer` — отклоняется, когда наблюдателя нет
  - `mark` / `unmark` — отклоняются при уже отмеченном / не отмеченном портале
  - `warn_creatures` — требует наблюдателя и наличия существ; при успехе обнуляет `creatures_count`
  - `dismiss` — только обновляет `last_update`, отклоняется на закрытом портале
- Неизвестный `portal_id` → `404`; некорректное значение `action` → `422` (валидация enum во FastAPI).
- Безопасность коммита: строка портала блокируется `SELECT ... FOR UPDATE` на время действия (конкурентные действия над одним порталом сериализуются); изменение портала + `ActionLogEntry` + `pg_notify` для `portal_changes`/`action_log_changes` находятся в одной транзакции — уведомления доходят до подписчиков только при состоявшемся коммите; отклонённое действие ничего не коммитит.
- Журнал действий: сначала новые (`timestamp DESC, id DESC`), записи содержат выполнившего пользователя; требует аутентификацию и по HTTP, и по WS.
- Статистика считается SQL-агрегатами: количество открытых/закрытых/отмеченных/с наблюдателем, распределение по уровням опасности для открытых порталов (все четыре уровня присутствуют всегда, отсутствующие обнуляются), средний риск; порталы с истёкшим сроком считаются закрытыми.
- WebSocket-цикл (`_hub_snapshot_loop`): начальный снимок при подключении; повторная отправка при каждом событии хаба; отключение клиента → отписка + закрытие; произвольный текст клиента (ping) игнорируется, цикл продолжается.

### Тесты
- `tests/test_portals.py`
  - `test_list_portals_requires_auth` — `401`
  - `test_list_portals_paginated` — постраничная выборка + `total`
  - `test_portal_payload_matches_schema` — точный набор полей ответа, включая производные `closed`/`risk_factor`/`danger_level`
  - `test_execute_action_flow` — happy path: mark, warn_creatures (включая `creatures_count == 0`), recall, stabilize, dismiss, отправка/отзыв наблюдателя, close
  - `test_execute_action_rejected` — `409` для close с существами и recall без наблюдателя, detail непустой
  - `test_execute_action_unknown_portal` — `404`
  - `test_action_log` — записи фиксируются, сначала новые, пользователь привязан
  - `test_action_log_requires_auth` — `401`
  - `test_stats` — суммы/пропорции, распределение опасности сходится с числом открытых
  - `test_stats_requires_auth` — `401`
  - `test_committed_action_wakes_both_hubs` — выполненное действие будит подписчиков обоих каналов `portal_changes` и `action_log_changes`
  - `test_rejected_action_sends_no_notification` — действие с `409` → нет записи в журнале, портал не изменён, ни один хаб не уведомлён
- `tests/test_ws.py`
  - `test_hub_snapshot_loop_exits_on_disconnect` — цикл завершается и отписывается при отключении
  - `test_hub_snapshot_loop_pushes_snapshot_on_event` — событие хаба вызывает отправку свежего снимка
  - `test_hub_snapshot_loop_ignores_client_ping` — текст клиента не ломает цикл
  - `test_portal_ws_rejects_anonymous` / `test_log_ws_rejects_anonymous` — `4401`, подключение не принимается
  - `test_portal_ws_sends_initial_snapshot_and_exits` / `test_log_ws_sends_initial_snapshot_and_exits` — аутентифицированный клиент получает начальный снимок страницы/журнала
- `tests/test_models.py`
  - `test_risk_factor_and_danger_level` — все четыре уровня опасности, ограничение риска на истёкшем портале
  - `test_closed_flag_makes_portal_unactionable` — закрытый/истёкший портал отклоняет действия
  - `test_mark_unmark_allowed_on_closed_portal` — mark/unmark — единственные действия, разрешённые на закрытом портале (включая unmark неотмеченного)
  - `test_action_rules` — пути принятия и отклонения close/stabilize/send_observer/mark/warn_creatures (warn также обнуляет существ)
- `tests/test_notifications.py`
  - `test_hub_receives_postgres_notify` — реальный Postgres NOTIFY будит подписчиков на обоих каналах
  - `test_hub_idempotent_stop` — повторный `stop()` безопасен
  - `test_hub_broadcast_wakes_all_subscribers` — broadcast рассылается всем подписчикам, отписка удаляет

## Вспомогательные инфраструктурные тесты (не Auth/Portals, но часть набора)
- `tests/test_db.py::test_db_lifecycle_guards` — `get_session_factory`/`create_all` кидают исключение до `init_db`; повторная инициализация работает
- `tests/test_main.py::test_lifespan_starts_and_stops_hubs` — lifespan приложения запускает/останавливает оба LISTEN/NOTIFY хаба
- `tests/test_config.py` — разбор `_as_bool`/значения по умолчанию, `DATABASE_URL` переопределяет собираемый URL
