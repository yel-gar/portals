# Portals

## Deployment

The stack runs through docker compose and picks up env vars from `.env` at the repo root (see the table below); nothing needs to be exported manually.

- **Production** — `docker compose up --build -d`. The backend image runs uvicorn as the unprivileged `app` user; the frontend image serves the built SPA from a single-worker nginx running as the `nginx` user (both Dockerfiles drop root at runtime).
- **Development (live reload)** — ensure `docker-compose.override.yml` exists; if missing, copy `docker-compose.override.yml.dev` to `docker-compose.override.yml`. If a copy predates a compose-template change (the `NET_BIND_SERVICE` capability and the worklog mount), re-copy it. Then run the project as usual (`docker compose up --build -d`). The Vite dev server runs as the `node` user (uid 1000, matching the host user, so the bind-mounted `./frontend` stays fully owned) and binds port 80 through the `NET_BIND_SERVICE` capability instead of root.

When upgrading a dev stack from the earlier root-user images: the `frontend_node_modules` named volume keeps root ownership, which the `node` user cannot write into — drop it once so it re-initializes from the image (`docker compose down && docker volume rm portals_frontend_node_modules && docker compose up -d --build`).

### Demo data

`populate.sh` (Linux/macOS) and `populate.ps1` (PowerShell 7+) seed the database with demo portals. They run the idempotent `backend/populate.py` inside the backend container via `/app/.venv/bin/python populate.py` — the venv python ships in the image, no poetry inside — and are safe to re-run: when portals already exist, the script prints a note and skips.

```bash
./populate.sh   # requires the stack to be running
```

### Worklog

The development journal is served by the frontend at `/AI-WORKLOG.md` straight from the repo-root `AI-WORKLOG.md`: production nginx and the dev Vite server both bind-mount it (see `docker-compose.yml` / `docker-compose.override.yml.dev`). There is no bundled copy to keep in sync — edit the root file and the page picks it up on the next reload.

## Environment variables

`POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB` are shared between the `postgres` and `backend` services and are interpolated from the project `.env` file (see `.env.example`). `POSTGRES_PASSWORD` must be non-empty; otherwise `docker compose` refuses to start.

`POSTGRES_HOST` and `POSTGRES_PORT` are set by `docker-compose.yml` for the backend service only.

| Name                         | Description                                                                                                                                                                                               | Default                                  | Required |
|------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------|----------|
| `POSTGRES_USER`              | PostgreSQL user, used by both `postgres` and `backend`                                                                                                                                                    | `postgres`                               | ❌       |
| `POSTGRES_PASSWORD`          | PostgreSQL password, used by both `postgres` and `backend`                                                                                                                                                | —                                        | ✅       |
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
| `INITIAL_SUPERUSER_USERNAME` | Backend-only: username of the initial superuser created/reconciled on startup; must be set together with `INITIAL_SUPERUSER_PASSWORD`                                                                     | —                                        | ❌       |
| `INITIAL_SUPERUSER_PASSWORD` | Backend-only: password of the initial superuser; when it changes, the stored hash is updated on the next startup (verified in `app/bootstrap.py`); must be set together with `INITIAL_SUPERUSER_USERNAME` | —                                        | ❌       |
| `PORTAL_OPEN_CHANCE`         | Backend-only: chance (0..1) of the portal simulator opening a new portal on each 10-second tick (0.05 ≈ one portal per 3–4 minutes)                                                                       | `0.05`                                   | ❌       |

> **Login over plain HTTP:** session cookies carry the `Secure` flag unless `DEBUG=1`. Browsers only accept `Secure` cookies from `https://` origins or `localhost`, so with `DEBUG=0` and a plain-`http://` URL (a LAN IP, a custom hostname, or any pre-TLS deployment) the login call appears to succeed but the cookie is silently rejected — every subsequent request 401s and the app bounces back to the login page. Keep `DEBUG=1` while the frontend is served over plain HTTP, or serve it over HTTPS.

When **both** `INITIAL_SUPERUSER_USERNAME` and `INITIAL_SUPERUSER_PASSWORD` are set, the app creates (or reconciles) a single superuser on startup: any superuser with a different name is deleted, while an existing superuser with the exact name is kept — and if its stored hash no longer matches the configured password, the hash is updated. Startup fails if a regular user already holds the configured username, or if only one of the two variables is set.
