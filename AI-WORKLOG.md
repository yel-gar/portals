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

Дополнительно найдено в ходе исправлений:
- `httpx2` — непонятный пакет в dev-зависимостях, заменён на `httpx`.
- в `app/security.py` был синтаксический ошибочный `except InvalidHashError, VerifyMismatchError:` (Python 2), из-за чего модуль не импортировался.

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
