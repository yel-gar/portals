# Portals

## Environment variables

`POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB` are shared between the `postgres` and `backend` services and are interpolated from the project `.env` file (see `.env.example`). `POSTGRES_PASSWORD` must be non-empty; otherwise `docker compose` refuses to start.

`POSTGRES_HOST` and `POSTGRES_PORT` are set by `docker-compose.yml` for the backend service only.

| Name               | Description                                                                     | Default                            | Required |
| ------------------ | ------------------------------------------------------------------------------- | ---------------------------------- | -------- |
| `POSTGRES_USER`    | PostgreSQL user, used by both `postgres` and `backend`                          | `postgres`                         | ❌ |
| `POSTGRES_PASSWORD`| PostgreSQL password, used by both `postgres` and `backend`                      | —                                  | ✅ |
| `POSTGRES_DB`      | PostgreSQL database name, used by both `postgres` and `backend`                 | `postgres`                         | ❌ |
| `POSTGRES_HOST`    | Backend-only: hostname of the `postgres` service                                | `postgres` (set in `docker-compose.yml`) | ❌ |
| `POSTGRES_PORT`    | Backend-only: port the `postgres` service listens on                            | `5432` (set in `docker-compose.yml`)     | ❌ |
| `BACKEND_PORT`     | Host port the `backend` container is published on, mapped to the container port `8000` | `8000`                              | ❌ |
| `FRONTEND_PORT`    | Host port the `frontend` container is published on, mapped to the container port `80` | `3000`                              | ❌ |
| `DATABASE_URL`     | Backend-only: overrides the URL assembled from `POSTGRES_*` (e.g. for local runs) | assembled from `POSTGRES_*`          | ❌ |
| `BACKEND_URL`      | Backend origin, added to the CORS allow-list                                   | ``                                  | ❌ |
| `FRONTEND_URL`     | Frontend origin, added to the CORS allow-list                                  | ``                                  | ❌ |
| `DEBUG`            | When truthy, session cookies are sent without the `Secure` flag                | `0`                                 | ❌ |
| `DISABLE_REGISTRATION` | When truthy, `POST /auth/register` returns `403` and public registration is disabled | `0`                          | ❌ |
| `INITIAL_SUPERUSER_USERNAME` | Backend-only: username of the initial superuser created on startup; must be set together with `INITIAL_SUPERUSER_PASSWORD` | — | ❌ |
| `INITIAL_SUPERUSER_PASSWORD` | Backend-only: password of the initial superuser created on startup; must be set together with `INITIAL_SUPERUSER_USERNAME` | — | ❌ |
| `PORTAL_OPEN_CHANCE` | Backend-only: chance (0..1) of the portal simulator opening a new portal on each 10-second tick (0.05 ≈ one portal per 3–4 minutes) | `0.05` | ❌ |

When **both** `INITIAL_SUPERUSER_USERNAME` and `INITIAL_SUPERUSER_PASSWORD` are set, the app creates (or reconciles) a single superuser on startup: any superuser with a different name is deleted, while an existing superuser with the exact name is kept (its password is never reset). Startup fails if a regular user already holds the configured username, or if only one of the two variables is set.
