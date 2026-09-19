# Порталы — фронтенд

React SPA панели управления лабораторией порталов. Работает в связке с FastAPI-бэкендом
(`backend/`) по JSON HTTP и двум snapshot WebSocket-каналам. UI на русском, код и
идентификаторы на английском. Стек: **React 19 + Vite 8 + TypeScript (strict) + Ant Design v6 +
TanStack Query + React Router v7**; тесты — **Vitest + Testing Library + MSW**.

## Структура

```
frontend/
  src/
    api/            клиент и типы: types.ts (зеркала схем бэкенда), client.ts (fetch,
                    ApiError, разбор detail), endpoints.ts (auth/portals/admin)
    hooks/          useSnapshotWs (snapshot WebSocket), useLiveSnapshot (запись в кэш Query),
                    usePortalData (страницы + stats), usePortalAction, useAuth
    components/     AppLayout, PortalTable, PortalModal, StatCards, DangerTag, LiveBadge,
                    PortalFiltersBar, LogFiltersBar, AuthShell, RequireAuth/RequireSuperuser
    pages/          Login, Register, Portals, Log, Stats, AdminUsers, NotFound
    test/           mocks.ts (MSW handlers), fakeWs.ts (FakeWebSocket), render.tsx
    constants.tsx   только презентационные данные (лейблы, цвета, иконки) — без бизнес-логики
    format.ts       относительное время, «осталось», ru-RU дата (с инъекцией `now` для тестов)
    theme.ts        токены темы «Угли» (тёмная, акцент #ff6a00)
```

Бэкенд — единственный источник истины. Фронтенд:
- не считает риск/уровень опасности и не проверяет допустимость действий — оценки и
  ошибки 409/422 приходят от сервера и показываются как есть;
- не хранит токены — аутентификация по httpOnly-куке `session_token` (`credentials: "include"`)
  во всех запросах;
- не делает client-side сортировку/фильтрацию/поиск — пагинация и все фильтры
  (`closed`/`danger_level`/`has_observer`/`is_marked`/`search`/`order_by` для порталов,
  `action`/`order_by` для журнала) — серверные; один и тот же строитель запроса
  (`portalListQuery`/`actionLogQuery`) используется для REST и snapshot-URL WS, поэтому
  оба канала всегда запрашивают одну и ту же отфильтрованную страницу.

## Live-обновления (snapshot WebSocket)

`GET /portals/ws` и `GET /portals/log/ws` пушат **полные снапшоты страницы** (те же
`PortalListSchema`/`ActionLogListSchema`, что и REST). Каждый кадр целиком заменяет
закешированную страницу через `queryClient.setQueryData` в тот же ключ, что и REST-запрос
(атомарная замена, без склейки). REST дополнительно опрашивается каждые 30 с (порталы/журнал)
и 20 с (stats — отдельного канала нет), чтобы подхватывать изменения по истечению
`expires_at`. Что приходит позже — REST или WS-кадр — просто побеждает.

`useSnapshotWs` (обёртка `useLiveSnapshot`):
- переподключается с экспоненциальной задержкой (1 c → 15 c) при неожиданном закрытии;
- код закрытия **4401** после accept трактует как «сессия истекла»;
- закрытие **до** завершения рукопожатия (бэкенд отклоняет мёртвую куку HTTP-403, а браузер
  отдаёт его как ошибку 1006) также инициирует перепроверку `me` — если сессия действительно
  истекла, приложение уходит на страницу входа; если это была просто сеть — переподключение
  просто продолжается.

## Переменные окружения

| Переменная        | Где используется        | Пример                  |
| ----------------- | ----------------------- | ----------------------- |
| `BACKEND_URL`     | compose; build-arg в `Dockerfile` (prod) / runtime env (dev) | `http://localhost:8000` |
| `VITE_BACKEND_URL`| собирается в бандл как base origin API (dev — runtime)       | `http://localhost:8000` |
| `VITE_DISABLE_REGISTRATION` | устанавливается compose из `DISABLE_REGISTRATION` (build-arg в prod, runtime env в dev); когда истинно, страница регистрации показывает «Регистрация отключена» вместо формы | `0` |
| `FRONTEND_PORT`   | host-порт контейнера фронтенда (см. корневой README)         | `3000`                  |

При пустом `VITE_BACKEND_URL` клиент обращается к собственному origin (за reverse proxy).

## Запуск

Всё запускается из корня репозитория через docker compose:

- **Production**: `docker compose up --build -d` — build-стадия собирает бандл с
  `BACKEND_URL`, serve-стадия отдаёт статику через nginx (SPA-fallback, gzip).
- **Dev (HMR)**: `docker-compose.override.yml` (копия `.dev`-шаблона) — контейнер с Vite,
  bind-mount `./frontend`, named-volume `frontend_node_modules`, runtime `VITE_BACKEND_URL`;
  порт 80 внутри, наружу `${FRONTEND_PORT:-3000}`.

Локально, без docker: `npm ci && npm run dev` (нужен `VITE_BACKEND_URL` в окружении).

## Проверки

```bash
npm run typecheck   # tsc -b --noEmit
npm run test:run    # vitest run (jsdom)
npm run build       # tsc -b && vite build
```

- MSW перехватывает HTTP (handlers — в `src/test/mocks.ts`); пути обработчиков задаются
  абсолютными, т.к. path-only паттерны не матчатся против чужого origin в текущей версии MSW.
- jsdom не реализует `WebSocket` и `matchMedia`/`ResizeObserver` — глобалы подменяются в
  `src/test/setup.ts` и `src/test/fakeWs.ts` (управляемый `FakeWebSocket` для проверки
  reconnect/backoff/4401/1006).
- `test.env.VITE_BACKEND_URL` в `vite.config.ts` фиксирует origin для тестов; `BACKEND_ORIGIN`
  в `mocks.ts` должен совпадать.

## Ключевые решения

- Тема «Угли», деталь портала — центрированный Modal 720px, действия по 3 в ряд (см.
  `.context/DECISIONS.md`).
- Кнопки действий всегда доступны (не блокируются на клиенте); сервер решает и отвечает
  409/422 — сообщение показывается дословно.
- MARK/UNMARK — одна кнопка-переключатель по `is_marked`.
- `danger_levels`/`avg_risk` в статистике считаются сервером по **открытым** порталам;
  распределение на странице Stats — доля от `open`, не от `total`.
