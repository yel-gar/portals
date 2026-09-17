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
