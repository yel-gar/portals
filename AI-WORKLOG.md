# AI Worklog

## Сводка

**AI-инструменты:**
- **OpenCode + BigPickle** - основной инструмент, почти вся работа: бэкенд, фронтенд, тесты, CI, инфраструктура, доработка по баг-репортам
- **OpenCode + MuseSpark 1.3** - завершающая часть работы (WebGPU-фон, финальные доработки)
- **ChatGPT 5.6-terra** (бесплатная версия) - код-ревью бэкенда, пару итераций, вне основного агентного цикла
- **Claude Sonnet 5** - разовая консультация по диагностике WGPU-артефактов на Windows

**Время разработки:** 3 дня, от идеи до финальной проверки.

**Бюджет:** проект сделан полностью на бесплатных тарифах - платных моделей/подписок не использовал. Один раз пришлось сменить аккаунт из-за упора в бесплатные лимиты, но это не меняет сути: весь объём работы (бэкенд, фронтенд, ~250 тестов, e2e, CI, доработка по баг-репортам) уместился в бесплатный тир доступных инструментов.

**Токены:**
- BigPickle: 2.9M input, 915K output, 81.7M cache read
- MuseSpark 1.3: 2.8M input, 200K output, 116.5M cache read (контекст заново перезагружался при каждом обращении, отсюда большой input относительно объёма реальных изменений)
- ChatGPT 5.6-terra и Claude Sonnet 5: точную статистику не собирал - использовались точечно (несколько сообщений), не через API с логированием, токены не считал

Высокий cache read у обоих инструментов - следствие большого объёма контекста проекта (AGENTS.md, исходники, история решений), который переиспользуется между запросами, а не признак неэффективного расходования токенов на генерацию.

**Этапы рабочего процесса:** конфигурация проекта и CI (этап 1) -> бэкенд: модели, риск-логика, действия порталов, auth (этап 2) -> доработка бэкенда: фильтры, симулятор, ревью (этап 2.1) -> фронтенд: макеты, страницы, тесты (этап 3) -> интеграция: связка фронта и бэка, e2e, обработка баг-репортов (этап 4) -> визуальная полировка (WebGPU-фон, вне критического пути).

Подробности по каждому этапу - что делал я, что делал агент, ключевые промпты - ниже, по разделам.

## Решения, принятые самостоятельно

1. **FastAPI вместо Django** - обоснование в этапе 1: проще для агентного цикла и для проверяющего, лучше асинхронность, фронтенд всё равно на React, поэтому фуллстек-фреймворк избыточен.
2. **Postgres вместо SQLite**, несмотря на то, что объём данных для тестового задания небольшой - сознательно выбрал ради `LISTEN/NOTIFY` для WebSocket-обновлений в реальном времени и `SELECT ... FOR UPDATE` для сериализации конкурентных действий над одним порталом. Без этого пришлось бы городить polling или самодельную блокировку поверх SQLite.
3. **Risk-логика и правила допустимых действий как методы модели `Portal`, а не в роутах** - единая точка проверки состояний, роут просто ловит `BadAction` и превращает в `409`. Это было явным требованием в исходном промпте (этап 2), но сама архитектура - мой выбор.
4. **Формула риска и её веса** - придуманы и зафиксированы мной до передачи агенту (энергия/стабильность/существа/TTL с весами 0.2/0.2/0.3/0.3, насыщающиеся компоненты для существ и TTL вместо линейных - подробнее в разделе "Формула риска" ниже), агент только реализовал.
5. **Решение не тратить время на кэширование (Redis) и не выносить деплой в Kubernetes** - для объёма данных тестового задания это не даёт измеримой выгоды и добавляет точки отказа при проверке; вместо этого время ушло в доменную логику и edge cases.
6. **Решение сделать WebGPU-фон некритичным путём** - вынес выбор бэкенда рендера (`chooseFireBackend`) с фолбэком на 2D-canvas и статику, чтобы визуальный эксперимент не мог сломать основной сценарий проверки.

## Формула риска

Риск считается по явной формуле, взвешивающей четыре компонента портала:

```
risk =
    (energy_level / 100.0) * RISK_ENERGY_WEIGHT
  + (1.0 - stability / 100.0) * RISK_STABILITY_WEIGHT
  + (RISK_CREATURES_SCALE * creatures_count / (RISK_CREATURES_SCALE * creatures_count + 1.0)) * RISK_CREATURES_WEIGHT
  + (1.0 - RISK_TTL_SCALE * ttl / (RISK_TTL_SCALE * ttl + 1.0)) * RISK_TTL_WEIGHT
```

где `ttl` - оставшееся время жизни портала в секундах, а веса и коэффициенты масштабирования вынесены константами:

| Константа               | Значение | Смысл                                                       |
|-------------------------|----------|-------------------------------------------------------------|
| `RISK_ENERGY_WEIGHT`    | 0.2      | вклад уровня энергии                                        |
| `RISK_STABILITY_WEIGHT` | 0.2      | вклад нестабильности (чем ниже стабильность, тем выше риск) |
| `RISK_CREATURES_WEIGHT` | 0.3      | вклад количества существ внутри                             |
| `RISK_TTL_WEIGHT`       | 0.3      | вклад оставшегося времени до схлопывания                    |
| `RISK_CREATURES_SCALE`  | 0.1      | скорость насыщения компонента существ                       |
| `RISK_TTL_SCALE`        | 0.01     | скорость насыщения компонента времени                       |

Компоненты `creatures_count` и `ttl` пропущены через насыщающуюся функцию вида `x / (x + 1)` вместо линейной - это намеренно: разница между 0 и 5 существами внутри портала должна значить куда больше для риска, чем разница между 50 и 55, аналогично для оставшегося времени до схлопывания. Линейная формула дала бы вклад, растущий непропорционально для больших значений; насыщение ограничивает вклад каждого компонента сверху, оставляя формулу интерпретируемой (итоговый риск всегда в `[0, 1]`) и не давая одному экстремальному параметру полностью забить остальные три. Итоговое значение маппится в уровни: `0.0–0.3` - low, `0.3–0.6` - medium, `0.6–0.9` - high, `> 0.9` - critical.

Формула и веса - моё решение, зафиксированное до передачи агенту (см. исходный промпт этапа 2); агент только реализовал её как метод модели.

## Где AI ошибался или предлагал плохие решения

Собрано по всем этапам (подробности - в соответствующих секциях ниже):

- **Безопасность/корректность данных**: почти все поля моделей БД остались `nullable` по умолчанию, хотя по ТЗ обязательны - потребовалось явно указать.
- **Конкурентность - самая серьёзная категория ошибок**: выполнение действий над порталом изначально не было потокобезопасным (гонка при одновременном доступе двух пользователей); отдельно симулятор фона мог перезаписать результат пользовательского действия, читая строку без `FOR UPDATE` (найдено на ревью, не самим агентом).
- **Производительность**: `/stats` изначально грузил все порталы в память и считал агрегаты в Python вместо SQL-агрегатов на стороне БД.
- **Избыточный/неверный код**: повторяющиеся лишние вызовы `model_validate` там, где FastAPI и так сериализует через `response_model`; ручное извлечение cookie из `request` вместо аннотации `Cookie`; `(await session.execute(...)).scalars()` вместо просто `session.scalars()`.
- **Синтаксические и импортные баги**: `except InvalidHashError, VerifyMismatchError:` - синтаксис Python 2, ломал импорт модуля целиком; несуществующий пакет `httpx2` в dev-зависимостях.
- **Инфраструктура**: Dockerfile ставил лишние build-зависимости через `apk` и переустанавливал `poetry` после копирования манифеста зависимостей, теряя кэш слоёв; в CI перепутаны флаги `poetry install` (`--only dev` без `--no-root`).
- **Тестирование**: использовал mock SQLite вместо testcontainers с реальным Postgres - для проекта, где логика завязана на `LISTEN/NOTIFY` и `FOR UPDATE`, это давало ложное чувство покрытия.
- **Галлюцинации**: фронтенд-агент ходил в исходники бэкенда вместо `openapi.json`, хотя это было прямо запрещено промптом.
- **Игнорирование ограничений скоупа**: фронтенд-агент пытался тестами лезть в бэкенд, хотя это было запрещено.
- **Зацикливание**: агент подвис на тестах для обновлений портала, путаясь из-за того, что форматтер переписывал код между попытками чтения - разорвано ручным вмешательством (см. этап 4).
- **Мелкие UI-баги первой итерации**: индикатор изменения риска показывал `+0.00`/`-0.00` при дельте меньше 0.01; закрытые порталы всплывали наверх списка вместо конца.
- **Архитектурные решения похуже**: симулятор изначально запускался только в проде - некорректно, так как это ломает воспроизводимость дев-окружения; `DISABLE_REGISTRATION` был прочитан конфигом, но не прокинут в `docker-compose.yml`, из-за чего настройка не доходила до реального контейнера.
- **Устаревшие/неоптимальные технические решения**: выбрал AntD v5 с плагином совместимости вместо того, чтобы сразу писать на v6.
- **Проблемы с ресурсами при работе с WebSocket**: непронумерованные очереди подписчиков могли расти неограниченно при частых обновлениях от симулятора - потенциальная утечка памяти под нагрузкой.
- **Graceful shutdown**: при неудачном переподключении listener'а `stop()` не мог прервать его backoff-сон, из-за чего остановка приложения могла растягиваться до 30 секунд - превышало грейс-период Docker.

## Что переписано/доработано вручную

Собственно код руками не писал - весь код прошёл через агента. Ручное вмешательство было в форме: явных инструкций на исправление (перечислены построчно в разделах "Ошибки агента" по каждому этапу и в списке выше), ревью и принятия/отклонения предложенных агентом решений, а также нескольких точечных прерываний зацикливания агента короткими директивными промптами (пример - этап 4, "Stop thinking. Re-run black + ruff fully...").

## Как проверял, что приложение реально работает

- Прогонял backend test suite (~99% покрытия) и frontend unit-тесты (>90% покрытия) на каждой итерации через настроенный CI.
- Playwright e2e-сьют (`frontend/e2e/`) против отдельного изолированного docker-compose стека - 9 спек-файлов, включая отдельный `live.spec.ts` с включённым симулятором для проверки, что WebSocket-обновления реально доходят в реальном времени, а не только polling.
- Ручная проверка как пользователь: прошёл все основные сценарии (регистрация/вход, все действия над порталом в разных состояниях, admin-панель, фильтры, пагинация, пустые состояния) в развёрнутом через docker compose приложении.
- Собирал список edge cases до начала тестирования (см. промпт "List the scenarios you tested..." в этапе 4) и сверял, что каждый из них покрыт либо тестом, либо явно проверен вручную.
- Специально проверял поведение при конкурентном доступе (два пользователя выполняют действия над одним порталом одновременно) - вручную и тестом на блокировку строки.
- WebGPU-фон и связанные визуальные эффекты проверял визуально на реальном железе (в том числе на Windows, где обнаружились артефакты) - здесь глубоко в код не вникал, доверился тестам (unit/e2e) и собственному зрению; в реализацию шейдера не вмешивался.

## Что доработал бы, будь это реальным продуктом

- **Кэширование и масштабирование**: сейчас сознательно не делал (см. решения выше) - при реальной нагрузке первым шагом был бы кэш `GET /portals` с инвалидацией по событию и, возможно, вынос симулятора в отдельный воркер вместо фонового таска в том же процессе.
- **Наблюдаемость**: сейчас логирование через встроенный `logging` - добавил бы структурированные логи и трассировку (хотя бы базовый OpenTelemetry) для отладки race conditions в проде, которые сложно воспроизвести локально.
- **Права доступа**: сейчас модель ролей - просто `is_superuser` бинарный флаг; в реальном продукте потребовалась бы более гранулярная модель прав (например, наблюдатели vs операторы vs админы).
- **Rate limiting**: есть базовая защита (`test_ratelimit.py`), но не проработана под реальную нагрузку и распределённое окружение (сейчас, вероятно, in-memory - не переживёт горизонтальное масштабирование).
- **CI/CD деплой**: сейчас CI гоняет только тесты - в реальном продукте добавил бы автоматический деплой с миграциями схемы (сейчас `create_all`, без Alembic - осознанно упрощено для тестового, потребовало бы пересмотра для растущей схемы).
- **WebGPU-фон**: довёл до рабочего состояния как приятный штрих, но в реальном продукте либо довёл бы до полной кроссплатформенной надёжности, либо убрал бы совсем - сейчас это неядровая фича, отнявшая непропорционально много итераций на полировку.
- **Frontend-код от агента**: я не фронтенд-разработчик и не могу дать по нему экспертную оценку на уровне кода - в реальном продукте отдал бы его на ревью фронтенд-инженеру перед продакшеном, а не полагался бы только на тесты и собственную проверку как пользователя.

---

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

## Что сделал агент
- полностью написал код согласно моему ТЗ
- написал тесты и проверил себя благодаря настроенному на этапе 1 CI
- провел само-ревью

## Ошибки агента
- использовал mock sqlite для тестов, хотя лучше использовать testcontainers, я внес корректировку
- `nullable` задана почти нигде в моделях БД. По умолчанию колонки nullable, а по ТЗ почти все поля обязательны.
- тесты должны быть полностью асинхронными на `pytest-asyncio` (и conftest тоже)
- не хватало логирования. Использовать встроенный `logging`.
- в `deps.py` кука извлекалась из `request` вручную, хотя FastAPI умеет это делать через аннотацию `Cookie`.
- коды ошибок не документированы ни для одного эндпоинта, нужно указывать `responses` в декораторе.
- лишние вызовы `model_validate`: если у схемы `ConfigDict(from_attributes=True)`, можно возвращать ORM-объект напрямую, FastAPI сам сериализует через `response_model`. Также злоупотребление `(await session.execute(...)).scalars()` - достаточно `session.scalars()`. Эти проблемы были в `list_users`, `register`, `login`, `me`, `_portal_page`, `action_log`, `execute_action`.
- эндпоинт `/stats` грузит все порталы в память и считает агрегаты в Python, нужно считать через SQL-агрегаты на стороне БД.
- выполнение действий над порталами не являлось потокобезопасным, использование сайта 2мя пользователями одновременно могло привести к гонке состояний

Дополнительно найдено в ходе исправлений:
- `httpx2` - непонятный пакет в dev-зависимостях, заменён на `httpx`.
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

# Этап 3. Фронтенд
Фронтенд создавался небольшими промптами в режиме реального времени с обязательным контролем качества и начальным согласованием макета и стиля.

## Что сделал я
- предложил варианты фреймворков для фронтенда (Next.js, React)
- обсудил с агентом выбор стека
- попросил агента сделать тестовые макеты перед началом основной разработки
- установил способ деплоя приложения: бэкенд и фронтенд на отдельных доменах
- дал комментарии по поводу макетов - карточка портала изначально отображалась в правом сайдбаре, я указал агенту перенести его в модал

## Что сделал агент
- создал тестовые макеты
- обсудил со мной выбор фреймворка и инструментов
- написал моки апи для тестирования
- нашел баг на бэкенде, связанный с вебсокетами и передал его ответственному агенту

## Проблемы агента
- Агент сильно застрял на этапе создания начальных макетов - у него неправильно работал инструмент записи, поэтому он до бесконечности перезаписывал. Я закрыл сессию и запустил нового агента с другой моделью.
- Была ошибка верстки - навигационный сайдбар висел над основной страницей в верхнем левом углу. Агент самостоятельно исправил после указания на проблему.
- Агент проигнорировал требование изучать схему по `openapi.json`, который экспортирует бэкенд, вместо этого полез изучать исходники бэкенда
- Агент не смог подключиться по вебсокету к панели и полез траблшутить бэкенд, что было запрещено промптом.
- Агент выбрал использовать устаревшую версию AntD (v5 вместо v6) и подключил плагин совместимости, хотя можно было написать на v6.

## Ключевые промпты
Поскольку основное описание проекта и требуемые страницы уже были занесены в контекстные файлы бэкенд-агентом, дополнительных объяснений по поводу дизайна не понадобилось.
```
Yes, you can record it. Please start with the implementation. Proceed according to this plan
1) Shut down server and prepare the frontend directory. You can delete the rest of variants but make sure you don't lose sources for embers theme.
2) Write a multi-stage dockerfile for build and serve with minimal RAM consumption.
3) Add `frontend` service to docker-compose.yml. Make sure you pass BACKEND_URL envvar to serve as base url of backend.
4) Add overrides to docker-compose.override.yml.dev to develop frontend with automatic file refresh.
5) Copy the .dev template to override file.
6) Bring backend service up, export the openapi schema for yourself.
7) Proceed with implementation of frontend.
8) Make sure to write tests and proper documentation.
Record this plan in project state and relevant context files before proceeding. Commit each relatively big action. Do not touch backend, if it responds in a weird way simply bring it up. You can test against live backend. You can edit .env file if required.
```

# Этап 2.1. Доработка бэкенда
По результатам этапа 2 параллельно с этапом 3 был запущен параллельный агент для исправления проблем с кодом.

## Что сделал я
- настроил для фронтенда и бэкенда параллельные worktrees и исправил проблему с виртуальными окружениями для pre-commit hooks
- обозначил бэкенд агенту задачу создать возможность фильтрации и сортировки
- обозначил задачу создать симулятор создания и изменения порталов
- убрал эндпоинты документации в проде (DEBUG=0)

## Что сделал агент
- добавил возможность фильтрации и сортировки и написал тесты под нее
- добавил и протестировал симулятор порталов
- с помощью субагентов провел полный ревью бэкенда и нашел несколько важных проблем

## Ошибки агента
- сделал, чтобы симулятор работал только в проде, хотя это не корректно
- при настройке тестов установил переменные среды через os.environ.setdefault вместо применения monkeypatch

## Ключевые промпты
```
Your next task: add a portal populator/simulator. It is a background task that randomly updates some portals every 10 seconds. Changeable values: stability (may increase or decrease), creatures_inside (may decrease or increase). New portals may open with a configurable chance via envvar (default 5% which should be equal to about 1 portal per 3-4 minutes). New portal has completely random values, TTL from 30 seconds to 30 minutes. Write a name generator for worlds and portal names. Also reorder code in routes.portals so that POST /{id} and GET /{id} are nearby.
```

# Этап 4. Интеграция
Интеграция состояла из завершения написания фронтенда, добавления фильтров (которые писались параллельно), тестов для фронтенда и интеграционных тестов. Также был проведен код-ревью бэкенда с помощью gpt-5.6-terra.

Этот этап получился самым длинным и растянутым по времени - сюда попали и код-ревью, и доводка UI по фидбеку, и e2e, и пара экспериментов с визуалом. Ниже сначала идёт разбор по темам, затем - сырые промпты, из которых он собран (не переписывал их набело, чтобы не терять точность формулировок).

## Разбор найденных проблем по темам

**Конкурентность и консистентность данных (бэкенд, самое серьёзное из найденного)**
Ревью на GPT нашло гонку между фоновым симулятором и пользовательским действием (симулятор читал строку портала без `FOR UPDATE` и мог закоммитить поверх результата `STABILIZE`), а также то, что `DISABLE_REGISTRATION` не пробрасывался в `docker-compose.yml`, несмотря на то что читался конфигом - настройка была фактически нерабочей в докер-деплое. Оба исправлены с добавлением тестов на конкретно эти сценарии.

**Устойчивость сервиса при остановке и нагрузке**
Найдено, что при неудачном переподключении к Postgres listener `stop()` не мог прервать backoff-сон - остановка приложения могла растягиваться до 30 секунд и превышать грейс-период Docker. Отдельно - WebSocket-очереди подписчиков были неограниченными: при частых обновлениях от симулятора могли расти без предела. Оба - реальные проблемы для продакшена, но проявились бы не на ревью читателя, а только под нагрузкой или при рестарте - типичный класс багов, которые генерация "с первого раза" пропускает.

**Рассинхронизация фронта с реальным состоянием бэкенда**
Несколько независимых багов одной природы: закрытый портал не всплывал в конец списка на фронте; кнопки не блокировались сразу при закрытии портала (только после переоткрытия модалки); модалка не обновлялась, если портал истекал, пока она была открыта; наблюдатель не отзывался автоматически при закрытии портала на бэкенде. Все - следствие того, что фронтенд-агент сначала реализовал happy path, не подумав о состояниях, которые меняются фоново (симулятором или временем), а не только пользовательским действием. Для случая с истекающей модалкой изначально запросил отдельный WebSocket-эндпоинт на конкретный портал с троттлингом через джиттер (чтобы не создавать нагрузочный всплеск при массовых обновлениях) - но агент несколько раз подряд застревал на этой задаче без видимой причины, и вместо траты токенов на попытки его вытащить решение для именно этого кейса (обновление одной открытой модалки) заменено на простой поллинг. Основной список/таблица порталов на WebSocket не переводился и продолжает получать обновления через него, как и раньше - поллинг используется точечно только для карточки открытого портала.

**UI-полировка и мелкие вёрстка-баги**
Основной объём - несостыковки вёрстки (заголовки таблицы не дотягиваются до фона, наложение колонки кнопок на узких экранах, разные цвета заголовков), нерабочие кнопки сброса фильтров, задвоенные кнопки Send/Recall observer, отсутствующий `/health`-эндпоинт, на который фронт зачем-то стучался. По отдельности мелочи, но в сумме - явный сигнал, что первая генерация UI без явного пошагового ревью выходит функциональной, но неряшливой; пришлось пройти несколько итераций фидбека, прежде чем интерфейс стал выглядеть завершённым, а не сгенерированным.

**Галлюцинации и нарушение границ задачи**
Агент лез траблшутить бэкенд при проблемах с WebSocket-подключением, хотя это было прямо запрещено промптом на этом этапе (границы ответственности между фронтенд- и бэкенд-агентами были явно оговорены заранее). Отдельно фронт делал запрос на `/health`, которого на бэкенде нет и не было - источник этого запроса выяснить не удалось (похоже на какой-то посторонний сервис/расширение, стучавшееся на порт 8000, а не на реальную галлюцинацию агента), но раз причина не подтверждена - просто зафиксировано как баг и закрыто добавлением эндпоинта.

## Итог по чек-листу обязательных сценариев (промпт "List the scenarios...")
Список из 14 сценариев (логин с неверными данными, экстремально длинные значения, пустой список порталов, 10000 порталов, 100000 записей журнала, все действия во всех состояниях, фильтры, права доступа не-суперюзера и т.д.) был сформулирован до начала финальной проверки, чтобы не полагаться на "проверю что вспомню". Все пункты покрыты либо тестами (backend/e2e), либо явной ручной проверкой - соответствие видно в разделах "Обработанные граничные случаи" ниже.

## Ошибки агента этого этапа (сведено из промптов ниже)

- Для работы скриптов популяции БД сначала добавил Poetry в deploy stage Dockerfile, хотя нужно было просто использовать уже собранный venv.
- Индикатор изменения риска показывал `+0.00`/`-0.00`, если реальная дельта была меньше 0.01, вместо того чтобы скрывать незначимые изменения.
- Закрытый портал изначально всплывал в начало списка вместо конца.
- Кнопки действий не блокировались сразу при закрытии портала - только после переоткрытия модалки того же портала.
- Наблюдатель не отзывался автоматически при закрытии портала - оставался "внутри" уже закрытого портала.
- Кнопки сброса фильтров не работали ни на дашборде, ни в журнале.
- Сортировка велась по сырому значению `risk_factor`, а не по уровню опасности - не то же самое на границах категорий.
- Верстка: заголовки таблицы не дотягивались до фона контейнера; колонка кнопок действий перекрывала остальные колонки на узких экранах (баг возвращался повторно после промежуточного фикса); цвет заголовка колонки "Portal" не совпадал с остальными; сам столбец не был прозрачным, хотя должен был.
- Полоса энергии всегда была одного (оранжевого) цвета вместо динамического градиента по значению.
- При открытии модалки была анимация, при закрытии - нет.
- Первая версия WebSocket-эндпоинта для одиночного портала (обновление карточки при истечении срока) несколько раз подряд не давалась агенту без ясной причины зацикливания - решение по этому конкретному кейсу в итоге заменено на простой поллинг, подробнее в разделе "Рассинхронизация фронта" выше.
- Фронт делал запрос на несуществующий `/health` - источник запроса не подтверждён, но исправлено добавлением эндпоинта.
- Использовал устаревшую версию AntD (v5 + плагин совместимости) вместо прямого перехода на v6, хотя это было явно указано первым пунктом в задаче.

## Ключевые промпты и сырые баг-репорты этапа (сокращено; несколько почти идентичных повторных списков объединены в один)
**зацикливание на форматтере**
```
Stop thinking. Re-run black + ruff fully, run backend tests fully then call read tools and then proceed on fixing.
```

**доработка фронтенда**
```
Record a couple ideas while we're waiting for backend
1) AntD must be rewritten to v6 before anything
2) Linter, formatter, coverage checker and pre-commit hooks must be configured
3) New backend will introduce filters and ordering for action logs and dashboard. Frontend needs to support it
4) When portal is marked as "dismissed", it should temporarily disappear from frontend or be moved towards the end
```

**комментарии ревьювера**
```
1. P1: simulator can overwrite a concurrent portal action.
   ~/PycharmProjects/portals-be/backend/app/simulator.py:149 reads mutable portal rows without FOR UPDATE, then commits randomized stability/creatures_count. A simultaneous STABILIZE action (/
   home/exenifix/PycharmProjects/portals-be/backend/app/routes/portals.py:527) does lock its row, but may commit before the simulator’s stale object is flushed, allowing the simulator to overwrite the
   action’s new stability.

   Agent instruction: lock the simulator’s selected open portals with with_for_update() before changing them, and add a two-session concurrency test proving a simultaneous STABILIZE cannot be lost.

2. P1: DISABLE_REGISTRATION does not reach the deployed backend.
   The new setting is documented in ~/PycharmProjects/portals-be/.env.example:16 and read in ~/PycharmProjects/portals-be/backend/app/config.py:100, but ~/
   PycharmProjects/portals-be/docker-compose.yml:23 does not pass it to the backend service. Setting it in the project .env therefore still leaves public registration enabled in Docker deployment.

   Agent instruction: add DISABLE_REGISTRATION: ${DISABLE_REGISTRATION:-0} to the backend service environment and verify the rendered Compose configuration includes it.

3. P2: listener recovery can make shutdown wait up to 30 seconds.
   When reconnection fails, UpdateHub._supervise (~/PycharmProjects/portals-be/backend/app/notifications.py:73) sleeps with exponential backoff. stop() (~/PycharmProjects/portals-
   be/backend/app/notifications.py:86) sets a flag but does not cancel or interrupt that sleep, then awaits the supervisor. After a failed reconnect, application shutdown can exceed the Docker grace
   period.

   Agent instruction: make the supervisor promptly cancellable during stop() and add a test that stops a hub while its reconnect attempt is backing off.

4. P2: simulator notifications can grow WebSocket subscriber queues without bound.
   UpdateHub.broadcast (~/PycharmProjects/portals-be/backend/app/notifications.py:115) puts one item per event into unbounded queues. The simulator emits one notification per changed portal
   every tick, so a slow client or slow snapshot query can accumulate an arbitrarily large queue.

   Agent instruction: use Queue(maxsize=1) and skip enqueueing when a refresh is already pending. This preserves the intended “refresh/coalesce” semantics. Add a test that repeated broadcasts leave only
   one pending refresh.
```

**сводный баг-репорт по фронтенду (объединяет несколько итераций одной темы)**
```
I found following issues
1. Websockets throw errors but seem to work (I do see updates every 10 seconds without polling over http):
Firefox can't establish a connection to the server at ws://localhost:8000/portals/ws?page=1&items_per_page=20&order_by=risk. useSnapshotWs.ts:48:16
The connection to ws://localhost:8000/portals/ws?page=1&items_per_page=20&order_by=risk was interrupted while the page was loading.
2. There's an issue with the table: headers don't fully extend to the end of outer background. Horizontal scroll works
3. Closed portal is displayed on top. It should not be that way, check with backend.
4. Modify backend sorting so that instead of ordering by value of risk factor, it's ordered by danger level.
5. Backend: observer must be automatically recalled on portal closure, i.e. closed portals must not have any observers in
6. Frontend: reset filters button does not work neither in dashboard nor in logs
7. Frontend: I see some requests to \/health being made, however there's no such endpoint
8. Frontend: add "deltas" between last recorded stats in table items, top stats and separate stats
9. Add a line separating scrollable table columns and button column. Also rename "Открыть" to "Детали", "Подробности", "Действия" or similar
10. Merge "Recall observer" and "Send observer" buttons into one. Make sure it refreshes when portal closes
11. The earlier stated task of moving the "dismissed" tasks to the end of the list on frontend side is not implemented.
12. There should be another tab that should display AI-WORKLOG.md rendered as proper html.
13. "Updated" field should not update on portal simulation update, only on actions
14. Add code highlight for the markdown page
15. Preferrably add the markdown via some link/volume instead of creating a copy needing maintenance. If going with link route, make sure it won't break on other platforms.
16. Add python script to automatically populate db with some portals, add bash and ps1 scripts to repo root, they will automatically run docker compose exec backend ... python populate.py
17. Add deploy instructions to README.md before the envvar table.
18. After done, collect previous set of 9 tasks, merge it with this one and simply present the list to me
19. The deltas for risk show +0.00 and -0.00, possibly when the risk factor value is too small. If the delta is below 0.01 in absolute value, don't show it
20. After closing the portal, modal should grey out all buttons except mark. The buttons must be greyed out on closed portals by default (except mark/unmark)
21. Harden both dockerfiles so that it's other user at runtime instead of root. Verify functionality.
```

```
Implement e2e testing using playwright. Deploy special test stack using separate docker compose file, make sure there are no volume and override conflicts.
```

```
List the scenarios you tested and make sure the following are handled:
1. Login with bad username or password
2. Login with extremely long username or password
3. Register with extremely long username or password
4. Register with empty username or password
5. No portals on dashboard
6. 10000 portals on dashboard
7. No action logs
8. 100000 action log entries
9. All actions check in different states
10. All pages accessible
11. Filters set and reset on button click in dashboard and logs
12. Non-superuser can't access admin
13. Can't act with closed portal besides marking
14. Empty stats page
```

```
Next idea: add move animations when portals change positions + some cool fiery shader effects on the sides using wgpu. Make sure to commit before attempting to do that as it might be complicated and might break things.
```

```
Issues:
1) I want a shader effect to cover entire background. And not like fire, but instead spark particles with turbulence and stuff. Current shader is like two columns on each sides of table with rotating ovals, I don't think that's intended.
2) Movement animation works, but it would be better if it was just a bit slower
3) When opening modal, there's an animation, but when closing there's no
4) When closing portal, buttons don't grey out immediately. They're greyed out only when re-opening modal for that portal.
```

```
1) Bug: if the width is too low, "Details" button col overlaps with table columns
2) Stats page should refresh in real time as well. You can just poll every ten seconds if user is on the page, it's fine

Task: add transition animations between pages. Each element popping up with slight jitter offset with bouncy animation would be the best.

Bug: when the portal expires while the modal is open, it does not update automatically and buttons don't grey out

1) For modal expiry bug, implement a websocket endpoint on backend side for individual portal. It will listen to postgres notifies as well, but send updates only if the state of selected portal changed. Make sure to add jitter so we don't get mass update issue where every websocket produces load burst on notify.
2) The dashboard currently has an issue: first the "Portal" column is not transparent. Next: "Portal" column header is of different color than the rest.
```

```
Current bugs
1) The old issue with "Details" button overlaying on narrow screens is back
2) Energy bar is always orange, it should get greener as it approaches zero

Ideas for future (don't start executing yet)
1) Risk should be displayed as integer percentage on frontend
2) Individual portal card should additionally poll to automatically grey out buttons in case portal closes in background
3) If observer is inside, no new creatures should appear during simulation (they can only leave)
```

```
1. Currently there's a global action log for all portals, but there must also be individual history for each portal in the modal. To implement this, follow two steps:
1.1. Add id filter to logs endpoint.
1.2. Connect frontend to that UI: add a collapsible right panel to modal that will open outwards. It's open by default and closes/opens with animation. It displays 5 last actions and a link to logs page to view full history for this exact portal.
2. We need "Recommended action" approach. Let's handle it this way: backend supplies recommended action via individual portal endpoint and frontend flashes that button with purple color (add a purple note that purple is recommended action).
The solution to recommended action is we have a bunch of conditions and each condition corresponds to a dict of recommended actions and points for each. All conditions are checked and action points are summated. If no action points are earned, recommend DISMISSED. Action with highest points is selected, on conflict resolve in following priority: CLOSE > SEND_OBSERVER > WARN_CREATURES > RECALL_OBSERVER > STABILIZE > DISMISS. MARK / UNMARK is never recommended.
1. Observer not inside
Stability < 50: STABILIZE 1
CREATURES == 0: CLOSE 10
TTL < 5 minutes: SEND_OBSERVER 1
2. Observer inside
Stability < 50: STABILIZE 1
TTL < 30 seconds: RECALL_OBSERVER 1
TTL < 5 minutes: WARN_CREATURES 1
CREATURES == 0: RECALL_OBSERVER 10

Recommended action must update after each click. Make sure portals with less than 5 minutes TTL ignore the dismissed behaviour even if they were dismissed previously.

3. Add possibility to force-close the portal with creatures inside, but only for critical portals. Display warning modal before doing that.

As usual, add test cases for everything, commit after each change. Describe the decision tree mechanism in AI-WORKLOG.md in russian after you're done with main tasks.
```

## Осознанно допущенные ситуации
Есть ситуация, что портал критического риска нельзя закрыть, поскольку чтобы предупредить существ, нужно сперва отправить наблюдателя, а наблюдателя в портал с критическим риском отправлять нельзя. Также наблюдатель автоматически возвращается при закрытии портала. (Обновление: принудительное закрытие ниже частично решает первую половину — критический портал с существами теперь закрывается через confirm + `force=true`; отправить наблюдателя в критический по-прежнему нельзя.)

## Рекомендованное действие, история портала и принудительное закрытие

### Дерево решений рекомендованного действия
Рекомендация считается на бэкенде (`Portal.recommended_action` в `backend/app/models.py`) и отдаётся в `PortalSchema` — то есть в списке, в `GET /portals/{id}` и в ответе `POST /portals/{id}`. После каждого действия сервер присылает свежий портал с уже пересчитанной рекомендацией, поэтому на фронтенде она «переезжает» сама, без дополнительных запросов.

Механика — словарь «действие → очки», все условия текущей ветки проверяются, совпадения суммируются:
- Ветка «наблюдателя нет»: стабильность < 50 → STABILIZE +1; существ нет → CLOSE +10; TTL < 5 мин → SEND_OBSERVER +1.
- Ветка «наблюдатель внутри»: стабильность < 50 → STABILIZE +1; TTL < 30 с → RECALL_OBSERVER +1; TTL < 5 мин → WARN_CREATURES +1; существ нет → RECALL_OBSERVER +10.
- Пустой словарь → DISMISS («оставить открытым»). MARK/UNMARK не участвуют никогда.
- Побеждает максимум очков; ничья разрешается фиксированным приоритетом: CLOSE > SEND_OBSERVER > WARN_CREATURES > RECALL_OBSERVER > STABILIZE > DISMISS.
- Закрытые и истёкшие порталы всегда возвращают DISMISS — действия на них недоступны, рекомендовать нечего.

Почему 10 против 1: «портал пуст» — терминальное состояние (можно закрыть, либо отозвать наблюдателя и закрыть следом), поэтому оно доминирует над любой комбинацией единичных сигналов. Единичные сигналы между собой разрешает приоритет: например, наблюдатель внутри + низкая стабильность + TTL 4 мин дают STABILIZE 1 и WARN_CREATURES 1 — побеждает WARN; TTL 20 с добавляет RECALL_OBSERVER 1, но WARN всё равно выше по приоритету. Без наблюдателя STABILIZE 1 + SEND_OBSERVER 1 при TTL < 5 мин разрешаются в пользу SEND_OBSERVER.

Пороги TTL вынесены в константы (`RECOMMEND_TTL_SEND_WARN_SECONDS = 300`, `RECOMMEND_TTL_RECALL_SECONDS = 30` в `backend/app/constants.py`), сравнение строгое (`<`). Рекомендация намеренно не проверяет валидность действия (например, SEND_OBSERVER при критическом риске сервер отклонит) — она отвечает «что делать», а не «что разрешено»; последнее слово всегда за валидацией действий и дословным 409.

Фронтенд (`PortalModal.tsx`): кнопка, совпадающая с `recommended_action`, получает пульсирующий фиолетовый контур (`.portal-action-recommended`, под reduced motion — статичный), в подписи пояснено, что фиолетовый — рекомендованное действие. Сравнение идёт по резолвленному действию тогглов (SEND/RECALL, MARK/UNMARK), поэтому подсветка всегда ложится на видимую кнопку. На закрытом портале подсветка не показывается.

### Игнорирование dismissed при TTL < 5 минут
Проблема: DISMISS отклоняется при TTL ≤ 5 мин, но портал, отложенный раньше, мог «состариться» в это окно и остаться припаркованным внизу списка — оператор переставал видеть срочный портал. Решение: клауза `dismissed_sinks` в `_portal_order_clauses` теперь требует одновременно `dismissed_until > now` И `expires_at > now + DISMISS_MIN_TTL_SECONDS` (порог считается в Python, в SQL уходят два bound-параметра). Просроченное окно игнорируется во всех режимах сортировки, портал возвращается на естественную позицию. Покрыто тестом `test_dismissed_urgent_portal_ignores_parking`.

### Принудительное закрытие
`Portal.close(force=False)`: без флага — как раньше (существа внутри → `BadAction`); с `force=True` — только при `danger_level == CRITICAL`, иначе `BadAction` «Принудительное закрытие разрешено только для порталов с критическим уровнем опасности». Закрытие по-прежнему отзывает наблюдателя и пишется в журнал как обычный CLOSE (отдельного enum не заводили). Роут: `POST /portals/{id}?action=CLOSE&force=true`, поведение задокументировано в `description` эндпоинта. Фронтенд: клик «Закрыть» на критическом портале с существами открывает confirm-модалку с предупреждением и числом существ; подтверждение уходит с `force=true`. На некритическом запрос идёт как обычно и сервер отвечает 409 с дословной причиной.

### История портала в модалке
Фильтр `portal_id` в `GET /portals/log` (и `/log/ws`) уже существовал на бэкенде — дописывать не пришлось; во фронтенд-типы (`ActionLogParams`, `LogFiltersState`, `actionLogQuery`) добавлены `portalId`/`userId`, которые раньше просто не пробрасывались. Панель в модалке: открыта по умолчанию, схлопывание/раскрытие — CSS-анимация `max-width`/`opacity` (модалка при этом расширяется наружу 720px → 1040px), внутри 5 последних записей (Tag действия + относительное время + пользователь) и ссылка «Полная история портала» на `/log?portal_id=N`. `LogPage` читает `portal_id` из URL при монтировании и показывает chip «Показаны действия портала #N» с кнопкой «Показать все»; «Сбросить» тоже чистит параметр.

### Тесты
- Бэкенд (142 pytest, все зелёные): матрица рекомендаций по обеим веткам, доминирование 10 очков, все ничьи по приоритету, fallback DISMISS, закрытые/истёкшие → DISMISS; force-close на модели и на роуте (critical + существа → 200 и запись CLOSE в журнале, non-critical → 409, без флага → 409, force на закрытом → 409); игнор dismissed при TTL < 5 мин; поле `recommended_action` в payload списка/деталей и его обновление после STABILIZE (стабильность 45 — детерминировано, т.к. буст +10..+30 всегда выводит за 50).
- Фронтенд (135 vitest, tsc/oxlint/prettier/build зелёные): маппинг `portal_id`/`user_id` в `actionLogQuery`; фиолетовая подсветка рекомендованной кнопки + легенда; панель (запрос с `portal_id`, ссылка `/log?portal_id=N`, collapse/expand по классам — в jsdom нет layout, поэтому `toBeVisible` неприменим); confirm + `force=true` на критическом, обычный CLOSE без confirm на некритическом; `LogPage` предфильтр из URL + очистка.

# Обработанные и покрытые тестами граничные случаи: Auth и Portals

## Auth (регистрация / вход / выход / me / сессии, включая администрирование пользователей)

### Обработанные граничные случаи
- Границы длины username/password задаются константами, общими для моделей БД и валидаторов Pydantic (`USERNAME` 4–64, `PASSWORD` 8–128) -> `422` при слишком коротком / слишком длинном / отсутствующем поле.
- Дубликат username при регистрации или создании администратором -> `409` (проверка до вставки + уникальный индекс).
- Вход с неверным паролем или неизвестным username -> одинаковый `401`, без перечисления пользователей.
- Проверка пароля fail-closed: `verify_password` ловит `InvalidHashError` и `VerifyMismatchError` и возвращает `False` вместо исключения.
- Сессионная cookie: httpOnly, `samesite=lax`, `Secure` кроме случая `DEBUG`; токен хранится в `LoginSession` со сроком жизни 14 дней.
- Истёкший токен сессии -> `401` (срок проверяется при каждом аутентифицированном запросе).
- Выход: удаляет строку `LoginSession` и чистит cookie; идемпотентен -> `204` даже без токена.
- Все защищённые маршруты (`/auth/me`, `/admin/*`, `/portals*`, WebSocket) -> `401` без валидной cookie.
- Администрирование: обычный пользователь -> `403`; созданному пользователю нельзя установить флаг суперпользователя; удаление суперпользователя -> `409`; несуществующий пользователь при удалении / смене пароля -> `404`; длина пароля -> `422`.
- Сессия, у которой удалён пользователь (`login_session.user is None`), считается неаутентифицированной (обрабатывается в `deps.authenticate_session_token`; напрямую не тестируется - целостность FK, без теста).

### Некоторые тесты
- `tests/test_auth.py`
  - `test_register_login_me_logout` - полный сценарий: регистрация -> `401` до входа -> вход выдаёт cookie -> me -> выход -> снова `401`
  - `test_register_duplicate_username` - `409` при повторной регистрации
  - `test_login_invalid_credentials` - неверный пароль и неизвестный пользователь -> `401`
  - `test_register_validation_errors` - `422` для короткого username / короткого пароля / отсутствующего поля
  - `test_logout_is_idempotent` - выход без сессии -> `204`
  - `test_expired_session_token_rejected` - истёкший токен в БД -> `/auth/me` `401`
- `tests/test_admin.py`
  - `test_admin_requires_superuser` - обычный пользователь -> `403`
  - `test_admin_requires_auth` - аноним -> `401`
  - `test_create_and_list_users` - создание возвращает не суперпользователя; список содержит обоих
  - `test_create_duplicate_user` - `409`
  - `test_set_password` - смена пароля работает (старая cookie инвалидируется выходом, новый пароль входит)
  - `test_set_password_missing_user` - `404`
  - `test_delete_user` - пользователь удалён, список сократился
  - `test_delete_superuser_forbidden` - `409`
  - `test_delete_missing_user` - `404`

## Portals (список / действия / журнал / статистика / WebSocket / уведомления)

### Обработанные граничные случаи
- Все HTTP-маршруты и оба WebSocket-эндпоинта требуют аутентификации -> `401` (HTTP) / закрытие `4401` (WS, `accept()` не вызывается).
- Пагинация: `page >= 1`, `items_per_page` в пределах 1..100, `total` сохраняется; постраничная выборка со смещением.
- Производные поля портала: `closed = expires_at <= now OR is_closed`; `risk_factor` ограничивает TTL на нуле (никогда не отрицателен для истёкших порталов); `danger_level` - уровни LOW/MEDIUM/HIGH/CRITICAL.
- Правила действий валидируются в методах модели `Portal` (кидают `BadAction` с описанием на русском; маршрут преобразует в `409`):
  - любое действие, кроме mark/unmark, на закрытом/истёкшем портале -> `409`
  - `close` - отклоняется, пока внутри есть существа или наблюдатель
  - `stabilize` - отклоняется, если стабильность уже `>= 50`
  - `send_observer` - отклоняется при критическом уровне опасности или если наблюдатель уже внутри
  - `recall_observer` - отклоняется, когда наблюдателя нет
  - `mark` / `unmark` - отклоняются при уже отмеченном / не отмеченном портале
  - `warn_creatures` - требует наблюдателя и наличия существ; при успехе обнуляет `creatures_count`
  - `dismiss` - только обновляет `last_update`, отклоняется на закрытом портале
- Неизвестный `portal_id` -> `404`; некорректное значение `action` -> `422` (валидация enum во FastAPI).
- Безопасность коммита: строка портала блокируется `SELECT ... FOR UPDATE` на время действия (конкурентные действия над одним порталом сериализуются); изменение портала + `ActionLogEntry` + `pg_notify` для `portal_changes`/`action_log_changes` находятся в одной транзакции - уведомления доходят до подписчиков только при состоявшемся коммите; отклонённое действие ничего не коммитит.
- Журнал действий: сначала новые (`timestamp DESC, id DESC`), записи содержат выполнившего пользователя; требует аутентификацию и по HTTP, и по WS.
- Статистика считается SQL-агрегатами: количество открытых/закрытых/отмеченных/с наблюдателем, распределение по уровням опасности для открытых порталов (все четыре уровня присутствуют всегда, отсутствующие обнуляются), средний риск; порталы с истёкшим сроком считаются закрытыми.
- WebSocket-цикл (`_hub_snapshot_loop`): начальный снимок при подключении; повторная отправка при каждом событии хаба; отключение клиента -> отписка + закрытие; произвольный текст клиента (ping) игнорируется, цикл продолжается.

### Тесты
- `tests/test_portals.py`
  - `test_list_portals_requires_auth` - `401`
  - `test_list_portals_paginated` - постраничная выборка + `total`
  - `test_portal_payload_matches_schema` - точный набор полей ответа, включая производные `closed`/`risk_factor`/`danger_level`
  - `test_execute_action_flow` - happy path: mark, warn_creatures (включая `creatures_count == 0`), recall, stabilize, dismiss, отправка/отзыв наблюдателя, close
  - `test_execute_action_rejected` - `409` для close с существами и recall без наблюдателя, detail непустой
  - `test_execute_action_unknown_portal` - `404`
  - `test_action_log` - записи фиксируются, сначала новые, пользователь привязан
  - `test_action_log_requires_auth` - `401`
  - `test_stats` - суммы/пропорции, распределение опасности сходится с числом открытых
  - `test_stats_requires_auth` - `401`
  - `test_committed_action_wakes_both_hubs` - выполненное действие будит подписчиков обоих каналов `portal_changes` и `action_log_changes`
  - `test_rejected_action_sends_no_notification` - действие с `409` -> нет записи в журнале, портал не изменён, ни один хаб не уведомлён
- `tests/test_ws.py`
  - `test_hub_snapshot_loop_exits_on_disconnect` - цикл завершается и отписывается при отключении
  - `test_hub_snapshot_loop_pushes_snapshot_on_event` - событие хаба вызывает отправку свежего снимка
  - `test_hub_snapshot_loop_ignores_client_ping` - текст клиента не ломает цикл
  - `test_portal_ws_rejects_anonymous` / `test_log_ws_rejects_anonymous` - `4401`, подключение не принимается
  - `test_portal_ws_sends_initial_snapshot_and_exits` / `test_log_ws_sends_initial_snapshot_and_exits` - аутентифицированный клиент получает начальный снимок страницы/журнала
- `tests/test_models.py`
  - `test_risk_factor_and_danger_level` - все четыре уровня опасности, ограничение риска на истёкшем портале
  - `test_closed_flag_makes_portal_unactionable` - закрытый/истёкший портал отклоняет действия
  - `test_mark_unmark_allowed_on_closed_portal` - mark/unmark - единственные действия, разрешённые на закрытом портале (включая unmark неотмеченного)
  - `test_action_rules` - пути принятия и отклонения close/stabilize/send_observer/mark/warn_creatures (warn также обнуляет существ)
- `tests/test_notifications.py`
  - `test_hub_receives_postgres_notify` - реальный Postgres NOTIFY будит подписчиков на обоих каналах
  - `test_hub_idempotent_stop` - повторный `stop()` безопасен
  - `test_hub_broadcast_wakes_all_subscribers` - broadcast рассылается всем подписчикам, отписка удаляет

## Вспомогательные инфраструктурные тесты (не Auth/Portals, но часть набора)
- `tests/test_db.py::test_db_lifecycle_guards` - `get_session_factory`/`create_all` кидают исключение до `init_db`; повторная инициализация работает
- `tests/test_main.py::test_lifespan_starts_and_stops_hubs` - lifespan приложения запускает/останавливает оба LISTEN/NOTIFY хаба
- `tests/test_config.py` - разбор `_as_bool`/значения по умолчанию, `DATABASE_URL` переопределяет собираемый URL

## WebGPU-фон: диагностика и починка артефактов на Windows (с консультацией Claude Sonnet)

### Симптомы
На Windows (Chrome, дискретная NVIDIA) огненный фон был сломан, а на Linux всё выглядело нормально. По очереди наблюдалось: частицы искажены и летят вниз вместо вверх; случайные чёрные квадраты и ошибки Dawn в консоли (`texture size exceeded`, `Could not create the swapchain texture`); точки не помещаются в свои «квадраты» (видимые границы ячеек сетки); точки гораздо крупнее, чем на Linux, и их больше; при перетаскивании окна между мониторами точки сплющивались по вертикали; подвисания при каждом обновлении данных; при переходе на страницу журнала фон полностью замирал. Позже выяснилось ключевое обстоятельство: на Linux WebGPU-адаптера нет, и там всегда работал 2D-canvas-фолбэк - «рабочего шейдера на Linux» не существовало, сравнивать было не с чем.

### Причины, найденные локально
- Неверный знак скролла поля: при y-down UV вычитание `t * speed` двигало узор вниз; сложение двигает вверх.
- Неверный диапазон UV в комментарии и коде (`[0, 2]` вместо фактических `[0, 1]` видимой области `fullScreenTriangle`) - поле было ужато вдвое по горизонтали, а центр эллиптического затухания оказался у правого края.
- Перевёрнутые аргументы `smoothstep` (edge0 > edge1) - неопределённое поведение по спецификации WGSL; на DirectX давало мусор (чёрные квадраты).
- Аккумулятор цикла `let best = 0` выводился как `i32` - сохранение яркости усекалось до целого, точки полностью пропадали.
- Холст размером с документ (absolute на весь `.app-shell`): на длинных страницах текстура вырастала до 2545×8577 и превышала лимит GPU - смерть свопчейна и замирание фона (страницы журнала - самые длинные, поэтому freeze был именно там).
- Обрезка точек на границах ячеек: пиксель рисовал только искру своей ячейки, точки у границ обрезались по линии сетки (квадратные артефакты).

### Консультация Claude Sonnet
Для разбора оставшихся лагов и различий с Linux был составлен `QUESTION.md` в корне проекта (полные исходники `frontend/src/components/fire/*`, отладочный снимок `fireDebug()`, пять вопросов) и задан старшей модели. Диагноз подтвердился и был дополнен: доминирующая стоимость - 27 тапов с `sin`-хэшем на пиксель; безусловное присваивание `canvas.width` пересоздаёт свопчейн; `alphaMode: "premultiplied"` при всегда непрозрачном выводе мешает композитору; неограниченный рост `time` во float теряет дробную часть (медленный фликер); нет паузы в скрытой вкладке и обработки `device.lost`.

### Что внедрено по итогам
- Один тап на пиксель: центры искр ограничены диапазоном `[R, 1 − R]` внутри ячейки, ни одна точка не пересекает границу (поиск по соседям 3×3 удалён - экономия ~9×).
- Sin-free хэш (мультипликативный `fract`-каскад) вместо `sin(dot)·43758`; один хэш на ячейку кормит плотность, центр и фазу.
- Мерцание приведено к форме фолбэка (медленное, неглубокое, с полом 0.45) - разница «на Linux мерцает меньше» была разницей констант двух разных рендереров.
- Рендер в половинном разрешении обоих путей с апскейлом браузера; guard присваивания `canvas.width`; `alphaMode: "opaque"`; `time % 3600`; пропуск кадров при `document.hidden`; сброс кэшированного root при `device.lost` с откатом на фолбэк.
- Отладочный зонд: `fireDebug()` в консоли (запрошенный/активный бэкенд, счётчик кадров, CSS- и canvas-размеры, DPR, адаптер) плюс однострочный `[fire]`-лог при резолве бэкенда; холст стал `position: fixed` (размер вьюпорта).
- Платформенная политика: на Windows всегда используется ember-фолбэк - тот же код, что на Linux (Model: `chooseFireBackend`, тест на Windows-UA, пометка в `frontend/README.md`). Шейдер оставлен для остальных платформ до проверки на реальном железе.

## Эксперимент: новый WebGPU-фон «магические потоки» (вместо искр)

### Замысел и механика эксперимента
Вместо доводки старых редких искр написан с нуля другой эффект: длинные текучие потоки поперёк экрана плюс плотная мелкая пыль. Для этого добавлен query-override `?fire=webgpu|ember|static` (`chooseFireBackend`, побеждает все эвристики) и временная панель отладки в сайдбаре

### Итерации по фидбеку
- Скорость уменьшена примерно вдвое; турбулентность отвязана от формы точек (новый параметр `warpScale`: 0 - идеально круглые точки в жёстком пространстве, 1 - warp их месит).
- Плотность: два слоя пыли (260/520, пороги 0.35/0.45) - сотни тысяч мелких точек; яркость поднята.

### Итоговая политика
Шейдер потоков стал фоном по умолчанию везде, где есть GPU, включая Windows (временное правило "на Windows всегда ember" отменено). Откатная лестница сохранена: `?fire=ember`, отказ инициализации, фолбэк, `device.lost`, переинициализация. Проверено: unit 129/129, backend 134/134, e2e 38/38, визуально на реальном железе.
