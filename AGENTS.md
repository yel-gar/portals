# Backend info
Backend is inside `backend/` folder. Backend uses async FastAPI with SQLAlchemy, asyncpg as database backend. Dependency control system is poetry, so use `poetry` to run scripts and manage dependencies. Test system is pytest. Test coverage is controlled by coverage.py. Pre-commit hooks are set up in root directory.

# Frontend info
Frontend is a React SPA scaffolded with Vite, written in strict TypeScript. It lives in `frontend/` (not scaffolded yet — layout TBD with user). It talks to the FastAPI backend over JSON HTTP and WebSockets; there is no SSR/SSG.

Stack (confirmed with user):
- React + Vite + TypeScript in strict mode, SPA only (no Next.js)
- Live updates come over the backend snapshot WebSockets (`/portals/ws`, `/portals/log/ws`): each push is a complete page snapshot and must replace the previous server state atomically, not merge piecemeal
- The backend remains the single source of truth: no duplicated business logic in the frontend

Pending user consultation (do not assume): UI component library, state management, router, package manager, `frontend/` file layout, and how the app is served (docker service vs static hosting; Vite dev proxy for backend + WS in development).

Frontend code must keep the same strictness culture as the backend: no unchecked `any`, types shared conceptually with the pydantic schemas (snapshot shapes arrive as JSON and have TS types mirroring them).

# Project overview
Magic portals laboratory overseer dashboard. The API and WebSocket backend are complete; the frontend (a React SPA, see "Frontend info") is under development on branch `frontend/react-vite`. Main page is a table of portals with live updates delivered over a WebSocket; clicking a portal opens an expanded description with ability to act (leave open, stabilize, close, send/recall observer, mark/unmark, warn creatures). There's also an actions log where all committed actions are recorded.

## Rules
- Use typehints, project must be strictly typed, checked through mypy.
- All timestamps must be stored and compared in UTC. DB datetime columns must be timezone-aware (`DateTime(timezone=True)` / `timestamptz`).
- Username and password length constants live in `app/constants.py` and must be shared by DB models and Pydantic validators.
- Portal action conditions are validated inside `Portal` model methods: they raise `BadAction` with a Russian description; the route layer is responsible for DB commit and action log entries.

## Documentation
- API routes - necessary, summary and error codes must be explicitly listed
- Dependencies - necessary
- Pydantic models - only for fields that require explanation
- Database models - not needed, must be self-explanatory
- Code comments - no excessive section divisions, no titles, only appropriate amount of comments explaining the flow

## Structure
All changes to structure must be coordinated with user. If the file/directory does not exist, you may create it.
- `app/` contains main code, all items below are inside
- `models.py` - database models
- `db.py` - database session constructor and app lifecycle (init/create_all/dispose)
- `constants.py` - username/password/portal column length constants shared by models and schemas
- `exceptions.py` - `BadAction` exception raised by portal action methods
- `schemas.py` - pydantic models
- `deps.py` - dependencies functions and annotations. All frequently used dependency functions must use `Annotated[type, Depends(function)]` type alias for typehinting throughout the project.
- `config.py` - env-based settings, loaded once
- `security.py` - argon2 password hashing helpers
- `notifications.py` - Postgres `LISTEN/NOTIFY` hub broadcasting refresh events to WS subscribers (currently only the listener side runs, no producers yet)
- `main.py` - FastAPI app factory, CORS, router includes, lifespan
- `routes/auth.py` - authorization manager
- `routes/portals.py` - main app routes (list, WS updates, actions, log, stats)
- `routes/admin.py` - superuser-only user management
- `frontend/` - React + Vite SPA (not scaffolded yet; layout pending user consultation), see "Frontend info"

## Tests
Tests run against a real PostgreSQL via `testcontainers` (a `postgres:18-alpine` container is started per test session), not SQLite.

# `.context/` directory info
- `PROJECT_STATE.md` - put current plan, if it's present here. Put all completed milestones and added features here.
- `DECISIONS.md` - all architecture-related decisions must first be discussed with user then committed here. Any change conflicting with previously made decisions must be discussed with user.
- `LESSONS.md` - record user's corrections here to avoid making same mistake.

# Environment variables
When introducing a new environment variable, always do the following:
1. Add it to `.env.example`
2. Document it in the envvars table in `README.md`

# Running the project
The project runs through docker. `.env` is already created at the repo root and is picked up by `docker compose` automatically, so env vars must not be set manually before running. If it's not created, copy `.env.example` to `.env`
- Production: `docker compose up --build -d`
- Development (live reload): ensure `docker-compose.override.yml` exists, if not then copy `docker-compose.override.yml.dev` to `docker-compose.override.yml`. After that run project as usual (`docker compose up --build -d`)
- Tests and other checks are run through poetry: `poetry -C backend run pytest`, pre-commit from repo root
