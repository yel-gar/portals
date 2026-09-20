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
                    fire/ (фоновая подложка-искры на весь экран), см. ниже
    pages/          Login, Register, Portals, Log, Stats, AdminUsers, Worklog, NotFound
    test/           mocks.ts (MSW handlers), fakeWs.ts (FakeWebSocket), render.tsx
    constants.tsx   только презентационные данные (лейблы, цвета, иконки) — без бизнес-логики
    format.ts       относительное время, «осталось», ru-RU дата (с инъекцией `now` для тестов)
    theme.ts        токены темы «Угли» (тёмная, акцент #ff6a00)
```

Бэкенд — единственный источник истины. Фронтенд:

- не считает риск/уровень опасности и не проверяет допустимость действий — оценки и
  ошибки 409/422 приходят от сервера и показываются как есть. Единственное client-side
  исключение: на закрытом портале кнопки всех действий, кроме MARK/UNMARK, отключены сразу
  (сервер всё равно ответил бы 409) — это подсказка, а не проверка.
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
и 10 с (stats — отдельного канала нет), чтобы подхватывать изменения по истечению
`expires_at` и освежать карточки stats, пока страница смонтирована. Что приходит позже —
REST или WS-кадр — просто побеждает.

`useSnapshotWs` (обёртка `useLiveSnapshot`):

- переподключается с экспоненциальной задержкой (1 c → 15 c) при неожиданном закрытии;
- код закрытия **4401** после accept трактует как «сессия истекла»;
- закрытие **до** завершения рукопожатия (бэкенд отклоняет мёртвую куку HTTP-403, а браузер
  отдаёт его как ошибку 1006) также инициирует перепроверку `me` — если сессия действительно
  истекла, приложение уходит на страницу входа; если это была просто сеть — переподключение
  просто продолжается.

## Переменные окружения

| Переменная                  | Где используется                                                                                                                                                             | Пример                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `BACKEND_URL`               | compose; build-arg в `Dockerfile` (prod) / runtime env (dev)                                                                                                                 | `http://localhost:8000` |
| `VITE_BACKEND_URL`          | собирается в бандл как base origin API (dev — runtime)                                                                                                                       | `http://localhost:8000` |
| `VITE_DISABLE_REGISTRATION` | устанавливается compose из `DISABLE_REGISTRATION` (build-arg в prod, runtime env в dev); когда истинно, страница регистрации показывает «Регистрация отключена» вместо формы | `0`                     |
| `FRONTEND_PORT`             | host-порт контейнера фронтенда (см. корневой README)                                                                                                                         | `3000`                  |

При пустом `VITE_BACKEND_URL` клиент обращается к собственному origin (за reverse proxy).

## Запуск

Всё запускается из корня репозитория через docker compose:

- **Production**: `docker compose up --build -d` — build-стадия собирает бандл с
  `BACKEND_URL`, serve-стадия отдаёт статику через nginx (SPA-fallback, gzip), nginx
  работает под пользователем `nginx` (не root).
- **Dev (HMR)**: `docker-compose.override.yml` (копия `.dev`-шаблона) — контейнер с Vite,
  bind-mount `./frontend`, named-volume `frontend_node_modules`, runtime `VITE_BACKEND_URL`;
  порт 80 внутри, наружу `${FRONTEND_PORT:-3000}`. Vite работает под пользователем `node`
  (uid 1000 — совпадает с хостовым, поэтому bind-mount полностью доступен) и слушает порт 80
  через capability `NET_BIND_SERVICE`, а не root.
- В обоих режимах корневой `AI-WORKLOG.md` монтируется так, что страница `/worklog` читает
  его по `/AI-WORKLOG.md` (prod — в html-каталог nginx, dev — в `public/` Vite); вшитой копии
  нет.

Локально, без docker: `npm ci && npm run dev` (нужен `VITE_BACKEND_URL` в окружении).

## Проверки

```bash
npm run lint          # oxlint (correctness/suspicious error, perf warn; warnings fail)
npm run format:check  # prettier --check
npm run typecheck     # tsc -b --noEmit
npm run test:run      # vitest run (jsdom)
npm run coverage      # vitest run --coverage (v8: text + lcov → coverage/lcov.info)
npm run build         # tsc -b && vite build
```

- Pre-commit (из корня репозитория) прогоняет `prettier --write` и `oxlint --fix` по
  изменённым `frontend/**` файлам (те же паттерны, что и бэкенд-хуки).
- Конфиги: `.oxlintrc.json` (плагин react, ESLint-style `style` выключен — за стиль
  отвечает Prettier), `.prettierrc.json` (`printWidth: 100`), `.prettierignore`.
- CI: `.github/workflows/frontend-ci.yml` (format/lint/typecheck/build + vitest, Node 24)
  и `frontend-coverage.yml` (загрузка `coverage/lcov.info` как артефакт).

- MSW перехватывает HTTP (handlers — в `src/test/mocks.ts`); пути обработчиков задаются
  абсолютными, т.к. path-only паттерны не матчатся против чужого origin в текущей версии MSW.
- jsdom не реализует `WebSocket` и `matchMedia`/`ResizeObserver` — глобалы подменяются в
  `src/test/setup.ts` и `src/test/fakeWs.ts` (управляемый `FakeWebSocket` для проверки
  reconnect/backoff/4401/1006).
- `test.env.VITE_BACKEND_URL` в `vite.config.ts` фиксирует origin для тестов; `BACKEND_ORIGIN`
  в `mocks.ts` должен совпадать.

## E2E (Playwright, docker compose)

Сквозной набор — `frontend/e2e/` + `playwright.config.ts` в корне фронтенда. Работает против
**выделенного** стека `docker-compose.e2e.yml` (проект `portals-e2e`, порты 8010/3010,
свои network/volume, без `.env` и без dev-override) — не трогает запущенный dev/prod стек:

```bash
npm run test:e2e          # оба проекта: детерминированный набор + live-смоук
npm run test:e2e:chromium # только детерминированные спеки (DISABLE_SIMULATOR=1)
npm run test:e2e:live     # live-смоук: симулятор включён, обновления по WebSocket
npm run test:e2e:ui       # Playwright UI-режим для отладки
```

Подробности (подготовка стека, сидирование, порядок файлов, live-проект, teardown) — в
корневом README, раздел «E2E tests (Playwright)». Настройки Playwright — в
`tsconfig.e2e.json` (проект typecheck'ится вместе с приложением), спеки исключены из vitest
(`vite.config.ts` → `test.exclude`).

## Ключевые решения

- Тема «Угли», деталь портала — центрированный Modal 720px, действия по 3 в ряд (см.
  `.context/DECISIONS.md`).
- Кнопки действий доступны всегда, кроме закрытых порталов: там остаются только
  MARK/UNMARK, остальные отключены на клиенте как подсказка — сервер остаётся источником
  истины и отвечает 409/422, сообщение показывается дословно. Открытая карточка опрашивает
  `GET /portals/{id}` каждые 10 c, поэтому кнопки гаснут и при закрытии портала в фоне
  (истечение), не дожидаясь обновления снапшота страницы. Закрытие необратимо и
  защёлкивается: запоздавший открытый снапшот страницы никогда не возвращает карточку
  в открытое состояние.
- MARK/UNMARK — одна кнопка-переключатель по `is_marked`.
- Дельта-бейджи риска и среднего риска скрываются при |изменение| < 0.01 (дрожание
  float-значений) — порог чисто презентационный.
- Журнал разработки (`/worklog`): `AI-WORKLOG.md` отдаётся фронтендом с собственного origin
  (bind-mount в compose), рендер `react-markdown`, подсветка кода `rehype-highlight`
  (`detect + ignoreMissing`) + тема `highlight.js` github-dark; ошибка загрузки показывает
  retryable-`Alert`.
- `danger_levels`/`avg_risk` в статистике считаются сервером по **открытым** порталам;
  распределение на странице Stats — доля от `open`, не от `total`.
- Декоративная фоновая подложка (`src/components/fire/`): WebGPU-шейдер искрящихся
  частиц с завихрениями (TypeGPU, TS-first WGSL, код-сплит chunk — тянется только когда
  `navigator.gpu` доступен), покрывает весь фон приложения, включая сайдбар; 2D-canvas-эмбер-фолбэк с
  восходящими искрами, а при `prefers-reduced-motion` — статичный градиент без
  анимационного цикла. Слой абсолютный с `z-index: -1`, `pointer-events: none`,
  `aria-hidden`; фолбэк выбирается по результату init и сохраняется
  в `data-fire-backend` (static/webgpu/ember). Поверх подложки основные поверхности UI
  прозрачны (обычный rgba, без blur — сайдбар/шапка в `app.css`, карточки/таблица/инпуты
  через `colorBgContainer` в `theme.ts`: сайдбар 0.42, шапка 0.4, контейнеры 0.45), чтобы
  искры просвечивали сквозь весь интерфейс; диалоги (модалка, дропдауны, сообщения) —
  лишь слегка прозрачны (`colorBgElevated` 0.75) ради читаемости.
- Перестановка строк таблицы порталов анимируется FLIP-переходом (`src/hooks/useFlip.ts`,
  только `PortalTable`, ключ `portal.id` → `data-flip-key`): замер позиций в layout-effect
  после коммита, WAAPI `translateY` (400 мс); пропускается на первом рендере и под reduced
  motion.
- Переходы между страницами (`AppLayout`): при смене маршрута роутер-поддерево и заголовок
  в шапке перемонтируются через `key={pathname}`, и каждый верхнеуровневый блок страницы
  появляется с упругим «подпрыгиванием» (`cubic-bezier(0.34, 1.56, 0.64, 1)`, 0.42 s,
  `backwards`) и лёгким джиттером траектории (`--rise`/`--jitter` по `nth-child`,
  стаггер задержек 0–180 мс). Обёртка — `display: contents`, отступы `.app-content` не
  затрагиваются; под `prefers-reduced-motion` анимации полностью выключены (мгновенный
  рендер, e2e-спеки детерминированы).
